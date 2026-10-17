import { describe, it, expect, beforeEach } from 'vitest';
import { buildTools } from '@nitrostack/core';
import { createMockContext } from '@nitrostack/core/testing';
import {
  VerificationTools,
  InMemoryTraceRegistry,
  VerifyOutcomeInput,
} from '../../src/modules/verification/index.js';
import { ReasonCodes } from '../../src/core/index.js';

describe('Tool: verify_outcome', () => {
  let controller: VerificationTools;
  let traceRegistry: InMemoryTraceRegistry;
  let tool: any;

  beforeEach(() => {
    traceRegistry = new InMemoryTraceRegistry();
    controller = new VerificationTools(undefined, traceRegistry);
    const tools = buildTools(controller);
    tool = tools.find((t) => t.name === 'verify_outcome');
  });

  it('produces PASS when evidence confirms required postconditions', async () => {
    const input: VerifyOutcomeInput = {
      target: {
        system: 'billing-system',
        resourceType: 'subscription',
        resourceId: 'sub-401',
        tenantId: 'tenant-1',
      },
      intent: {
        operation: 'cancel_subscription',
        summary: 'Cancel active subscription',
        expectedChanges: { status: 'CANCELLED' },
      },
      action: {
        toolName: 'cancel_subscription',
        executionStatus: 'REPORTED_SUCCESS',
      },
      postconditions: [
        {
          id: 'post-1',
          description: 'Status must be CANCELLED',
          path: 'status',
          operator: 'EQUALS',
          expectedValue: 'CANCELLED',
        },
      ],
      evidence: [
        {
          sourceId: 'billing-db-replica',
          sourceKind: 'DIRECT_READ',
          target: {
            system: 'billing-system',
            resourceType: 'subscription',
            resourceId: 'sub-401',
            tenantId: 'tenant-1',
          },
          observedPayload: {
            subscriptionId: 'sub-401',
            status: 'CANCELLED',
          },
        },
      ],
    };

    const ctx = createMockContext();
    const result = await tool.execute(input, ctx);

    expect(result.status).toBe('success');
    expect(result.overallVerdict).toBe('PASS');
    expect(result.conditionEvaluations[0].verdict).toBe('PASS');
    expect(result.conditionEvaluations[0].reasonCode).toBe(
      ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED
    );

    // Verify trace was registered and retrievable
    expect(result.traceId).toBeDefined();
    expect(traceRegistry.has(result.traceId)).toBe(true);
  });

  it('produces FAIL when evidence contradicts the claimed state change (False Success)', async () => {
    const input: VerifyOutcomeInput = {
      target: {
        system: 'billing-system',
        resourceType: 'subscription',
        resourceId: 'sub-401',
        tenantId: 'tenant-1',
      },
      intent: {
        operation: 'cancel_subscription',
        summary: 'Cancel active subscription',
        expectedChanges: { status: 'CANCELLED' },
      },
      action: {
        toolName: 'cancel_subscription',
        executionStatus: 'REPORTED_SUCCESS', // Claimed success!
      },
      postconditions: [
        {
          id: 'post-1',
          description: 'Status must be CANCELLED',
          path: 'status',
          operator: 'EQUALS',
          expectedValue: 'CANCELLED',
        },
      ],
      evidence: [
        {
          sourceId: 'billing-db-replica',
          sourceKind: 'DIRECT_READ',
          target: {
            system: 'billing-system',
            resourceType: 'subscription',
            resourceId: 'sub-401',
            tenantId: 'tenant-1',
          },
          observedPayload: {
            subscriptionId: 'sub-401',
            status: 'ACTIVE', // Ground truth remains ACTIVE!
          },
        },
      ],
    };

    const ctx = createMockContext();
    const result = await tool.execute(input, ctx);

    // Tool execution succeeded, but verification verdict is FAIL
    expect(result.status).toBe('success');
    expect(result.overallVerdict).toBe('FAIL');
    expect(result.conditionEvaluations[0].verdict).toBe('FAIL');
    expect(result.conditionEvaluations[0].reasonCode).toBe(ReasonCodes.FAIL_VALUE_MISMATCH);
    expect(result.summary).toContain('FAILED');
  });

  it('produces INCONCLUSIVE when evidence is missing or does not match target', async () => {
    const input: VerifyOutcomeInput = {
      target: {
        system: 'billing-system',
        resourceType: 'subscription',
        resourceId: 'sub-401',
        tenantId: 'tenant-1',
      },
      intent: {
        operation: 'cancel_subscription',
        summary: 'Cancel active subscription',
        expectedChanges: { status: 'CANCELLED' },
      },
      postconditions: [
        {
          id: 'post-1',
          description: 'Status must be CANCELLED',
          path: 'status',
          operator: 'EQUALS',
          expectedValue: 'CANCELLED',
        },
      ],
      evidence: [], // No evidence provided!
    };

    const ctx = createMockContext();
    const result = await tool.execute(input, ctx);

    expect(result.overallVerdict).toBe('INCONCLUSIVE');
    expect(result.conditionEvaluations[0].reasonCode).toBe(ReasonCodes.INC_EVIDENCE_NOT_FOUND);
  });

  it('automatically computes canonical SHA-256 integrityHash if omitted from evidence', async () => {
    const input: VerifyOutcomeInput = {
      target: {
        system: 'billing-system',
        resourceType: 'subscription',
        resourceId: 'sub-401',
      },
      intent: {
        operation: 'inspect',
        summary: 'inspect payload',
        expectedChanges: {},
      },
      postconditions: [
        {
          id: 'post-1',
          description: 'Status check',
          path: 'status',
          operator: 'EQUALS',
          expectedValue: 'ACTIVE',
        },
      ],
      evidence: [
        {
          sourceId: 'db',
          target: { system: 'billing-system', resourceType: 'subscription', resourceId: 'sub-401' },
          observedPayload: { status: 'ACTIVE' },
          // integrityHash is omitted
        },
      ],
    };

    const ctx = createMockContext();
    const result = await tool.execute(input, ctx);

    expect(result.overallVerdict).toBe('PASS');
    expect(result.evidenceManifest[0].integrityHash).toBeDefined();
    expect(result.evidenceManifest[0].integrityHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects invalid requests with schema validation errors', async () => {
    const malformedInput = {
      target: { system: 'billing' }, // missing resourceType, resourceId
      intent: { operation: 'test' }, // missing summary
      postconditions: [], // at least 1 postcondition required
    };

    const ctx = createMockContext();
    await expect(tool.execute(malformedInput, ctx)).rejects.toThrow();
  });
});
