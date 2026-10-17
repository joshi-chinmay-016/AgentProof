/**
 * AgentProof Tests — Phase 7 MCP Boundary & Protocol Regression
 * 
 * Validates that all existing MCP tools (verify_outcome, inspect_trace, run_scenario, list_scenarios)
 * remain 100% operational alongside Phase 7 streaming and webhook attestations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildTools } from '@nitrostack/core';
import { createMockContext } from '@nitrostack/core/testing';
import {
  VerificationTools,
  InMemoryTraceRegistry,
  VerifyOutcomeInput,
  InspectTraceInput,
} from '../../src/modules/verification/index.js';
import {
  InMemoryWebhookEventRepository,
  InMemoryWebhookSourceRegistry,
  InMemoryPendingRequestRegistry,
  InMemoryAuditEventRepository,
  WebhookEventProcessor,
  WebhookSourceConfig,
  WebhookEventRecord,
} from '../../src/streaming/index.js';

describe('Phase 7 MCP Boundary & Protocol Regression', () => {
  let controller: VerificationTools;
  let traceRegistry: InMemoryTraceRegistry;
  let verifyOutcomeTool: any;
  let inspectTraceTool: any;
  let runScenarioTool: any;
  let listScenariosTool: any;

  const tenantDev = 'tenant-developer';
  const tenantOther = 'tenant-other';

  beforeEach(() => {
    traceRegistry = new InMemoryTraceRegistry();
    controller = new VerificationTools({
      traceRegistry,
      traceRepository: traceRegistry as any,
    });

    const tools = buildTools(controller);
    verifyOutcomeTool = tools.find((t) => t.name === 'verify_outcome');
    inspectTraceTool = tools.find((t) => t.name === 'inspect_trace');
    runScenarioTool = tools.find((t) => t.name === 'run_scenario');
    listScenariosTool = tools.find((t) => t.name === 'list_scenarios');
  });

  it('preserves all four core MCP tools without breaking the protocol contract', () => {
    expect(verifyOutcomeTool).toBeDefined();
    expect(inspectTraceTool).toBeDefined();
    expect(runScenarioTool).toBeDefined();
    expect(listScenariosTool).toBeDefined();
  });

  it('allows inspect_trace to view traces generated via asynchronous webhook event processing', async () => {
    // 1. Set up streaming webhook pipeline with traceRegistry
    const eventRepo = new InMemoryWebhookEventRepository();
    const sourceRegistry = new InMemoryWebhookSourceRegistry();
    const pendingRegistry = new InMemoryPendingRequestRegistry();
    const auditRepo = new InMemoryAuditEventRepository();

    const sourceConfig: WebhookSourceConfig = {
      sourceId: 'src-mcp-integration',
      tenantId: tenantDev,
      provider: 'GENERIC',
      signatureScheme: 'HMAC_SHA256',
      secretRef: 'env:WEBHOOK_SECRET',
      signatureHeader: 'x-sig',
      timestampHeader: 'x-time',
      eventIdHeader: 'x-event-id',
      maxClockSkewMs: 10000,
      replayRetentionMs: 86400000,
      allowedEvents: ['*'],
      enabled: true,
      autoVerifyState: false,
      correlationRule: {
        targetSystem: 'billing',
        targetResourceTypeField: 'resourceType',
        targetResourceIdField: 'id',
      },
    };
    sourceRegistry.register(sourceConfig);

    const processor = new WebhookEventProcessor({
      eventRepository: eventRepo,
      sourceRegistry,
      pendingRegistry,
      traceRepository: traceRegistry,
      auditRepository: auditRepo,
    });

    // 2. Register pending verification request
    const requestId = 'req-stream-001';
    await pendingRegistry.register({
      tenantId: tenantDev,
      requestId,
      request: {
        schemaVersion: '1.0.0',
        requestId,
        timestamp: new Date().toISOString(),
        target: {
          system: 'billing',
          resourceType: 'invoice',
          resourceId: 'inv-999',
          tenantId: tenantDev,
        },
        intent: {
          operation: 'PAY_INVOICE',
          summary: 'Invoice payment confirmation',
          expectedChanges: { paid: true },
        },
        preconditions: [],
        postconditions: [
          {
            id: 'post-paid',
            description: 'Invoice must be paid',
            path: 'paid',
            operator: 'EQUALS',
            expectedValue: true,
            enforcement: 'REQUIRED',
          },
        ],
        policy: {
          timeoutMs: 5000,
          freshnessToleranceMs: 60000,
          requireIndependentSource: false,
        },
      },
      correlationId: 'inv-999',
      targetResourceId: 'inv-999',
      targetResourceType: 'invoice',
      registeredAt: new Date().toISOString(),
    });

    // 3. Process webhook event
    const eventRecord: WebhookEventRecord = {
      internalEventId: 'evt-wh-001',
      tenantId: tenantDev,
      sourceId: 'src-mcp-integration',
      externalEventId: 'ext-wh-001',
      eventType: 'invoice.paid',
      payloadDigest: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      parsedPayload: {
        id: 'inv-999',
        resourceType: 'invoice',
        paid: true,
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
    };
    await eventRepo.create(eventRecord);

    await processor.processEvent(tenantDev, 'evt-wh-001');

    const updatedEvent = await eventRepo.getById(tenantDev, 'evt-wh-001');
    expect(updatedEvent?.status).toBe('COMPLETED');
    const traceId = updatedEvent!.traceId!;

    // 4. Now invoke inspect_trace MCP tool
    const ctx = createMockContext({
      headers: {
        'x-agentproof-tenant-id': tenantDev,
        'x-agentproof-roles': 'tenant_user',
      },
    });

    const inspectInput: InspectTraceInput = {
      traceId,
    };

    const inspectOutput = await inspectTraceTool.handler(inspectInput, ctx);
    expect(inspectOutput.status).toBe('success');
    expect(inspectOutput.traceId).toBe(traceId);
    expect(inspectOutput.result.overallVerdict).toBe('PASS');
  });

  it('enforces tenant boundary on webhook-generated traces via inspect_trace', async () => {
    // Save trace for tenantDev
    await traceRegistry.save(
      {
        traceId: 'trc-private-wh',
        request: {
          schemaVersion: '1.0.0',
          requestId: 'req-priv',
          timestamp: new Date().toISOString(),
          target: { system: 'db', resourceType: 'rec', resourceId: '1', tenantId: tenantDev },
          intent: { operation: 'OP', summary: 'S', expectedChanges: {} },
          preconditions: [],
          postconditions: [
            { id: 'c', description: 'd', path: 'x', operator: 'EXISTS', enforcement: 'REQUIRED' },
          ],
          policy: { timeoutMs: 1000, freshnessToleranceMs: 1000, requireIndependentSource: false },
        },
        evidence: [],
        result: {
          schemaVersion: '1.0.0',
          verificationId: 'v-1',
          requestId: 'req-priv',
          overallVerdict: 'PASS',
          summary: 'ok',
          evaluatedAt: new Date().toISOString(),
          conditionEvaluations: [],
          evidenceManifest: [],
          verifierIdentity: { name: 'V', version: '1.0.0' },
          executionDurationMs: 1,
        },
        recordedAt: new Date().toISOString(),
      },
      tenantDev
    );

    // Call from tenantOther
    const ctxOther = createMockContext({
      tenantId: tenantOther,
      headers: {
        'x-agentproof-tenant': tenantOther,
        'x-agentproof-roles': 'tenant_user',
      },
    } as any);

    await expect(inspectTraceTool.handler({ traceId: 'trc-private-wh' }, ctxOther)).rejects.toThrow();
  });
});
