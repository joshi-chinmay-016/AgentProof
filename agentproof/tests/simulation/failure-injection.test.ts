import { describe, it, expect } from 'vitest';
import {
  FailureModeSchema,
  FailureInjectionConfigSchema,
} from '../../src/simulation/index.js';

describe('Failure Injection Model & Schemas', () => {
  it('validates supported FailureModes', () => {
    expect(FailureModeSchema.parse('GENUINE_SUCCESS')).toBe('GENUINE_SUCCESS');
    expect(FailureModeSchema.parse('FALSE_SUCCESS')).toBe('FALSE_SUCCESS');
    expect(FailureModeSchema.parse('WRONG_TARGET')).toBe('WRONG_TARGET');
    expect(FailureModeSchema.parse('PARTIAL_UPDATE')).toBe('PARTIAL_UPDATE');
    expect(FailureModeSchema.parse('GENUINE_FAILURE')).toBe('GENUINE_FAILURE');
  });

  it('rejects unsupported or arbitrary failure mode strings', () => {
    expect(() => FailureModeSchema.parse('MAGIC_SUCCESS')).toThrow();
    expect(() => FailureModeSchema.parse('RANDOM_CORRUPTION')).toThrow();
    expect(() => FailureModeSchema.parse('')).toThrow();
  });

  it('validates valid FailureInjectionConfig objects', () => {
    const config1 = FailureInjectionConfigSchema.parse({
      mode: 'GENUINE_SUCCESS',
    });
    expect(config1.mode).toBe('GENUINE_SUCCESS');

    const config2 = FailureInjectionConfigSchema.parse({
      mode: 'PARTIAL_UPDATE',
      partialFields: ['plan', 'maxSeats'],
    });
    expect(config2.partialFields).toEqual(['plan', 'maxSeats']);

    const config3 = FailureInjectionConfigSchema.parse({
      mode: 'WRONG_TARGET',
      wrongTargetSubscriptionId: 'sub-999',
    });
    expect(config3.wrongTargetSubscriptionId).toBe('sub-999');
  });

  it('enforces that WRONG_TARGET requires wrongTargetSubscriptionId', () => {
    expect(() =>
      FailureInjectionConfigSchema.parse({
        mode: 'WRONG_TARGET',
      })
    ).toThrow(/wrongTargetSubscriptionId must be specified/);
  });
});
