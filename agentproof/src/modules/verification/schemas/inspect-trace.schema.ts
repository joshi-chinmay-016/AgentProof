/**
 * AgentProof MCP Layer — inspect_trace Input Schema
 */

import { z } from 'zod';

export const InspectTraceInputSchema = z.object({
  traceId: z.string().min(1, 'traceId must be specified').describe('Unique trace identifier to inspect'),
  tenantId: z.string().optional().describe('Optional tenant context for enforcing tenant isolation'),
});

export type InspectTraceInput = z.infer<typeof InspectTraceInputSchema>;
