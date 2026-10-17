/**
 * AgentProof Tests — Phase 6 MCP Boundary Integration
 * 
 * Verifies the MCP interface with external state reader integration:
 * - Tool registration and schema validation with integrationId
 * - Execution of verify_outcome referencing trusted external integrations
 * - Cross-tenant integration isolation over MCP
 * - Verification trace inspection retaining external observation metadata
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
  InMemoryIntegrationRegistry,
  RestApiStateReader,
  RestApiIntegrationConfig,
  StaticSecretProvider,
} from '../../src/observation/index.js';

describe('Phase 6 MCP Boundary Integration', () => {
  let controller: VerificationTools;
  let traceRegistry: InMemoryTraceRegistry;
  let integrationRegistry: InMemoryIntegrationRegistry;
  let secretProvider: StaticSecretProvider;
  let verifyOutcomeTool: any;
  let inspectTraceTool: any;

  const tenantDev = 'tenant-developer';
  const tenantOther = 'tenant-other';

  const extConfig: RestApiIntegrationConfig = {
    integrationId: 'crm-api-service',
    tenantId: tenantDev,
    type: 'REST_API',
    baseUrl: 'https://crm.dev.internal',
    allowedResourcePatterns: ['/api/customers/*'],
    pathMapping: {
      customer: '/api/customers/{id}',
    },
    auth: { type: 'BEARER', secretRef: 'CRM_TOKEN' },
    timeoutMs: 1000,
    maxResponseSizeBytes: 1024 * 1024,
    allowedMethods: ['GET'],
    allowLoopback: true,
    enabled: true,
    freshnessToleranceMs: 60000,
  };

  beforeEach(() => {
    traceRegistry = new InMemoryTraceRegistry();
    integrationRegistry = new InMemoryIntegrationRegistry();
    integrationRegistry.register(extConfig);

    secretProvider = new StaticSecretProvider({
      CRM_TOKEN: 'crm-dev-token-999',
    });

    controller = new VerificationTools({
      traceRegistry,
      traceRepository: traceRegistry as any,
      integrationRegistry,
      secretProvider,
    });

    const tools = buildTools(controller);
    verifyOutcomeTool = tools.find((t) => t.name === 'verify_outcome');
    inspectTraceTool = tools.find((t) => t.name === 'inspect_trace');
  });

  it('exposes verify_outcome tool accepting optional integrationId', () => {
    expect(verifyOutcomeTool).toBeDefined();
    expect(verifyOutcomeTool.description).toContain('Independently verifies');
  });

  it('executes verify_outcome with integrationId and verifies against external observation', async () => {
    // Mock external response for customer 123
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          id: 'cust-123',
          tier: 'VIP',
          active: true,
        }),
        { status: 200 }
      );
    };

    const reader = new RestApiStateReader(extConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });
    integrationRegistry.registerReader(reader);

    const input: VerifyOutcomeInput = {
      tenantId: tenantDev,
      integrationId: 'crm-api-service',
      target: {
        system: 'crm',
        resourceType: 'customer',
        resourceId: 'cust-123',
      },
      intent: {
        operation: 'upgrade_tier',
        summary: 'Upgrade customer tier to VIP',
      },
      action: {
        toolName: 'upgrade_customer',
        executionStatus: 'REPORTED_SUCCESS',
      },
      postconditions: [
        {
          id: 'tier-check',
          description: 'Tier must be VIP',
          path: 'tier',
          operator: 'EQUALS',
          expectedValue: 'VIP',
        },
      ],
    };

    const ctx = createMockContext();
    const result = await verifyOutcomeTool.execute(input, ctx);

    expect(result.status).toBe('success');
    expect(result.overallVerdict).toBe('PASS');
    expect(result.evidenceManifest).toHaveLength(1);
    expect(result.evidenceManifest[0].sourceId).toBe('crm-api-service');

    // Inspect the generated trace using inspect_trace tool
    const inspectInput: InspectTraceInput = {
      traceId: result.traceId,
      tenantId: tenantDev,
    };

    const traceResult = await inspectTraceTool.execute(inspectInput, ctx);
    expect(traceResult.status).toBe('success');
    expect(traceResult.traceId).toBe(result.traceId);
    expect(traceResult.evidence[0].sourceId).toBe('crm-api-service');
    expect(traceResult.evidence[0].provenance?.trustLevel).toBe('SOURCE_AUTHENTICATED');
  });

  it('rejects cross-tenant integration reference over MCP boundary', async () => {
    const input: VerifyOutcomeInput = {
      tenantId: tenantOther, // tenant-other attempts to access tenantDev integration
      integrationId: 'crm-api-service',
      target: {
        system: 'crm',
        resourceType: 'customer',
        resourceId: 'cust-123',
      },
      intent: {
        operation: 'read',
        summary: 'Read customer',
      },
      postconditions: [
        {
          id: 'tier-check',
          description: 'Tier check',
          path: 'tier',
          operator: 'EQUALS',
          expectedValue: 'VIP',
        },
      ],
    };

    const ctx = createMockContext();
    await expect(verifyOutcomeTool.execute(input, ctx)).rejects.toThrow(
      /tenant/i
    );
  });

  it('handles external source read error returning INCONCLUSIVE verdict over MCP', async () => {
    // Mock failure
    const mockFetch: typeof fetch = async () => {
      return new Response('Gateway error', { status: 502 });
    };

    const reader = new RestApiStateReader(extConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });
    integrationRegistry.registerReader(reader);

    const input: VerifyOutcomeInput = {
      tenantId: tenantDev,
      integrationId: 'crm-api-service',
      target: {
        system: 'crm',
        resourceType: 'customer',
        resourceId: 'cust-123',
      },
      intent: {
        operation: 'upgrade_tier',
        summary: 'Upgrade customer',
      },
      postconditions: [
        {
          id: 'tier-check',
          description: 'Tier check',
          path: 'tier',
          operator: 'EQUALS',
          expectedValue: 'VIP',
        },
      ],
    };

    const ctx = createMockContext();
    const result = await verifyOutcomeTool.execute(input, ctx);

    expect(result.status).toBe('success');
    expect(result.overallVerdict).toBe('INCONCLUSIVE');
  });
});
