/**
 * AgentProof MCP Layer — Scenario Catalog
 * 
 * Authoritative registry of known simulation scenarios.
 * Shared between list_scenarios and run_scenario to prevent duplicate registrations.
 */

import {
  ScenarioDefinition,
  FailureMode,
  createScenarioA_GenuineSuccess,
  createScenarioB_FalseSuccess,
  createScenarioC_WrongTarget,
  createScenarioD_PartialUpdate,
  createScenarioE_MissingTarget,
  createScenarioF_ObservationUnavailable,
  createScenarioG_TenantIsolation,
  createScenarioH_MultipleRequiredConditions,
} from '../../simulation/index.js';

export interface ScenarioMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly failureMode: FailureMode;
  readonly expectedVerdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  readonly operation: string;
  readonly primaryResourceId: string;
}

export interface ScenarioCatalogEntry {
  readonly metadata: ScenarioMetadata;
  readonly factory: () => ScenarioDefinition;
}

export class ScenarioCatalog {
  private readonly entries: Map<string, ScenarioCatalogEntry> = new Map();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    this.register({
      metadata: {
        id: 'SCENARIO_A',
        name: 'Genuine Success',
        description: 'Action mutates target subscription and independent observation confirms PASS.',
        failureMode: 'GENUINE_SUCCESS',
        expectedVerdict: 'PASS',
        operation: 'cancel_subscription',
        primaryResourceId: 'sub-100',
      },
      factory: createScenarioA_GenuineSuccess,
    });

    this.register({
      metadata: {
        id: 'SCENARIO_B',
        name: 'False Success (Primary Demo)',
        description:
          'Action reports success without executing mutation; independent observation proves state unchanged and results in FAIL.',
        failureMode: 'FALSE_SUCCESS',
        expectedVerdict: 'FAIL',
        operation: 'cancel_subscription',
        primaryResourceId: 'sub-100',
      },
      factory: createScenarioB_FalseSuccess,
    });

    this.register({
      metadata: {
        id: 'SCENARIO_C',
        name: 'Wrong Target Mutation',
        description:
          'Action mutates unintended resource B; verifier observes intended resource A and yields FAIL.',
        failureMode: 'WRONG_TARGET',
        expectedVerdict: 'FAIL',
        operation: 'cancel_subscription',
        primaryResourceId: 'sub-100',
      },
      factory: createScenarioC_WrongTarget,
    });

    this.register({
      metadata: {
        id: 'SCENARIO_D',
        name: 'Partial Update',
        description:
          'Action mutates plan but fails to cancel status; verifier rejects incomplete execution as FAIL.',
        failureMode: 'PARTIAL_UPDATE',
        expectedVerdict: 'FAIL',
        operation: 'downgrade_and_cancel',
        primaryResourceId: 'sub-100',
      },
      factory: createScenarioD_PartialUpdate,
    });

    this.register({
      metadata: {
        id: 'SCENARIO_E',
        name: 'Missing Target',
        description:
          'Target resource does not exist in ground truth; verifier yields INCONCLUSIVE.',
        failureMode: 'FALSE_SUCCESS',
        expectedVerdict: 'INCONCLUSIVE',
        operation: 'cancel_subscription',
        primaryResourceId: 'sub-missing',
      },
      factory: createScenarioE_MissingTarget,
    });

    this.register({
      metadata: {
        id: 'SCENARIO_F',
        name: 'Observation Unavailable',
        description:
          'Independent reader suffers connection timeout; verifier cleanly returns INCONCLUSIVE without false FAIL.',
        failureMode: 'GENUINE_SUCCESS',
        expectedVerdict: 'INCONCLUSIVE',
        operation: 'cancel_subscription',
        primaryResourceId: 'sub-100',
      },
      factory: createScenarioF_ObservationUnavailable,
    });

    this.register({
      metadata: {
        id: 'SCENARIO_G',
        name: 'Tenant Isolation',
        description:
          'Ensures operations and observations remain strictly isolated across tenant boundaries.',
        failureMode: 'GENUINE_SUCCESS',
        expectedVerdict: 'PASS',
        operation: 'cancel_subscription',
        primaryResourceId: 'sub-100',
      },
      factory: createScenarioG_TenantIsolation,
    });

    this.register({
      metadata: {
        id: 'SCENARIO_H',
        name: 'Multiple Required Conditions',
        description:
          'Demonstrates Phase 2 FAIL > INCONCLUSIVE > PASS dominance rule across multiple postconditions.',
        failureMode: 'GENUINE_SUCCESS',
        expectedVerdict: 'FAIL',
        operation: 'cancel_and_convert_plan',
        primaryResourceId: 'sub-100',
      },
      factory: createScenarioH_MultipleRequiredConditions,
    });
  }

  public register(entry: ScenarioCatalogEntry): void {
    this.entries.set(entry.metadata.id.toUpperCase(), entry);
  }

  public list(): readonly ScenarioMetadata[] {
    const list: ScenarioMetadata[] = [];
    for (const entry of this.entries.values()) {
      list.push({ ...entry.metadata });
    }
    return Object.freeze(list);
  }

  public get(scenarioId: string): ScenarioDefinition | undefined {
    const entry = this.entries.get(scenarioId.trim().toUpperCase());
    return entry ? entry.factory() : undefined;
  }

  public getMetadata(scenarioId: string): ScenarioMetadata | undefined {
    const entry = this.entries.get(scenarioId.trim().toUpperCase());
    return entry ? { ...entry.metadata } : undefined;
  }

  public has(scenarioId: string): boolean {
    return this.entries.has(scenarioId.trim().toUpperCase());
  }
}

// Global default singleton for the application instance
export const defaultScenarioCatalog = new ScenarioCatalog();
