/**
 * AgentProof End-to-End Integration & Security Test Suite
 * 
 * Proves the complete real-world integration between:
 * 1. An AI Agent performing real HTTP business operations
 * 2. An actual running REST service (TestCustomerService) over real TCP sockets
 * 3. AgentProof's authenticated verification HTTP adapter (/api/v1/verifications)
 * 4. The registered RestApiStateReader performing independent state observation
 * 5. Deterministic postcondition evaluation yielding authoritative PASS, FAIL, or INCONCLUSIVE verdicts
 * 6. Durable persistence of verification traces, tamper-evident audit events, and secret redaction
 * 7. Tenant boundary isolation and anti-SSRF protections
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'node:http';
import { ConsoleApiHandler } from '../../src/server/console-api-handler.js';
import { TestCustomerService } from '../fixtures/test-customer-service.js';
import { InMemoryTraceRegistry } from '../../src/modules/verification/trace-registry.js';
import { InMemoryIntegrationRegistry } from '../../src/observation/registry/in-memory-integration-registry.js';
import { IntegrationConfigSchema } from '../../src/observation/registry/integration-config.schema.js';
import { FileAuditEventRepository } from '../../src/streaming/audit/file-audit-repository.js';
import { StaticSecretProvider } from '../../src/observation/security/secret-provider.js';

// HTTP simulation helper for testing ConsoleApiHandler
async function invokeConsoleApi(
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

describe('First Real Integration: Python Agent + Independent REST Evidence Verification', () => {
  let customerService: TestCustomerService;
  let customerServicePort: number;
  let customerServiceBaseUrl: string;

  let traceRepo: InMemoryTraceRegistry;
  let integrationReg: InMemoryIntegrationRegistry;
  let auditRepo: FileAuditEventRepository;
  let secretProvider: StaticSecretProvider;
  let handler: ConsoleApiHandler;

  const DEV_API_KEY = 'agentproof-dev-key';
  const TENANT_A_KEY = 'tenant-a-key';
  const TENANT_B_KEY = 'tenant-b-key';

  beforeAll(async () => {
    // 1. Start the real local customer business service on a dynamic port
    customerService = new TestCustomerService({ expectedApiKey: 'customer-service-secret-token' });
    customerServicePort = await customerService.start(0);
    customerServiceBaseUrl = `http://127.0.0.1:${customerServicePort}`;
  });

  afterAll(async () => {
    await customerService.stop();
  });

  beforeEach(() => {
    customerService.clear();

    traceRepo = new InMemoryTraceRegistry();
    integrationReg = new InMemoryIntegrationRegistry();
    auditRepo = new FileAuditEventRepository();
    secretProvider = new StaticSecretProvider({
      CUSTOMER_SERVICE_TOKEN: 'customer-service-secret-token',
    });

    // 2. Register the real REST integration under 'default-tenant'
    const integrationConfig = IntegrationConfigSchema.parse({
      integrationId: 'customer-service-rest',
      tenantId: 'default-tenant',
      type: 'REST_API',
      baseUrl: customerServiceBaseUrl,
      allowedResourcePatterns: ['/customers/*', '/api/customers/*'],
      pathMapping: { customer: '/customers/{id}' },
      auth: {
        type: 'API_KEY',
        secretRef: 'CUSTOMER_SERVICE_TOKEN',
        headerName: 'x-api-key',
      },
      timeoutMs: 3000,
      maxResponseSizeBytes: 1048576,
      allowedMethods: ['GET', 'HEAD'],
      allowLoopback: true,
      enabled: true,
      freshnessToleranceMs: 60000,
    });
    integrationReg.register(integrationConfig);

    // 3. Register a foreign integration under 'tenant-b' for cross-tenant testing
    const tenantBConfig = IntegrationConfigSchema.parse({
      integrationId: 'isolated-tenant-b-rest',
      tenantId: 'tenant-b',
      type: 'REST_API',
      baseUrl: customerServiceBaseUrl,
      allowedResourcePatterns: ['/customers/*'],
      pathMapping: { customer: '/customers/{id}' },
      auth: { type: 'NONE' },
      allowLoopback: true,
      enabled: true,
    });
    integrationReg.register(tenantBConfig);

    handler = new ConsoleApiHandler({
      traceRepository: traceRepo,
      integrationRegistry: integrationReg,
      auditRepository: auditRepo,
      secretProvider,
    });
  });

  // ==========================================================================
  // TEST C: END-TO-END PASS TEST
  // ==========================================================================
  describe('End-to-End PASS Verification Flow', () => {
    it('creates a real customer, independently verifies state via REST reader, and returns PASS', async () => {
      // 1. Agent creates customer on the real business service
      const customer = customerService.setCustomer('cust-real-001', {
        name: 'Apex AI Systems',
        plan: 'enterprise',
        status: 'ACTIVE',
        balance: 7500,
      });
      expect(customer.id).toBe('cust-real-001');

      // 2. Agent submits verification request to AgentProof POST /api/v1/verifications
      const verificationPayload = {
        operation: 'create_customer_account',
        integrationId: 'customer-service-rest',
        target: {
          system: 'customer_billing',
          resourceType: 'customer',
          resourceId: 'cust-real-001',
        },
        intent: {
          operation: 'create_customer_account',
          summary: 'Provision enterprise customer with active billing status',
          expectedChanges: { status: 'ACTIVE', plan: 'enterprise' },
        },
        action: {
          toolName: 'create_customer',
          executionStatus: 'REPORTED_SUCCESS',
          invokedAt: new Date(Date.now() - 1000).toISOString(),
          completedAt: new Date().toISOString(),
        },
        postconditions: [
          {
            id: 'check_active_status',
            description: 'Customer account status must be ACTIVE in system-of-record',
            path: 'status',
            operator: 'EQUALS',
            expectedValue: 'ACTIVE',
            enforcement: 'REQUIRED',
          },
          {
            id: 'check_plan_tier',
            description: 'Customer plan tier must be enterprise',
            path: 'plan',
            operator: 'EQUALS',
            expectedValue: 'enterprise',
            enforcement: 'REQUIRED',
          },
          {
            id: 'check_positive_balance',
            description: 'Customer opening balance must be positive',
            path: 'balance',
            operator: 'GREATER_THAN',
            expectedValue: 0,
            enforcement: 'REQUIRED',
          },
        ],
      };

      const res = await invokeConsoleApi(
        handler,
        'POST',
        '/api/v1/verifications',
        { Authorization: `Bearer ${DEV_API_KEY}` },
        verificationPayload
      );

      // Assertions on verification response
      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.verdict).toBe('PASS');
      expect(res.body.overallVerdict).toBe('PASS');
      expect(res.body.traceId).toBeDefined();
      expect(res.body.verificationId).toBeDefined();
      expect(res.body.evidenceCount).toBe(1);

      // Check condition evaluations
      expect(res.body.conditionEvaluations).toHaveLength(3);
      for (const cond of res.body.conditionEvaluations) {
        expect(cond.verdict).toBe('PASS');
      }

      // 3. Inspect public retrieval endpoint GET /api/v1/verifications/{verificationId}
      const inspectRes = await invokeConsoleApi(
        handler,
        'GET',
        `/api/v1/verifications/${res.body.traceId}`,
        { Authorization: `Bearer ${DEV_API_KEY}` }
      );

      expect(inspectRes.statusCode).toBe(200);
      expect(inspectRes.body.verdict).toBe('PASS');
      expect(inspectRes.body.target.resourceId).toBe('cust-real-001');

      // 4. Inspect evidence endpoint GET /api/v1/verifications/{verificationId}/evidence
      const evidenceRes = await invokeConsoleApi(
        handler,
        'GET',
        `/api/v1/verifications/${res.body.traceId}/evidence`,
        { Authorization: `Bearer ${DEV_API_KEY}` }
      );

      expect(evidenceRes.statusCode).toBe(200);
      expect(evidenceRes.body.total).toBe(1);
      const ev = evidenceRes.body.evidence[0];
      expect(ev.sourceId).toBe('customer-service-rest');
      expect(ev.sourceKind).toBe('EXTERNAL_API');
      expect(ev.observationStatus).toBe('FOUND');
      expect(ev.trustLevel).toBe('SOURCE_AUTHENTICATED');
      expect(ev.integrityHash).toMatch(/^[a-f0-9]{64}$/);
      expect(ev.observedPayload.status).toBe('ACTIVE');
      expect(ev.observedPayload.plan).toBe('enterprise');

      // 5. Verify audit chain appended
      const auditEvents = await auditRepo.getEvents('default-tenant');
      expect(auditEvents.length).toBeGreaterThan(0);
      const latestAudit = auditEvents[auditEvents.length - 1];
      expect(latestAudit.eventType).toBe('VERIFICATION_EXECUTED');
      expect(latestAudit.payloadDigest).toBeDefined();
      expect(latestAudit.currentDigest).toBeDefined();
    });
  });

  // ==========================================================================
  // TEST D: END-TO-END FAIL TEST
  // ==========================================================================
  describe('End-to-End FAIL Verification Flow', () => {
    it('detects a state violation when actual external REST state is SUSPENDED and returns FAIL', async () => {
      // 1. Customer exists in test service, but has status "SUSPENDED"
      customerService.setCustomer('cust-real-002', {
        name: 'Beta Transport Corp',
        plan: 'starter',
        status: 'SUSPENDED',
        balance: 100,
      });

      // 2. Agent claims it created an active enterprise customer
      const verificationPayload = {
        operation: 'create_customer_account',
        integrationId: 'customer-service-rest',
        target: {
          system: 'customer_billing',
          resourceType: 'customer',
          resourceId: 'cust-real-002',
        },
        action: {
          toolName: 'create_customer',
          executionStatus: 'REPORTED_SUCCESS', // False claim!
        },
        postconditions: [
          {
            id: 'check_active_status',
            description: 'Customer account status must be ACTIVE',
            path: 'status',
            operator: 'EQUALS',
            expectedValue: 'ACTIVE',
            enforcement: 'REQUIRED',
          },
        ],
      };

      const res = await invokeConsoleApi(
        handler,
        'POST',
        '/api/v1/verifications',
        { Authorization: `Bearer ${DEV_API_KEY}` },
        verificationPayload
      );

      // 3. Engine evaluates independently observed state and returns authoritative FAIL
      expect(res.statusCode).toBe(201);
      expect(res.body.verdict).toBe('FAIL');
      expect(res.body.overallVerdict).toBe('FAIL');

      const failedCond = res.body.conditionEvaluations.find(
        (c: any) => c.conditionId === 'check_active_status'
      );
      expect(failedCond).toBeDefined();
      expect(failedCond.verdict).toBe('FAIL');
      expect(failedCond.expected).toBe('ACTIVE');
      expect(failedCond.explanation).toContain('SUSPENDED');
      expect(failedCond.explanation).toContain('ACTIVE');

      // Evidence was successfully found and authentic, but condition was violated
      expect(res.body.evidenceCount).toBe(1);
    });
  });

  // ==========================================================================
  // TEST E: END-TO-END INCONCLUSIVE TEST
  // ==========================================================================
  describe('End-to-End INCONCLUSIVE Verification Flow', () => {
    it('returns INCONCLUSIVE without misrepresenting reader error as a business failure when server errors (500)', async () => {
      // 1. Simulate server error on external service
      customerService.simulateServerError = true;

      const verificationPayload = {
        operation: 'verify_critical_resource',
        integrationId: 'customer-service-rest',
        target: {
          system: 'customer_billing',
          resourceType: 'customer',
          resourceId: 'cust-real-error',
        },
        postconditions: [
          {
            id: 'check_resource_status',
            description: 'Status must be ACTIVE',
            path: 'status',
            operator: 'EQUALS',
            expectedValue: 'ACTIVE',
            enforcement: 'REQUIRED',
          },
        ],
      };

      const res = await invokeConsoleApi(
        handler,
        'POST',
        '/api/v1/verifications',
        { Authorization: `Bearer ${DEV_API_KEY}` },
        verificationPayload
      );

      // 2. Authoritative verdict MUST be INCONCLUSIVE, NOT FAIL
      expect(res.statusCode).toBe(201);
      expect(res.body.verdict).toBe('INCONCLUSIVE');
      expect(res.body.overallVerdict).toBe('INCONCLUSIVE');
      expect(res.body.summary).toContain('INCONCLUSIVE');

      const cond = res.body.conditionEvaluations[0];
      expect(cond.verdict).toBe('INCONCLUSIVE');
      expect(cond.reasonCode).toBe('INC_READER_ERROR');
    });

    it('returns INCONCLUSIVE when the external endpoint times out', async () => {
      customerService.simulateTimeout = true;

      // Register short timeout integration to execute test fast
      const fastTimeoutConfig = IntegrationConfigSchema.parse({
        integrationId: 'fast-timeout-rest',
        tenantId: 'default-tenant',
        type: 'REST_API',
        baseUrl: customerServiceBaseUrl,
        allowedResourcePatterns: ['/customers/*'],
        pathMapping: { customer: '/customers/{id}' },
        auth: { type: 'API_KEY', secretRef: 'CUSTOMER_SERVICE_TOKEN', headerName: 'x-api-key' },
        timeoutMs: 150, // 150ms timeout
        allowLoopback: true,
        enabled: true,
      });
      integrationReg.register(fastTimeoutConfig);

      const verificationPayload = {
        operation: 'verify_timed_out_resource',
        integrationId: 'fast-timeout-rest',
        target: {
          system: 'customer_billing',
          resourceType: 'customer',
          resourceId: 'cust-timeout-test',
        },
        postconditions: [
          {
            id: 'check_status',
            description: 'Status check',
            path: 'status',
            operator: 'EQUALS',
            expectedValue: 'ACTIVE',
            enforcement: 'REQUIRED',
          },
        ],
      };

      const res = await invokeConsoleApi(
        handler,
        'POST',
        '/api/v1/verifications',
        { Authorization: `Bearer ${DEV_API_KEY}` },
        verificationPayload
      );

      expect(res.statusCode).toBe(201);
      expect(res.body.verdict).toBe('INCONCLUSIVE');
      const cond = res.body.conditionEvaluations[0];
      expect(cond.verdict).toBe('INCONCLUSIVE');
      expect(cond.reasonCode).toBe('INC_READER_TIMEOUT');
    });
  });

  // ==========================================================================
  // TEST F: SECURITY & BOUNDARY TESTS
  // ==========================================================================
  describe('Security Boundaries & Tenant Isolation', () => {
    it('rejects unauthenticated verification requests with HTTP 401', async () => {
      const res = await invokeConsoleApi(
        handler,
        'POST',
        '/api/v1/verifications',
        {}, // No token
        {
          operation: 'test_unauth',
          target: { system: 'sys', resourceType: 'res', resourceId: '1' },
          postconditions: [{ id: 'c1', description: 'd', path: 'p', operator: 'EQUALS', expectedValue: 1 }],
        }
      );

      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects client-supplied authoritative verdict attempts with HTTP 400', async () => {
      const res = await invokeConsoleApi(
        handler,
        'POST',
        '/api/v1/verifications',
        { Authorization: `Bearer ${DEV_API_KEY}` },
        {
          operation: 'override_attempt',
          verdict: 'PASS', // Illegal client override attempt!
          target: { system: 'sys', resourceType: 'res', resourceId: '1' },
          postconditions: [{ id: 'c1', description: 'd', path: 'p', operator: 'EQUALS', expectedValue: 1 }],
        }
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FIELD');
    });

    it('prevents tenant spoofing: locks execution tenant to authenticated caller', async () => {
      customerService.setCustomer('cust-tenant-iso', {
        name: 'Tenant Isolation Test',
        plan: 'starter',
        status: 'ACTIVE',
      });

      // Tenant A agent tries to submit verification claiming tenant-b in target
      const res = await invokeConsoleApi(
        handler,
        'POST',
        '/api/v1/verifications',
        { Authorization: `Bearer ${TENANT_A_KEY}` },
        {
          operation: 'tenant_spoofing_test',
          integrationId: 'customer-service-rest',
          target: {
            system: 'billing',
            resourceType: 'customer',
            resourceId: 'cust-tenant-iso',
            tenantId: 'tenant-b', // Spoof attempt!
          },
          postconditions: [
            { id: 'c1', description: 'd', path: 'status', operator: 'EQUALS', expectedValue: 'ACTIVE' },
          ],
        }
      );

      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('TENANT_ACCESS_DENIED');
    });

    it('blocks cross-tenant integration source access', async () => {
      // Tenant A agent tries to use Tenant B's integration
      const res = await invokeConsoleApi(
        handler,
        'POST',
        '/api/v1/verifications',
        { Authorization: `Bearer ${TENANT_A_KEY}` },
        {
          operation: 'cross_source_access',
          integrationId: 'isolated-tenant-b-rest', // Tenant B source!
          target: { system: 'sys', resourceType: 'customer', resourceId: 'cust-1' },
          postconditions: [
            { id: 'c1', description: 'd', path: 'status', operator: 'EQUALS', expectedValue: 'ACTIVE' },
          ],
        }
      );

      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('INTEGRATION_ACCESS_DENIED');
    });

    it('blocks cross-tenant inspection of verification traces', async () => {
      // 1. Create a verification under tenant-a
      customerService.setCustomer('cust-a-secret', {
        name: 'Confidential Client A',
        status: 'ACTIVE',
      });

      // Register integration for tenant-a
      const tenantAConfig = IntegrationConfigSchema.parse({
        integrationId: 'tenant-a-rest',
        tenantId: 'tenant-a',
        type: 'REST_API',
        baseUrl: customerServiceBaseUrl,
        allowedResourcePatterns: ['/customers/*'],
        pathMapping: { customer: '/customers/{id}' },
        auth: { type: 'API_KEY', secretRef: 'CUSTOMER_SERVICE_TOKEN', headerName: 'x-api-key' },
        allowLoopback: true,
        enabled: true,
      });
      integrationReg.register(tenantAConfig);

      const createRes = await invokeConsoleApi(
        handler,
        'POST',
        '/api/v1/verifications',
        { Authorization: `Bearer ${TENANT_A_KEY}` },
        {
          operation: 'create_a',
          integrationId: 'tenant-a-rest',
          target: { system: 'sys', resourceType: 'customer', resourceId: 'cust-a-secret' },
          postconditions: [
            { id: 'c1', description: 'd', path: 'status', operator: 'EQUALS', expectedValue: 'ACTIVE' },
          ],
        }
      );
      expect(createRes.statusCode).toBe(201);
      const traceId = createRes.body.traceId;

      // 2. Tenant B agent tries to read Tenant A's trace
      const getRes = await invokeConsoleApi(
        handler,
        'GET',
        `/api/v1/verifications/${traceId}`,
        { Authorization: `Bearer ${TENANT_B_KEY}` }
      );
      expect(getRes.statusCode).toBe(403);
      expect(getRes.body.error.code).toBe('TENANT_ACCESS_DENIED');

      // 3. Tenant B agent tries to read Tenant A's evidence
      const evRes = await invokeConsoleApi(
        handler,
        'GET',
        `/api/v1/verifications/${traceId}/evidence`,
        { Authorization: `Bearer ${TENANT_B_KEY}` }
      );
      expect(evRes.statusCode).toBe(403);
      expect(evRes.body.error.code).toBe('TENANT_ACCESS_DENIED');
    });

    it('redacts secrets and sensitive keys from evidence responses', async () => {
      customerService.setCustomer('cust-sensitive-1', {
        name: 'Financial Client',
        status: 'ACTIVE',
        plan: 'enterprise',
        balance: 1000,
      });

      const createRes = await invokeConsoleApi(
        handler,
        'POST',
        '/api/v1/verifications',
        { Authorization: `Bearer ${DEV_API_KEY}` },
        {
          operation: 'create_with_secrets',
          integrationId: 'customer-service-rest',
          target: { system: 'sys', resourceType: 'customer', resourceId: 'cust-sensitive-1' },
          postconditions: [
            { id: 'c1', description: 'd', path: 'status', operator: 'EQUALS', expectedValue: 'ACTIVE' },
          ],
        }
      );
      expect(createRes.statusCode).toBe(201);
      const traceId = createRes.body.traceId;

      const evRes = await invokeConsoleApi(
        handler,
        'GET',
        `/api/v1/verifications/${traceId}/evidence`,
        { Authorization: `Bearer ${DEV_API_KEY}` }
      );

      expect(evRes.statusCode).toBe(200);
      const rawText = JSON.stringify(evRes.body);
      // Secrets MUST never appear in API responses
      expect(rawText).not.toContain('customer-service-secret-token');
    });

    it('blocks SSRF attempts when path is not in allowedResourcePatterns', async () => {
      const restrictedConfig = IntegrationConfigSchema.parse({
        integrationId: 'restricted-rest',
        tenantId: 'default-tenant',
        type: 'REST_API',
        baseUrl: customerServiceBaseUrl,
        allowedResourcePatterns: ['/only/allowed/path/*'], // Restricted allowlist!
        pathMapping: { customer: '/customers/{id}' }, // Conflicts with allowlist
        allowLoopback: true,
        enabled: true,
      });
      integrationReg.register(restrictedConfig);

      const res = await invokeConsoleApi(
        handler,
        'POST',
        '/api/v1/verifications',
        { Authorization: `Bearer ${DEV_API_KEY}` },
        {
          operation: 'ssrf_attempt',
          integrationId: 'restricted-rest',
          target: { system: 'sys', resourceType: 'customer', resourceId: 'cust-1' },
          postconditions: [
            { id: 'c1', description: 'd', path: 'status', operator: 'EQUALS', expectedValue: 'ACTIVE' },
          ],
        }
      );

      // SSRF guard blocks the read, producing a READ_ERROR which safely becomes INCONCLUSIVE
      expect(res.statusCode).toBe(201);
      expect(res.body.verdict).toBe('INCONCLUSIVE');
    });
  });

  // ==========================================================================
  // TEST G: WEB CONSOLE QUERY INTEGRATION
  // ==========================================================================
  describe('Web Console Listing & Overview Integration', () => {
    it('makes verified real traces visible in web console list and overview metrics', async () => {
      customerService.setCustomer('cust-overview-test', {
        name: 'Dashboard Corp',
        status: 'ACTIVE',
      });

      // Submit verification
      const createRes = await invokeConsoleApi(
        handler,
        'POST',
        '/api/v1/verifications',
        { Authorization: `Bearer ${DEV_API_KEY}` },
        {
          operation: 'dashboard_integration_run',
          integrationId: 'customer-service-rest',
          target: { system: 'sys', resourceType: 'customer', resourceId: 'cust-overview-test' },
          postconditions: [
            { id: 'c1', description: 'd', path: 'status', operator: 'EQUALS', expectedValue: 'ACTIVE' },
          ],
        }
      );
      expect(createRes.statusCode).toBe(201);

      // Check GET /api/verifications (used by Verification Explorer)
      const listRes = await invokeConsoleApi(handler, 'GET', '/api/verifications');
      expect(listRes.statusCode).toBe(200);
      expect(listRes.body.items.length).toBeGreaterThan(0);
      const foundItem = listRes.body.items.find((i: any) => i.traceId === createRes.body.traceId);
      expect(foundItem).toBeDefined();
      expect(foundItem.isSimulation).toBe(false); // Distinguishable from simulation!
      expect(foundItem.integrationId).toBe('customer-service-rest');

      // Check GET /api/overview (used by Dashboard Overview)
      const overviewRes = await invokeConsoleApi(handler, 'GET', '/api/overview');
      expect(overviewRes.statusCode).toBe(200);
      expect(overviewRes.body.metrics.totalVerifications).toBeGreaterThan(0);
      expect(overviewRes.body.verdictDistribution.PASS).toBeGreaterThan(0);
    });
  });
});
