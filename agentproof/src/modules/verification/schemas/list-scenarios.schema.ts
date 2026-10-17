/**
 * AgentProof MCP Layer — list_scenarios Input Schema
 */

import { z } from 'zod';

export const ListScenariosInputSchema = z
  .object({})
  .describe('Empty object to list all available demonstration scenarios');

export type ListScenariosInput = z.infer<typeof ListScenariosInputSchema>;
