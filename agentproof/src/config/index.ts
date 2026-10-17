/**
 * AgentProof Configuration
 * 
 * Centralized, validated environment and operational configuration.
 */

import * as path from 'node:path';
import { z } from 'zod';

export const AgentProofConfigSchema = z.object({
  storageBackend: z.enum(['file', 'in-memory']).default('in-memory'),
  storageDir: z.string().default('.agentproof/data/traces'),
  devAuthMode: z.boolean().default(true),
  maxPostconditionsCount: z.number().int().positive().default(50),
  maxEvidenceCount: z.number().int().positive().default(100),
  maxPayloadSizeBytes: z.number().int().positive().default(1024 * 1024), // 1MB
  defaultFreshnessToleranceMs: z.number().int().nonnegative().default(60000),
  maxClockSkewMs: z.number().int().nonnegative().default(10000),
});

export type AgentProofConfig = z.infer<typeof AgentProofConfigSchema>;

export function loadConfig(overrides?: Partial<AgentProofConfig>): AgentProofConfig {
  const backendEnv = process.env.AGENTPROOF_STORAGE_BACKEND;
  const storageBackend = overrides?.storageBackend ?? (backendEnv === 'file' ? 'file' : 'in-memory');
  const storageDir = overrides?.storageDir ?? process.env.AGENTPROOF_STORAGE_DIR ?? path.resolve('.agentproof/data/traces');
  const devAuthMode = overrides?.devAuthMode ?? (process.env.AGENTPROOF_DEV_AUTH !== 'false');

  const parsed = AgentProofConfigSchema.parse({
    storageBackend,
    storageDir,
    devAuthMode,
    maxPostconditionsCount: overrides?.maxPostconditionsCount ?? 50,
    maxEvidenceCount: overrides?.maxEvidenceCount ?? 100,
    maxPayloadSizeBytes: overrides?.maxPayloadSizeBytes ?? 1024 * 1024,
    defaultFreshnessToleranceMs: overrides?.defaultFreshnessToleranceMs ?? 60000,
    maxClockSkewMs: overrides?.maxClockSkewMs ?? 10000,
  });

  return parsed;
}

export const defaultConfig = loadConfig();
