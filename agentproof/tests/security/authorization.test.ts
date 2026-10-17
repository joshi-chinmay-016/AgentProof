/**
 * AgentProof Phase 5 Test Suite — Identity & Authorization
 * 
 * Verifies trusted execution identity, least-privilege permissions,
 * and strict tenant isolation at the security layer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  StaticIdentityProvider,
  ContextIdentityProvider,
  DefaultDevelopmentIdentityProvider,
  SecurityPrincipal,
  DefaultAuthorizationService,
  Permissions,
  AuthenticationError,
  AuthorizationError,
  TenantAccessDeniedError,
} from '../../src/security/index.js';
import { VerificationTrace } from '../../src/core/index.js';

describe('Security Layer — Identity & Authorization', () => {
  let authService: DefaultAuthorizationService;

  beforeEach(() => {
    authService = new DefaultAuthorizationService();
  });

  describe('Identity Providers', () => {
    it('StaticIdentityProvider deterministically returns configured principal', async () => {
      const principal: SecurityPrincipal = {
        principalId: 'agent-007',
        tenantId: 'tenant-mi6',
        principalType: 'AGENT',
        permissions: [Permissions.VERIFY_EXECUTE],
        authMethod: 'API_KEY',
      };
      const provider = new StaticIdentityProvider(principal);
      const resolved = await provider.resolvePrincipal();

      expect(resolved.principalId).toBe('agent-007');
      expect(resolved.tenantId).toBe('tenant-mi6');
      expect(resolved.permissions).toContain(Permissions.VERIFY_EXECUTE);
    });

    it('ContextIdentityProvider resolves from token and rejects unknown tokens', async () => {
      const provider = new ContextIdentityProvider();
      const principal: SecurityPrincipal = {
        principalId: 'svc-billing',
        tenantId: 'tenant-enterprise',
        principalType: 'SERVICE',
        permissions: [Permissions.VERIFY_EXECUTE, Permissions.TRACE_READ],
        authMethod: 'BEARER_TOKEN',
      };
      provider.registerPrincipal('secret-token-xyz', principal);

      // Successful resolution via token
      const resolved = await provider.resolvePrincipal({ token: 'secret-token-xyz' });
      expect(resolved.principalId).toBe('svc-billing');
      expect(resolved.tenantId).toBe('tenant-enterprise');

      // Successful resolution via Authorization header
      const resolvedFromHeader = await provider.resolvePrincipal({
        headers: { authorization: 'Bearer secret-token-xyz' },
      });
      expect(resolvedFromHeader.principalId).toBe('svc-billing');

      // Rejection of unknown token
      await expect(
        provider.resolvePrincipal({ token: 'invalid-token-123' })
      ).rejects.toThrow(AuthenticationError);

      // Rejection of empty context
      await expect(provider.resolvePrincipal()).rejects.toThrow(AuthenticationError);
    });

    it('ContextIdentityProvider resolves from tenant and principal headers', async () => {
      const provider = new ContextIdentityProvider();
      const principal: SecurityPrincipal = {
        principalId: 'app-user',
        tenantId: 'tenant-alpha',
        principalType: 'USER',
        permissions: [Permissions.TRACE_READ],
        authMethod: 'HEADER',
      };
      provider.registerPrincipal('tenant-alpha:app-user', principal);

      const resolved = await provider.resolvePrincipal({
        headers: {
          'x-agentproof-tenant': 'tenant-alpha',
          'x-agentproof-principal': 'app-user',
        },
      });
      expect(resolved.principalId).toBe('app-user');
      expect(resolved.tenantId).toBe('tenant-alpha');
    });

    it('DefaultDevelopmentIdentityProvider tags warning and isolates explicit tenant', async () => {
      const devProvider = new DefaultDevelopmentIdentityProvider('tenant-dev');
      const principal = await devProvider.resolvePrincipal();

      expect(principal.principalId).toBe('dev-agent');
      expect(principal.tenantId).toBe('tenant-dev');
      expect(principal.metadata?.environment).toBe('development');
      expect(principal.metadata?.warning).toBeDefined();

      // If context specifies explicit tenant in dev mode, adopts it
      const customDev = await devProvider.resolvePrincipal({ tenantId: 'tenant-custom' });
      expect(customDev.tenantId).toBe('tenant-custom');
    });
  });

  describe('Authorization Service', () => {
    const tenantAPrincipal: SecurityPrincipal = {
      principalId: 'agent-tenant-A',
      tenantId: 'tenant-A',
      principalType: 'AGENT',
      permissions: [Permissions.VERIFY_EXECUTE, Permissions.TRACE_READ],
      authMethod: 'TOKEN',
    };

    const readonlyPrincipal: SecurityPrincipal = {
      principalId: 'auditor-tenant-A',
      tenantId: 'tenant-A',
      principalType: 'USER',
      permissions: [Permissions.TRACE_READ],
      authMethod: 'TOKEN',
    };

    const wildcardAdminPrincipal: SecurityPrincipal = {
      principalId: 'admin-global',
      tenantId: '*',
      principalType: 'SYSTEM',
      permissions: ['*'],
      authMethod: 'CERTIFICATE',
    };

    it('grants allowed operations and denies ungranted operations', () => {
      // Allowed
      expect(() => {
        authService.authorizeOperation(tenantAPrincipal, Permissions.VERIFY_EXECUTE);
      }).not.toThrow();

      expect(() => {
        authService.authorizeOperation(tenantAPrincipal, Permissions.TRACE_READ);
      }).not.toThrow();

      // Denied: readonly principal cannot execute verification
      expect(() => {
        authService.authorizeOperation(readonlyPrincipal, Permissions.VERIFY_EXECUTE);
      }).toThrow(AuthorizationError);

      // Denied: tenantAPrincipal cannot run scenarios (not in permissions)
      expect(() => {
        authService.authorizeOperation(tenantAPrincipal, Permissions.SCENARIO_RUN);
      }).toThrow(AuthorizationError);
    });

    it('prevents caller-supplied tenant ID from overriding authorized identity', () => {
      // Caller requests tenant-A (matches authenticated context) -> ALLOWED
      expect(
        authService.authorizeTenantScope(tenantAPrincipal, 'tenant-A')
      ).toBe('tenant-A');

      // Caller requests tenant-B (cross-tenant spoofing attempt) -> DENIED
      expect(() => {
        authService.authorizeTenantScope(tenantAPrincipal, 'tenant-B');
      }).toThrow(TenantAccessDeniedError);

      // Omitted requested tenant defaults to principal's authorized tenant
      expect(
        authService.authorizeTenantScope(tenantAPrincipal)
      ).toBe('tenant-A');
    });

    it('allows wildcard administrative principals across any requested tenant', () => {
      expect(
        authService.authorizeTenantScope(wildcardAdminPrincipal, 'tenant-A')
      ).toBe('tenant-A');
      expect(
        authService.authorizeTenantScope(wildcardAdminPrincipal, 'tenant-B')
      ).toBe('tenant-B');
      expect(
        authService.authorizeTenantScope(wildcardAdminPrincipal, 'tenant-XYZ')
      ).toBe('tenant-XYZ');
    });

    it('strictly denies cross-tenant trace inspection', () => {
      const traceTenantA: VerificationTrace = {
        traceId: 'trace-tenant-A-101',
        request: {
          schemaVersion: '1.0.0',
          requestId: 'req-1',
          timestamp: '2026-10-17T12:00:00.000Z',
          target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-1', tenantId: 'tenant-A' },
          intent: { operation: 'cancel', summary: 'cancel', expectedChanges: {} },
          preconditions: [],
          postconditions: [],
          policy: { timeoutMs: 5000, requireIndependentSource: true, freshnessToleranceMs: 60000 },
        },
        evidence: [],
        result: {
          schemaVersion: '1.0.0',
          verificationId: 'v-1',
          requestId: 'req-1',
          overallVerdict: 'PASS',
          summary: 'PASS',
          evaluatedAt: '2026-10-17T12:00:00.000Z',
          conditionEvaluations: [],
          evidenceManifest: [],
          verifierIdentity: { name: 'core', version: '1.0.0' },
          executionDurationMs: 1,
        },
        recordedAt: '2026-10-17T12:00:00.000Z',
      };

      const traceTenantB: VerificationTrace = {
        ...traceTenantA,
        traceId: 'trace-tenant-B-202',
        request: {
          ...traceTenantA.request,
          target: { ...traceTenantA.request.target, tenantId: 'tenant-B' },
        },
      };

      // Tenant A principal inspects Tenant A's trace -> ALLOWED
      expect(() => {
        authService.authorizeTraceAccess(tenantAPrincipal, traceTenantA);
      }).not.toThrow();

      // Tenant A principal attempts to inspect Tenant B's trace -> DENIED
      expect(() => {
        authService.authorizeTraceAccess(tenantAPrincipal, traceTenantB);
      }).toThrow(TenantAccessDeniedError);

      // Global admin inspects both -> ALLOWED
      expect(() => {
        authService.authorizeTraceAccess(wildcardAdminPrincipal, traceTenantA);
      }).not.toThrow();
      expect(() => {
        authService.authorizeTraceAccess(wildcardAdminPrincipal, traceTenantB);
      }).not.toThrow();
    });

    it('denies trace modification to principals lacking TRACE_WRITE permission', () => {
      // Readonly principal cannot write traces
      expect(() => {
        authService.authorizeTraceWrite(readonlyPrincipal, 'tenant-A');
      }).toThrow(AuthorizationError);

      // Principal with TRACE_WRITE for tenant-A attempting to write for tenant-B -> DENIED
      const writerPrincipal: SecurityPrincipal = {
        principalId: 'writer-tenant-A',
        tenantId: 'tenant-A',
        principalType: 'SERVICE',
        permissions: [Permissions.TRACE_WRITE],
        authMethod: 'TOKEN',
      };

      expect(() => {
        authService.authorizeTraceWrite(writerPrincipal, 'tenant-B');
      }).toThrow(TenantAccessDeniedError);

      expect(() => {
        authService.authorizeTraceWrite(writerPrincipal, 'tenant-A');
      }).not.toThrow();
    });
  });
});
