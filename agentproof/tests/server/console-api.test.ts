/**
 * AgentProof Web Console — API Handler Automated Test Suite
 * 
 * Validates all console REST endpoints, tenant isolation, secret redaction,
 * deterministic verdict preservation, and audit chain verification.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as http from 'node:http';
import { ConsoleApiHandler } from '../../src/server/console-api-handler.js';
import { InMemoryTraceRegistry } from '../../src/modules/verification/trace-registry.js';
import { FileAuditEventRepository } from '../../src/streaming/audit/file-audit-repository.js';
import { FileWebhookEventRepository } from '../../src/streaming/persistence/file-webhook-event-repository.js';
import { InMemoryIntegrationRegistry } from '../../src/observation/registry/in-memory-integration-registry.js';
import { ScenarioCatalog } from '../../src/modules/verification/scenario-catalog.js';
import { ScenarioRunner } from '../../src/simulation/scenarios/scenario-runner.js';
import { VerificationEngine } from '../../src/core/index.js';

// Helper to simulate HTTP requests against ConsoleApiHandler
async function invokeApi(
  handler: ConsoleApiHandler,
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<{ statusCode: number; headers: Record<string, string>; body: any }> {
  return new Promise((resolve, reject) => {
    const req: any = new http.IncomingMessage(null as any);
    req.method = method;
    req.url = urlPath;
    req.headers = {
      host: 'localhost:3000',
      'x-agentproof-tenant': 'test-tenant',
      ...headers,
    };

    const resHeaders: Record<string, string> = {};
    let statusCode = 200;
    const chunks: Buffer[] = [];

    const res: any = {
      setHeader: (name: string, value: string) => {
        resHeaders[name.toLowerCase()] = value;
      },
      writeHead: (code: number, headers?: Record<string, string>) => {
        statusCode = code;
        if (headers) {
          for (const [k, v] of Object.entries(headers)) {
            resHeaders[k.toLowerCase()] = v;
          }
        }
      },
      end: (data?: any) => {
        if (data) {
          chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        }
        const rawBody = Buffer.concat(chunks).toString('utf-8');
        let parsed: any;
        try {
          parsed = JSON.parse(rawBody);
        } catch {
          parsed = rawBody;
        }
        resolve({ statusCode, headers: resHeaders, body: parsed });
      },
    };

    // Simulate request body streaming
    if (body) {
      const payload = Buffer.from(JSON.stringify(body));
      process.nextTick(() => {
        req.emit('data', payload);
        req.emit('end');
      });
    } else {
      process.nextTick(() => {
        req.emit('end');
      });
    }

    handler.handleHttpRequest(req, res).catch(reject);
  });
}

describe('ConsoleApiHandler Endpoints & Security Boundaries', () => {
  let traceRepo: InMemoryTraceRegistry;
  let integrationReg: InMemoryIntegrationRegistry;
  let handler: ConsoleApiHandler;

  beforeEach(() => {
    traceRepo = new InMemoryTraceRegistry();
    integrationReg = new InMemoryIntegrationRegistry();
    handler = new ConsoleApiHandler({
      traceRepository: traceRepo,
      integrationRegistry: integrationReg,
    });
  });

  describe('GET /api/health', () => {
    it('returns healthy status and operational subsystems', async () => {
      const res = await invokeApi(handler, 'GET', '/api/health');
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.subsystems.verificationEngine).toBe('operational');
      expect(res.body.subsystems.traceRepository).toBe('operational');
    });
  });

  describe('GET /api/overview', () => {
    it('returns structured verification metrics and attention items', async () => {
      const res = await invokeApi(handler, 'GET', '/api/overview');
      expect(res.statusCode).toBe(200);
      expect(res.body.metrics).toBeDefined();
      expect(res.body.verdictDistribution).toBeDefined();
      expect(res.body.verdictDistribution.PASS).toBe(0);
      expect(res.body.verdictDistribution.FAIL).toBe(0);
      expect(res.body.verdictDistribution.INCONCLUSIVE).toBe(0);
      expect(res.body.recentActivity).toEqual([]);
    });
  });

  describe('GET /api/scenarios and POST /api/scenarios/:id/run', () => {
    it('lists all registered simulation scenarios', async () => {
      const res = await invokeApi(handler, 'GET', '/api/scenarios');
      expect(res.statusCode).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(6);
      const ids = res.body.items.map((s: any) => s.id);
      expect(ids).toContain('SCENARIO_A');
      expect(ids).toContain('SCENARIO_B');
      expect(ids).toContain('SCENARIO_F');
    });

    it('executes Scenario A and returns authoritative PASS verdict and stores trace', async () => {
      const runRes = await invokeApi(handler, 'POST', '/api/scenarios/SCENARIO_A/run');
      expect(runRes.statusCode).toBe(200);
      expect(runRes.body.status).toBe('success');
      expect(runRes.body.authoritativeVerdict).toBe('PASS');
      expect(runRes.body.traceId).toBeDefined();

      // Verify trace now exists in verification list
      const listRes = await invokeApi(handler, 'GET', '/api/verifications');
      expect(listRes.statusCode).toBe(200);
      expect(listRes.body.total).toBe(1);
      expect(listRes.body.items[0].verdict).toBe('PASS');
    });

    it('executes Scenario B (false success) and returns authoritative FAIL verdict', async () => {
      const runRes = await invokeApi(handler, 'POST', '/api/scenarios/SCENARIO_B/run');
      expect(runRes.statusCode).toBe(200);
      expect(runRes.body.authoritativeVerdict).toBe('FAIL');
      expect(runRes.body.summary).toContain('Verification FAILED');
    });
  });

  describe('POST /api/verifications/run', () => {
    it('evaluates postconditions and returns authoritative verdict', async () => {
      const verificationPayload = {
        request: {
          schemaVersion: '1.0.0',
          requestId: 'req-test-1',
          timestamp: new Date().toISOString(),
          target: { system: 'billing', resourceType: 'subscription', resourceId: 'sub-200' },
          intent: { operation: 'cancel', summary: 'Cancel sub', expectedChanges: {} },
          preconditions: [],
          postconditions: [
            {
              id: 'p-1',
              description: 'status is CANCELLED',
              path: 'status',
              operator: 'EQUALS',
              expectedValue: 'CANCELLED',
              enforcement: 'REQUIRED',
            },
          ],
          policy: { timeoutMs: 5000, requireIndependentSource: true, freshnessToleranceMs: 60000 },
        },
        evidence: [
          {
            evidenceId: 'ev-test-1',
            evidenceType: 'STATE_SNAPSHOT',
            sourceId: 'postgres-reader',
            sourceKind: 'DIRECT_READ',
            target: { system: 'billing', resourceType: 'subscription', resourceId: 'sub-200' },
            observedPayload: { status: 'CANCELLED' },
            observedAt: new Date().toISOString(),
            freshnessMs: 10,
            integrityHash: 'c'.repeat(64),
            limitations: [],
            provenance: { trustLevel: 'INTEGRITY_CHECKED' },
          },
        ],
        action: {
          actionId: 'act-test-1',
          toolName: 'cancel',
          target: { system: 'billing', resourceType: 'subscription', resourceId: 'sub-200' },
          sanitizedArgs: {},
          executionStatus: 'REPORTED_SUCCESS',
          invokedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      };

      const res = await invokeApi(handler, 'POST', '/api/verifications/run', {}, verificationPayload);
      expect(res.statusCode).toBe(201);
      expect(res.body.verdict).toBe('PASS');
      expect(res.body.traceId).toBeDefined();

      // Retrieve trace detail
      const detailRes = await invokeApi(handler, 'GET', `/api/verifications/${res.body.traceId}`);
      expect(detailRes.statusCode).toBe(200);
      expect(detailRes.body.verdict).toBe('PASS');
      expect(detailRes.body.postconditions.length).toBe(1);
      expect(detailRes.body.evidence.length).toBe(1);
    });
  });

  describe('GET /api/audit/integrity & Checkpoints', () => {
    it('verifies audit chain integrity and creates signed checkpoints', async () => {
      // 1. Run scenario to generate audit entries
      await invokeApi(handler, 'POST', '/api/scenarios/SCENARIO_A/run');

      // 2. Check audit integrity
      const intRes = await invokeApi(handler, 'GET', '/api/audit/integrity');
      expect(intRes.statusCode).toBe(200);
      expect(intRes.body.isValid).toBe(true);
      expect(intRes.body.totalEvents).toBeGreaterThanOrEqual(1);

      // 3. Create signed checkpoint
      const chkRes = await invokeApi(handler, 'POST', '/api/audit/checkpoints', {});
      expect(chkRes.statusCode).toBe(201);
      expect(chkRes.body.checkpoint.signatureAlgorithm).toBe('RSA-SHA256');
      expect(chkRes.body.checkpoint.signature).toBeDefined();
    });
  });

  describe('GET /api/integrations & Secret Redaction', () => {
    it('lists registered integrations with masked/sanitized secret references', async () => {
      const res = await invokeApi(handler, 'GET', '/api/integrations');
      expect(res.statusCode).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      for (const item of res.body.items) {
        if (item.auth?.secretRef) {
          expect(item.auth.secretRef.startsWith('vault://') || item.auth.secretRef.startsWith('env://')).toBe(true);
        }
      }
    });
  });

  describe('Tenant Boundary Enforcement', () => {
    it('isolates traces by x-agentproof-tenant header', async () => {
      // Run scenario under tenant-alpha
      await invokeApi(handler, 'POST', '/api/scenarios/SCENARIO_A/run', {
        'x-agentproof-tenant': 'tenant-alpha',
      });

      // Query as tenant-alpha
      const alphaRes = await invokeApi(handler, 'GET', '/api/verifications', {
        'x-agentproof-tenant': 'tenant-alpha',
      });
      expect(alphaRes.body.total).toBe(1);

      // Query as tenant-beta (should be isolated, 0 records)
      const betaRes = await invokeApi(handler, 'GET', '/api/verifications', {
        'x-agentproof-tenant': 'tenant-beta',
      });
      expect(betaRes.body.total).toBe(0);
    });
  });
});
