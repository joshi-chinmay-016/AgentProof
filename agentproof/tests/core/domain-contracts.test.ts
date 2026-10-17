import { describe, it, expect } from 'vitest';
import {
  VerificationRequestSchema,
  EvidenceSchema,
  ActionRecordSchema,
  ConditionSpecSchema,
} from '../../src/core/index.js';

describe('Core Domain Contracts & Validation', () => {
  it('1. A valid verification request is accepted', () => {
    const validRequest = {
      schemaVersion: '1.0.0',
      requestId: 'req_sub_upgrade_01',
      timestamp: new Date().toISOString(),
      target: {
        system: 'billing_service',
        resourceType: 'subscription',
        resourceId: 'sub_c791',
        tenantId: 'tenant_enterprise',
      },
      intent: {
        operation: 'upgrade_subscription',
        summary: 'Upgrade plan from free to pro with 10 seats',
        expectedChanges: { tier: 'pro', max_seats: 10 },
      },
      preconditions: [
        {
          id: 'pre_tier_is_free',
          description: 'Initial tier must be free',
          path: 'tier',
          operator: 'EQUALS',
          expectedValue: 'free',
          enforcement: 'REQUIRED',
        },
      ],
      postconditions: [
        {
          id: 'post_tier_is_pro',
          description: 'Resulting tier must be pro',
          path: 'tier',
          operator: 'EQUALS',
          expectedValue: 'pro',
          enforcement: 'REQUIRED',
        },
      ],
      policy: {
        timeoutMs: 5000,
        requireIndependentSource: true,
        freshnessToleranceMs: 60000,
      },
    };

    const parsed = VerificationRequestSchema.safeParse(validRequest);
    expect(parsed.success).toBe(true);
  });

  it('2. A malformed request is rejected', () => {
    const malformedRequest = {
      schemaVersion: '1.0.0',
      // missing requestId
      target: {
        system: 'billing_service',
        // missing resourceType and resourceId
      },
      postconditions: [], // empty postconditions (violates min 1)
    };

    const parsed = VerificationRequestSchema.safeParse(malformedRequest);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.length).toBeGreaterThan(0);
    }
  });

  it('3. An invalid condition definition is rejected', () => {
    const invalidCondition = {
      id: 'cond_invalid',
      description: 'Condition with invalid operator',
      path: 'tier',
      operator: 'MAGIC_OPERATOR_DOES_NOT_EXIST',
      enforcement: 'REQUIRED',
    };

    const parsed = ConditionSpecSchema.safeParse(invalidCondition);
    expect(parsed.success).toBe(false);
  });

  it('4. Invalid evidence metadata is rejected according to specification', () => {
    const invalidEvidence = {
      evidenceId: '', // empty id
      evidenceType: 'STATE_SNAPSHOT',
      sourceId: 'adapter_01',
      sourceKind: 'UNKNOWN_KIND', // invalid source kind
      target: {
        system: '',
        resourceType: '',
        resourceId: '',
      },
      observedPayload: {},
      observedAt: 'not-a-timestamp', // invalid datetime
      freshnessMs: -10, // negative freshness
      integrityHash: '',
    };

    const parsed = EvidenceSchema.safeParse(invalidEvidence);
    expect(parsed.success).toBe(false);
  });

  it('Validates ActionRecord structure properly', () => {
    const validAction = {
      actionId: 'act_101',
      toolName: 'update_subscription',
      target: {
        system: 'billing_service',
        resourceType: 'subscription',
        resourceId: 'sub_c791',
      },
      sanitizedArgs: { tier: 'pro' },
      executionStatus: 'REPORTED_SUCCESS',
      reportedResult: { status: 'success' },
      invokedAt: new Date(Date.now() - 5000).toISOString(),
      completedAt: new Date().toISOString(),
      agentId: 'agent_sales_bot',
    };

    const parsed = ActionRecordSchema.safeParse(validAction);
    expect(parsed.success).toBe(true);
  });
});
