/**
 * AgentProof Streaming & Webhooks — Webhook Source Configuration Schema
 * 
 * Validates trusted webhook source registrations and signing policies.
 */

import { z } from 'zod';

export const WebhookProviderSchema = z.enum([
  'STRIPE',
  'GITHUB',
  'CUSTOM_HMAC',
  'AWS_SNS',
  'GENERIC',
]);

export const WebhookSignatureSchemeSchema = z.enum([
  'HMAC_SHA256',
  'RSA_SHA256',
]);

export const CorrelationRuleSchema = z.object({
  targetSystem: z.string().default('external'),
  targetResourceTypeField: z.string().default('resourceType'),
  targetResourceIdField: z.string().default('id'),
  correlationIdField: z.string().optional(),
});

export const WebhookSourceConfigSchema = z.object({
  sourceId: z.string().min(1, 'sourceId is required'),
  tenantId: z.string().min(1, 'tenantId is required'),
  provider: WebhookProviderSchema.default('CUSTOM_HMAC'),
  signatureScheme: WebhookSignatureSchemeSchema.default('HMAC_SHA256'),
  secretRef: z.string().min(1, 'secretRef is required to resolve signing key'),
  publicKeyId: z.string().optional().describe('Key identifier if using RSA asymmetric verification'),
  signatureHeader: z.string().default('x-signature-256'),
  timestampHeader: z.string().default('x-timestamp'),
  eventIdHeader: z.string().default('x-event-id'),
  maxClockSkewMs: z.number().int().positive().max(300000).default(10000), // Max 5 min, default 10s
  replayRetentionMs: z.number().int().positive().max(7 * 86400000).default(86400000), // 24h default
  allowedEvents: z.array(z.string()).default(['*']).describe('Allowed event types or ["*"] for all'),
  enabled: z.boolean().default(true),
  autoVerifyState: z.boolean().default(false).describe('Trigger independent Phase 6 read on receipt'),
  integrationId: z.string().optional().describe('Linked Phase 6 integration ID for independent read'),
  correlationRule: CorrelationRuleSchema.default({
    targetSystem: 'external',
    targetResourceTypeField: 'resourceType',
    targetResourceIdField: 'id',
  }),
});

export type WebhookSourceConfig = z.infer<typeof WebhookSourceConfigSchema>;
