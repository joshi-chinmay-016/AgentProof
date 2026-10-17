/**
 * AgentProof MCP Layer — VerificationTools Controller
 * 
 * Exposes AgentProof deterministic verification capabilities to AI agents
 * and MCP-compatible clients via NitroStack @Tool decorators:
 * 1. verify_outcome
 * 2. inspect_trace
 * 3. run_scenario
 * 4. list_scenarios
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
} from '../../core/index.js';
import { EvidenceAdapter, ScenarioRunner } from '../../simulation/index.js';
import { ITraceRegistry, defaultTraceRegistry } from './trace-registry.js';
import { ScenarioCatalog, defaultScenarioCatalog } from './scenario-catalog.js';
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

export class VerificationTools {
  private readonly verifier: IVerifier;
  private readonly traceRegistry: ITraceRegistry;
  private readonly scenarioCatalog: ScenarioCatalog;
  private readonly scenarioRunner: ScenarioRunner;
  private readonly evidenceAdapter: EvidenceAdapter;

  constructor(
    verifier?: IVerifier,
    traceRegistry?: ITraceRegistry,
    scenarioCatalog?: ScenarioCatalog,
    scenarioRunner?: ScenarioRunner
  ) {
    this.verifier = verifier ?? new VerificationEngine();
    this.traceRegistry = traceRegistry ?? defaultTraceRegistry;
    this.scenarioCatalog = scenarioCatalog ?? defaultScenarioCatalog;
    this.scenarioRunner =
      scenarioRunner ?? new ScenarioRunner({ verifier: this.verifier });
    this.evidenceAdapter = new EvidenceAdapter();
  }

  /**
   * Tool 1: verify_outcome
   * Evaluates independently acquired evidence against postconditions to deterministically
   * verify an agent action's outcome.
   */
  @Tool({
    name: 'verify_outcome',
    description:
      'Independently verifies whether an agent operation satisfied its required postconditions based on observable evidence. Returns PASS, FAIL, or INCONCLUSIVE.',
    inputSchema: VerifyOutcomeInputSchema,
  })
  public async verifyOutcome(input: VerifyOutcomeInput, ctx?: ExecutionContext) {
    if (ctx?.logger) {
      ctx.logger.info('Executing verify_outcome', {
        requestId: input.requestId,
        target: input.target,
        operation: input.intent.operation,
      });
    }

    // 1. Build and validate VerificationRequest
    const requestId = input.requestId ?? `req-${crypto.randomUUID().slice(0, 8)}`;
    const tenantId = input.tenantId ?? input.target.tenantId;

    const target = {
      system: input.target.system,
      resourceType: input.target.resourceType,
      resourceId: input.target.resourceId,
      tenantId,
    };

    const request: VerificationRequest = VerificationRequestSchema.parse({
      schemaVersion: '1.0.0',
      requestId,
      timestamp: new Date().toISOString(),
      target,
      intent: input.intent,
      preconditions: input.preconditions ?? [],
      postconditions: input.postconditions,
      policy: input.policy ?? {
        timeoutMs: 5000,
        requireIndependentSource: true,
        freshnessToleranceMs: 60000,
      },
    });

    // 2. Build ActionRecord if provided
    let actionRecord: ActionRecord | undefined;
    if (input.action) {
      const invokedAt = input.action.invokedAt ?? new Date().toISOString();
      const completedAt = input.action.completedAt ?? invokedAt;

      actionRecord = ActionRecordSchema.parse({
        actionId: input.action.actionId ?? `act-${crypto.randomUUID().slice(0, 8)}`,
        toolName: input.action.toolName,
        target: input.action.target ?? target,
        sanitizedArgs: input.action.sanitizedArgs ?? {},
        executionStatus: input.action.executionStatus,
        reportedResult: input.action.reportedResult ?? null,
        invokedAt,
        completedAt,
        agentId: input.action.agentId,
      }) as ActionRecord;
    }

    // 3. Format & validate Evidence collection
    const formattedEvidence: Evidence[] = [];
    for (let i = 0; i < input.evidence.length; i++) {
      const raw = input.evidence[i];
      const observedAt = raw.observedAt ?? new Date().toISOString();
      const integrityHash =
        raw.integrityHash ?? this.evidenceAdapter.computePayloadHash(raw.observedPayload);

      const ev = EvidenceSchema.parse({
        evidenceId: raw.evidenceId ?? `ev-${i + 1}-${crypto.randomUUID().slice(0, 6)}`,
        evidenceType: raw.evidenceType ?? 'STATE_SNAPSHOT',
        sourceId: raw.sourceId,
        sourceKind: raw.sourceKind ?? 'DIRECT_READ',
        target: raw.target,
        observedPayload: raw.observedPayload,
        observedAt,
        freshnessMs: raw.freshnessMs ?? 0,
        integrityHash,
        limitations: raw.limitations ?? [],
      }) as Evidence;

      formattedEvidence.push(ev);
    }

    // 4. Execute verification through Phase 2 engine
    const verificationResult = await this.verifier.verify(
      request,
      formattedEvidence,
      actionRecord
    );

    // 5. Generate and register audit trace
    let trace;
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

    this.traceRegistry.save(trace);

    // 6. Return structured machine-readable result
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
   * Retrieves an immutable audit trace explaining how a verification verdict was reached.
   */
  @Tool({
    name: 'inspect_trace',
    description:
      'Inspects an immutable verification trace detailing the request, action claims, observed evidence, and condition evaluations for an executed verification.',
    inputSchema: InspectTraceInputSchema,
  })
  public async inspectTrace(input: InspectTraceInput, ctx?: ExecutionContext) {
    if (ctx?.logger) {
      ctx.logger.info('Executing inspect_trace', { traceId: input.traceId });
    }

    const trace = this.traceRegistry.getById(input.traceId, input.tenantId);

    if (!trace) {
      throw new Error(
        `Trace not found: Trace ID [${input.traceId}] does not exist in memory or access was denied due to tenant mismatch.`
      );
    }

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
      'Executes a deterministic simulation scenario through the complete AgentProof pipeline (seeding, mock tool execution, independent observation, and Phase 2 verification).',
    inputSchema: RunScenarioInputSchema,
  })
  public async runScenario(input: RunScenarioInput, ctx?: ExecutionContext) {
    if (ctx?.logger) {
      ctx.logger.info('Executing run_scenario', { scenarioId: input.scenarioId });
    }

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

    const executionResult = await this.scenarioRunner.run(scenario);

    // Save trace into registry for subsequent inspection
    this.traceRegistry.save(executionResult.trace);

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

  public getScenarioCatalog(): ScenarioCatalog {
    return this.scenarioCatalog;
  }
}
