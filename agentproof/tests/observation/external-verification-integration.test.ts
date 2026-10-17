/**
 * AgentProof End-to-End Verification Integration Tests — 10 Required Cases
 * 
 * Demonstrates all 10 canonical verification integration cases:
 * Case 1: Genuine success -> PASS
 * Case 2: False success -> FAIL
 * Case 3: Wrong resource -> FAIL
 * Case 4: Observation unavailable -> INCONCLUSIVE
 * Case 5: Confirmed absence -> PASS (deletion)
 * Case 6: Untrusted evidence -> INCONCLUSIVE
 * Case 7: Cross-tenant access -> Access Denied
 * Case 8: Stale observation -> INCONCLUSIVE
 * Case 9: Source conflict -> INCONCLUSIVE
 * Case 10: Trace persistence -> Trace survives reopening
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  VerificationEngine,
  VerificationRequest,
  ActionRecord,
  Evidence,
  EvidenceTrustValidator,
} from '../../src/core/index.js';
import {
  InMemoryIntegrationRegistry,
  RestApiStateReader,
  RestApiIntegrationConfig,
  StaticSecretProvider,
  ExternalEvidenceAdapter,
} from '../../src/observation/index.js';
import { VerificationTools } from '../../src/modules/verification/verification.tools.js';
import { FileTraceRepository } from '../../src/persistence/index.js';
import { TenantAccessDeniedError } from '../../src/security/index.js';

describe('External Verification Integration — 10 End-to-End Cases', () => {
  const TEST_STORAGE_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'phase6-test-traces');

  beforeEach(() => {
    if (!fs.existsSync(TEST_STORAGE_DIR)) {
      fs.mkdirSync(TEST_STORAGE_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_STORAGE_DIR)) {
      fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
    }
  });

  const tenantA = 'tenant-alpha';
  const tenantB = 'tenant-beta';

  const billingConfig: RestApiIntegrationConfig = {
    integrationId: 'billing-reader-alpha',
    tenantId: tenantA,
    type: 'REST_API',
    baseUrl: 'https://billing.internal',
    allowedResourcePatterns: ['/api/subscriptions/*'],
    pathMapping: {
      subscription: '/api/subscriptions/{id}',
    },
    auth: { type: 'BEARER', secretRef: 'ALPHA_TOKEN' },
    timeoutMs: 1000,
    maxResponseSizeBytes: 1024 * 1024,
    allowedMethods: ['GET'],
    allowLoopback: true,
    enabled: true,
    freshnessToleranceMs: 60000,
  };

  const secretProvider = new StaticSecretProvider({
    ALPHA_TOKEN: 'secret-token-alpha-123',
  });

  it('Case 1 — Genuine success: Agent claims updated, reader confirms new state -> PASS', async () => {
    const registry = new InMemoryIntegrationRegistry();
    registry.register(billingConfig);

    // Mock remote returns the updated state claimed by agent: status = 'CANCELLED'
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          id: 'sub-42',
          status: 'CANCELLED',
          updatedAt: new Date().toISOString(),
        }),
        { status: 200 }
      );
    };

    const reader = new RestApiStateReader(billingConfig, { secretProvider, fetchFn: mockFetch });
    registry.registerReader(reader);

    const tools = new VerificationTools({
      integrationRegistry: registry,
      secretProvider,
    });

    const result = await tools.verifyOutcome({
      tenantId: tenantA,
      integrationId: 'billing-reader-alpha',
      target: { system: 'billing', resourceType: 'subscription', resourceId: 'sub-42' },
      intent: { operation: 'cancel_subscription', summary: 'Cancel active subscription' },
      action: {
        toolName: 'cancel_subscription_api',
        executionStatus: 'REPORTED_SUCCESS',
        reportedResult: { success: true },
      },
      postconditions: [
        {
          id: 'cond-status',
          description: 'Subscription status must be CANCELLED',
          path: 'status',
          operator: 'EQUALS',
          expectedValue: 'CANCELLED',
        },
      ],
    });

    expect(result.overallVerdict).toBe('PASS');
    expect(result.conditionEvaluations[0].verdict).toBe('PASS');
    expect(result.conditionEvaluations[0].observed).toBe('CANCELLED');
  });

  it('Case 2 — False success: Agent claims updated, reader observes old state -> FAIL', async () => {
    const registry = new InMemoryIntegrationRegistry();
    registry.register(billingConfig);

    // Mock remote returns old state: status = 'ACTIVE' despite agent claiming success
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          id: 'sub-42',
          status: 'ACTIVE', // still active!
        }),
        { status: 200 }
      );
    };

    const reader = new RestApiStateReader(billingConfig, { secretProvider, fetchFn: mockFetch });
    registry.registerReader(reader);

    const tools = new VerificationTools({
      integrationRegistry: registry,
      secretProvider,
    });

    const result = await tools.verifyOutcome({
      tenantId: tenantA,
      integrationId: 'billing-reader-alpha',
      target: { system: 'billing', resourceType: 'subscription', resourceId: 'sub-42' },
      intent: { operation: 'cancel_subscription', summary: 'Cancel active subscription' },
      action: {
        toolName: 'cancel_subscription_api',
        executionStatus: 'REPORTED_SUCCESS',
        reportedResult: { message: 'Subscription cancelled successfully' },
      },
      postconditions: [
        {
          id: 'cond-status',
          description: 'Subscription status must be CANCELLED',
          path: 'status',
          operator: 'EQUALS',
          expectedValue: 'CANCELLED',
        },
      ],
    });

    expect(result.overallVerdict).toBe('FAIL');
    expect(result.conditionEvaluations[0].verdict).toBe('FAIL');
    expect(result.conditionEvaluations[0].observed).toBe('ACTIVE');
    expect(result.conditionEvaluations[0].expected).toBe('CANCELLED');
  });

  it('Case 3 — Wrong resource: Agent claimed resource A updated, but resource A remains unchanged -> FAIL', async () => {
    const registry = new InMemoryIntegrationRegistry();
    registry.register(billingConfig);

    // Sub-42 was requested, but still has original status 'ACTIVE'
    const mockFetch: typeof fetch = async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('sub-42')) {
        return new Response(JSON.stringify({ id: 'sub-42', status: 'ACTIVE' }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'sub-99', status: 'CANCELLED' }), { status: 200 });
    };

    const reader = new RestApiStateReader(billingConfig, { secretProvider, fetchFn: mockFetch });
    registry.registerReader(reader);

    const tools = new VerificationTools({
      integrationRegistry: registry,
      secretProvider,
    });

    const result = await tools.verifyOutcome({
      tenantId: tenantA,
      integrationId: 'billing-reader-alpha',
      target: { system: 'billing', resourceType: 'subscription', resourceId: 'sub-42' },
      intent: { operation: 'cancel_subscription', summary: 'Cancel subscription 42' },
      action: {
        toolName: 'cancel_subscription_api',
        executionStatus: 'REPORTED_SUCCESS',
      },
      postconditions: [
        {
          id: 'cond-status',
          description: 'Subscription sub-42 must be CANCELLED',
          path: 'status',
          operator: 'EQUALS',
          expectedValue: 'CANCELLED',
        },
      ],
    });

    expect(result.overallVerdict).toBe('FAIL');
    expect(result.conditionEvaluations[0].verdict).toBe('FAIL');
  });

  it('Case 4 — Observation unavailable: Reader times out or encounters network error -> INCONCLUSIVE', async () => {
    const registry = new InMemoryIntegrationRegistry();
    registry.register(billingConfig);

    // Mock fetch throws AbortError (timeout)
    const mockFetch: typeof fetch = async () => {
      const err = new Error('Request timeout');
      err.name = 'AbortError';
      throw err;
    };

    const reader = new RestApiStateReader(billingConfig, { secretProvider, fetchFn: mockFetch });
    registry.registerReader(reader);

    const tools = new VerificationTools({
      integrationRegistry: registry,
      secretProvider,
    });

    const result = await tools.verifyOutcome({
      tenantId: tenantA,
      integrationId: 'billing-reader-alpha',
      target: { system: 'billing', resourceType: 'subscription', resourceId: 'sub-42' },
      intent: { operation: 'cancel_subscription', summary: 'Cancel subscription' },
      action: {
        toolName: 'cancel_subscription_api',
        executionStatus: 'REPORTED_SUCCESS',
      },
      postconditions: [
        {
          id: 'cond-status',
          description: 'Subscription status must be CANCELLED',
          path: 'status',
          operator: 'EQUALS',
          expectedValue: 'CANCELLED',
        },
      ],
    });

    // Verification engine must return INCONCLUSIVE, NEVER false FAIL or false PASS!
    expect(result.overallVerdict).toBe('INCONCLUSIVE');
    expect(result.conditionEvaluations[0].verdict).toBe('INCONCLUSIVE');
  });

  it('Case 5 — Confirmed absence: Trusted reader reliably observes 404 -> deletion postcondition PASS', async () => {
    const registry = new InMemoryIntegrationRegistry();
    registry.register(billingConfig);

    // Mock fetch returns 404 Not Found (confirmed absence)
    const mockFetch: typeof fetch = async () => {
      return new Response(null, { status: 404 });
    };

    const reader = new RestApiStateReader(billingConfig, { secretProvider, fetchFn: mockFetch });
    registry.registerReader(reader);

    const tools = new VerificationTools({
      integrationRegistry: registry,
      secretProvider,
    });

    const result = await tools.verifyOutcome({
      tenantId: tenantA,
      integrationId: 'billing-reader-alpha',
      target: { system: 'billing', resourceType: 'subscription', resourceId: 'sub-deleted' },
      intent: { operation: 'delete_subscription', summary: 'Delete subscription permanently' },
      action: {
        toolName: 'delete_subscription_api',
        executionStatus: 'REPORTED_SUCCESS',
      },
      postconditions: [
        {
          id: 'cond-deletion',
          description: 'Subscription resource status must be absent',
          path: 'status',
          operator: 'DOES_NOT_EXIST',
        },
      ],
    });

    expect(result.overallVerdict).toBe('PASS');
    expect(result.conditionEvaluations[0].verdict).toBe('PASS');
  });

  it('Case 6 — Untrusted evidence: Caller attempts to forge provenance and hash -> rejected, INCONCLUSIVE', async () => {
    const tools = new VerificationTools();

    const result = await tools.verifyOutcome({
      tenantId: tenantA,
      target: { system: 'billing', resourceType: 'subscription', resourceId: 'sub-1' },
      intent: { operation: 'verify', summary: 'Verify outcome' },
      evidence: [
        {
          sourceId: 'untrusted-fake-source',
          target: { system: 'billing', resourceType: 'subscription', resourceId: 'sub-1' },
          observedPayload: { status: 'CANCELLED' },
          limitations: ['INTEGRITY_DIGEST_MISMATCH'], // Tampered evidence
        },
      ],
      postconditions: [
        {
          id: 'cond-1',
          description: 'status equals CANCELLED',
          path: 'status',
          operator: 'EQUALS',
          expectedValue: 'CANCELLED',
        },
      ],
    });

    expect(result.overallVerdict).toBe('INCONCLUSIVE');
    expect(result.conditionEvaluations[0].verdict).toBe('INCONCLUSIVE');
  });

  it('Case 7 — Cross-tenant access: Tenant A cannot access Tenant B integration -> denied', async () => {
    const registry = new InMemoryIntegrationRegistry();

    // Register an integration belonging to Tenant B
    registry.register({
      ...billingConfig,
      integrationId: 'tenant-b-exclusive-api',
      tenantId: tenantB,
    });

    const tools = new VerificationTools({
      integrationRegistry: registry,
      secretProvider,
    });

    // Tenant A attempts to access Tenant B's integration
    await expect(
      tools.verifyOutcome({
        tenantId: tenantA,
        integrationId: 'tenant-b-exclusive-api',
        target: { system: 'billing', resourceType: 'subscription', resourceId: 'sub-1' },
        intent: { operation: 'read', summary: 'Read billing' },
        postconditions: [
          {
            id: 'c1',
            description: 'check',
            path: 'id',
            operator: 'EQUALS',
            expectedValue: 'sub-1',
          },
        ],
      })
    ).rejects.toThrow(TenantAccessDeniedError);
  });

  it('Case 8 — Stale observation: Observation timestamp precedes action beyond tolerance -> INCONCLUSIVE', async () => {
    const engine = new VerificationEngine();
    const target = { system: 'billing', resourceType: 'subscription', resourceId: 'sub-1' };

    const oldTimestamp = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    const actionTimestamp = new Date(Date.now() - 1000).toISOString(); // 1 sec ago

    const adapter = new ExternalEvidenceAdapter();
    const staleEvidence = adapter.toEvidence({
      status: 'FOUND',
      target,
      observedAt: oldTimestamp,
      payload: { status: 'CANCELLED' },
      sourceId: 'billing-reader',
      sourceType: 'REST_API',
      integrationId: 'billing-reader',
      tenantId: tenantA,
    })!;

    const request: VerificationRequest = {
      schemaVersion: '1.0.0',
      requestId: 'req-stale',
      timestamp: new Date().toISOString(),
      target,
      intent: { operation: 'cancel', summary: 'cancel subscription', expectedChanges: { status: 'CANCELLED' } },
      postconditions: [
        {
          id: 'c1',
          description: 'status must be CANCELLED',
          path: 'status',
          operator: 'EQUALS',
          expectedValue: 'CANCELLED',
          enforcement: 'REQUIRED',
        },
      ],
      policy: {
        timeoutMs: 5000,
        requireIndependentSource: true,
        freshnessToleranceMs: 60000, // 60 seconds tolerance
      },
    };

    const action: ActionRecord = {
      actionId: 'act-1',
      toolName: 'cancel_api',
      target,
      sanitizedArgs: {},
      executionStatus: 'REPORTED_SUCCESS',
      reportedResult: null,
      invokedAt: actionTimestamp,
      completedAt: actionTimestamp,
    };

    const result = await engine.verify(request, [staleEvidence], action);
    expect(result.overallVerdict).toBe('INCONCLUSIVE');
    expect(result.conditionEvaluations[0].reasonCode).toBe('INC_STALE_EVIDENCE');
  });

  it('Case 9 — Source conflict: Two trusted readers report incompatible states -> INCONCLUSIVE', async () => {
    const engine = new VerificationEngine();
    const target = { system: 'billing', resourceType: 'subscription', resourceId: 'sub-1' };
    const now = new Date().toISOString();

    const adapter = new ExternalEvidenceAdapter();
    const ev1 = adapter.toEvidence({
      status: 'FOUND',
      target,
      observedAt: now,
      payload: { status: 'CANCELLED' },
      sourceId: 'billing-api-us',
      sourceType: 'REST_API',
      integrationId: 'billing-api-us',
      tenantId: tenantA,
    })!;

    const ev2 = adapter.toEvidence({
      status: 'FOUND',
      target,
      observedAt: now,
      payload: { status: 'ACTIVE' }, // conflicting!
      sourceId: 'billing-api-eu',
      sourceType: 'REST_API',
      integrationId: 'billing-api-eu',
      tenantId: tenantA,
    })!;

    const request: VerificationRequest = {
      schemaVersion: '1.0.0',
      requestId: 'req-conflict',
      timestamp: now,
      target,
      intent: { operation: 'cancel', summary: 'cancel subscription', expectedChanges: { status: 'CANCELLED' } },
      postconditions: [
        {
          id: 'c1',
          description: 'status must be CANCELLED',
          path: 'status',
          operator: 'EQUALS',
          expectedValue: 'CANCELLED',
          enforcement: 'REQUIRED',
        },
      ],
      policy: {
        timeoutMs: 5000,
        requireIndependentSource: true,
        freshnessToleranceMs: 60000,
      },
    };

    const result = await engine.verify(request, [ev1, ev2]);
    expect(result.overallVerdict).toBe('INCONCLUSIVE');
    expect(result.conditionEvaluations[0].reasonCode).toBe('INC_CONFLICTING_EVIDENCE');
  });

  it('Case 10 — Trace persistence: Real external observation trace survives repository reopening', async () => {
    const repo1 = new FileTraceRepository({ storageDir: TEST_STORAGE_DIR });
    const registry = new InMemoryIntegrationRegistry();
    registry.register(billingConfig);

    const mockFetch: typeof fetch = async () => {
      return new Response(JSON.stringify({ id: 'sub-dur-1', status: 'CANCELLED' }), {
        status: 200,
      });
    };

    const reader = new RestApiStateReader(billingConfig, { secretProvider, fetchFn: mockFetch });
    registry.registerReader(reader);

    const tools = new VerificationTools({
      integrationRegistry: registry,
      secretProvider,
      traceRepository: repo1,
    });

    const verification = await tools.verifyOutcome({
      tenantId: tenantA,
      integrationId: 'billing-reader-alpha',
      target: { system: 'billing', resourceType: 'subscription', resourceId: 'sub-dur-1' },
      intent: { operation: 'cancel', summary: 'Cancel sub' },
      postconditions: [
        {
          id: 'c1',
          description: 'status',
          path: 'status',
          operator: 'EQUALS',
          expectedValue: 'CANCELLED',
        },
      ],
    });

    expect(verification.overallVerdict).toBe('PASS');
    const originalTraceId = verification.traceId;

    // Simulate closing instance and reopening a fresh FileTraceRepository pointing to same directory
    const repo2 = new FileTraceRepository({ storageDir: TEST_STORAGE_DIR });
    const loadedTrace = await repo2.getByTenantAndId(tenantA, originalTraceId);

    expect(loadedTrace).not.toBeNull();
    expect(loadedTrace?.traceId).toBe(originalTraceId);
    expect(loadedTrace?.result.overallVerdict).toBe('PASS');
    expect(loadedTrace?.evidence).toHaveLength(1);
    expect(loadedTrace?.evidence[0].sourceId).toBe('billing-reader-alpha');
    expect(loadedTrace?.evidence[0].provenance?.trustLevel).toBe('SOURCE_AUTHENTICATED');
  });
});
