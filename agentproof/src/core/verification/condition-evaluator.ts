/**
 * AgentProof Core Verification — ConditionEvaluator
 * 
 * Evaluates individual ConditionSpec assertions deterministically against
 * independently acquired Evidence.
 */

import { ConditionSpec, ResourceTarget } from '../domain/verification-request.js';
import { Evidence } from '../domain/evidence.js';
import { ActionRecord } from '../domain/action-record.js';
import { ConditionEvaluation, Verdict } from '../domain/verification-result.js';
import { ReasonCodes } from './reason-codes.js';

export class ConditionEvaluator {
  /**
   * Evaluates a single condition against the available evidence collection.
   */
  public evaluateCondition(
    condition: ConditionSpec,
    target: ResourceTarget,
    evidenceList: readonly Evidence[],
    action?: ActionRecord,
    freshnessToleranceMs: number = 60000
  ): ConditionEvaluation {
    // 1. Filter evidence relevant to target resource
    const matchingEvidence = evidenceList.filter((e) => this.isEvidenceRelevant(e, target));

    if (matchingEvidence.length === 0) {
      return {
        conditionId: condition.id,
        description: condition.description,
        verdict: 'INCONCLUSIVE',
        reasonCode: ReasonCodes.INC_EVIDENCE_NOT_FOUND,
        explanation: `No evidence found matching target resource [${target.system}:${target.resourceType}:${target.resourceId}].`,
        expected: condition.expectedValue,
        observed: undefined,
      };
    }

    // Check for untrusted or integrity-compromised evidence
    const untrustedEvidence = matchingEvidence.find((e) =>
      e.limitations && (
        e.limitations.includes('INTEGRITY_DIGEST_MISMATCH') ||
        e.limitations.includes('UNTRUSTED_EVIDENCE') ||
        e.limitations.includes('INVALID_OBSERVED_TIMESTAMP') ||
        e.limitations.includes('FUTURE_TIMESTAMP_EXCEEDS_CLOCK_SKEW')
      )
    );

    if (untrustedEvidence) {
      return {
        conditionId: condition.id,
        description: condition.description,
        verdict: 'INCONCLUSIVE',
        reasonCode: ReasonCodes.INC_UNTRUSTED_EVIDENCE,
        explanation: `Evidence [${untrustedEvidence.evidenceId}] is untrusted or failed integrity verification: ${untrustedEvidence.limitations.join(', ')}.`,
        expected: condition.expectedValue,
        observed: undefined,
        supportingEvidenceId: untrustedEvidence.evidenceId,
      };
    }

    // Check for reader error or observation failure
    const failedObservation = matchingEvidence.find((e) =>
      e.observationStatus === 'ERROR' ||
      (e.limitations && (
        e.limitations.includes('OBSERVATION_FAILED_READ_ERROR') ||
        e.limitations.includes('READER_TIMEOUT') ||
        e.limitations.includes('READER_ERROR')
      ))
    );

    if (failedObservation) {
      const isTimeout =
        failedObservation.limitations?.includes('READER_TIMEOUT') ||
        failedObservation.limitations?.includes('TIMEOUT');
      return {
        conditionId: condition.id,
        description: condition.description,
        verdict: 'INCONCLUSIVE',
        reasonCode: isTimeout ? ReasonCodes.INC_READER_TIMEOUT : ReasonCodes.INC_READER_ERROR,
        explanation: `Observation failed for target resource: ${failedObservation.limitations?.join(', ') || 'Remote source read error'}.`,
        expected: condition.expectedValue,
        observed: undefined,
        supportingEvidenceId: failedObservation.evidenceId,
      };
    }

    // 2. Check for stale evidence relative to action invocation
    if (action) {
      const actionTime = new Date(action.invokedAt).getTime();
      const staleEvidence = matchingEvidence.find((e) => {
        const obsTime = new Date(e.observedAt).getTime();
        // Observation occurred prior to action start beyond allowable tolerance
        return obsTime < actionTime - freshnessToleranceMs;
      });

      if (staleEvidence) {
        return {
          conditionId: condition.id,
          description: condition.description,
          verdict: 'INCONCLUSIVE',
          reasonCode: ReasonCodes.INC_STALE_EVIDENCE,
          explanation: `Evidence [${staleEvidence.evidenceId}] was observed at ${staleEvidence.observedAt}, which precedes action invocation ${action.invokedAt}.`,
          expected: condition.expectedValue,
          observed: undefined,
          supportingEvidenceId: staleEvidence.evidenceId,
        };
      }
    }

    // 3. Extract observed values across matching evidence to check for conflicts
    const extractedValues = matchingEvidence.map((e) => ({
      evidenceId: e.evidenceId,
      value: this.resolvePath(e.observedPayload, condition.path),
    }));

    // If multiple evidence items observe contradictory values for this path
    if (extractedValues.length > 1) {
      const firstVal = extractedValues[0].value;
      const hasConflict = extractedValues.some(
        (ev) => !this.deepEqual(ev.value, firstVal)
      );

      if (hasConflict) {
        return {
          conditionId: condition.id,
          description: condition.description,
          verdict: 'INCONCLUSIVE',
          reasonCode: ReasonCodes.INC_CONFLICTING_EVIDENCE,
          explanation: `Multiple evidence sources returned conflicting values for path '${condition.path}'.`,
          expected: condition.expectedValue,
          observed: extractedValues.map((ev) => ev.value),
        };
      }
    }

    // 4. Primary evidence item for evaluation
    const primaryEvidence = matchingEvidence[0];
    const observedValue = extractedValues[0].value;

    // 5. Evaluate based on operator
    return this.evaluatePredicate(condition, observedValue, primaryEvidence.evidenceId);
  }

  /**
   * Deterministically evaluates a typed predicate operator.
   */
  private evaluatePredicate(
    condition: ConditionSpec,
    observedValue: unknown,
    evidenceId: string
  ): ConditionEvaluation {
    const { operator, expectedValue, id, description } = condition;

    switch (operator) {
      case 'EQUALS': {
        if (observedValue === undefined) {
          return {
            conditionId: id,
            description,
            verdict: 'INCONCLUSIVE',
            reasonCode: ReasonCodes.INC_MISSING_ATTRIBUTES,
            explanation: `Path '${condition.path}' not found in observed payload.`,
            expected: expectedValue,
            observed: undefined,
            supportingEvidenceId: evidenceId,
          };
        }

        const isMatch = this.deepEqual(observedValue, expectedValue);
        return {
          conditionId: id,
          description,
          verdict: isMatch ? 'PASS' : 'FAIL',
          reasonCode: isMatch ? ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED : ReasonCodes.FAIL_VALUE_MISMATCH,
          explanation: isMatch
            ? `Observed value for '${condition.path}' matches expected value.`
            : `Observed value ${JSON.stringify(observedValue)} does not equal expected ${JSON.stringify(expectedValue)}.`,
          expected: expectedValue,
          observed: observedValue,
          supportingEvidenceId: evidenceId,
        };
      }

      case 'NOT_EQUALS': {
        if (observedValue === undefined) {
          return {
            conditionId: id,
            description,
            verdict: 'INCONCLUSIVE',
            reasonCode: ReasonCodes.INC_MISSING_ATTRIBUTES,
            explanation: `Path '${condition.path}' not found in observed payload.`,
            expected: expectedValue,
            observed: undefined,
            supportingEvidenceId: evidenceId,
          };
        }

        const isMatch = !this.deepEqual(observedValue, expectedValue);
        return {
          conditionId: id,
          description,
          verdict: isMatch ? 'PASS' : 'FAIL',
          reasonCode: isMatch ? ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED : ReasonCodes.FAIL_VALUE_MISMATCH,
          explanation: isMatch
            ? `Observed value for '${condition.path}' is not equal to ${JSON.stringify(expectedValue)} as required.`
            : `Observed value for '${condition.path}' unexpectedly equals forbidden value ${JSON.stringify(expectedValue)}.`,
          expected: expectedValue,
          observed: observedValue,
          supportingEvidenceId: evidenceId,
        };
      }

      case 'GREATER_THAN': {
        if (typeof observedValue !== 'number' || typeof expectedValue !== 'number') {
          return {
            conditionId: id,
            description,
            verdict: 'INCONCLUSIVE',
            reasonCode: ReasonCodes.INC_MISSING_ATTRIBUTES,
            explanation: `GREATER_THAN requires numeric values; observed ${typeof observedValue}, expected ${typeof expectedValue}.`,
            expected: expectedValue,
            observed: observedValue,
            supportingEvidenceId: evidenceId,
          };
        }

        const isGreater = observedValue > expectedValue;
        return {
          conditionId: id,
          description,
          verdict: isGreater ? 'PASS' : 'FAIL',
          reasonCode: isGreater ? ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED : ReasonCodes.FAIL_THRESHOLD_EXCEEDED,
          explanation: isGreater
            ? `Observed ${observedValue} is greater than threshold ${expectedValue}.`
            : `Observed ${observedValue} is not greater than threshold ${expectedValue}.`,
          expected: expectedValue,
          observed: observedValue,
          supportingEvidenceId: evidenceId,
        };
      }

      case 'LESS_THAN': {
        if (typeof observedValue !== 'number' || typeof expectedValue !== 'number') {
          return {
            conditionId: id,
            description,
            verdict: 'INCONCLUSIVE',
            reasonCode: ReasonCodes.INC_MISSING_ATTRIBUTES,
            explanation: `LESS_THAN requires numeric values; observed ${typeof observedValue}, expected ${typeof expectedValue}.`,
            expected: expectedValue,
            observed: observedValue,
            supportingEvidenceId: evidenceId,
          };
        }

        const isLess = observedValue < expectedValue;
        return {
          conditionId: id,
          description,
          verdict: isLess ? 'PASS' : 'FAIL',
          reasonCode: isLess ? ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED : ReasonCodes.FAIL_THRESHOLD_EXCEEDED,
          explanation: isLess
            ? `Observed ${observedValue} is less than threshold ${expectedValue}.`
            : `Observed ${observedValue} is not less than threshold ${expectedValue}.`,
          expected: expectedValue,
          observed: observedValue,
          supportingEvidenceId: evidenceId,
        };
      }

      case 'CONTAINS': {
        if (typeof observedValue === 'string' && typeof expectedValue === 'string') {
          const contains = observedValue.includes(expectedValue);
          return {
            conditionId: id,
            description,
            verdict: contains ? 'PASS' : 'FAIL',
            reasonCode: contains ? ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED : ReasonCodes.FAIL_VALUE_MISMATCH,
            explanation: contains
              ? `String '${observedValue}' contains substring '${expectedValue}'.`
              : `String '${observedValue}' does not contain '${expectedValue}'.`,
            expected: expectedValue,
            observed: observedValue,
            supportingEvidenceId: evidenceId,
          };
        }

        if (Array.isArray(observedValue)) {
          const contains = observedValue.some((item) => this.deepEqual(item, expectedValue));
          return {
            conditionId: id,
            description,
            verdict: contains ? 'PASS' : 'FAIL',
            reasonCode: contains ? ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED : ReasonCodes.FAIL_VALUE_MISMATCH,
            explanation: contains
              ? `Array contains expected element ${JSON.stringify(expectedValue)}.`
              : `Array does not contain expected element ${JSON.stringify(expectedValue)}.`,
            expected: expectedValue,
            observed: observedValue,
            supportingEvidenceId: evidenceId,
          };
        }

        return {
          conditionId: id,
          description,
          verdict: 'INCONCLUSIVE',
          reasonCode: ReasonCodes.INC_MISSING_ATTRIBUTES,
          explanation: `CONTAINS operator requires a string or array; observed ${typeof observedValue}.`,
          expected: expectedValue,
          observed: observedValue,
          supportingEvidenceId: evidenceId,
        };
      }

      case 'MATCHES_REGEX': {
        if (typeof observedValue !== 'string' || typeof expectedValue !== 'string') {
          return {
            conditionId: id,
            description,
            verdict: 'INCONCLUSIVE',
            reasonCode: ReasonCodes.INC_MISSING_ATTRIBUTES,
            explanation: `MATCHES_REGEX requires string observed value and regex pattern.`,
            expected: expectedValue,
            observed: observedValue,
            supportingEvidenceId: evidenceId,
          };
        }

        try {
          const regex = new RegExp(expectedValue);
          const matches = regex.test(observedValue);
          return {
            conditionId: id,
            description,
            verdict: matches ? 'PASS' : 'FAIL',
            reasonCode: matches ? ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED : ReasonCodes.FAIL_VALUE_MISMATCH,
            explanation: matches
              ? `Observed string matches regular expression /${expectedValue}/.`
              : `Observed string does not match regex /${expectedValue}/.`,
            expected: expectedValue,
            observed: observedValue,
            supportingEvidenceId: evidenceId,
          };
        } catch (e) {
          return {
            conditionId: id,
            description,
            verdict: 'INCONCLUSIVE',
            reasonCode: ReasonCodes.INC_UNSUPPORTED_PREDICATE,
            explanation: `Invalid regular expression pattern: ${expectedValue}.`,
            expected: expectedValue,
            observed: observedValue,
            supportingEvidenceId: evidenceId,
          };
        }
      }

      case 'EXISTS': {
        const exists = observedValue !== undefined && observedValue !== null;
        return {
          conditionId: id,
          description,
          verdict: exists ? 'PASS' : 'FAIL',
          reasonCode: exists ? ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED : ReasonCodes.FAIL_VALUE_MISMATCH,
          explanation: exists
            ? `Path '${condition.path}' exists in observed payload.`
            : `Path '${condition.path}' does not exist (null or undefined).`,
          expected: 'NOT_NULL_OR_UNDEFINED',
          observed: observedValue,
          supportingEvidenceId: evidenceId,
        };
      }

      case 'DOES_NOT_EXIST': {
        const notExists = observedValue === undefined || observedValue === null;
        return {
          conditionId: id,
          description,
          verdict: notExists ? 'PASS' : 'FAIL',
          reasonCode: notExists ? ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED : ReasonCodes.FAIL_VALUE_MISMATCH,
          explanation: notExists
            ? `Path '${condition.path}' is absent as expected.`
            : `Path '${condition.path}' exists unexpectedly with value ${JSON.stringify(observedValue)}.`,
          expected: 'UNDEFINED_OR_NULL',
          observed: observedValue,
          supportingEvidenceId: evidenceId,
        };
      }

      default: {
        return {
          conditionId: id,
          description,
          verdict: 'INCONCLUSIVE',
          reasonCode: ReasonCodes.INC_UNSUPPORTED_PREDICATE,
          explanation: `Unsupported predicate operator: ${operator}.`,
          expected: expectedValue,
          observed: observedValue,
          supportingEvidenceId: evidenceId,
        };
      }
    }
  }

  /**
   * Safely checks whether an evidence item matches the target resource.
   */
  public isEvidenceRelevant(evidence: Evidence, target: ResourceTarget): boolean {
    if (evidence.target.system !== target.system) return false;
    if (evidence.target.resourceType !== target.resourceType) return false;
    if (evidence.target.resourceId !== target.resourceId) return false;
    if (target.tenantId && evidence.target.tenantId !== target.tenantId) return false;
    return true;
  }

  /**
   * Safely resolves a nested dot-delimited property path against an arbitrary payload.
   */
  public resolvePath(payload: unknown, path: string): unknown {
    if (payload === null || payload === undefined) return undefined;
    if (!path || path === '') return payload;

    const parts = path.split('.');
    let current: any = payload;

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Deterministic deep equality check for primitives, arrays, and objects.
   */
  public deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;

    if (typeof a !== typeof b) return false;
    if (a === null || b === null || a === undefined || b === undefined) return false;

    if (typeof a !== 'object') return false;

    if (Array.isArray(a) !== Array.isArray(b)) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!this.deepEqual(a[i], b[i])) return false;
      }
      return true;
    }

    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;

    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
      if (!this.deepEqual(objA[key], objB[key])) return false;
    }

    return true;
  }
}
