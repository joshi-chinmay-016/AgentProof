/**
 * AgentProof Streaming & Webhooks — Webhook Event Correlator
 * 
 * Correlates incoming webhook events to pending verification requests.
 * Enforces tenant isolation, validates event types, rejects ambiguous candidates,
 * and preserves audit linkages.
 */

import { WebhookEventRecord } from '../contracts/webhook.interface.js';
import { WebhookSourceConfig } from '../registry/webhook-source.schema.js';
import { VerificationRequest } from '../../core/domain/verification-request.js';
import { IPendingRequestRegistry } from './pending-request-registry.js';

export type CorrelationOutcome =
  | 'MATCHED'
  | 'UNMATCHED'
  | 'AMBIGUOUS'
  | 'DISALLOWED_EVENT_TYPE'
  | 'TENANT_MISMATCH';

export interface CorrelationResult {
  readonly outcome: CorrelationOutcome;
  readonly matchedRequest?: VerificationRequest;
  readonly correlationId?: string;
  readonly reason?: string;
}

export class EventCorrelator {
  private readonly pendingRegistry: IPendingRequestRegistry;

  constructor(pendingRegistry: IPendingRequestRegistry) {
    this.pendingRegistry = pendingRegistry;
  }

  /**
   * Safe property path extractor for nested payload objects (e.g., 'data.order.id')
   */
  private extractByPath(obj: unknown, pathStr: string): unknown {
    if (!obj || typeof obj !== 'object') return undefined;
    const parts = pathStr.split('.');
    let current: any = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = current[part];
    }
    return current;
  }

  public async correlate(
    event: WebhookEventRecord,
    source: WebhookSourceConfig
  ): Promise<CorrelationResult> {
    // 1. Verify tenant boundary
    if (event.tenantId !== source.tenantId) {
      return {
        outcome: 'TENANT_MISMATCH',
        reason: `Event tenant (${event.tenantId}) does not match source tenant (${source.tenantId})`,
      };
    }

    // 2. Validate allowed event types if configured
    if (source.allowedEvents && !source.allowedEvents.includes('*') && !source.allowedEvents.includes(event.eventType)) {
      return {
        outcome: 'DISALLOWED_EVENT_TYPE',
        reason: `Event type '${event.eventType}' is not permitted by source config (allowed: ${source.allowedEvents.join(', ')})`,
      };
    }

    const payload = event.parsedPayload;

    // 3. Extract candidate correlation identifiers
    const candidates: string[] = [];

    // Check custom configured property path
    if (source.correlationRule?.correlationIdField) {
      const val = this.extractByPath(payload, source.correlationRule.correlationIdField);
      if (typeof val === 'string' && val.length > 0) {
        candidates.push(val);
      }
    }

    // Check standard candidate property paths
    const standardPaths = [
      'requestId',
      'correlationId',
      'traceId',
      'data.requestId',
      'data.correlationId',
      'data.traceId',
      'metadata.requestId',
      'metadata.correlationId',
    ];

    for (const p of standardPaths) {
      const val = this.extractByPath(payload, p);
      if (typeof val === 'string' && val.length > 0 && !candidates.includes(val)) {
        candidates.push(val);
      }
    }

    // Try correlating by candidate ID
    for (const candidate of candidates) {
      const matches = await this.pendingRegistry.findByCorrelation(event.tenantId, candidate);
      if (matches.length === 1) {
        return {
          outcome: 'MATCHED',
          matchedRequest: matches[0].request,
          correlationId: candidate,
        };
      }
      if (matches.length > 1) {
        return {
          outcome: 'AMBIGUOUS',
          correlationId: candidate,
          reason: `Ambiguous correlation: multiple pending verification requests matched key '${candidate}'`,
        };
      }
    }

    // 4. Try correlating by resource target (if resourceType and resourceId exist)
    const resourceTypeField = source.correlationRule?.targetResourceTypeField ?? 'resourceType';
    const resourceIdField = source.correlationRule?.targetResourceIdField ?? 'id';

    const resourceType = this.extractByPath(payload, resourceTypeField) || this.extractByPath(payload, 'data.resourceType');
    const resourceId = this.extractByPath(payload, resourceIdField) || this.extractByPath(payload, 'data.resourceId') || this.extractByPath(payload, 'data.id');

    if (typeof resourceType === 'string' && typeof resourceId === 'string') {
      const resourceMatches = await this.pendingRegistry.findByResource(
        event.tenantId,
        resourceType,
        resourceId
      );

      if (resourceMatches.length === 1) {
        return {
          outcome: 'MATCHED',
          matchedRequest: resourceMatches[0].request,
          correlationId: `${resourceType}:${resourceId}`,
        };
      }
      if (resourceMatches.length > 1) {
        return {
          outcome: 'AMBIGUOUS',
          correlationId: `${resourceType}:${resourceId}`,
          reason: `Ambiguous correlation: multiple pending requests for resource '${resourceType}:${resourceId}'`,
        };
      }
    }

    // 5. No match found
    return {
      outcome: 'UNMATCHED',
      reason: 'No matching pending verification request found for tenant and event correlation keys',
    };
  }
}
