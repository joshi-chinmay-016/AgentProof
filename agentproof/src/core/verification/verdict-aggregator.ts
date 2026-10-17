/**
 * AgentProof Core Verification — VerdictAggregator
 * 
 * Aggregates individual ConditionEvaluation results into an overall Verdict
 * adhering strictly to the priority hierarchy: FAIL > INCONCLUSIVE > PASS.
 */

import { ConditionEvaluation, Verdict } from '../domain/verification-result.js';
import { ConditionEnforcement } from '../domain/verification-request.js';
import { ReasonCodes } from './reason-codes.js';

export interface AggregationItem {
  readonly evaluation: ConditionEvaluation;
  readonly enforcement: ConditionEnforcement;
}

export interface AggregatedVerdictResult {
  readonly overallVerdict: Verdict;
  readonly summary: string;
  readonly primaryReasonCode: string;
}

export class VerdictAggregator {
  /**
   * Aggregates condition evaluations into an overall verdict.
   */
  public aggregate(items: readonly AggregationItem[]): AggregatedVerdictResult {
    if (items.length === 0) {
      return {
        overallVerdict: 'INCONCLUSIVE',
        summary: 'No conditions provided for evaluation.',
        primaryReasonCode: ReasonCodes.INC_MISSING_ATTRIBUTES,
      };
    }

    // Separate required and advisory evaluations
    const requiredItems = items.filter((item) => item.enforcement === 'REQUIRED');
    const advisoryItems = items.filter((item) => item.enforcement === 'ADVISORY');

    // Counts across required conditions
    const requiredFailed = requiredItems.filter((item) => item.evaluation.verdict === 'FAIL');
    const requiredInconclusive = requiredItems.filter((item) => item.evaluation.verdict === 'INCONCLUSIVE');
    const requiredPassed = requiredItems.filter((item) => item.evaluation.verdict === 'PASS');

    // Counts across advisory conditions
    const advisoryFailed = advisoryItems.filter((item) => item.evaluation.verdict === 'FAIL');

    // 1. FAIL takes absolute precedence over all other outcomes
    if (requiredFailed.length > 0) {
      const firstFail = requiredFailed[0].evaluation;
      return {
        overallVerdict: 'FAIL',
        summary: `Verification FAILED: ${requiredFailed.length} of ${requiredItems.length} required postcondition(s) violated. Primary violation: ${firstFail.explanation}`,
        primaryReasonCode: firstFail.reasonCode,
      };
    }

    // 2. INCONCLUSIVE takes precedence over PASS if evidence is insufficient/indeterminate
    if (requiredInconclusive.length > 0) {
      const firstInc = requiredInconclusive[0].evaluation;
      return {
        overallVerdict: 'INCONCLUSIVE',
        summary: `Verification INCONCLUSIVE: ${requiredInconclusive.length} of ${requiredItems.length} required condition(s) could not be verified due to insufficient/indeterminate evidence.`,
        primaryReasonCode: firstInc.reasonCode,
      };
    }

    // 3. PASS only when ALL required conditions pass
    if (requiredPassed.length === requiredItems.length && requiredItems.length > 0) {
      const advisoryNote = advisoryFailed.length > 0 
        ? ` (${advisoryFailed.length} advisory condition(s) did not match).` 
        : '.';
      return {
        overallVerdict: 'PASS',
        summary: `Verification PASSED: All ${requiredItems.length} required postcondition(s) verified by independent evidence${advisoryNote}`,
        primaryReasonCode: ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED,
      };
    }

    // Fallback if no required conditions were specified but advisory ones were
    if (requiredItems.length === 0 && advisoryItems.length > 0) {
      const allAdvisoryPass = advisoryItems.every((item) => item.evaluation.verdict === 'PASS');
      return {
        overallVerdict: allAdvisoryPass ? 'PASS' : 'INCONCLUSIVE',
        summary: `Only advisory conditions were supplied: ${allAdvisoryPass ? 'All passed' : 'Some could not be verified'}.`,
        primaryReasonCode: allAdvisoryPass ? ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED : ReasonCodes.INC_MISSING_ATTRIBUTES,
      };
    }

    return {
      overallVerdict: 'INCONCLUSIVE',
      summary: 'Evaluation completed with indeterminate condition states.',
      primaryReasonCode: ReasonCodes.INC_MISSING_ATTRIBUTES,
    };
  }
}
