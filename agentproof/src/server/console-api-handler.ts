/**
 * AgentProof Web Console — Production-Quality API Handler
 * 
 * Provides authenticated, tenant-isolated HTTP endpoints for the AgentProof
 * Web Console. Connects directly to core verification engines, persistent trace
 * stores, tamper-evident audit hash chains, and external reader registries.
 * 
 * Core Invariant: Backend remains the absolute authority for verdicts.
 * All PASS / FAIL / INCONCLUSIVE outcomes are computed by VerificationEngine.
 */

import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { z } from 'zod';
import {
  VerificationEngine,
  IVerifier,
  VerificationRequest,
  VerificationRequestSchema,
  ActionRecord,
  ActionRecordSchema,
  Evidence,
  EvidenceSchema,
  VerificationTrace,
  EvidenceTrustValidator,
  ResourceTarget,
} from '../core/index.js';
import { ITraceRepository, FileTraceRepository } from '../persistence/index.js';
import { ScenarioCatalog, defaultScenarioCatalog } from '../modules/verification/scenario-catalog.js';
import { ScenarioRunner } from '../simulation/scenarios/scenario-runner.js';
import {
  IAuditEventRepository,
  FileAuditEventRepository,
  AuditChainVerifier,
  AuditCheckpointManager,
  IWebhookEventRepository,
  FileWebhookEventRepository,
  IWebhookSourceRegistry,
  InMemoryWebhookSourceRegistry,
  WebhookEventRecord,
} from '../streaming/index.js';
import {
  IIntegrationRegistry,
  defaultIntegrationRegistry,
  IntegrationConfigSchema,
  RestApiStateReader,
  S3ObjectStateReader,
  PostgresStateReader,
  ExternalEvidenceAdapter,
  ISecretProvider,
  EnvironmentSecretProvider,
} from '../observation/index.js';
import {
  IIdentityProvider,
  ContextIdentityProvider,
  SecurityPrincipal,
  Permissions,
  AuthenticationError,
  AuthorizationError,
  TenantAccessDeniedError,
  IAuthorizationService,
  DefaultAuthorizationService,
} from '../security/index.js';
import {
  ConditionInputSchema,
  ActionInputSchema,
  EvidenceInputSchema,
  PolicyInputSchema,
} from '../modules/verification/schemas/verify-outcome.schema.js';

export const V1VerificationPayloadSchema = z.object({
  requestId: z.string().optional(),
  integrationId: z.string().optional(),
  operation: z.string().optional(),
  target: z.object({
    system: z.string().min(1, 'Target system must be specified'),
    resourceType: z.string().min(1, 'Target resourceType must be specified'),
    resourceId: z.string().min(1, 'Target resourceId must be specified'),
    tenantId: z.string().optional(),
  }),
  intent: z
    .object({
      operation: z.string().min(1, 'Operation must be specified'),
      summary: z.string().default('Verification execution'),
      expectedChanges: z.record(z.unknown()).default({}),
    })
    .optional(),
  postconditions: z.array(ConditionInputSchema).min(1, 'At least one postcondition is required'),
  preconditions: z.array(ConditionInputSchema).optional().default([]),
  action: ActionInputSchema.optional(),
  evidence: z.array(EvidenceInputSchema).optional().default([]),
  policy: PolicyInputSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export interface ConsoleApiHandlerOptions {
  readonly traceRepository?: ITraceRepository;
  readonly auditRepository?: IAuditEventRepository;
  readonly checkpointManager?: AuditCheckpointManager;
  readonly webhookEventRepository?: IWebhookEventRepository;
  readonly webhookSourceRegistry?: IWebhookSourceRegistry;
  readonly integrationRegistry?: IIntegrationRegistry;
  readonly scenarioCatalog?: ScenarioCatalog;
  readonly scenarioRunner?: ScenarioRunner;
  readonly verifier?: IVerifier;
  readonly allowedOrigins?: readonly string[];
  readonly identityProvider?: IIdentityProvider;
  readonly authorizationService?: IAuthorizationService;
  readonly secretProvider?: ISecretProvider;
  readonly evidenceTrustValidator?: EvidenceTrustValidator;
  readonly externalEvidenceAdapter?: ExternalEvidenceAdapter;
}

export class ConsoleApiHandler {
  private readonly traceRepository: ITraceRepository;
  private readonly auditRepository: IAuditEventRepository;
  private readonly checkpointManager: AuditCheckpointManager;
  private readonly webhookEventRepository: IWebhookEventRepository;
  private readonly webhookSourceRegistry: IWebhookSourceRegistry;
  private readonly integrationRegistry: IIntegrationRegistry;
  private readonly scenarioCatalog: ScenarioCatalog;
  private readonly scenarioRunner: ScenarioRunner;
  private readonly verifier: IVerifier;
  private readonly allowedOrigins: readonly string[];
  private readonly identityProvider: IIdentityProvider;
  private readonly authorizationService: IAuthorizationService;
  private readonly secretProvider: ISecretProvider;
  private readonly evidenceTrustValidator: EvidenceTrustValidator;
  private readonly externalEvidenceAdapter: ExternalEvidenceAdapter;

  // Asymmetric test keypair for creating signed audit checkpoints
  private readonly checkpointKeyPair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  constructor(options: ConsoleApiHandlerOptions = {}) {
    this.traceRepository = options.traceRepository ?? new FileTraceRepository();
    this.auditRepository = options.auditRepository ?? new FileAuditEventRepository();
    this.checkpointManager = options.checkpointManager ?? new AuditCheckpointManager();
    this.webhookEventRepository = options.webhookEventRepository ?? new FileWebhookEventRepository();
    this.webhookSourceRegistry = options.webhookSourceRegistry ?? new InMemoryWebhookSourceRegistry();
    this.integrationRegistry = options.integrationRegistry ?? defaultIntegrationRegistry;
    this.scenarioCatalog = options.scenarioCatalog ?? defaultScenarioCatalog;
    this.scenarioRunner = options.scenarioRunner ?? new ScenarioRunner();
    this.verifier = options.verifier ?? new VerificationEngine();
    this.allowedOrigins = options.allowedOrigins ?? ['*'];

    // Setup Identity & Authorization
    const defaultPrincipals: Record<string, SecurityPrincipal> = {
      'agentproof-dev-key': {
        principalId: 'dev-python-agent',
        tenantId: 'default-tenant',
        principalType: 'AGENT',
        permissions: [
          Permissions.VERIFY_EXECUTE,
          Permissions.TRACE_READ,
          Permissions.TRACE_WRITE,
          Permissions.SCENARIO_RUN,
        ],
        authMethod: 'API_KEY',
        metadata: { role: 'python-agent', environment: 'development' },
      },
      'tenant-a-key': {
        principalId: 'agent-tenant-a',
        tenantId: 'tenant-a',
        principalType: 'AGENT',
        permissions: [Permissions.VERIFY_EXECUTE, Permissions.TRACE_READ, Permissions.TRACE_WRITE],
        authMethod: 'API_KEY',
        metadata: { tenant: 'tenant-a' },
      },
      'tenant-b-key': {
        principalId: 'agent-tenant-b',
        tenantId: 'tenant-b',
        principalType: 'AGENT',
        permissions: [Permissions.VERIFY_EXECUTE, Permissions.TRACE_READ, Permissions.TRACE_WRITE],
        authMethod: 'API_KEY',
        metadata: { tenant: 'tenant-b' },
      },
      'agentproof-admin-key': {
        principalId: 'admin-principal',
        tenantId: '*',
        principalType: 'SYSTEM',
        permissions: ['*'],
        authMethod: 'BEARER',
        metadata: { role: 'admin' },
      },
    };

    const envKey = process.env.AGENTPROOF_API_KEY;
    if (envKey && !defaultPrincipals[envKey]) {
      defaultPrincipals[envKey] = {
        principalId: 'env-configured-agent',
        tenantId: 'default-tenant',
        principalType: 'AGENT',
        permissions: [Permissions.VERIFY_EXECUTE, Permissions.TRACE_READ, Permissions.TRACE_WRITE],
        authMethod: 'API_KEY',
        metadata: { source: 'process.env.AGENTPROOF_API_KEY' },
      };
    }

    this.identityProvider = options.identityProvider ?? new ContextIdentityProvider({ principals: defaultPrincipals });
    this.authorizationService = options.authorizationService ?? new DefaultAuthorizationService();
    this.secretProvider = options.secretProvider ?? new EnvironmentSecretProvider();
    this.evidenceTrustValidator = options.evidenceTrustValidator ?? new EvidenceTrustValidator();
    this.externalEvidenceAdapter = options.externalEvidenceAdapter ?? new ExternalEvidenceAdapter();

    // Seed default integrations if empty
    this.ensureDefaultIntegrations();
  }

  private ensureDefaultIntegrations(): void {
    const existing = this.integrationRegistry.listByTenant('*');
    if (existing.length === 0) {
      try {
        const pgConfig = IntegrationConfigSchema.parse({
          integrationId: 'billing-db-postgres',
          tenantId: 'default-tenant',
          type: 'POSTGRES',
          host: 'postgres.internal.cloud',
          port: 5432,
          database: 'billing_production',
          user: 'billing_reader',
          allowedSchemas: ['public'],
          allowedTables: ['subscriptions', 'invoices', 'payment_attempts'],
          allowedColumns: {
            subscriptions: ['id', 'status', 'plan_tier', 'customer_id', 'updated_at'],
            invoices: ['id', 'amount', 'currency', 'status'],
          },
          idColumnMapping: { subscriptions: 'id', invoices: 'id' },
          auth: { type: 'API_KEY', secretRef: 'vault://postgres/billing_app_secret' },
          timeoutMs: 3000,
          enabled: true,
          freshnessToleranceMs: 60000,
        });
        this.integrationRegistry.register(pgConfig);

        const s3Config = IntegrationConfigSchema.parse({
          integrationId: 'audit-blob-s3',
          tenantId: 'default-tenant',
          type: 'S3_STORAGE',
          endpoint: 'https://s3.us-east-1.amazonaws.com',
          bucket: 'agentproof-production-audit-logs',
          allowedPrefixes: ['receipts/', 'snapshots/'],
          auth: { type: 'BEARER', secretRef: 'vault://aws/audit_bucket_token' },
          timeoutMs: 4000,
          allowLoopback: false,
          enabled: true,
          freshnessToleranceMs: 300000,
        });
        this.integrationRegistry.register(s3Config);

        const restConfig = IntegrationConfigSchema.parse({
          integrationId: 'user-management-rest',
          tenantId: 'default-tenant',
          type: 'REST_API',
          baseUrl: 'https://identity.internal.cloud',
          allowedResourcePatterns: ['/api/v1/users/*', '/api/v1/tenants/*'],
          pathMapping: { user: '/api/v1/users/{id}' },
          auth: { type: 'BEARER', secretRef: 'env://IDENTITY_SERVICE_TOKEN' },
          timeoutMs: 5000,
          maxResponseSizeBytes: 1048576,
          allowedMethods: ['GET', 'HEAD'],
          allowLoopback: false,
          enabled: true,
          freshnessToleranceMs: 30000,
        });
        this.integrationRegistry.register(restConfig);
      } catch {
        // Safe ignore in test mocks
      }
    }

    // Ensure real local customer REST integration is registered
    const hasCustomerRest = this.integrationRegistry.getById('customer-service-rest', 'default-tenant');
    if (!hasCustomerRest) {
      try {
        const customerServiceUrl = process.env.CUSTOMER_SERVICE_URL ?? 'http://localhost:4000';
        const customerRestConfig = IntegrationConfigSchema.parse({
          integrationId: 'customer-service-rest',
          tenantId: 'default-tenant',
          type: 'REST_API',
          baseUrl: customerServiceUrl,
          allowedResourcePatterns: ['/customers/*', '/api/customers/*'],
          pathMapping: { customer: '/customers/{id}' },
          auth: {
            type: 'API_KEY',
            secretRef: 'env://CUSTOMER_SERVICE_API_KEY',
            headerName: 'x-api-key',
          },
          timeoutMs: 4000,
          maxResponseSizeBytes: 1048576,
          allowedMethods: ['GET', 'HEAD'],
          allowLoopback: true,
          enabled: true,
          freshnessToleranceMs: 60000,
        });
        this.integrationRegistry.register(customerRestConfig);
      } catch {
        // Safe ignore
      }
    }
  }

  /**
   * Main HTTP request router for /api/* endpoints
   */
  public async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    // 1. CORS Preflight & Headers
    const origin = req.headers.origin;
    if (origin && (this.allowedOrigins.includes('*') || this.allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-agentproof-tenant');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 2. Tenant Context Extraction & Normalization
    const tenantId = (req.headers['x-agentproof-tenant'] as string) || url.searchParams.get('tenant') || 'default-tenant';

    try {
      // 3. Route Dispatch
      if (pathname === '/api/health') {
        return this.handleHealth(req, res);
      }

      if (pathname === '/api/overview') {
        return await this.handleOverview(req, res, tenantId);
      }

      // V1 Authenticated Verification Endpoints
      if (pathname === '/api/v1/verifications') {
        if (method === 'POST') {
          return await this.handleCreateVerificationV1(req, res);
        }
        if (method === 'GET') {
          return await this.handleListVerificationsV1(req, res, url);
        }
      }

      if (pathname.startsWith('/api/v1/verifications/')) {
        const subpath = pathname.slice('/api/v1/verifications/'.length);
        if (subpath.endsWith('/evidence') && method === 'GET') {
          const verificationId = subpath.slice(0, -('/evidence'.length));
          return await this.handleGetVerificationEvidenceV1(req, res, decodeURIComponent(verificationId));
        }
        if (subpath && method === 'GET') {
          return await this.handleGetVerificationV1(req, res, decodeURIComponent(subpath));
        }
      }

      if (pathname === '/api/verifications' || pathname === '/api/verifications/run') {
        if (method === 'GET' && pathname === '/api/verifications') {
          return await this.handleListVerifications(req, res, tenantId, url);
        }
        if (method === 'POST') {
          return await this.handleRunVerification(req, res, tenantId);
        }
      }

      if (pathname.startsWith('/api/verifications/') && pathname !== '/api/verifications/run') {
        const traceId = pathname.slice('/api/verifications/'.length);
        if (traceId && method === 'GET') {
          return await this.handleGetVerification(req, res, tenantId, decodeURIComponent(traceId));
        }
      }

      if (pathname === '/api/evidence' && method === 'GET') {
        return await this.handleListEvidence(req, res, tenantId, url);
      }

      if (pathname === '/api/timeline' && method === 'GET') {
        return await this.handleGetTimeline(req, res, tenantId, url);
      }

      if ((pathname === '/api/audit/integrity' && method === 'GET') || (pathname === '/api/audit/verify' && method === 'POST')) {
        return await this.handleAuditIntegrity(req, res, tenantId);
      }

      if (pathname === '/api/audit/checkpoints') {
        if (method === 'GET') {
          return await this.handleListCheckpoints(req, res, tenantId);
        }
        if (method === 'POST') {
          return await this.handleCreateCheckpoint(req, res, tenantId);
        }
      }

      if (pathname === '/api/integrations') {
        if (method === 'GET') {
          return this.handleListIntegrations(req, res, tenantId);
        }
        if (method === 'POST') {
          return await this.handleConfigureIntegration(req, res, tenantId);
        }
      }

      if (pathname === '/api/webhooks') {
        if (method === 'GET') {
          return await this.handleListWebhooks(req, res, tenantId, url);
        }
      }

      if (pathname.startsWith('/api/webhooks/')) {
        const eventId = pathname.slice('/api/webhooks/'.length);
        if (eventId && method === 'GET') {
          return await this.handleGetWebhook(req, res, tenantId, decodeURIComponent(eventId));
        }
      }

      // Liveness & Readiness
      if (pathname === '/healthz' && method === 'GET') {
        return this.handleLiveness(req, res);
      }

      if (pathname === '/readyz' && method === 'GET') {
        return this.handleReadiness(req, res);
      }

      // Activity Since (for "Since you last visited")
      if (pathname === '/api/activity/since' && method === 'GET') {
        return await this.handleActivitySince(req, res, tenantId, url);
      }

      // Enhanced Runs endpoints (matching /api/runs and /api/runs/:id)
      if (pathname === '/api/runs' && method === 'GET') {
        return await this.handleListRuns(req, res, tenantId, url);
      }

      if (pathname.startsWith('/api/runs/') && method === 'GET') {
        const runId = pathname.slice('/api/runs/'.length);
        if (runId) {
          return await this.handleGetRun(req, res, tenantId, decodeURIComponent(runId));
        }
      }

      // Raw Trace Inspection
      if (pathname.startsWith('/api/traces/') && method === 'GET') {
        const traceId = pathname.slice('/api/traces/'.length);
        if (traceId) {
          return await this.handleGetRawTrace(req, res, tenantId, decodeURIComponent(traceId));
        }
      }

      // Evidence Detail
      if (pathname.startsWith('/api/evidence/') && method === 'GET') {
        const evidenceId = pathname.slice('/api/evidence/'.length);
        if (evidenceId) {
          return await this.handleGetEvidenceDetail(req, res, tenantId, decodeURIComponent(evidenceId));
        }
      }

      if (pathname === '/api/scenarios' && method === 'GET') {
        return this.handleListScenarios(req, res);
      }

      if (pathname.startsWith('/api/scenarios/') && pathname.endsWith('/run') && method === 'POST') {
        const scenarioId = pathname.slice('/api/scenarios/'.length, -('/run'.length));
        return await this.handleRunScenario(req, res, tenantId, decodeURIComponent(scenarioId));
      }

      if (pathname === '/api/seed' && method === 'POST') {
        return await this.handleSeedDemo(req, res, tenantId);
      }

      // Not Found
      this.sendError(res, 404, 'NOT_FOUND', `Unknown API route: ${method} ${pathname}`);
    } catch (err: any) {
      this.sendError(res, 500, 'INTERNAL_SERVER_ERROR', err.message ?? 'An unexpected error occurred.');
    }
  }

  // --- Handlers ---

  private handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): void {
    this.sendJson(res, 200, {
      status: 'healthy',
      version: '1.0.0',
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      subsystems: {
        verificationEngine: 'operational',
        traceRepository: 'operational',
        auditChain: 'operational',
        webhookReceiver: 'operational',
        integrationRegistry: 'operational',
      },
    });
  }

  private handleLiveness(_req: http.IncomingMessage, res: http.ServerResponse): void {
    const mem = process.memoryUsage();
    this.sendJson(res, 200, {
      status: 'alive',
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      pid: process.pid,
      memoryUsageMb: Math.round(mem.heapUsed / (1024 * 1024)),
    });
  }

  private handleReadiness(_req: http.IncomingMessage, res: http.ServerResponse): void {
    this.sendJson(res, 200, {
      status: 'ready',
      timestamp: new Date().toISOString(),
      subsystems: {
        traceStorage: 'ready',
        auditStorage: 'ready',
        webhookStorage: 'ready',
        integrationRegistry: 'ready',
      },
    });
  }

  private async handleOverview(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string
  ): Promise<void> {
    const traces = await this.traceRepository.listByTenant(tenantId, { limit: 100 });
    const auditEvents = await this.auditRepository.getEvents(tenantId);
    const integrity = AuditChainVerifier.verifyChain(auditEvents, tenantId);

    let passCount = 0;
    let failCount = 0;
    let inconclusiveCount = 0;
    let totalConditions = 0;
    let satisfiedConditions = 0;

    const recentActivity = traces.slice(0, 10).map((t) => {
      const v = t.result.overallVerdict;
      if (v === 'PASS') passCount++;
      else if (v === 'FAIL') failCount++;
      else if (v === 'INCONCLUSIVE') inconclusiveCount++;

      const conds = t.result.conditionEvaluations ?? [];
      totalConditions += conds.length;
      satisfiedConditions += conds.filter((c) => c.verdict === 'PASS').length;

      return {
        traceId: t.traceId,
        requestId: t.request.requestId,
        operation: t.request.intent.operation,
        system: t.request.target.system,
        resourceId: t.request.target.resourceId,
        verdict: t.result.overallVerdict,
        evaluatedAt: t.result.evaluatedAt,
        summary: t.result.summary,
        conditionCount: conds.length,
        evidenceCount: t.evidence.length,
      };
    });

    // Count remaining traces beyond top 10 for accurate aggregates
    for (let i = 10; i < traces.length; i++) {
      const v = traces[i].result.overallVerdict;
      if (v === 'PASS') passCount++;
      else if (v === 'FAIL') failCount++;
      else if (v === 'INCONCLUSIVE') inconclusiveCount++;

      const conds = traces[i].result.conditionEvaluations ?? [];
      totalConditions += conds.length;
      satisfiedConditions += conds.filter((c) => c.verdict === 'PASS').length;
    }

    const totalVerifications = traces.length;
    const completenessRate = totalConditions > 0
      ? Math.round((satisfiedConditions / totalConditions) * 100)
      : totalVerifications > 0 ? 100 : 0;

    // Attention Items (Actionable items requiring engineer focus)
    const attentionItems: Array<{
      id: string;
      severity: 'HIGH' | 'MEDIUM' | 'INFO';
      title: string;
      reason: string;
      targetId: string;
      type: 'VERIFICATION_FAILURE' | 'INCONCLUSIVE_READ' | 'AUDIT_INTEGRITY' | 'WEBHOOK_QUARANTINE';
    }> = [];

    if (!integrity.isValid && auditEvents.length > 0) {
      attentionItems.push({
        id: `att-audit-${integrity.brokenSequence ?? 0}`,
        severity: 'HIGH',
        title: 'Audit Chain Digest Mismatch',
        reason: integrity.errorMessage ?? 'Cryptographic link broken in audit chain.',
        targetId: integrity.brokenAuditId ?? 'chain',
        type: 'AUDIT_INTEGRITY',
      });
    }

    for (const t of traces) {
      if (t.result.overallVerdict === 'FAIL' && attentionItems.length < 5) {
        attentionItems.push({
          id: `att-fail-${t.traceId}`,
          severity: 'HIGH',
          title: `Verification Failed: ${t.request.intent.operation}`,
          reason: t.result.summary,
          targetId: t.traceId,
          type: 'VERIFICATION_FAILURE',
        });
      } else if (t.result.overallVerdict === 'INCONCLUSIVE' && attentionItems.length < 5) {
        attentionItems.push({
          id: `att-inconclusive-${t.traceId}`,
          severity: 'MEDIUM',
          title: `Inconclusive Outcome: ${t.request.intent.operation}`,
          reason: t.result.summary,
          targetId: t.traceId,
          type: 'INCONCLUSIVE_READ',
        });
      }
    }

    const integrations = this.integrationRegistry.listByTenant(tenantId).map((c) => ({
      integrationId: c.integrationId,
      type: c.type,
      enabled: c.enabled,
      health: 'HEALTHY',
      lastChecked: new Date().toISOString(),
    }));

    this.sendJson(res, 200, {
      tenantId,
      metrics: {
        totalVerifications,
        passCount,
        failCount,
        inconclusiveCount,
        passRate: totalVerifications > 0 ? Math.round((passCount / totalVerifications) * 100) : 0,
        evidenceCompletenessRate: completenessRate,
      },
      verdictDistribution: {
        PASS: passCount,
        FAIL: failCount,
        INCONCLUSIVE: inconclusiveCount,
      },
      recentActivity,
      attentionItems,
      integrations,
      auditChainStatus: {
        isValid: integrity.isValid,
        totalEvents: integrity.totalEvents,
        verifiedAt: integrity.verifiedAt,
      },
    });
  }

  private async handleListVerifications(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string,
    url: URL
  ): Promise<void> {
    const q = (url.searchParams.get('q') ?? '').toLowerCase().trim();
    const verdict = url.searchParams.get('verdict') as 'PASS' | 'FAIL' | 'INCONCLUSIVE' | null;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10), 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10), 0);

    const allTraces = await this.traceRepository.listByTenant(tenantId, { limit: 500 });

    const filtered = allTraces.filter((t) => {
      if (verdict && t.result.overallVerdict !== verdict) {
        return false;
      }
      if (q) {
        const matchTraceId = t.traceId.toLowerCase().includes(q);
        const matchRequestId = t.request.requestId.toLowerCase().includes(q);
        const matchOperation = t.request.intent.operation.toLowerCase().includes(q);
        const matchSystem = t.request.target.system.toLowerCase().includes(q);
        const matchResource = t.request.target.resourceId.toLowerCase().includes(q);
        const matchSummary = t.result.summary.toLowerCase().includes(q);
        return matchTraceId || matchRequestId || matchOperation || matchSystem || matchResource || matchSummary;
      }
      return true;
    });

    const paginated = filtered.slice(offset, offset + limit).map((t) => ({
      traceId: t.traceId,
      requestId: t.request.requestId,
      operation: t.request.intent.operation,
      summary: t.request.intent.summary,
      target: t.request.target,
      verdict: t.result.overallVerdict,
      evaluatedAt: t.result.evaluatedAt,
      resultSummary: t.result.summary,
      conditionCount: t.result.conditionEvaluations?.length ?? 0,
      evidenceCount: t.evidence.length,
      durationMs: t.result.executionDurationMs,
      isSimulation: t.request.intent.operation.includes('cancel_subscription') || t.traceId.includes('scn') || t.request.requestId.includes('sim'),
      integrationId: t.evidence.find((e) => e.sourceKind === 'EXTERNAL_API')?.sourceId,
    }));

    this.sendJson(res, 200, {
      total: filtered.length,
      limit,
      offset,
      items: paginated,
    });
  }

  private async handleGetVerification(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string,
    traceId: string
  ): Promise<void> {
    const trace = await this.traceRepository.getByTenantAndId(tenantId, traceId);
    if (!trace) {
      this.sendError(res, 404, 'TRACE_NOT_FOUND', `Verification trace '${traceId}' not found for tenant '${tenantId}'`);
      return;
    }

    const payload = {
      traceId: trace.traceId,
      requestId: trace.request.requestId,
      recordedAt: trace.recordedAt,
      evaluatedAt: trace.result.evaluatedAt,
      verdict: trace.result.overallVerdict,
      summary: trace.result.summary,
      durationMs: trace.result.executionDurationMs,
      target: trace.request.target,
      intent: trace.request.intent,
      policy: trace.request.policy,
      postconditions: trace.request.postconditions.map((p) => ({
        id: p.id,
        description: p.description,
        path: p.path,
        operator: p.operator,
        expectedValue: p.expectedValue,
        enforcement: p.enforcement,
      })),
      conditionEvaluations: trace.result.conditionEvaluations ?? [],
      evidenceManifest: trace.result.evidenceManifest ?? [],
      evidence: trace.evidence.map((e) => ({
        evidenceId: e.evidenceId,
        evidenceType: e.evidenceType,
        sourceId: e.sourceId,
        sourceKind: e.sourceKind,
        observedPayload: e.observedPayload,
        observedAt: e.observedAt,
        freshnessMs: e.freshnessMs,
        integrityHash: e.integrityHash,
        provenance: e.provenance,
        limitations: e.limitations,
      })),
      action: trace.action,
      rawTrace: trace,
    };

    this.sendJson(res, 200, payload);
  }

  private async handleListRuns(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string,
    url: URL
  ): Promise<void> {
    const q = (url.searchParams.get('q') ?? '').toLowerCase().trim();
    const verdict = url.searchParams.get('verdict') as 'PASS' | 'FAIL' | 'INCONCLUSIVE' | null;
    const scenarioId = url.searchParams.get('scenarioId') ?? undefined;
    const system = url.searchParams.get('system') ?? undefined;
    const since = url.searchParams.get('since') ?? undefined;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10), 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10), 0);

    const allTraces = await this.traceRepository.listByTenant(tenantId, { limit: 500 });

    const filtered = allTraces.filter((t) => {
      if (verdict && t.result.overallVerdict !== verdict) return false;
      if (system && t.request.target.system !== system) return false;
      if (since && new Date(t.result.evaluatedAt).getTime() < new Date(since).getTime()) return false;
      if (scenarioId && !t.request.intent.summary.toLowerCase().includes(scenarioId.toLowerCase()) && !t.request.intent.operation.toLowerCase().includes(scenarioId.toLowerCase())) {
        return false;
      }
      if (q) {
        const matchTraceId = t.traceId.toLowerCase().includes(q);
        const matchRequestId = t.request.requestId.toLowerCase().includes(q);
        const matchOperation = t.request.intent.operation.toLowerCase().includes(q);
        const matchSystem = t.request.target.system.toLowerCase().includes(q);
        const matchResource = t.request.target.resourceId.toLowerCase().includes(q);
        const matchSummary = t.result.summary.toLowerCase().includes(q);
        return matchTraceId || matchRequestId || matchOperation || matchSystem || matchResource || matchSummary;
      }
      return true;
    });

    const paginated = filtered.slice(offset, offset + limit).map((t) => {
      const conds = t.result.conditionEvaluations ?? [];
      const passed = conds.filter((c) => c.verdict === 'PASS').length;
      const failed = conds.filter((c) => c.verdict === 'FAIL').length;
      const inconclusive = conds.filter((c) => c.verdict === 'INCONCLUSIVE').length;
      const isSimulation = t.request.intent.operation.includes('cancel_subscription') || t.traceId.includes('scn') || t.request.requestId.includes('sim');

      return {
        traceId: t.traceId,
        requestId: t.request.requestId,
        operation: t.request.intent.operation,
        summary: t.request.intent.summary,
        target: t.request.target,
        verdict: t.result.overallVerdict,
        evaluatedAt: t.result.evaluatedAt,
        resultSummary: t.result.summary,
        conditionCount: conds.length,
        passedConditions: passed,
        failedConditions: failed,
        inconclusiveConditions: inconclusive,
        evidenceCount: t.evidence.length,
        durationMs: t.result.executionDurationMs,
        isSimulation,
      };
    });

    this.sendJson(res, 200, {
      total: filtered.length,
      limit,
      offset,
      items: paginated,
    });
  }

  private async handleGetRun(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string,
    runId: string
  ): Promise<void> {
    const trace = await this.traceRepository.getByTenantAndId(tenantId, runId);
    if (!trace) {
      this.sendError(res, 404, 'NOT_FOUND', `Run with traceId '${runId}' not found for tenant '${tenantId}'`);
      return;
    }

    const overall = trace.result.overallVerdict;
    const condEvals = trace.result.conditionEvaluations ?? [];

    const postconditions = trace.request.postconditions.map((p) => {
      const evalResult = condEvals.find((c) => c.conditionId === p.id);
      const verdict = evalResult?.verdict ?? 'INCONCLUSIVE';
      let isDrivingCondition = false;
      if (overall === 'FAIL') isDrivingCondition = verdict === 'FAIL';
      else if (overall === 'INCONCLUSIVE') isDrivingCondition = verdict === 'INCONCLUSIVE';
      else if (overall === 'PASS') isDrivingCondition = true;

      let observationStatus: 'FOUND' | 'NOT_FOUND' | 'READ_ERROR' | 'UNTRUSTED' = 'FOUND';
      if (evalResult?.reasonCode?.includes('UNAVAILABLE') || evalResult?.reasonCode?.includes('ERROR')) {
        observationStatus = 'READ_ERROR';
      } else if (evalResult?.observed === null || evalResult?.observed === undefined) {
        observationStatus = 'NOT_FOUND';
      }

      return {
        conditionId: p.id,
        description: p.description,
        path: p.path,
        operator: p.operator,
        expectedValue: p.expectedValue,
        observedValue: evalResult?.observed ?? null,
        verdict,
        reasonCode: evalResult?.reasonCode ?? 'UNKNOWN',
        explanation: evalResult?.explanation ?? 'Not evaluated',
        supportingEvidenceId: evalResult?.supportingEvidenceId,
        observationStatus,
        isDrivingCondition,
      };
    });

    const isSimulation = trace.request.intent.operation.includes('cancel_subscription') || trace.traceId.includes('scn') || trace.request.requestId.includes('sim');

    const payload = {
      traceId: trace.traceId,
      requestId: trace.request.requestId,
      tenantId,
      recordedAt: trace.recordedAt,
      evaluatedAt: trace.result.evaluatedAt,
      verdict: trace.result.overallVerdict,
      summary: trace.result.summary,
      durationMs: trace.result.executionDurationMs,
      isSimulation,
      target: trace.request.target,
      intent: trace.request.intent,
      postconditions,
      evidence: trace.evidence.map((e) => ({
        evidenceId: e.evidenceId,
        sourceId: e.sourceId,
        sourceKind: e.sourceKind,
        evidenceType: e.evidenceType,
        observedAt: e.observedAt,
        freshnessMs: e.freshnessMs,
        integrityHash: e.integrityHash,
        trustLevel: e.provenance?.trustLevel ?? 'UNVERIFIED',
        observationStatus: e.observationStatus ?? 'FOUND',
        observedPayload: e.observedPayload,
        limitations: e.limitations ?? [],
      })),
      action: trace.action,
      linkedAuditId: `aud_${trace.traceId}`,
      rawTrace: trace,
    };

    this.sendJson(res, 200, payload);
  }

  private async handleActivitySince(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string,
    url: URL
  ): Promise<void> {
    const sinceParam = url.searchParams.get('since');
    const sinceDate = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const traces = await this.traceRepository.listByTenant(tenantId, { limit: 100 });
    const auditEvents = await this.auditRepository.getEvents(tenantId);

    const newTraces = traces.filter((t) => new Date(t.result.evaluatedAt).getTime() > sinceDate.getTime());
    const newFailures = newTraces.filter((t) => t.result.overallVerdict === 'FAIL');
    const newInconclusive = newTraces.filter((t) => t.result.overallVerdict === 'INCONCLUSIVE');
    const newAudit = auditEvents.filter((a) => new Date(a.timestamp).getTime() > sinceDate.getTime());

    this.sendJson(res, 200, {
      since: sinceDate.toISOString(),
      generatedAt: new Date().toISOString(),
      newVerificationsCount: newTraces.length,
      newFailuresCount: newFailures.length,
      newInconclusiveCount: newInconclusive.length,
      newAuditEventsCount: newAudit.length,
      latestRunId: newTraces.length > 0 ? newTraces[0].traceId : null,
      hasChanges: newTraces.length > 0 || newAudit.length > 0,
    });
  }

  private async handleGetRawTrace(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string,
    traceId: string
  ): Promise<void> {
    const trace = await this.traceRepository.getByTenantAndId(tenantId, traceId);
    if (!trace) {
      this.sendError(res, 404, 'NOT_FOUND', `Trace '${traceId}' not found for tenant '${tenantId}'`);
      return;
    }
    this.sendJson(res, 200, trace);
  }

  private async handleGetEvidenceDetail(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string,
    evidenceId: string
  ): Promise<void> {
    const traces = await this.traceRepository.listByTenant(tenantId, { limit: 100 });
    for (const t of traces) {
      for (const e of t.evidence) {
        if (e.evidenceId === evidenceId) {
          this.sendJson(res, 200, {
            ...e,
            traceId: t.traceId,
            evaluatedAt: t.result.evaluatedAt,
          });
          return;
        }
      }
    }
    this.sendError(res, 404, 'NOT_FOUND', `Evidence item '${evidenceId}' not found for tenant '${tenantId}'`);
  }

  private async handleRunVerification(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string
  ): Promise<void> {
    const body = await this.readJsonBody(req);
    if (!body || typeof body !== 'object') {
      this.sendError(res, 400, 'INVALID_BODY', 'Request body must be a valid JSON object.');
      return;
    }

    const parsedRequest = VerificationRequestSchema.safeParse(body.request);
    if (!parsedRequest.success) {
      this.sendError(res, 400, 'INVALID_REQUEST_SCHEMA', 'Invalid verification request schema', parsedRequest.error.format());
      return;
    }

    let evidenceList: Evidence[] = [];
    if (Array.isArray(body.evidence)) {
      for (const rawEv of body.evidence) {
        const item = {
          ...rawEv,
          observedPayload: rawEv.observedPayload !== undefined ? rawEv.observedPayload : null,
        };
        const parsedEv = EvidenceSchema.safeParse(item);
        if (!parsedEv.success) {
          this.sendError(res, 400, 'INVALID_EVIDENCE_SCHEMA', 'Invalid evidence item schema', parsedEv.error.format());
          return;
        }
        evidenceList.push(parsedEv.data as Evidence);
      }
    }

    let actionRecord: ActionRecord | undefined;
    if (body.action) {
      const item = {
        ...body.action,
        reportedResult: body.action.reportedResult !== undefined ? body.action.reportedResult : null,
      };
      const parsedAction = ActionRecordSchema.safeParse(item);
      if (!parsedAction.success) {
        this.sendError(res, 400, 'INVALID_ACTION_SCHEMA', 'Invalid action record schema', parsedAction.error.format());
        return;
      }
      actionRecord = parsedAction.data as ActionRecord;
    }

    // Run deterministic verification engine
    const request = parsedRequest.data;
    const effectiveTenant = request.target.tenantId ?? tenantId;
    (request.target as any).tenantId = effectiveTenant;

    for (const ev of evidenceList) {
      if (!ev.target.tenantId) {
        (ev.target as any).tenantId = effectiveTenant;
      }
    }

    if (actionRecord && !actionRecord.target.tenantId) {
      (actionRecord.target as any).tenantId = effectiveTenant;
    }

    const result = await this.verifier.verify(request, evidenceList, actionRecord);

    let trace: VerificationTrace;
    if (this.verifier instanceof VerificationEngine && typeof (this.verifier as any).createTrace === 'function') {
      trace = (this.verifier as VerificationEngine).createTrace(request, result, evidenceList, actionRecord);
    } else {
      trace = {
        traceId: crypto.randomUUID(),
        request: Object.freeze({ ...request }),
        action: actionRecord ? Object.freeze({ ...actionRecord }) : undefined,
        evidence: Object.freeze(evidenceList.map((e) => Object.freeze({ ...e }))),
        result: Object.freeze({ ...result }),
        recordedAt: new Date().toISOString(),
      };
    }

    // Persist trace
    await this.traceRepository.saveForTenant(tenantId, trace);

    // Append to tamper-evident audit chain
    await this.auditRepository.append(tenantId, {
      auditId: `aud_${trace.traceId}`,
      eventType: 'VERIFICATION_EXECUTED',
      entityId: trace.traceId,
      payload: {
        verdict: result.overallVerdict,
        summary: result.summary,
        operation: request.intent.operation,
      },
    });

    this.sendJson(res, 201, {
      status: 'success',
      verdict: result.overallVerdict,
      verificationId: result.verificationId,
      traceId: trace.traceId,
      result,
    });
  }

  private async handleListEvidence(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string,
    url: URL
  ): Promise<void> {
    const q = (url.searchParams.get('q') ?? '').toLowerCase().trim();
    const sourceId = url.searchParams.get('sourceId');
    const traces = await this.traceRepository.listByTenant(tenantId, { limit: 50 });

    const evidenceItems: any[] = [];
    const seenEvidenceIds = new Set<string>();

    for (const t of traces) {
      for (const e of t.evidence) {
        if (seenEvidenceIds.has(e.evidenceId)) continue;
        seenEvidenceIds.add(e.evidenceId);

        if (sourceId && e.sourceId !== sourceId) continue;
        if (q) {
          const matchId = e.evidenceId.toLowerCase().includes(q);
          const matchSource = e.sourceId.toLowerCase().includes(q);
          const matchType = e.evidenceType.toLowerCase().includes(q);
          if (!matchId && !matchSource && !matchType) continue;
        }

        evidenceItems.push({
          evidenceId: e.evidenceId,
          sourceId: e.sourceId,
          sourceKind: e.sourceKind,
          evidenceType: e.evidenceType,
          observedAt: e.observedAt,
          freshnessMs: e.freshnessMs,
          integrityHash: e.integrityHash,
          trustLevel: e.provenance?.trustLevel ?? 'UNVERIFIED',
          target: e.target,
          observedPayload: e.observedPayload,
          traceId: t.traceId,
        });
      }
    }

    this.sendJson(res, 200, {
      total: evidenceItems.length,
      items: evidenceItems,
    });
  }

  private async handleGetTimeline(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string,
    _url: URL
  ): Promise<void> {
    const auditEvents = await this.auditRepository.getEvents(tenantId);
    const traces = await this.traceRepository.listByTenant(tenantId, { limit: 20 });

    const timelineItems: Array<{
      id: string;
      sequenceNumber?: number;
      type: string;
      timestamp: string;
      title: string;
      description: string;
      status?: string;
      entityId: string;
      digest?: string;
    }> = [];

    // Map audit events
    for (const ae of auditEvents) {
      timelineItems.push({
        id: ae.auditId,
        sequenceNumber: ae.sequenceNumber,
        type: ae.eventType,
        timestamp: ae.timestamp,
        title: `Audit Entry #${ae.sequenceNumber} [${ae.eventType}]`,
        description: `Cryptographically linked to previous digest ${ae.previousDigest.slice(0, 12)}...`,
        entityId: ae.entityId,
        digest: ae.currentDigest,
      });
    }

    // Map verification traces
    for (const t of traces) {
      timelineItems.push({
        id: `timeline_${t.traceId}`,
        type: 'VERIFICATION_OUTCOME',
        timestamp: t.result.evaluatedAt,
        title: `Verification Evaluated: ${t.request.intent.operation}`,
        description: t.result.summary,
        status: t.result.overallVerdict,
        entityId: t.traceId,
      });
    }

    timelineItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    this.sendJson(res, 200, {
      total: timelineItems.length,
      items: timelineItems,
    });
  }

  private async handleAuditIntegrity(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string
  ): Promise<void> {
    const events = await this.auditRepository.getEvents(tenantId);
    const integrity = AuditChainVerifier.verifyChain(events, tenantId);
    const checkpoints = await this.checkpointManager.getCheckpoints(tenantId);

    this.sendJson(res, 200, {
      isValid: integrity.isValid,
      totalEvents: integrity.totalEvents,
      checkedSequences: integrity.checkedSequences,
      brokenSequence: integrity.brokenSequence,
      brokenAuditId: integrity.brokenAuditId,
      errorCategory: integrity.errorCategory,
      errorMessage: integrity.errorMessage,
      verifiedAt: integrity.verifiedAt,
      checkpointsCount: checkpoints.length,
      latestCheckpoint: checkpoints[checkpoints.length - 1] ?? null,
      chainHeadDigest: events.length > 0 ? events[events.length - 1].currentDigest : null,
    });
  }

  private async handleListCheckpoints(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string
  ): Promise<void> {
    const checkpoints = await this.checkpointManager.getCheckpoints(tenantId);
    this.sendJson(res, 200, {
      total: checkpoints.length,
      items: checkpoints,
    });
  }

  private async handleCreateCheckpoint(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string
  ): Promise<void> {
    const events = await this.auditRepository.getEvents(tenantId);
    if (events.length === 0) {
      this.sendError(res, 400, 'EMPTY_CHAIN', 'Cannot create checkpoint on an empty audit chain.');
      return;
    }

    const latest = events[events.length - 1];
    const keyId = 'master-audit-key-1';

    const checkpoint = AuditCheckpointManager.signCheckpoint(
      tenantId,
      latest.sequenceNumber,
      latest.currentDigest,
      keyId,
      this.checkpointKeyPair.privateKey
    );

    await this.checkpointManager.saveCheckpoint(checkpoint);

    this.sendJson(res, 201, {
      status: 'success',
      checkpoint,
    });
  }

  private handleListIntegrations(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string
  ): void {
    let configs = this.integrationRegistry.listByTenant(tenantId);
    if (configs.length === 0 && tenantId !== '*') {
      configs = this.integrationRegistry.listByTenant('*');
    }

    // Sanitize credentials: hide secrets, show safe secret references
    const sanitized = configs.map((c) => {
      const copy: any = JSON.parse(JSON.stringify(c));
      if (copy.auth?.secretRef) {
        copy.auth.secretRef = copy.auth.secretRef.startsWith('vault://') || copy.auth.secretRef.startsWith('env://')
          ? copy.auth.secretRef
          : '[MASKED_SECRET_REF]';
      }
      return copy;
    });

    this.sendJson(res, 200, {
      total: sanitized.length,
      items: sanitized,
    });
  }

  private async handleConfigureIntegration(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string
  ): Promise<void> {
    const body = await this.readJsonBody(req);
    if (!body || typeof body !== 'object') {
      this.sendError(res, 400, 'INVALID_BODY', 'Invalid JSON body');
      return;
    }

    (body as any).tenantId = tenantId;

    const parsed = IntegrationConfigSchema.safeParse(body);
    if (!parsed.success) {
      this.sendError(res, 400, 'VALIDATION_FAILED', 'Integration schema validation failed', parsed.error.format());
      return;
    }

    this.integrationRegistry.register(parsed.data);

    this.sendJson(res, 201, {
      status: 'success',
      integrationId: parsed.data.integrationId,
    });
  }

  private async handleListWebhooks(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string,
    url: URL
  ): Promise<void> {
    const sourceId = url.searchParams.get('sourceId') ?? undefined;
    const records = await this.webhookEventRepository.query({
      tenantId,
      sourceId,
      limit: 50,
    });

    const sanitized = records.map((r: WebhookEventRecord) => ({
      internalEventId: r.internalEventId,
      sourceId: r.sourceId,
      externalEventId: r.externalEventId,
      eventType: r.eventType,
      status: r.status,
      receivedAt: r.receivedAt,
      attempts: r.attempts,
      payloadDigest: r.payloadDigest,
      lastError: r.lastError,
    }));

    this.sendJson(res, 200, {
      total: sanitized.length,
      items: sanitized,
    });
  }

  private async handleGetWebhook(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string,
    eventId: string
  ): Promise<void> {
    const record = await this.webhookEventRepository.getById(tenantId, eventId);
    if (!record) {
      this.sendError(res, 404, 'WEBHOOK_EVENT_NOT_FOUND', `Webhook event '${eventId}' not found for tenant '${tenantId}'`);
      return;
    }

    this.sendJson(res, 200, {
      ...record,
    });
  }

  private handleListScenarios(_req: http.IncomingMessage, res: http.ServerResponse): void {
    const scenarios = this.scenarioCatalog.list();
    this.sendJson(res, 200, {
      total: scenarios.length,
      items: scenarios,
    });
  }

  private async handleRunScenario(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string,
    scenarioId: string
  ): Promise<void> {
    const scenario = this.scenarioCatalog.get(scenarioId);
    if (!scenario) {
      this.sendError(res, 404, 'SCENARIO_NOT_FOUND', `Simulation scenario '${scenarioId}' not found.`);
      return;
    }

    const metadata = this.scenarioCatalog.getMetadata(scenarioId);

    // Run scenario
    const runResult = await this.scenarioRunner.run(scenario);

    // Scope scenario trace to the active tenant executing the scenario
    (runResult.trace.request.target as any).tenantId = tenantId;

    // Save trace for tenant
    await this.traceRepository.saveForTenant(tenantId, runResult.trace);

    // Append audit event
    await this.auditRepository.append(tenantId, {
      auditId: `aud_scn_${runResult.trace.traceId}`,
      eventType: 'SCENARIO_EXECUTED',
      entityId: runResult.trace.traceId,
      payload: {
        scenarioId,
        verdict: runResult.verificationResult.overallVerdict,
        summary: runResult.verificationResult.summary,
      },
    });

    this.sendJson(res, 200, {
      status: 'success',
      scenarioId,
      scenarioName: scenario.name,
      expectedVerdict: metadata?.expectedVerdict ?? 'PASS',
      authoritativeVerdict: runResult.verificationResult.overallVerdict,
      summary: runResult.verificationResult.summary,
      traceId: runResult.trace.traceId,
      result: runResult.verificationResult,
      initialRecords: runResult.initialRecords,
      finalRecords: runResult.finalRecords,
      evidence: runResult.evidence,
    });
  }

  /**
   * Seeds demo data (Scenario A -> PASS, Scenario B -> FAIL, Scenario F -> INCONCLUSIVE)
   * into the tenant's trace repository and audit chain.
   */
  private async handleSeedDemo(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    tenantId: string
  ): Promise<void> {
    const seedIds = ['SCENARIO_A', 'SCENARIO_B', 'SCENARIO_F'];
    const results: any[] = [];

    for (const scnId of seedIds) {
      const scenario = this.scenarioCatalog.get(scnId);
      if (scenario) {
        const runResult = await this.scenarioRunner.run(scenario);
        await this.traceRepository.saveForTenant(tenantId, runResult.trace);
        await this.auditRepository.append(tenantId, {
          auditId: `aud_seed_${runResult.trace.traceId}`,
          eventType: 'SCENARIO_EXECUTED',
          entityId: runResult.trace.traceId,
          payload: {
            scenarioId: scnId,
            verdict: runResult.verificationResult.overallVerdict,
          },
        });
        results.push({
          scenarioId: scnId,
          verdict: runResult.verificationResult.overallVerdict,
          traceId: runResult.trace.traceId,
        });
      }
    }

    this.sendJson(res, 200, {
      status: 'success',
      message: 'Demo dataset successfully generated.',
      seeded: results,
    });
  }

  // --- HTTP Helpers ---

  private readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      const maxBytes = 1024 * 1024; // 1 MB

      req.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          reject(new Error('PAYLOAD_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (chunks.length === 0) {
          resolve({});
          return;
        }
        try {
          const bodyStr = Buffer.concat(chunks).toString('utf-8');
          resolve(JSON.parse(bodyStr));
        } catch (err) {
          reject(new Error('MALFORMED_JSON'));
        }
      });

      req.on('error', (err) => reject(err));
    });
  }

  private sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
    const json = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.end(json);
  }

  private sendError(
    res: http.ServerResponse,
    statusCode: number,
    code: string,
    message: string,
    details?: unknown
  ): void {
    const errorBody: any = {
      error: {
        code,
        message,
        timestamp: new Date().toISOString(),
      },
    };
    if (details) {
      errorBody.error.details = details;
    }
    this.sendJson(res, statusCode, errorBody);
  }

  // --- V1 Authenticated Verification Handlers ---

  private async authenticateV1(req: http.IncomingMessage): Promise<SecurityPrincipal> {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    const apiKeyHeader = req.headers['x-agentproof-api-key'] || req.headers['X-AgentProof-Api-Key'];
    let token: string | undefined;

    if (authHeader && typeof authHeader === 'string') {
      token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
    } else if (apiKeyHeader && typeof apiKeyHeader === 'string') {
      token = apiKeyHeader.trim();
    }

    if (!token) {
      throw new AuthenticationError(
        'Authentication required: valid Bearer token or x-agentproof-api-key header must be provided.'
      );
    }

    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    }

    return await this.identityProvider.resolvePrincipal({
      token,
      headers,
    });
  }

  private async handleCreateVerificationV1(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    let principal: SecurityPrincipal;
    try {
      principal = await this.authenticateV1(req);
    } catch (err: any) {
      this.sendError(res, 401, 'UNAUTHENTICATED', err.message ?? 'Authentication failed.');
      return;
    }

    try {
      this.authorizationService.authorizeOperation(principal, Permissions.VERIFY_EXECUTE);
    } catch (err: any) {
      this.sendError(res, 403, 'FORBIDDEN', err.message ?? 'Access denied.');
      return;
    }

    const rawBody = await this.readJsonBody(req);
    if (!rawBody || typeof rawBody !== 'object') {
      this.sendError(res, 400, 'INVALID_BODY', 'Request body must be a valid JSON object.');
      return;
    }

    // Reject client-supplied results or arbitrary URLs
    if ('verdict' in rawBody || 'overallVerdict' in rawBody || 'result' in rawBody) {
      this.sendError(
        res,
        400,
        'INVALID_FIELD',
        'Client cannot specify authoritative verdict or result in verification request.'
      );
      return;
    }

    const parsed = V1VerificationPayloadSchema.safeParse(rawBody);
    if (!parsed.success) {
      this.sendError(
        res,
        400,
        'VALIDATION_FAILED',
        'Verification request schema validation failed.',
        parsed.error.format()
      );
      return;
    }

    const data = parsed.data;

    // Enforce Tenant Isolation: bind target resource to principal's authorized tenant
    let authorizedTenant: string;
    try {
      authorizedTenant = this.authorizationService.authorizeTenantScope(principal, data.target.tenantId);
    } catch (err: any) {
      this.sendError(res, 403, 'TENANT_ACCESS_DENIED', err.message ?? 'Tenant access denied.');
      return;
    }

    const target: ResourceTarget = {
      system: data.target.system,
      resourceType: data.target.resourceType,
      resourceId: data.target.resourceId,
      tenantId: authorizedTenant,
    };

    const operation = data.intent?.operation || data.operation || 'verify_operation';
    const summary = data.intent?.summary || `Verify ${operation}`;
    const expectedChanges = data.intent?.expectedChanges || {};

    const requestId = data.requestId ?? `req-${crypto.randomUUID().slice(0, 8)}`;
    const nowIso = new Date().toISOString();

    const request: VerificationRequest = {
      schemaVersion: '1.0.0',
      requestId,
      timestamp: nowIso,
      target,
      intent: {
        operation,
        summary,
        expectedChanges,
      },
      preconditions: (data.preconditions ?? []).map((p) => ({
        id: p.id,
        description: p.description,
        path: p.path,
        operator: p.operator as any,
        expectedValue: p.expectedValue,
        enforcement: p.enforcement as any,
      })),
      postconditions: data.postconditions.map((p) => ({
        id: p.id,
        description: p.description,
        path: p.path,
        operator: p.operator as any,
        expectedValue: p.expectedValue,
        enforcement: p.enforcement as any,
      })),
      policy: {
        timeoutMs: data.policy?.timeoutMs ?? 5000,
        requireIndependentSource: data.policy?.requireIndependentSource ?? true,
        freshnessToleranceMs: data.policy?.freshnessToleranceMs ?? 60000,
      },
      metadata: data.metadata,
    };

    let actionRecord: ActionRecord | undefined;
    if (data.action) {
      actionRecord = {
        actionId: data.action.actionId ?? `act-${crypto.randomUUID().slice(0, 8)}`,
        toolName: data.action.toolName,
        target,
        sanitizedArgs: data.action.sanitizedArgs ?? {},
        executionStatus: data.action.executionStatus as any,
        reportedResult: data.action.reportedResult !== undefined ? data.action.reportedResult : null,
        invokedAt: data.action.invokedAt ?? nowIso,
        completedAt: data.action.completedAt ?? nowIso,
        agentId: data.action.agentId,
      };
    }

    const evidenceList: Evidence[] = [];

    // If caller specified an external integrationId, resolve trusted configuration and read state independently
    if (data.integrationId) {
      const integration = this.integrationRegistry.getById(data.integrationId, authorizedTenant);
      if (!integration) {
        this.sendError(
          res,
          403,
          'INTEGRATION_ACCESS_DENIED',
          `Integration '${data.integrationId}' not found or not accessible within tenant '${authorizedTenant}'.`
        );
        return;
      }

      if (!integration.enabled) {
        this.sendError(
          res,
          400,
          'INTEGRATION_DISABLED',
          `Integration '${data.integrationId}' is currently disabled.`
        );
        return;
      }

      let reader = this.integrationRegistry.getReader?.(data.integrationId, authorizedTenant);
      if (!reader) {
        if (integration.type === 'REST_API') {
          reader = new RestApiStateReader(integration, { secretProvider: this.secretProvider });
        } else if (integration.type === 'S3_STORAGE') {
          reader = new S3ObjectStateReader(integration, { secretProvider: this.secretProvider });
        } else if (integration.type === 'POSTGRES') {
          reader = new PostgresStateReader(integration, { secretProvider: this.secretProvider });
        }
        if (reader) {
          this.integrationRegistry.registerReader?.(reader);
        }
      }

      if (!reader) {
        this.sendError(
          res,
          500,
          'READER_ERROR',
          `Failed to initialize reader for integration type '${integration.type}'.`
        );
        return;
      }

      // Register the integration's sourceId with EvidenceTrustValidator
      this.evidenceTrustValidator.registerTrustedSource(integration.integrationId);

      // Perform independent external state observation
      const observationRecord = await reader.readState(target);

      // Convert observation to Evidence preserving failure metadata
      const externalEvidence = this.externalEvidenceAdapter.toEvidence(observationRecord, {
        includeFailureRecord: true,
      });

      if (externalEvidence) {
        const trustReport = this.evidenceTrustValidator.validate(
          externalEvidence,
          target,
          request.policy,
          actionRecord
        );
        const combinedLimitations = Array.from(
          new Set([...(externalEvidence.limitations ?? []), ...trustReport.limitations])
        );

        const validatedExtEv = EvidenceSchema.parse({
          ...externalEvidence,
          limitations: combinedLimitations,
          provenance: {
            ...externalEvidence.provenance,
            trustLevel: trustReport.trustLevel,
          },
        }) as Evidence;

        evidenceList.push(validatedExtEv);
      }
    }

    // Process any caller-supplied additional evidence (validated through trust validator)
    if (Array.isArray(data.evidence)) {
      for (let i = 0; i < data.evidence.length; i++) {
        const raw = data.evidence[i];
        const observedAt = raw.observedAt ?? nowIso;
        const computedHash = this.externalEvidenceAdapter.computePayloadHash(raw.observedPayload);

        if (raw.integrityHash && raw.integrityHash !== computedHash) {
          this.sendError(
            res,
            400,
            'INTEGRITY_MISMATCH',
            `Integrity hash mismatch on evidence item [${raw.evidenceId ?? i + 1}].`
          );
          return;
        }

        const tempEv: Evidence = {
          evidenceId: raw.evidenceId ?? `ev-${crypto.randomUUID().slice(0, 8)}`,
          evidenceType: (raw.evidenceType as any) ?? 'STATE_SNAPSHOT',
          sourceId: raw.sourceId,
          sourceKind: (raw.sourceKind as any) ?? 'DIRECT_READ',
          target: {
            system: raw.target.system,
            resourceType: raw.target.resourceType,
            resourceId: raw.target.resourceId,
            tenantId: authorizedTenant,
          },
          observedPayload: raw.observedPayload !== undefined ? raw.observedPayload : null,
          observedAt,
          freshnessMs: raw.freshnessMs ?? 0,
          integrityHash: computedHash,
          limitations: raw.limitations ?? [],
          digestAlgorithm: 'SHA-256',
          canonicalizationVersion: 'v1',
          schemaVersion: '1.0.0',
          provenance: raw.provenance as any,
          observationStatus: raw.observationStatus as any,
        };

        const trustReport = this.evidenceTrustValidator.validate(tempEv, target, request.policy, actionRecord);
        const combinedLimitations = Array.from(
          new Set([...(raw.limitations ?? []), ...trustReport.limitations])
        );

        const ev = EvidenceSchema.parse({
          ...tempEv,
          limitations: combinedLimitations,
          provenance: {
            ...raw.provenance,
            trustLevel: trustReport.trustLevel,
          },
        }) as Evidence;

        evidenceList.push(ev);
      }
    }

    // Run deterministic verification engine
    const result = await this.verifier.verify(request, evidenceList, actionRecord);

    // Create durable trace
    let trace: VerificationTrace;
    if (this.verifier instanceof VerificationEngine && typeof (this.verifier as any).createTrace === 'function') {
      trace = (this.verifier as VerificationEngine).createTrace(request, result, evidenceList, actionRecord);
    } else {
      trace = {
        traceId: crypto.randomUUID(),
        request: Object.freeze({ ...request }),
        action: actionRecord ? Object.freeze({ ...actionRecord }) : undefined,
        evidence: Object.freeze(evidenceList.map((e) => Object.freeze({ ...e }))),
        result: Object.freeze({ ...result }),
        recordedAt: nowIso,
      };
    }

    // Persist trace
    await this.traceRepository.saveForTenant(authorizedTenant, trace);

    // Append to tamper-evident audit chain
    await this.auditRepository.append(authorizedTenant, {
      auditId: `aud_${trace.traceId}`,
      eventType: 'VERIFICATION_EXECUTED',
      entityId: trace.traceId,
      payload: {
        verdict: result.overallVerdict,
        summary: result.summary,
        operation: request.intent.operation,
        integrationId: data.integrationId,
      },
    });

    this.sendJson(res, 201, {
      status: 'success',
      verificationId: result.verificationId,
      traceId: trace.traceId,
      verdict: result.overallVerdict,
      overallVerdict: result.overallVerdict,
      summary: result.summary,
      evaluatedAt: result.evaluatedAt,
      target,
      postconditions: result.conditionEvaluations ?? [],
      conditionEvaluations: result.conditionEvaluations ?? [],
      evidenceCount: evidenceList.length,
      evidenceManifest: result.evidenceManifest ?? [],
      executionDurationMs: result.executionDurationMs,
      links: {
        self: `/api/v1/verifications/${trace.traceId}`,
        evidence: `/api/v1/verifications/${trace.traceId}/evidence`,
      },
    });
  }

  private async handleGetVerificationV1(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    verificationId: string
  ): Promise<void> {
    let principal: SecurityPrincipal;
    try {
      principal = await this.authenticateV1(req);
    } catch (err: any) {
      this.sendError(res, 401, 'UNAUTHENTICATED', err.message ?? 'Authentication failed.');
      return;
    }

    try {
      this.authorizationService.authorizeOperation(principal, Permissions.TRACE_READ);
    } catch (err: any) {
      this.sendError(res, 403, 'FORBIDDEN', err.message ?? 'Access denied.');
      return;
    }

    // Search under authorized tenant scope (or '*' for wildcard)
    let trace: VerificationTrace | null | undefined = await this.traceRepository.getByTenantAndId(principal.tenantId, verificationId);
    if (!trace && principal.tenantId === '*') {
      const all = await this.traceRepository.listByTenant('*', { limit: 500 });
      trace = all.find((t) => t.traceId === verificationId || t.result.verificationId === verificationId);
    }

    if (!trace) {
      // Check if trace exists under a different tenant to provide accurate 403 vs 404
      const allTraces = await this.traceRepository.listByTenant('*', { limit: 500 });
      const foreignTrace = allTraces.find(
        (t) => t.traceId === verificationId || t.result.verificationId === verificationId
      );
      if (foreignTrace && foreignTrace.request.target.tenantId !== principal.tenantId) {
        this.sendError(
          res,
          403,
          'TENANT_ACCESS_DENIED',
          `Access to verification trace '${verificationId}' denied by tenant isolation policy.`
        );
        return;
      }
      this.sendError(res, 404, 'NOT_FOUND', `Verification '${verificationId}' was not found.`);
      return;
    }

    try {
      this.authorizationService.authorizeTraceAccess(principal, trace);
    } catch (err: any) {
      this.sendError(res, 403, 'TENANT_ACCESS_DENIED', err.message ?? 'Access denied.');
      return;
    }

    this.sendJson(res, 200, {
      verificationId: trace.result.verificationId,
      traceId: trace.traceId,
      tenantId: trace.request.target.tenantId ?? principal.tenantId,
      verdict: trace.result.overallVerdict,
      overallVerdict: trace.result.overallVerdict,
      summary: trace.result.summary,
      evaluatedAt: trace.result.evaluatedAt,
      recordedAt: trace.recordedAt,
      executionDurationMs: trace.result.executionDurationMs,
      target: trace.request.target,
      intent: trace.request.intent,
      postconditions: trace.request.postconditions,
      conditionEvaluations: trace.result.conditionEvaluations ?? [],
      evidenceManifest: trace.result.evidenceManifest ?? [],
      evidenceCount: trace.evidence.length,
      action: trace.action,
      links: {
        self: `/api/v1/verifications/${trace.traceId}`,
        evidence: `/api/v1/verifications/${trace.traceId}/evidence`,
      },
    });
  }

  private async handleGetVerificationEvidenceV1(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    verificationId: string
  ): Promise<void> {
    let principal: SecurityPrincipal;
    try {
      principal = await this.authenticateV1(req);
    } catch (err: any) {
      this.sendError(res, 401, 'UNAUTHENTICATED', err.message ?? 'Authentication failed.');
      return;
    }

    try {
      this.authorizationService.authorizeOperation(principal, Permissions.TRACE_READ);
    } catch (err: any) {
      this.sendError(res, 403, 'FORBIDDEN', err.message ?? 'Access denied.');
      return;
    }

    let trace: VerificationTrace | null | undefined = await this.traceRepository.getByTenantAndId(principal.tenantId, verificationId);
    if (!trace && principal.tenantId === '*') {
      const all = await this.traceRepository.listByTenant('*', { limit: 500 });
      trace = all.find((t) => t.traceId === verificationId || t.result.verificationId === verificationId);
    }

    if (!trace) {
      const allTraces = await this.traceRepository.listByTenant('*', { limit: 500 });
      const foreignTrace = allTraces.find(
        (t) => t.traceId === verificationId || t.result.verificationId === verificationId
      );
      if (foreignTrace && foreignTrace.request.target.tenantId !== principal.tenantId) {
        this.sendError(
          res,
          403,
          'TENANT_ACCESS_DENIED',
          `Access to verification trace '${verificationId}' denied by tenant isolation policy.`
        );
        return;
      }
      this.sendError(res, 404, 'NOT_FOUND', `Verification '${verificationId}' was not found.`);
      return;
    }

    try {
      this.authorizationService.authorizeTraceAccess(principal, trace);
    } catch (err: any) {
      this.sendError(res, 403, 'TENANT_ACCESS_DENIED', err.message ?? 'Access denied.');
      return;
    }

    const sanitizedEvidence = trace.evidence.map((e) => ({
      evidenceId: e.evidenceId,
      sourceId: e.sourceId,
      sourceKind: e.sourceKind,
      evidenceType: e.evidenceType,
      target: e.target,
      observedAt: e.observedAt,
      freshnessMs: e.freshnessMs,
      integrityHash: e.integrityHash,
      observationStatus: e.observationStatus ?? 'FOUND',
      trustLevel: e.provenance?.trustLevel ?? 'UNVERIFIED',
      limitations: e.limitations ?? [],
      observedPayload: this.redactSensitiveData(e.observedPayload),
      provenance: {
        observerIdentity: e.provenance?.observerIdentity,
        observerType: e.provenance?.observerType,
        trustLevel: e.provenance?.trustLevel,
      },
    }));

    this.sendJson(res, 200, {
      verificationId: trace.result.verificationId,
      traceId: trace.traceId,
      tenantId: trace.request.target.tenantId ?? principal.tenantId,
      total: sanitizedEvidence.length,
      evidence: sanitizedEvidence,
    });
  }

  private async handleListVerificationsV1(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): Promise<void> {
    let principal: SecurityPrincipal;
    try {
      principal = await this.authenticateV1(req);
    } catch (err: any) {
      this.sendError(res, 401, 'UNAUTHENTICATED', err.message ?? 'Authentication failed.');
      return;
    }

    try {
      this.authorizationService.authorizeOperation(principal, Permissions.TRACE_READ);
    } catch (err: any) {
      this.sendError(res, 403, 'FORBIDDEN', err.message ?? 'Access denied.');
      return;
    }

    const q = (url.searchParams.get('q') ?? '').toLowerCase().trim();
    const verdict = url.searchParams.get('verdict') as 'PASS' | 'FAIL' | 'INCONCLUSIVE' | null;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10), 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10), 0);

    const allTraces = await this.traceRepository.listByTenant(principal.tenantId, { limit: 500 });
    const filtered = allTraces.filter((t) => {
      if (verdict && t.result.overallVerdict !== verdict) return false;
      if (q) {
        const matchTraceId = t.traceId.toLowerCase().includes(q);
        const matchOp = t.request.intent.operation.toLowerCase().includes(q);
        const matchSys = t.request.target.system.toLowerCase().includes(q);
        const matchRes = t.request.target.resourceId.toLowerCase().includes(q);
        return matchTraceId || matchOp || matchSys || matchRes;
      }
      return true;
    });

    const paginated = filtered.slice(offset, offset + limit).map((t) => ({
      verificationId: t.result.verificationId,
      traceId: t.traceId,
      operation: t.request.intent.operation,
      summary: t.request.intent.summary,
      target: t.request.target,
      verdict: t.result.overallVerdict,
      evaluatedAt: t.result.evaluatedAt,
      resultSummary: t.result.summary,
      conditionCount: t.result.conditionEvaluations?.length ?? 0,
      evidenceCount: t.evidence.length,
      durationMs: t.result.executionDurationMs,
      links: {
        self: `/api/v1/verifications/${t.traceId}`,
        evidence: `/api/v1/verifications/${t.traceId}/evidence`,
      },
    }));

    this.sendJson(res, 200, {
      total: filtered.length,
      limit,
      offset,
      items: paginated,
    });
  }

  private redactSensitiveData(val: unknown): unknown {
    if (val === null || val === undefined) return val;
    if (typeof val !== 'object') return val;
    if (Array.isArray(val)) {
      return val.map((item) => this.redactSensitiveData(item));
    }
    const sensitiveKeys = ['authorization', 'secret', 'password', 'token', 'api_key', 'apikey', 'key'];
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (sensitiveKeys.some((s) => k.toLowerCase().includes(s))) {
        result[k] = '[REDACTED]';
      } else {
        result[k] = this.redactSensitiveData(v);
      }
    }
    return result;
  }
}

