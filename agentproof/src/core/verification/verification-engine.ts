/**
 * AgentProof Core Verification — VerificationEngine
 * 
 * Central coordinator implementing the IVerifier contract.
 * Pure, side-effect free, framework-independent.
 */

import * as crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { IVerifier } from '../contracts/verifier.js';
import {
  VerificationRequest,
  VerificationRequestSchema,
  ConditionSpec,
} from '../domain/verification-request.js';
import { Evidence, EvidenceSchema } from '../domain/evidence.js';
import { ActionRecord, ActionRecordSchema } from '../domain/action-record.js';
import {
  VerificationResult,
  ConditionEvaluation,
  EvidenceManifestItem,
} from '../domain/verification-result.js';
import { VerificationTrace } from '../domain/verification-trace.js';
import { ConditionEvaluator } from './condition-evaluator.js';
import { VerdictAggregator, AggregationItem } from './verdict-aggregator.js';
import { ReasonCodes } from './reason-codes.js';
import { ValidationError } from '../errors/domain-errors.js';

export interface VerificationEngineOptions {
  readonly verifierName?: string;
  readonly verifierVersion?: string;
}

export class VerificationEngine implements IVerifier {
  private readonly conditionEvaluator: ConditionEvaluator;
  private readonly verdictAggregator: VerdictAggregator;
  private readonly verifierIdentity: { name: string; version: string };

  constructor(options?: VerificationEngineOptions) {
    this.conditionEvaluator = new ConditionEvaluator();
    this.verdictAggregator = new VerdictAggregator();
    this.verifierIdentity = {
      name: options?.verifierName ?? 'AgentProof-Core',
      version: options?.verifierVersion ?? '1.0.0',
    };
  }

  /**
   * Evaluates a VerificationRequest against acquired Evidence and ActionRecord.
   */
  public async verify(
    request: VerificationRequest,
    evidence: readonly Evidence[],
    action?: ActionRecord
  ): Promise<VerificationResult> {
    const startTime = performance.now();

    // 1. Validate inputs strictly against domain schemas
    this.validateInputs(request, evidence, action);

    const conditionEvaluations: ConditionEvaluation[] = [];
    const aggregationItems: AggregationItem[] = [];

    // 2. Preconditions Evaluation (if specified)
    if (request.preconditions && request.preconditions.length > 0) {
      for (const pre of request.preconditions) {
        const evalResult = this.conditionEvaluator.evaluateCondition(
          pre,
          request.target,
          evidence,
          action,
          request.policy.freshnessToleranceMs
        );

        // If a required precondition is violated, fail immediately
        if (evalResult.verdict === 'FAIL' && pre.enforcement === 'REQUIRED') {
          const preconditionFailEvaluation: ConditionEvaluation = {
            ...evalResult,
            reasonCode: ReasonCodes.FAIL_PRECONDITION_VIOLATED,
            explanation: `Precondition [${pre.id}] violated: ${evalResult.explanation}`,
          };
          conditionEvaluations.push(preconditionFailEvaluation);

          const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
          return this.buildResult(
            request.requestId,
            'FAIL',
            `Verification FAILED: Precondition '${pre.id}' was violated before action could be verified.`,
            conditionEvaluations,
            evidence,
            durationMs
          );
        }

        conditionEvaluations.push(evalResult);
      }
    }

    // 3. Postconditions Evaluation (All evaluated exhaustively)
    for (const post of request.postconditions) {
      const evalResult = this.conditionEvaluator.evaluateCondition(
        post,
        request.target,
        evidence,
        action,
        request.policy.freshnessToleranceMs
      );

      conditionEvaluations.push(evalResult);
      aggregationItems.push({
        evaluation: evalResult,
        enforcement: post.enforcement,
      });
    }

    // 4. Aggregate Verdict using Tri-State Priority Rules
    const aggregated = this.verdictAggregator.aggregate(aggregationItems);

    const durationMs = Math.round((performance.now() - startTime) * 100) / 100;

    return this.buildResult(
      request.requestId,
      aggregated.overallVerdict,
      aggregated.summary,
      conditionEvaluations,
      evidence,
      durationMs
    );
  }

  /**
   * Creates an immutable audit trace linking the request, evidence, and result.
   */
  public createTrace(
    request: VerificationRequest,
    result: VerificationResult,
    evidence: readonly Evidence[],
    action?: ActionRecord
  ): VerificationTrace {
    return {
      traceId: crypto.randomUUID(),
      request: Object.freeze({ ...request }),
      action: action ? Object.freeze({ ...action }) : undefined,
      evidence: Object.freeze(evidence.map((e) => Object.freeze({ ...e }))),
      result: Object.freeze({ ...result }),
      recordedAt: new Date().toISOString(),
    };
  }

  /**
   * Validates request, evidence, and action structures.
   * Throws ValidationError if inputs are malformed.
   */
  private validateInputs(
    request: VerificationRequest,
    evidence: readonly Evidence[],
    action?: ActionRecord
  ): void {
    const reqValidation = VerificationRequestSchema.safeParse(request);
    if (!reqValidation.success) {
      const issues = reqValidation.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`
      );
      throw new ValidationError(`Malformed VerificationRequest: ${issues.join('; ')}`, issues);
    }

    if (!Array.isArray(evidence)) {
      throw new ValidationError('Evidence parameter must be an array.');
    }

    for (let i = 0; i < evidence.length; i++) {
      const evValidation = EvidenceSchema.safeParse(evidence[i]);
      if (!evValidation.success) {
        const issues = evValidation.error.issues.map(
          (issue) => `evidence[${i}].${issue.path.join('.')}: ${issue.message}`
        );
        throw new ValidationError(`Malformed Evidence at index ${i}: ${issues.join('; ')}`, issues);
      }
    }

    if (action) {
      const actValidation = ActionRecordSchema.safeParse(action);
      if (!actValidation.success) {
        const issues = actValidation.error.issues.map(
          (issue) => `action.${issue.path.join('.')}: ${issue.message}`
        );
        throw new ValidationError(`Malformed ActionRecord: ${issues.join('; ')}`, issues);
      }
    }
  }

  /**
   * Helper to construct a typed, immutable VerificationResult.
   */
  private buildResult(
    requestId: string,
    verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE',
    summary: string,
    evaluations: readonly ConditionEvaluation[],
    evidence: readonly Evidence[],
    durationMs: number
  ): VerificationResult {
    const evidenceManifest: EvidenceManifestItem[] = evidence.map((e) => ({
      evidenceId: e.evidenceId,
      sourceId: e.sourceId,
      observedAt: e.observedAt,
      integrityHash: e.integrityHash,
    }));

    return {
      schemaVersion: '1.0.0',
      verificationId: crypto.randomUUID(),
      requestId,
      overallVerdict: verdict,
      summary,
      evaluatedAt: new Date().toISOString(),
      conditionEvaluations: Object.freeze([...evaluations]),
      evidenceManifest: Object.freeze(evidenceManifest),
      verifierIdentity: this.verifierIdentity,
      executionDurationMs: durationMs,
    };
  }
}
