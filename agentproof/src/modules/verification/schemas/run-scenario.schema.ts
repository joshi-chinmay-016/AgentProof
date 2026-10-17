/**
 * AgentProof MCP Layer — run_scenario Input Schema
 */

import { z } from 'zod';

export const RunScenarioInputSchema = z.object({
  scenarioId: z
    .string()
    .min(1, 'scenarioId must be specified')
    .describe('Identifier of the scenario to execute (e.g. SCENARIO_A, SCENARIO_B)'),
});

export type RunScenarioInput = z.infer<typeof RunScenarioInputSchema>;
