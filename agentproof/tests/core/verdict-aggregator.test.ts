import { describe, it, expect } from 'vitest';
import {
  VerdictAggregator,
  AggregationItem,
  ReasonCodes,
  ConditionEvaluation,
} from '../../src/core/index.js';

describe('VerdictAggregator — Tri-State Priority Aggregation', () => {
  const aggregator = new VerdictAggregator();

  const createEvaluation = (
    id: string,
    verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE',
    reasonCode: string = ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED,
    explanation = 'Test explanation'
  ): ConditionEvaluation => ({
    conditionId: id,
    description: `Condition ${id}`,
    verdict,
    reasonCode,
    explanation,
    expected: 'expected',
    observed: verdict === 'PASS' ? 'expected' : 'other',
  });

  it('13. All required conditions satisfied produce PASS', () => {
    const items: AggregationItem[] = [
      { evaluation: createEvaluation('c1', 'PASS'), enforcement: 'REQUIRED' },
      { evaluation: createEvaluation('c2', 'PASS'), enforcement: 'REQUIRED' },
    ];

    const result = aggregator.aggregate(items);

    expect(result.overallVerdict).toBe('PASS');
    expect(result.primaryReasonCode).toBe(ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED);
    expect(result.summary).toContain('All 2 required postcondition(s) verified');
  });

  it('14. Reliable evidence of a required violation produces the specified failure outcome', () => {
    const items: AggregationItem[] = [
      { evaluation: createEvaluation('c1', 'PASS'), enforcement: 'REQUIRED' },
      {
        evaluation: createEvaluation('c2', 'FAIL', ReasonCodes.FAIL_VALUE_MISMATCH, 'Expected pro, got free'),
        enforcement: 'REQUIRED',
      },
    ];

    const result = aggregator.aggregate(items);

    expect(result.overallVerdict).toBe('FAIL');
    expect(result.primaryReasonCode).toBe(ReasonCodes.FAIL_VALUE_MISMATCH);
    expect(result.summary).toContain('1 of 2 required postcondition(s) violated');
  });

  it('15. Missing evidence prevents a false PASS (yields INCONCLUSIVE)', () => {
    const items: AggregationItem[] = [
      {
        evaluation: createEvaluation('c1', 'INCONCLUSIVE', ReasonCodes.INC_EVIDENCE_NOT_FOUND, 'No evidence found'),
        enforcement: 'REQUIRED',
      },
    ];

    const result = aggregator.aggregate(items);

    expect(result.overallVerdict).toBe('INCONCLUSIVE');
    expect(result.primaryReasonCode).toBe(ReasonCodes.INC_EVIDENCE_NOT_FOUND);
  });

  it('16. Mixed passing and inconclusive conditions follow the documented aggregation rules', () => {
    const items: AggregationItem[] = [
      { evaluation: createEvaluation('c1', 'PASS'), enforcement: 'REQUIRED' },
      {
        evaluation: createEvaluation('c2', 'INCONCLUSIVE', ReasonCodes.INC_READER_TIMEOUT, 'Reader timeout'),
        enforcement: 'REQUIRED',
      },
    ];

    const result = aggregator.aggregate(items);

    // Inconclusive condition prevents PASS
    expect(result.overallVerdict).toBe('INCONCLUSIVE');
    expect(result.primaryReasonCode).toBe(ReasonCodes.INC_READER_TIMEOUT);
  });

  it('17. Multiple conditions are all evaluated and represented in the result with FAIL precedence', () => {
    // 1 PASS, 1 INCONCLUSIVE, 1 FAIL
    // Priority: FAIL > INCONCLUSIVE > PASS
    const items: AggregationItem[] = [
      { evaluation: createEvaluation('c1', 'PASS'), enforcement: 'REQUIRED' },
      {
        evaluation: createEvaluation('c2', 'INCONCLUSIVE', ReasonCodes.INC_STALE_EVIDENCE),
        enforcement: 'REQUIRED',
      },
      {
        evaluation: createEvaluation('c3', 'FAIL', ReasonCodes.FAIL_VALUE_MISMATCH, 'Value mismatch on c3'),
        enforcement: 'REQUIRED',
      },
    ];

    const result = aggregator.aggregate(items);

    expect(result.overallVerdict).toBe('FAIL');
    expect(result.primaryReasonCode).toBe(ReasonCodes.FAIL_VALUE_MISMATCH);
  });

  it('18. Advisory condition failures do not downgrade an overall PASS', () => {
    const items: AggregationItem[] = [
      { evaluation: createEvaluation('c1', 'PASS'), enforcement: 'REQUIRED' },
      {
        evaluation: createEvaluation('c2_advisory', 'FAIL', ReasonCodes.FAIL_VALUE_MISMATCH, 'Advisory latency high'),
        enforcement: 'ADVISORY',
      },
    ];

    const result = aggregator.aggregate(items);

    expect(result.overallVerdict).toBe('PASS');
    expect(result.summary).toContain('1 advisory condition(s) did not match');
  });

  it('Handles empty condition sets by returning INCONCLUSIVE', () => {
    const result = aggregator.aggregate([]);
    expect(result.overallVerdict).toBe('INCONCLUSIVE');
  });
});
