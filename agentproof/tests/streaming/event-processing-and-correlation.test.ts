/**
 * AgentProof Streaming & Webhooks — Event Processing & Correlation Test Suite
 * 
 * Tests tenant-scoped correlation, independent observation integration (Phase 6 readers),
 * deterministic verdicts (PASS, FAIL, INCONCLUSIVE), and audit logging.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryWebhookEventRepository,
  InMemoryWebhookSourceRegistry,
  InMemoryPendingRequestRegistry,
  InMemoryAuditEventRepository,
  WebhookEventProcessor,
  WebhookSourceConfig,
  WebhookEventRecord,
} from '../../src/streaming/index.js';
import { InMemoryTraceRepository } from '../../src/persistence/in-memory-trace-repository.js';
import { VerificationRequest } from '../../src/core/domain/verification-request.js';
import { IExternalStateReader, ExternalObservationRecord } from '../../src/observation/contracts/state-reader.interface.js';

describe('Event Processing & Correlation', () => {
  let eventRepo: InMemoryWebhookEventRepository;
  let sourceRegistry: InMemoryWebhookSourceRegistry;
  let pendingRegistry: InMemoryPendingRequestRegistry;
  let traceRepo: InMemoryTraceRepository;
  let auditRepo: InMemoryAuditEventRepository;

  const tenantId = 'tenant-payments-prod';
  const sourceId = 'src-stripe-charges';

  const sourceConfig: WebhookSourceConfig = {
    sourceId,
    tenantId,
    provider: 'STRIPE',
    signatureScheme: 'HMAC_SHA256',
    secretRef: 'env:STRIPE_SECRET',
    signatureHeader: 'stripe-signature',
    timestampHeader: 'x-timestamp',
    eventIdHeader: 'x-event-id',
    maxClockSkewMs: 10000,
    replayRetentionMs: 86400000,
    allowedEvents: ['*'],
    enabled: true,
    autoVerifyState: false,
    correlationRule: {
      targetSystem: 'stripe',
      targetResourceTypeField: 'resourceType',
      targetResourceIdField: 'id',
      correlationIdField: 'data.object.id',
    },
  };

  const makeVerificationRequest = (
    requestId: string,
    chargeId: string,
    expectedStatus: string = 'succeeded',
    requireIndependent: boolean = false
  ): VerificationRequest => ({
    schemaVersion: '1.0.0',
    requestId,
    timestamp: new Date().toISOString(),
    target: {
      system: 'stripe',
      resourceType: 'charge',
      resourceId: chargeId,
      tenantId,
    },
    intent: {
      operation: 'CHARGE_CUSTOMER',
      summary: 'Process payment charge',
      expectedChanges: { status: expectedStatus },
    },
    preconditions: [],
    postconditions: [
      {
        id: 'post-status',
        description: 'Charge status must match expected',
        path: 'status',
        operator: 'EQUALS',
        expectedValue: expectedStatus,
        enforcement: 'REQUIRED',
      },
    ],
    policy: {
      timeoutMs: 5000,
      freshnessToleranceMs: 60000,
      requireIndependentSource: requireIndependent,
    },
  });

  const makeWebhookRecord = (
    internalId: string,
    chargeId: string,
    statusVal: string
  ): WebhookEventRecord => ({
    internalEventId: internalId,
    tenantId,
    sourceId,
    externalEventId: `evt_${chargeId}`,
    eventType: 'charge.succeeded',
    payloadDigest: 'sha256-digest-mock-1234567890abcdef1234567890abcdef1234567890abcdef',
    parsedPayload: {
      id: `evt_${chargeId}`,
      type: 'charge.succeeded',
      data: {
        object: {
          id: chargeId,
          status: statusVal,
        },
      },
      status: statusVal,
    },
    receivedAt: new Date().toISOString(),
    eventTimestamp: new Date().toISOString(),
    signatureVerification: {
      isValid: true,
      category: 'VALID',
      scheme: 'HMAC_SHA256',
      verifiedAt: new Date().toISOString(),
    },
    status: 'QUEUED',
    attempts: 0,
  });

  beforeEach(() => {
    eventRepo = new InMemoryWebhookEventRepository();
    sourceRegistry = new InMemoryWebhookSourceRegistry();
    pendingRegistry = new InMemoryPendingRequestRegistry();
    traceRepo = new InMemoryTraceRepository();
    auditRepo = new InMemoryAuditEventRepository();

    sourceRegistry.register(sourceConfig);
  });

  it('correlates a webhook event with a pending request and produces a PASS verdict', async () => {
    const processor = new WebhookEventProcessor({
      eventRepository: eventRepo,
      sourceRegistry,
      pendingRegistry,
      traceRepository: traceRepo,
      auditRepository: auditRepo,
    });

    const chargeId = 'ch_test_12345';
    const req = makeVerificationRequest('req-101', chargeId, 'succeeded', false);
    await pendingRegistry.register({
      tenantId,
      requestId: req.requestId,
      request: req,
      correlationId: chargeId,
      targetResourceId: chargeId,
      targetResourceType: 'charge',
      registeredAt: new Date().toISOString(),
    });

    const event = makeWebhookRecord('evt-int-101', chargeId, 'succeeded');
    await eventRepo.create(event);

    const processed = await processor.processEvent(tenantId, 'evt-int-101');
    expect(processed).toBe(true);

    const updatedEvent = await eventRepo.getById(tenantId, 'evt-int-101');
    expect(updatedEvent?.status).toBe('COMPLETED');
    expect(updatedEvent?.traceId).toBeDefined();

    // Trace persisted
    const trace = await traceRepo.getByTenantAndId(tenantId, updatedEvent!.traceId!);
    expect(trace).not.toBeNull();
    expect(trace?.result.overallVerdict).toBe('PASS');

    // Audit event recorded
    const auditEvents = await auditRepo.getEvents(tenantId);
    expect(auditEvents.length).toBeGreaterThan(0);
    expect(auditEvents[0].eventType).toBe('VERIFICATION_COMPLETED');
  });

  it('handles unmatched webhook without fabricating a verification request', async () => {
    const processor = new WebhookEventProcessor({
      eventRepository: eventRepo,
      sourceRegistry,
      pendingRegistry,
      traceRepository: traceRepo,
      auditRepository: auditRepo,
    });

    // Ingest event with no corresponding pending request
    const event = makeWebhookRecord('evt-unmatched-1', 'ch_orphan_999', 'succeeded');
    await eventRepo.create(event);

    const processed = await processor.processEvent(tenantId, 'evt-unmatched-1');
    expect(processed).toBe(true);

    const updatedEvent = await eventRepo.getById(tenantId, 'evt-unmatched-1');
    expect(updatedEvent?.status).toBe('COMPLETED');
    expect(updatedEvent?.errorCategory).toBe('UNMATCHED');

    // Trace was NOT fabricated
    const traces = await traceRepo.listByTenant(tenantId);
    expect(traces.length).toBe(0);

    // Audit record logged UNMATCHED event
    const auditEvents = await auditRepo.getEvents(tenantId);
    expect(auditEvents.some((a) => a.eventType === 'WEBHOOK_EVENT_UNMATCHED')).toBe(true);
  });

  it('strictly enforces tenant isolation: cannot correlate across tenant boundaries', async () => {
    const processor = new WebhookEventProcessor({
      eventRepository: eventRepo,
      sourceRegistry,
      pendingRegistry,
      traceRepository: traceRepo,
      auditRepository: auditRepo,
    });

    // Register pending request for tenant A
    const req = makeVerificationRequest('req-tenant-b', 'ch_cross_1', 'succeeded', false);
    await pendingRegistry.register({
      tenantId: 'tenant-B',
      requestId: req.requestId,
      request: req,
      correlationId: 'ch_cross_1',
      targetResourceId: 'ch_cross_1',
      targetResourceType: 'charge',
      registeredAt: new Date().toISOString(),
    });

    // Event arrives for tenant A
    const event = makeWebhookRecord('evt-cross-tenant', 'ch_cross_1', 'succeeded');
    await eventRepo.create(event);

    await processor.processEvent(tenantId, 'evt-cross-tenant');

    // Tenant A event does NOT correlate with Tenant B request
    const pendingB = await pendingRegistry.getById('tenant-B', 'req-tenant-b');
    expect(pendingB).not.toBeNull(); // Still pending
  });

  it('performs independent state read when mandated by policy, producing PASS on confirmed state', async () => {
    const chargeId = 'ch_independent_1';
    const mockStateReader: IExternalStateReader = {
      sourceId: 'stripe',
      sourceType: 'REST_API',
      integrationId: 'int-stripe-1',
      tenantId,
      readState: async (target) => ({
        status: 'FOUND',
        target,
        observedAt: new Date().toISOString(),
        payload: { status: 'succeeded', amount: 5000 },
        sourceId: 'stripe',
        sourceType: 'REST_API',
        integrationId: 'int-stripe-1',
        tenantId,
      }),
    };

    const processor = new WebhookEventProcessor({
      eventRepository: eventRepo,
      sourceRegistry,
      pendingRegistry,
      traceRepository: traceRepo,
      auditRepository: auditRepo,
      stateReaders: [mockStateReader],
    });

    // Request requires independent source
    const req = makeVerificationRequest('req-indep-1', chargeId, 'succeeded', true);
    await pendingRegistry.register({
      tenantId,
      requestId: req.requestId,
      request: req,
      correlationId: chargeId,
      targetResourceId: chargeId,
      targetResourceType: 'charge',
      registeredAt: new Date().toISOString(),
    });

    const event = makeWebhookRecord('evt-indep-1', chargeId, 'succeeded');
    await eventRepo.create(event);

    await processor.processEvent(tenantId, 'evt-indep-1');

    const updatedEvent = await eventRepo.getById(tenantId, 'evt-indep-1');
    const trace = await traceRepo.getByTenantAndId(tenantId, updatedEvent!.traceId!);
    expect(trace?.result.overallVerdict).toBe('PASS');
  });

  it('produces INCONCLUSIVE when independent read fails (never converting read error into FAIL)', async () => {
    const chargeId = 'ch_timeout_1';
    const failingStateReader: IExternalStateReader = {
      sourceId: 'stripe',
      sourceType: 'REST_API',
      integrationId: 'int-stripe-fail',
      tenantId,
      readState: async (target) => ({
        status: 'READ_ERROR',
        target,
        observedAt: new Date().toISOString(),
        payload: null,
        sourceId: 'stripe',
        sourceType: 'REST_API',
        integrationId: 'int-stripe-fail',
        tenantId,
        errorCategory: 'TIMEOUT',
        errorMessage: 'Connection to Stripe API timed out',
        limitations: ['TIMEOUT_CONNECTING_TO_API'],
      }),
    };

    const processor = new WebhookEventProcessor({
      eventRepository: eventRepo,
      sourceRegistry,
      pendingRegistry,
      traceRepository: traceRepo,
      auditRepository: auditRepo,
      stateReaders: [failingStateReader],
    });

    const req = makeVerificationRequest('req-fail-indep', chargeId, 'succeeded', true);
    await pendingRegistry.register({
      tenantId,
      requestId: req.requestId,
      request: req,
      correlationId: chargeId,
      targetResourceId: chargeId,
      targetResourceType: 'charge',
      registeredAt: new Date().toISOString(),
    });

    const event = makeWebhookRecord('evt-fail-indep', chargeId, 'succeeded');
    await eventRepo.create(event);

    await processor.processEvent(tenantId, 'evt-fail-indep');

    const updatedEvent = await eventRepo.getById(tenantId, 'evt-fail-indep');
    const trace = await traceRepo.getByTenantAndId(tenantId, updatedEvent!.traceId!);

    // CRITICAL INVARIANT: Read error must produce INCONCLUSIVE, NOT FAIL!
    expect(trace?.result.overallVerdict).toBe('INCONCLUSIVE');
  });

  it('produces FAIL when independent reader establishes postcondition is violated', async () => {
    const chargeId = 'ch_failed_payment';
    const stateReaderViolation: IExternalStateReader = {
      sourceId: 'stripe',
      sourceType: 'REST_API',
      integrationId: 'int-stripe-violation',
      tenantId,
      readState: async (target) => ({
        status: 'FOUND',
        target,
        observedAt: new Date().toISOString(),
        payload: { status: 'failed', failureCode: 'card_declined' },
        sourceId: 'stripe',
        sourceType: 'REST_API',
        integrationId: 'int-stripe-violation',
        tenantId,
      }),
    };

    const processor = new WebhookEventProcessor({
      eventRepository: eventRepo,
      sourceRegistry,
      pendingRegistry,
      traceRepository: traceRepo,
      auditRepository: auditRepo,
      stateReaders: [stateReaderViolation],
    });

    const req = makeVerificationRequest('req-violation', chargeId, 'succeeded', true);
    await pendingRegistry.register({
      tenantId,
      requestId: req.requestId,
      request: req,
      correlationId: chargeId,
      targetResourceId: chargeId,
      targetResourceType: 'charge',
      registeredAt: new Date().toISOString(),
    });

    const event = makeWebhookRecord('evt-violation', chargeId, 'failed');
    await eventRepo.create(event);

    await processor.processEvent(tenantId, 'evt-violation');

    const updatedEvent = await eventRepo.getById(tenantId, 'evt-violation');
    const trace = await traceRepo.getByTenantAndId(tenantId, updatedEvent!.traceId!);
    expect(trace?.result.overallVerdict).toBe('FAIL');
  });
});
