/**
 * AgentProof MCP Layer — VerificationTools Controller
 * 
 * Exposes AgentProof deterministic verification capabilities to AI agents
 * and MCP-compatible clients via NitroStack @Tool decorators:
 * 1. verify_outcome
 * 2. inspect_trace
 * 3. run_scenario
 * 4. list_scenarios
 * 
 * Hardened for Phase 5: Trusted Identity, Tenant Authorization, Durable Persistence,
 * Evidence Provenance & Trust Validation, and Fail-Closed Security.
 */

import * as crypto from 'node:crypto';
import { ToolDecorator as Tool, ExecutionContext } from '@nitrostack/core';
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
} from '../../core/index.js';
import { EvidenceAdapter, ScenarioRunner } from '../../simulation/index.js';
import { ITraceRegistry, defaultTraceRegistry } from './trace-registry.js';
import { ScenarioCatalog, defaultScenarioCatalog } from './scenario-catalog.js';
import { ITraceRepository, InMemoryTraceRepository, FileTraceRepository } from '../../persistence/index.js';
import {
  IIdentityProvider,
  DefaultDevelopmentIdentityProvider,
  IAuthorizationService,
  DefaultAuthorizationService,
  Permissions,
  TraceNotFoundError,
  TenantAccessDeniedError,
} from '../../security/index.js';
import { defaultConfig } from '../../config/index.js';
import {
  VerifyOutcomeInputSchema,
  VerifyOutcomeInput,
} from './schemas/verify-outcome.schema.js';
import {
  InspectTraceInputSchema,
  InspectTraceInput,
} from './schemas/inspect-trace.schema.js';
import {
  RunScenarioInputSchema,
  RunScenarioInput,
} from './schemas/run-scenario.schema.js';
import {
  ListScenariosInputSchema,
  ListScenariosInput,
} from './schemas/list-scenarios.schema.js';
import {
  IIntegrationRegistry,
  defaultIntegrationRegistry,
  ISecretProvider,
  IPostgresDriver,
  RestApiStateReader,
  S3ObjectStateReader,
  PostgresStateReader,
  ExternalEvidenceAdapter,
} from '../../observation/index.js';

export interface VerificationToolsOptions {
  readonly verifier?: IVerifier;
  readonly traceRegistry?: ITraceRegistry;
  readonly traceRepository?: ITraceRepository;
  readonly scenarioCatalog?: ScenarioCatalog;
  readonly scenarioRunner?: ScenarioRunner;
  readonly identityProvider?: IIdentityProvider;
  readonly authorizationService?: IAuthorizationService;
  readonly evidenceTrustValidator?: EvidenceTrustValidator;
  readonly integrationRegistry?: IIntegrationRegistry;
  readonly secretProvider?: ISecretProvider;
  readonly postgresDriver?: IPostgresDriver;
}

export class VerificationTools {
  private readonly verifier: IVerifier;
  private readonly traceRegistry: ITraceRegistry;
  private readonly traceRepository: ITraceRepository;
  private readonly scenarioCatalog: ScenarioCatalog;
  private readonly scenarioRunner?: ScenarioRunner;
  private readonly identityProvider: IIdentityProvider;
  private readonly authorizationService: IAuthorizationService;
  private readonly evidenceTrustValidator: EvidenceTrustValidator;
  private readonly evidenceAdapter: EvidenceAdapter;
  private readonly integrationRegistry: IIntegrationRegistry;
  private readonly secretProvider?: ISecretProvider;
  private readonly postgresDriver?: IPostgresDriver;
  private readonly externalEvidenceAdapter: ExternalEvidenceAdapter;

  constructor(
    verifierOrOptions?: IVerifier | VerificationToolsOptions,
    traceRegistry?: ITraceRegistry,
    scenarioCatalog?: ScenarioCatalog,
    scenarioRunner?: ScenarioRunner,
    identityProvider?: IIdentityProvider,
    authorizationService?: IAuthorizationService,
    traceRepository?: ITraceRepository,
    evidenceTrustValidator?: EvidenceTrustValidator,
    integrationRegistry?: IIntegrationRegistry
  ) {
    const isOptions = verifierOrOptions && typeof (verifierOrOptions as any).verify !== 'function';
    const opts: VerificationToolsOptions = isOptions ? (verifierOrOptions as VerificationToolsOptions) : {};

    this.verifier = (isOptions ? opts.verifier : (verifierOrOptions as IVerifier)) ?? new VerificationEngine();
    this.traceRegistry = (isOptions ? opts.traceRegistry : traceRegistry) ?? defaultTraceRegistry;
    this.scenarioCatalog = (isOptions ? opts.scenarioCatalog : scenarioCatalog) ?? defaultScenarioCatalog;
    this.scenarioRunner = isOptions ? opts.scenarioRunner : scenarioRunner;

    this.identityProvider = (isOptions ? opts.identityProvider : identityProvider) ?? new DefaultDevelopmentIdentityProvider();
    this.authorizationService = (isOptions ? opts.authorizationService : authorizationService) ?? new DefaultAuthorizationService();
    this.evidenceTrustValidator = (isOptions ? opts.evidenceTrustValidator : evidenceTrustValidator) ?? new EvidenceTrustValidator();
    this.evidenceAdapter = new EvidenceAdapter();

    this.integrationRegistry = (isOptions ? opts.integrationRegistry : integrationRegistry) ?? defaultIntegrationRegistry;
    this.secretProvider = isOptions ? opts.secretProvider : undefined;
    this.postgresDriver = isOptions ? opts.postgresDriver : undefined;
    this.externalEvidenceAdapter = new ExternalEvidenceAdapter();

    // Trace repository resolution
    if (isOptions && opts.traceRepository) {
      this.traceRepository = opts.traceRepository;
    } else if (traceRepository) {
      this.traceRepository = traceRepository;
    } else if (this.traceRegistry && typeof (this.traceRegistry as any).saveForTenant === 'function') {
      this.traceRepository = this.traceRegistry as unknown as ITraceRepository;
    } else if (defaultConfig.storageBackend === 'file') {
      this.traceRepository = new FileTraceRepository({ storageDir: defaultConfig.storageDir });
    } else {
      this.traceRepository = defaultTraceRegistry as unknown as ITraceRepository;
    }
  }

  /**
   * Tool 1: verify_outcome
   * Independently verifies whether an AI agent operation satisfied its required postconditions
   * using independently observed evidence.
   */
  @Tool({
    name: 'verify_outcome',
    description:
      'Independently verifies whether an AI agent operation satisfied its required postconditions using independently observed evidence. Returns PASS (all conditions met with trustworthy evidence), FAIL (reliable evidence proves a required condition violated), or INCONCLUSIVE (insufficient, unauthenticated, stale, or conflicting evidence). Verification traces are immutably persisted.',
    inputSchema: VerifyOutcomeInputSchema,
  })
  public async verifyOutcome(input: VerifyOutcomeInput, ctx?: ExecutionContext) {
    const validatedInput = VerifyOutcomeInputSchema.parse(input);
    if (ctx?.logger) {
      ctx.logger.info('Executing verify_outcome', {
        requestId: validatedInput.requestId,
        target: validatedInput.target,
        operation: validatedInput.intent.operation,
      });
    }

    // 1. Resolve caller identity and authorize operation
    const principal = await this.identityProvider.resolvePrincipal(ctx, { tenantId: validatedInput.tenantId ?? validatedInput.target.tenantId });
    await this.authorizationService.authorizeOperation(principal, Permissions.VERIFY_EXECUTE);

    // 2. Establish and authorize tenant scope
    const requestedTenant = validatedInput.tenantId ?? validatedInput.target.tenantId;
    if (requestedTenant) {
      await this.authorizationService.authorizeTenantScope(principal, requestedTenant);
    }

    if (validatedInput.target.tenantId && requestedTenant && validatedInput.target.tenantId !== requestedTenant && principal.tenantId !== '*') {
      throw new TenantAccessDeniedError(
        `Target tenant [${validatedInput.target.tenantId}] does not match authorized execution tenant scope [${requestedTenant}].`
      );
    }

    // 3. Build and validate VerificationRequest
    const requestId = validatedInput.requestId ?? `req-${crypto.randomUUID().slice(0, 8)}`;
    const effectiveTenant = validatedInput.target.tenantId ?? (requestedTenant && requestedTenant !== '*' ? requestedTenant : (principal.tenantId !== '*' ? principal.tenantId : undefined));
    const target = {
      system: validatedInput.target.system,
      resourceType: validatedInput.target.resourceType,
      resourceId: validatedInput.target.resourceId,
      tenantId: effectiveTenant,
    };

    const request: VerificationRequest = VerificationRequestSchema.parse({
      schemaVersion: '1.0.0',
      requestId,
      timestamp: new Date().toISOString(),
      target,
      intent: validatedInput.intent,
      preconditions: validatedInput.preconditions ?? [],
      postconditions: validatedInput.postconditions,
      policy: validatedInput.policy ?? {
        timeoutMs: 5000,
        requireIndependentSource: true,
        freshnessToleranceMs: 60000,
      },
    });

    // 4. Build ActionRecord if provided
    let actionRecord: ActionRecord | undefined;
    if (validatedInput.action) {
      const invokedAt = validatedInput.action.invokedAt ?? new Date().toISOString();
      const completedAt = validatedInput.action.completedAt ?? invokedAt;

      actionRecord = ActionRecordSchema.parse({
        actionId: validatedInput.action.actionId ?? `act-${crypto.randomUUID().slice(0, 8)}`,
        toolName: validatedInput.action.toolName,
        target: validatedInput.action.target ?? target,
        sanitizedArgs: validatedInput.action.sanitizedArgs ?? {},
        executionStatus: validatedInput.action.executionStatus,
        reportedResult: validatedInput.action.reportedResult ?? null,
        invokedAt,
        completedAt,
        agentId: validatedInput.action.agentId,
      }) as ActionRecord;
    }

    // 5. Format & validate Evidence collection
    const formattedEvidence: Evidence[] = [];
    for (let i = 0; i < validatedInput.evidence.length; i++) {
      const raw = validatedInput.evidence[i];
      const observedAt = raw.observedAt ?? new Date().toISOString();
      const computedHash = this.evidenceAdapter.computePayloadHash(raw.observedPayload);

      // Caller-supplied integrityHash check
      if (raw.integrityHash && raw.integrityHash !== computedHash) {
        throw new Error(
          `Integrity hash mismatch on evidence item [${raw.evidenceId ?? i + 1}]: ` +
          `supplied hash [${raw.integrityHash}] does not match computed SHA-256 digest [${computedHash}] of observedPayload.`
        );
      }

      const integrityHash = computedHash;

      const evTarget = {
        system: raw.target.system,
        resourceType: raw.target.resourceType,
        resourceId: raw.target.resourceId,
        tenantId: raw.target.tenantId ?? target.tenantId,
      };

      // Validate through EvidenceTrustValidator
      const tempEv: Evidence = {
        evidenceId: raw.evidenceId ?? `ev-${i + 1}-${crypto.randomUUID().slice(0, 6)}`,
        evidenceType: raw.evidenceType ?? 'STATE_SNAPSHOT',
        sourceId: raw.sourceId,
        sourceKind: raw.sourceKind ?? 'DIRECT_READ',
        target: evTarget,
        observedPayload: raw.observedPayload,
        observedAt,
        freshnessMs: raw.freshnessMs ?? 0,
        integrityHash,
        limitations: raw.limitations ?? [],
        digestAlgorithm: raw.digestAlgorithm ?? 'SHA-256',
        canonicalizationVersion: raw.canonicalizationVersion ?? 'v1',
        schemaVersion: raw.schemaVersion ?? '1.0.0',
        provenance: raw.provenance,
        observationStatus: raw.observationStatus,
      };

      const trustReport = this.evidenceTrustValidator.validate(
        tempEv,
        target,
        request.policy,
        actionRecord
      );

      const combinedLimitations = Array.from(
        new Set([...(raw.limitations ?? []), ...trustReport.limitations])
      );

      const ev = EvidenceSchema.parse({
        ...tempEv,
        limitations: combinedLimitations,
        provenance: {
          ...raw.provenance,
          trustLevel: trustReport.trustLevel, // derived, not self-elevated
        },
      }) as Evidence;

      formattedEvidence.push(ev);
    }

    // 5b. Independently observe state from trusted external integration if specified
    if (validatedInput.integrationId) {
      const integration = this.integrationRegistry.getById(
        validatedInput.integrationId,
        effectiveTenant
      );

      if (!integration) {
        throw new TenantAccessDeniedError(
          `Integration [${validatedInput.integrationId}] was not found in authorized tenant scope.`
        );
      }

      if (!integration.enabled) {
        throw new Error(`Integration [${validatedInput.integrationId}] is currently disabled.`);
      }

      let reader = this.integrationRegistry.getReader?.(
        validatedInput.integrationId,
        effectiveTenant
      );

      if (!reader) {
        if (integration.type === 'REST_API') {
          reader = new RestApiStateReader(integration, { secretProvider: this.secretProvider });
        } else if (integration.type === 'S3_STORAGE') {
          reader = new S3ObjectStateReader(integration, { secretProvider: this.secretProvider });
        } else if (integration.type === 'POSTGRES') {
          reader = new PostgresStateReader(integration, {
            secretProvider: this.secretProvider,
            driver: this.postgresDriver,
          });
        }
        if (reader) {
          this.integrationRegistry.registerReader?.(reader);
        }
      }

      if (!reader) {
        throw new Error(
          `Failed to initialize reader for integration type [${integration.type}].`
        );
      }

      // Register the integration's sourceId with EvidenceTrustValidator
      this.evidenceTrustValidator.registerTrustedSource(integration.integrationId);

      // Perform independent external state observation
      const observationRecord = await reader.readState(target);

      // Convert observation to Evidence with failure preservation
      const externalEvidence = this.externalEvidenceAdapter.toEvidence(observationRecord, {
        includeFailureRecord: true,
      });

      if (externalEvidence) {
        // Validate external evidence through EvidenceTrustValidator
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

        formattedEvidence.push(validatedExtEv);
      }
    }

    // 6. Execute verification through deterministic Phase 2 engine
    const verificationResult = await this.verifier.verify(
      request,
      formattedEvidence,
      actionRecord
    );

    // 7. Generate audit trace
    let trace: VerificationTrace;
    if (
      this.verifier instanceof VerificationEngine &&
      typeof (this.verifier as any).createTrace === 'function'
    ) {
      trace = (this.verifier as VerificationEngine).createTrace(
        request,
        verificationResult,
        formattedEvidence,
        actionRecord
      );
    } else {
      trace = {
        traceId: crypto.randomUUID(),
        request: Object.freeze({ ...request }),
        action: actionRecord ? Object.freeze({ ...actionRecord }) : undefined,
        evidence: Object.freeze(formattedEvidence.map((e) => Object.freeze({ ...e }))),
        result: Object.freeze({ ...verificationResult }),
        recordedAt: new Date().toISOString(),
      };
    }

    // 8. Persist trace in durable repository
    const saveTenant = effectiveTenant ?? 'default';
    try {
      await this.traceRepository.saveForTenant(saveTenant, trace);
    } catch (err: any) {
      if (ctx?.logger) {
        ctx.logger.error('Failed to persist verification trace', {
          traceId: trace.traceId,
          error: err.message,
        });
      }
      throw err;
    }

    // Also update legacy registry if separate
    if (this.traceRegistry && this.traceRegistry !== (this.traceRepository as any)) {
      try {
        this.traceRegistry.save(trace);
      } catch {
        // Ignore if already stored
      }
    }

    // 9. Return structured machine-readable result
    return {
      status: 'success',
      verificationId: verificationResult.verificationId,
      requestId: verificationResult.requestId,
      overallVerdict: verificationResult.overallVerdict,
      summary: verificationResult.summary,
      evaluatedAt: verificationResult.evaluatedAt,
      conditionEvaluations: verificationResult.conditionEvaluations,
      evidenceManifest: verificationResult.evidenceManifest,
      traceId: trace.traceId,
      trace,
      executionDurationMs: verificationResult.executionDurationMs,
    };
  }

  /**
   * Tool 2: inspect_trace
   * Retrieves an immutable, tenant-isolated audit trace explaining how a verification verdict was reached.
   */
  @Tool({
    name: 'inspect_trace',
    description:
      'Inspects an immutable, tenant-isolated verification trace detailing the request, action claims, observed evidence provenance, and condition evaluations for an executed verification. Strictly scoped to the authenticated tenant.',
    inputSchema: InspectTraceInputSchema,
  })
  public async inspectTrace(input: InspectTraceInput, ctx?: ExecutionContext) {
    if (ctx?.logger) {
      ctx.logger.info('Executing inspect_trace', { traceId: input.traceId });
    }

    // 1. Resolve principal and authorize operation
    const principal = await this.identityProvider.resolvePrincipal(ctx, { tenantId: input.tenantId });
    await this.authorizationService.authorizeOperation(principal, Permissions.TRACE_READ);

    // 2. Determine and validate tenant scope
    const targetTenant = input.tenantId ?? principal.tenantId;
    if (input.tenantId) {
      await this.authorizationService.authorizeTenantScope(principal, input.tenantId);
    }

    // 3. Retrieve trace strictly scoped to tenant
    const effectiveFilterTenant = (targetTenant && targetTenant !== '*') ? targetTenant : undefined;
    let trace: VerificationTrace | null = null;
    if (effectiveFilterTenant) {
      trace = await this.traceRepository.getByTenantAndId(effectiveFilterTenant, input.traceId);
    } else {
      trace = await this.traceRepository.getById(input.traceId);
    }

    if (!trace) {
      if (this.traceRegistry && this.traceRegistry !== (this.traceRepository as any)) {
        trace = this.traceRegistry.getById(input.traceId, effectiveFilterTenant) as VerificationTrace | null;
      }
    }

    if (!trace) {
      // Fail closed: do not leak whether trace exists under another tenant
      throw new TraceNotFoundError(
        `Trace not found: Trace ID [${input.traceId}] does not exist in memory or access was denied due to tenant mismatch.`
      );
    }

    // 4. Verify trace access through authorization service
    await this.authorizationService.authorizeTraceAccess(principal, trace);

    return {
      status: 'success',
      traceId: trace.traceId,
      recordedAt: trace.recordedAt,
      request: trace.request,
      action: trace.action,
      evidence: trace.evidence,
      result: trace.result,
    };
  }

  /**
   * Tool 3: run_scenario
   * Executes a registered deterministic simulation scenario to demonstrate verification behavior.
   */
  @Tool({
    name: 'run_scenario',
    description:
      'Executes a deterministic simulated scenario (A: Genuine Success, B: False Success, C: Wrong Target, D: Partial Update, E: Observation Unavailable, F: Tenant Isolation) through simulated tool execution and observation. Scenarios are clearly labeled as simulated and execute in isolated environments.',
    inputSchema: RunScenarioInputSchema,
  })
  public async runScenario(input: RunScenarioInput, ctx?: ExecutionContext) {
    if (ctx?.logger) {
      ctx.logger.info('Executing run_scenario', { scenarioId: input.scenarioId });
    }

    // 1. Resolve caller and authorize scenario execution
    const principal = await this.identityProvider.resolvePrincipal(ctx);
    await this.authorizationService.authorizeOperation(principal, Permissions.SCENARIO_EXECUTE);

    const scenario = this.scenarioCatalog.get(input.scenarioId);

    if (!scenario) {
      const available = this.scenarioCatalog
        .list()
        .map((s) => s.id)
        .join(', ');
      throw new Error(
        `Unknown scenario [${input.scenarioId}]. Available registered scenarios: ${available}`
      );
    }

    // 2. Scenario state isolation: fresh runner per invocation
    const runner = this.scenarioRunner ?? new ScenarioRunner({ verifier: this.verifier });
    const executionResult = await runner.run(scenario);

    // 3. Save trace into durable repository
    const traceTenant = executionResult.trace.request.target.tenantId ?? 'default';
    await this.traceRepository.saveForTenant(traceTenant, executionResult.trace);

    if (this.traceRegistry && this.traceRegistry !== (this.traceRepository as any)) {
      try {
        this.traceRegistry.save(executionResult.trace);
      } catch {
        // Ignore if already stored
      }
    }

    return {
      status: 'success',
      scenarioId: executionResult.scenarioId,
      name: scenario.name,
      description: scenario.description,
      actionReportedStatus: executionResult.actionRecord.executionStatus,
      verificationVerdict: executionResult.verificationResult.overallVerdict,
      summary: executionResult.verificationResult.summary,
      evidenceCount: executionResult.evidence.length,
      traceId: executionResult.trace.traceId,
      verificationResult: executionResult.verificationResult,
      trace: executionResult.trace,
    };
  }

  /**
   * Tool 4: list_scenarios
   * Discovers the catalog of available deterministic simulation scenarios.
   */
  @Tool({
    name: 'list_scenarios',
    description:
      'Lists all discoverable deterministic simulation scenarios and their expected verification outcomes.',
    inputSchema: ListScenariosInputSchema,
  })
  public async listScenarios(_input: ListScenariosInput, ctx?: ExecutionContext) {
    if (ctx?.logger) {
      ctx.logger.info('Executing list_scenarios');
    }

    // Authorize operation
    const principal = await this.identityProvider.resolvePrincipal(ctx);
    await this.authorizationService.authorizeOperation(principal, Permissions.SCENARIO_LIST);

    const scenarios = this.scenarioCatalog.list();

    return {
      status: 'success',
      count: scenarios.length,
      scenarios,
    };
  }

  public getTraceRegistry(): ITraceRegistry {
    return this.traceRegistry;
  }

  public getTraceRepository(): ITraceRepository {
    return this.traceRepository;
  }

  public getScenarioCatalog(): ScenarioCatalog {
    return this.scenarioCatalog;
  }

  public getIdentityProvider(): IIdentityProvider {
    return this.identityProvider;
  }

  public getAuthorizationService(): IAuthorizationService {
    return this.authorizationService;
  }

  public getEvidenceTrustValidator(): EvidenceTrustValidator {
    return this.evidenceTrustValidator;
  }
}
