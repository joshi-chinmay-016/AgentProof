/**
 * AgentProof Observation Registry — Integration Configuration Schemas
 * 
 * Defines validated Zod schemas for external state reader configurations.
 */

import { z } from 'zod';

export const AuthConfigSchema = z.object({
  type: z.enum(['BEARER', 'API_KEY', 'BASIC', 'CUSTOM_HEADER', 'NONE']).default('NONE'),
  secretRef: z.string().optional().describe('Key reference resolved by ISecretProvider (e.g. ENV var name)'),
  headerName: z.string().default('Authorization').optional(),
  headerPrefix: z.string().default('Bearer ').optional(),
  username: z.string().optional(),
});

export type AuthConfig = z.infer<typeof AuthConfigSchema>;

export const RestApiIntegrationConfigSchema = z.object({
  integrationId: z.string().min(1, 'integrationId must be specified'),
  tenantId: z.string().min(1, 'tenantId must be specified'),
  type: z.literal('REST_API'),
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  allowedResourcePatterns: z
    .array(z.string())
    .min(1, 'At least one allowed resource pattern is required to prevent arbitrary access'),
  pathMapping: z.record(z.string()).default({}).describe('Maps resourceType to URL path template e.g. { subscription: "/api/subscriptions/{id}" }'),
  auth: AuthConfigSchema.default({ type: 'NONE' }),
  timeoutMs: z.number().int().positive().max(30000).default(5000),
  maxResponseSizeBytes: z.number().int().positive().max(5 * 1024 * 1024).default(1024 * 1024),
  allowedMethods: z.array(z.enum(['GET', 'HEAD'])).default(['GET', 'HEAD']),
  allowLoopback: z.boolean().default(false),
  enabled: z.boolean().default(true),
  freshnessToleranceMs: z.number().int().nonnegative().default(60000),
});

export type RestApiIntegrationConfig = z.infer<typeof RestApiIntegrationConfigSchema>;

export const S3IntegrationConfigSchema = z.object({
  integrationId: z.string().min(1, 'integrationId must be specified'),
  tenantId: z.string().min(1, 'tenantId must be specified'),
  type: z.literal('S3_STORAGE'),
  endpoint: z.string().url('endpoint must be a valid URL'),
  bucket: z.string().min(1, 'bucket name must be specified'),
  allowedPrefixes: z.array(z.string()).default(['']).describe('Allowed key prefixes within the bucket'),
  auth: AuthConfigSchema.default({ type: 'NONE' }),
  timeoutMs: z.number().int().positive().max(30000).default(5000),
  allowLoopback: z.boolean().default(false),
  enabled: z.boolean().default(true),
  freshnessToleranceMs: z.number().int().nonnegative().default(60000),
});

export type S3IntegrationConfig = z.infer<typeof S3IntegrationConfigSchema>;

export const PostgresIntegrationConfigSchema = z.object({
  integrationId: z.string().min(1, 'integrationId must be specified'),
  tenantId: z.string().min(1, 'tenantId must be specified'),
  type: z.literal('POSTGRES'),
  host: z.string().min(1, 'host must be specified'),
  port: z.number().int().positive().default(5432),
  database: z.string().min(1, 'database must be specified'),
  user: z.string().default('postgres'),
  allowedSchemas: z.array(z.string()).default(['public']),
  allowedTables: z.array(z.string()).min(1, 'allowedTables allowlist must be specified'),
  allowedColumns: z.record(z.array(z.string())).describe('Allowed columns per table { table: ["col1", "col2"] }'),
  idColumnMapping: z.record(z.string()).default({}).describe('Primary lookup key per table { table: "id" }'),
  auth: AuthConfigSchema.default({ type: 'NONE' }),
  timeoutMs: z.number().int().positive().max(30000).default(5000),
  enabled: z.boolean().default(true),
  freshnessToleranceMs: z.number().int().nonnegative().default(60000),
});

export type PostgresIntegrationConfig = z.infer<typeof PostgresIntegrationConfigSchema>;

export const IntegrationConfigSchema = z.discriminatedUnion('type', [
  RestApiIntegrationConfigSchema,
  S3IntegrationConfigSchema,
  PostgresIntegrationConfigSchema,
]);

export type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;
