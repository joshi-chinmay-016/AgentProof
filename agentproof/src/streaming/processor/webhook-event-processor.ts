/**
 * AgentProof Streaming & Webhooks — Webhook Event Processor
 * 
 * Asynchronous worker that processes durably stored webhook events:
 * correlates events with pending verification requests, performs independent
 * observations when mandated, evaluates deterministic verdicts, persists traces,
 * appends tamper-evident audit records, and handles retries and crash recovery.
 */

import * as crypto from 'node:crypto';
import { IWebhookEventRepository } from '../persistence/webhook-event-repository.interface.js';
import { IWebhookSourceRegistry } from '../registry/webhook-source-registry.js';
import { IPendingRequestRegistry } from './pending-request-registry.js';
import { EventCorrelator } from './event-correlator.js';
import { IAuditEventRepository } from '../audit/audit-repository.interface.js';
import { ITraceRepository } from '../../persistence/trace-repository.interface.js';
import { VerificationEngine } from '../../core/verification/verification-engine.js';
import { ExternalEvidenceAdapter } from '../../observation/adapters/external-evidence-adapter.js';
import { IExternalStateReader, ExternalObservationRecord } from '../../observation/contracts/state-reader.interface.js';
import { VerificationTrace } from '../../core/domain/verification-trace.js';
import { Evidence } from '../../core/domain/evidence.js';
import { ResourceTarget } from '../../core/domain/verification-request.js';

export interface WebhookEventProcessorOptions {
  readonly eventRepository: IWebhookEventRepository;
  readonly sourceRegistry: IWebhookSourceRegistry;
  readonly pendingRegistry: IPendingRequestRegistry;
  readonly correlator?: EventCorrelator;
  readonly verificationEngine?: VerificationEngine;
  readonly traceRepository?: ITraceRepository;
  readonly auditRepository?: IAuditEventRepository;
  readonly stateReaders?: readonly IExternalStateReader[];
  readonly maxRetries?: number;
}

export class WebhookEventProcessor {
  private readonly eventRepository: IWebhookEventRepository;
  private readonly sourceRegistry: IWebhookSourceRegistry;
  private readonly pendingRegistry: IPendingRequestRegistry;
  private readonly correlator: EventCorrelator;
  private readonly engine: VerificationEngine;
  private readonly traceRepository?: ITraceRepository;
  private readonly auditRepository?: IAuditEventRepository;
  private readonly stateReaders: readonly IExternalStateReader[];
  private readonly evidenceAdapter: ExternalEvidenceAdapter;
  private readonly maxRetries: number;
  private workerTimer?: NodeJS.Timeout;
  private isProcessing = false;

  constructor(options: WebhookEventProcessorOptions) {
    this.eventRepository = options.eventRepository;
    this.sourceRegistry = options.sourceRegistry;
    this.pendingRegistry = options.pendingRegistry;
    this.correlator = options.correlator ?? new EventCorrelator(options.pendingRegistry);
    this.engine = options.verificationEngine ?? new VerificationEngine();
    this.traceRepository = options.traceRepository;
    this.auditRepository = options.auditRepository;
    this.stateReaders = options.stateReaders ?? [];
    this.evidenceAdapter = new ExternalEvidenceAdapter();
    this.maxRetries = options.maxRetries ?? 3;
  }

  private findStateReader(tenantId: string, target: ResourceTarget): IExternalStateReader | undefined {
    return this.stateReaders.find((reader) => {
      if (reader.tenantId !== tenantId) return false;
      if (reader.sourceId === target.system) return true;
      if (reader.sourceType.toLowerCase() === target.system.toLowerCase()) return true;
      return false;
    });
  }

  /**
   * Dispatches immediate processing for an event (e.g. from WebhookReceiver callback).
   */
  public async dispatch(tenantId: string, internalEventId: string): Promise<boolean> {
    return this.processEvent(tenantId, internalEventId);
  }

  /**
   * Processes a single event by internalEventId.
   */
  public async processEvent(tenantId: string, internalEventId: string): Promise<boolean> {
    const event = await this.eventRepository.getById(tenantId, internalEventId);
    if (!event) return false;

    // Idempotent: do not re-process completed events
    if (event.status === 'COMPLETED') {
      return true;
    }

    if (event.status === 'PERMANENT_FAILURE' || event.status === 'QUARANTINED') {
      return false;
    }

    // Move to PROCESSING atomically
    try {
      await this.eventRepository.updateStatus(tenantId, internalEventId, 'PROCESSING', {
        incrementAttempts: true,
      });
    } catch {
      // Transition failed (e.g. already in processing or completed)
      return false;
    }

    try {
      // 1. Resolve configured source
      const source = await this.sourceRegistry.getSource(event.sourceId);
      if (!source || !source.enabled) {
        await this.eventRepository.updateStatus(tenantId, internalEventId, 'PERMANENT_FAILURE', {
          lastError: `Source '${event.sourceId}' is unavailable or disabled`,
          errorCategory: 'SOURCE_UNAVAILABLE',
        });
        if (this.auditRepository) {
          await this.auditRepository.append(tenantId, {
            auditId: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            eventType: 'WEBHOOK_SOURCE_UNAVAILABLE',
            entityId: event.internalEventId,
            payload: { sourceId: event.sourceId, eventId: event.internalEventId },
          });
        }
        return false;
      }

      // 2. Correlate event with pending verification request
      const correlation = await this.correlator.correlate(event, source);

      if (correlation.outcome === 'UNMATCHED') {
        // Event does not match any expected pending request.
        // Record audit event and complete without creating a false verification trace.
        if (this.auditRepository) {
          await this.auditRepository.append(tenantId, {
            auditId: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            eventType: 'WEBHOOK_EVENT_UNMATCHED',
            entityId: event.internalEventId,
            payload: {
              sourceId: event.sourceId,
              eventType: event.eventType,
              externalEventId: event.externalEventId,
              reason: correlation.reason,
            },
          });
        }

        await this.eventRepository.updateStatus(tenantId, internalEventId, 'COMPLETED', {
          lastError: correlation.reason,
          errorCategory: 'UNMATCHED',
          completedAt: new Date().toISOString(),
        });
        return true;
      }

      if (correlation.outcome === 'AMBIGUOUS' || correlation.outcome === 'DISALLOWED_EVENT_TYPE' || correlation.outcome === 'TENANT_MISMATCH') {
        if (this.auditRepository) {
          await this.auditRepository.append(tenantId, {
            auditId: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            eventType: 'WEBHOOK_EVENT_REJECTED',
            entityId: event.internalEventId,
            payload: {
              sourceId: event.sourceId,
              outcome: correlation.outcome,
              reason: correlation.reason,
            },
          });
        }

        await this.eventRepository.updateStatus(tenantId, internalEventId, 'PERMANENT_FAILURE', {
          lastError: correlation.reason,
          errorCategory: correlation.outcome,
        });
        return false;
      }

      // 3. Matched pending verification request
      const matchedRequest = correlation.matchedRequest!;
      const evidenceList: Evidence[] = [];

      // Determine if independent state observation is required
      const requireIndependent = source.autoVerifyState || matchedRequest.policy.requireIndependentSource;

      if (requireIndependent) {
        const stateReader = this.findStateReader(tenantId, matchedRequest.target);
        if (stateReader) {
          const obsRecord = await stateReader.readState(matchedRequest.target);
          const evidence = this.evidenceAdapter.toEvidence(obsRecord, { includeFailureRecord: true });
          if (evidence) {
            evidenceList.push(evidence);
          }
        } else {
          // Independent observation required but no matching state reader configured
          const failureRecord: ExternalObservationRecord = {
            status: 'READ_ERROR',
            target: matchedRequest.target,
            observedAt: new Date().toISOString(),
            payload: null,
            sourceId: matchedRequest.target.system,
            sourceType: 'REST_API',
            integrationId: 'unconfigured',
            tenantId,
            errorCategory: 'UNKNOWN',
            errorMessage: 'Independent observation mandated by policy, but no matching external state reader is configured',
            limitations: ['REQUIRED_INDEPENDENT_SOURCE_UNAVAILABLE'],
          };
          const failureEvidence = this.evidenceAdapter.toEvidence(failureRecord, { includeFailureRecord: true });
          if (failureEvidence) {
            evidenceList.push(failureEvidence);
          }
        }
      } else {
        // Direct webhook payload evidence (when independent observation is not required)
        evidenceList.push({
          evidenceId: `ev-wh-${event.internalEventId.slice(0, 16)}`,
          schemaVersion: '1.0.0',
          evidenceType: 'STATE_SNAPSHOT',
          sourceId: event.sourceId,
          sourceKind: 'EXTERNAL_API',
          target: matchedRequest.target,
          observedPayload: event.parsedPayload,
          observedAt: event.eventTimestamp,
          freshnessMs: Math.max(0, Date.now() - new Date(event.eventTimestamp).getTime()),
          integrityHash: event.payloadDigest,
          limitations: [],
          canonicalizationVersion: 'v1',
          provenance: {
            observerIdentity: 'AgentProof-WebhookReceiver',
            observerType: 'EXTERNAL',
            trustLevel: 'SOURCE_AUTHENTICATED',
          },
          observationStatus: 'FOUND',
        });
      }

      // 4. Run deterministic verification engine
      const verificationResult = await this.engine.verify(matchedRequest, evidenceList);

      // 5. Construct immutable VerificationTrace
      const traceId = `trc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const trace: VerificationTrace = {
        traceId,
        request: matchedRequest,
        evidence: evidenceList,
        result: verificationResult,
        recordedAt: new Date().toISOString(),
      };

      // 6. Persist trace durably
      if (this.traceRepository) {
        await this.traceRepository.save(trace, tenantId);
      }

      // 7. Append tamper-evident audit record
      if (this.auditRepository) {
        await this.auditRepository.append(tenantId, {
          auditId: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
          eventType: 'VERIFICATION_COMPLETED',
          entityId: traceId,
          payload: {
            traceId,
            requestId: matchedRequest.requestId,
            verdict: verificationResult.overallVerdict,
            reasons: verificationResult.conditionEvaluations.map((c) => c.reasonCode),
            webhookEventId: event.internalEventId,
            sourceId: event.sourceId,
          },
          metadata: {
            correlationId: correlation.correlationId,
          },
        });
      }

      // 8. Clean up correlated pending request
      await this.pendingRegistry.remove(tenantId, matchedRequest.requestId);

      // 9. Update event status to COMPLETED
      await this.eventRepository.updateStatus(tenantId, internalEventId, 'COMPLETED', {
        traceId,
        correlationId: correlation.correlationId,
        completedAt: new Date().toISOString(),
      });

      return true;
    } catch (procErr: any) {
      const refreshedEvent = await this.eventRepository.getById(tenantId, internalEventId);
      const attempts = refreshedEvent ? refreshedEvent.attempts : 1;
      const isRetryable = attempts < this.maxRetries;
      const nextStatus = isRetryable ? 'RETRYABLE_FAILURE' : 'PERMANENT_FAILURE';

      await this.eventRepository.updateStatus(tenantId, internalEventId, nextStatus, {
        lastError: procErr.message ?? 'Unknown processing error',
        errorCategory: isRetryable ? 'RETRYABLE_PROCESSING_ERROR' : 'MAX_RETRIES_EXCEEDED',
      });

      if (this.auditRepository) {
        await this.auditRepository.append(tenantId, {
          auditId: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
          eventType: 'WEBHOOK_PROCESSING_FAILED',
          entityId: event.internalEventId,
          payload: {
            eventId: event.internalEventId,
            attempts,
            isRetryable,
            error: procErr.message,
          },
        });
      }

      return false;
    }
  }

  /**
   * Scans and processes pending events across tenants.
   */
  public async processPending(limit: number = 10): Promise<number> {
    const pending = await this.eventRepository.getPendingEvents(undefined, limit);
    let processed = 0;
    for (const evt of pending) {
      const ok = await this.processEvent(evt.tenantId, evt.internalEventId);
      if (ok) processed++;
    }
    return processed;
  }

  /**
   * Recovers any in-flight events left in PROCESSING state after a process crash.
   */
  public async recoverOnStartup(tenantId?: string): Promise<number> {
    return this.eventRepository.recoverInFlightEvents(tenantId);
  }

  /**
   * Starts a background polling loop.
   */
  public startWorker(pollIntervalMs: number = 1000): void {
    if (this.workerTimer) return;
    this.workerTimer = setInterval(async () => {
      if (this.isProcessing) return;
      this.isProcessing = true;
      try {
        await this.processPending(10);
      } catch (err: any) {
        console.error(`[WebhookEventProcessor] Worker polling error: ${err?.message}`);
      } finally {
        this.isProcessing = false;
      }
    }, pollIntervalMs);
  }

  /**
   * Stops the background polling loop.
   */
  public async stopWorker(): Promise<void> {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = undefined;
    }
  }
}
