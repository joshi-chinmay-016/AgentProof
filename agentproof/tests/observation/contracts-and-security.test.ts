/**
 * AgentProof Tests — Observation Contracts, SSRF Guard, and Secret Provider
 */

import { describe, it, expect } from 'vitest';
import {
  SsrfGuard,
  StaticSecretProvider,
  EnvironmentSecretProvider,
  ExternalEvidenceAdapter,
  InMemoryIntegrationRegistry,
  RestApiIntegrationConfigSchema,
  S3IntegrationConfigSchema,
  PostgresIntegrationConfigSchema,
} from '../../src/observation/index.js';
import { EvidenceTrustValidator } from '../../src/core/index.js';

describe('Observation Contracts & Security', () => {
  describe('SSRF Guard', () => {
    it('blocks private IPv4 addresses (RFC 1918) when loopback is disabled', () => {
      const guard = new SsrfGuard({ allowLoopback: false });

      // 10.0.0.0/8
      expect(() => guard.validateUrl('https://10.0.0.1/api/data')).toThrow(/private/i);
      // 172.16.0.0/12
      expect(() => guard.validateUrl('https://172.16.0.5/api/data')).toThrow(/private/i);
      // 192.168.0.0/16
      expect(() => guard.validateUrl('https://192.168.1.1/api/data')).toThrow(/private/i);
    });

    it('blocks cloud metadata endpoints (169.254.169.254)', () => {
      const guard = new SsrfGuard({ allowLoopback: false });
      expect(() => guard.validateUrl('http://169.254.169.254/latest/meta-data')).toThrow();
      expect(() => guard.validateUrl('https://169.254.169.254/latest/meta-data')).toThrow();
    });

    it('blocks localhost and loopback addresses by default', () => {
      const guard = new SsrfGuard({ allowLoopback: false });
      expect(() => guard.validateUrl('https://localhost:8080/api')).toThrow(/prohibited in non-loopback mode|loopback/i);
      expect(() => guard.validateUrl('https://127.0.0.1:8080/api')).toThrow(/loopback|private/i);
      expect(() => guard.validateUrl('https://[::1]:8080/api')).toThrow(/loopback/i);
    });

    it('allows loopback when explicitly configured for local development/testing', () => {
      const guard = new SsrfGuard({ allowLoopback: true, allowedSchemes: ['http', 'https'] });
      const url = guard.validateUrl('http://127.0.0.1:3000/api/users/123');
      expect(url.hostname).toBe('127.0.0.1');
      expect(url.port).toBe('3000');
    });

    it('rejects forbidden URL schemes (e.g. file, ftp, gopher)', () => {
      const guard = new SsrfGuard({ allowedSchemes: ['https'] });
      expect(() => guard.validateUrl('file:///etc/passwd')).toThrow(/scheme/i);
      expect(() => guard.validateUrl('http://example.com/api')).toThrow(/scheme/i);
      expect(() => guard.validateUrl('ftp://ftp.example.com/file')).toThrow(/scheme/i);
    });

    it('rejects embedded credentials in URL', () => {
      const guard = new SsrfGuard({ allowLoopback: true, allowedSchemes: ['https'] });
      expect(() => guard.validateUrl('https://user:password@example.com/api')).toThrow(/embedded credentials/i);
    });

    it('validates paths against resource allowlist patterns', () => {
      const guard = new SsrfGuard();
      const patterns = ['/api/subscriptions/*', '/api/users/*/profile', '/v1/orders'];

      expect(guard.validatePath('/api/subscriptions/sub-123', patterns)).toBe(true);
      expect(guard.validatePath('/api/users/u-456/profile', patterns)).toBe(true);
      expect(guard.validatePath('/v1/orders', patterns)).toBe(true);

      // Disallowed paths
      expect(guard.validatePath('/admin/secret', patterns)).toBe(false);
      expect(guard.validatePath('/api/subscriptions/sub-123/delete', patterns)).toBe(false);
      expect(guard.validatePath('/api/users/u-456/billing', patterns)).toBe(false);
    });

    it('redacts sensitive headers from observation metadata', () => {
      const guard = new SsrfGuard();
      const headers = {
        authorization: 'Bearer secret-token-xyz',
        'x-api-key': 'top-secret-key-123',
        'content-type': 'application/json',
        'cache-control': 'no-cache',
        cookie: 'session=abc123xyz',
        'set-cookie': 'session=abc123xyz; Path=/',
      };

      const redacted = guard.redactHeaders(headers);
      expect(redacted['authorization']).toBe('[REDACTED]');
      expect(redacted['x-api-key']).toBe('[REDACTED]');
      expect(redacted['cookie']).toBe('[REDACTED]');
      expect(redacted['set-cookie']).toBe('[REDACTED]');
      expect(redacted['content-type']).toBe('application/json');
      expect(redacted['cache-control']).toBe('no-cache');
    });
  });

  describe('Secret Provider', () => {
    it('StaticSecretProvider resolves configured secrets without environment access', async () => {
      const provider = new StaticSecretProvider({
        API_TOKEN: 'token-val-456',
        DB_PASS: 'db-pass-789',
      });

      expect(await provider.getSecret('API_TOKEN')).toBe('token-val-456');
      expect(await provider.getSecret('DB_PASS')).toBe('db-pass-789');
      expect(await provider.getSecret('NON_EXISTENT')).toBeUndefined();
    });

    it('EnvironmentSecretProvider resolves environment variables with optional prefix', async () => {
      process.env['TEST_PHASE6_KEY'] = 'env-value-123';
      const provider = new EnvironmentSecretProvider({ prefix: 'TEST_PHASE6_' });

      expect(await provider.getSecret('KEY')).toBe('env-value-123');
      delete process.env['TEST_PHASE6_KEY'];
    });
  });

  describe('External Evidence Adapter & Trust Validation', () => {
    it('converts FOUND observation into valid Evidence with SOURCE_AUTHENTICATED trust', () => {
      const adapter = new ExternalEvidenceAdapter();
      const trustValidator = new EvidenceTrustValidator();

      const record = {
        status: 'FOUND' as const,
        target: { system: 'crm', resourceType: 'account', resourceId: 'acc-1' },
        observedAt: new Date().toISOString(),
        payload: { id: 'acc-1', status: 'ACTIVE', tier: 'ENTERPRISE' },
        sourceId: 'crm-production-api',
        sourceType: 'REST_API' as const,
        integrationId: 'crm-production-api',
        tenantId: 'tenant-enterprise',
      };

      trustValidator.registerTrustedSource(record.sourceId);

      const evidence = adapter.toEvidence(record);
      expect(evidence).not.toBeNull();
      expect(evidence?.observationStatus).toBe('FOUND');
      expect(evidence?.observedPayload).toEqual({ id: 'acc-1', status: 'ACTIVE', tier: 'ENTERPRISE' });

      const trustReport = trustValidator.validate(evidence!, record.target);
      expect(trustReport.isValid).toBe(true);
      expect(trustReport.trustLevel).toBe('SOURCE_AUTHENTICATED');
      expect(trustReport.digestMatches).toBe(true);
    });

    it('converts NOT_FOUND observation into valid absence Evidence with limitations', () => {
      const adapter = new ExternalEvidenceAdapter();
      const record = {
        status: 'NOT_FOUND' as const,
        target: { system: 'crm', resourceType: 'account', resourceId: 'acc-999' },
        observedAt: new Date().toISOString(),
        payload: null,
        sourceId: 'crm-api',
        sourceType: 'REST_API' as const,
        integrationId: 'crm-api',
        tenantId: 'tenant-enterprise',
      };

      const evidence = adapter.toEvidence(record);
      expect(evidence).not.toBeNull();
      expect(evidence?.observationStatus).toBe('NOT_FOUND');
      expect(evidence?.observedPayload).toBeNull();
      expect(evidence?.limitations).toContain('RESOURCE_NOT_FOUND_IN_SYSTEM_OF_RECORD');
    });

    it('returns null on READ_ERROR by default to prevent fabricating evidence', () => {
      const adapter = new ExternalEvidenceAdapter();
      const record = {
        status: 'READ_ERROR' as const,
        target: { system: 'crm', resourceType: 'account', resourceId: 'acc-1' },
        observedAt: new Date().toISOString(),
        payload: null,
        sourceId: 'crm-api',
        sourceType: 'REST_API' as const,
        integrationId: 'crm-api',
        tenantId: 'tenant-enterprise',
        errorCategory: 'TIMEOUT' as const,
        errorMessage: 'Network timeout',
      };

      const evidence = adapter.toEvidence(record);
      expect(evidence).toBeNull();
    });

    it('preserves error metadata when includeFailureRecord is requested', () => {
      const adapter = new ExternalEvidenceAdapter();
      const record = {
        status: 'READ_ERROR' as const,
        target: { system: 'crm', resourceType: 'account', resourceId: 'acc-1' },
        observedAt: new Date().toISOString(),
        payload: null,
        sourceId: 'crm-api',
        sourceType: 'REST_API' as const,
        integrationId: 'crm-api',
        tenantId: 'tenant-enterprise',
        errorCategory: 'TIMEOUT' as const,
        errorMessage: 'Connection timed out after 5000ms',
      };

      const evidence = adapter.toEvidence(record, { includeFailureRecord: true });
      expect(evidence).not.toBeNull();
      expect(evidence?.observationStatus).toBe('ERROR');
      expect(evidence?.limitations).toContain('OBSERVATION_FAILED_READ_ERROR');
      expect(evidence?.limitations).toContain('READER_TIMEOUT');
    });
  });

  describe('Integration Configuration Schemas & Registry', () => {
    it('validates RestApiIntegrationConfigSchema with defaults', () => {
      const valid = RestApiIntegrationConfigSchema.parse({
        integrationId: 'rest-1',
        tenantId: 'tenant-a',
        type: 'REST_API',
        baseUrl: 'https://api.example.com',
        allowedResourcePatterns: ['/api/v1/*'],
      });

      expect(valid.timeoutMs).toBe(5000);
      expect(valid.allowedMethods).toEqual(['GET', 'HEAD']);
      expect(valid.allowLoopback).toBe(false);
      expect(valid.enabled).toBe(true);
    });

    it('validates S3IntegrationConfigSchema', () => {
      const valid = S3IntegrationConfigSchema.parse({
        integrationId: 's3-1',
        tenantId: 'tenant-a',
        type: 'S3_STORAGE',
        endpoint: 'https://s3.amazonaws.com',
        bucket: 'my-audit-bucket',
        allowedPrefixes: ['reports/', 'invoices/'],
      });

      expect(valid.bucket).toBe('my-audit-bucket');
      expect(valid.allowedPrefixes).toEqual(['reports/', 'invoices/']);
    });

    it('validates PostgresIntegrationConfigSchema', () => {
      const valid = PostgresIntegrationConfigSchema.parse({
        integrationId: 'pg-1',
        tenantId: 'tenant-a',
        type: 'POSTGRES',
        host: 'db.example.internal',
        database: 'orders_db',
        allowedTables: ['orders', 'customers'],
        allowedColumns: {
          orders: ['id', 'status', 'total'],
          customers: ['id', 'email'],
        },
      });

      expect(valid.port).toBe(5432);
      expect(valid.allowedSchemas).toEqual(['public']);
    });

    it('enforces tenant boundaries in InMemoryIntegrationRegistry', () => {
      const registry = new InMemoryIntegrationRegistry();

      registry.register({
        integrationId: 'api-1',
        tenantId: 'tenant-a',
        type: 'REST_API',
        baseUrl: 'https://a.example.com',
        allowedResourcePatterns: ['/*'],
        auth: { type: 'NONE' },
        timeoutMs: 5000,
        maxResponseSizeBytes: 1024 * 1024,
        allowedMethods: ['GET', 'HEAD'],
        allowLoopback: false,
        enabled: true,
        freshnessToleranceMs: 60000,
        pathMapping: {},
      });

      registry.register({
        integrationId: 'api-2',
        tenantId: 'tenant-b',
        type: 'REST_API',
        baseUrl: 'https://b.example.com',
        allowedResourcePatterns: ['/*'],
        auth: { type: 'NONE' },
        timeoutMs: 5000,
        maxResponseSizeBytes: 1024 * 1024,
        allowedMethods: ['GET', 'HEAD'],
        allowLoopback: false,
        enabled: true,
        freshnessToleranceMs: 60000,
        pathMapping: {},
      });

      // Tenant A can see api-1, but not api-2
      expect(registry.getById('api-1', 'tenant-a')).toBeDefined();
      expect(registry.getById('api-2', 'tenant-a')).toBeUndefined();

      // Tenant B can see api-2, but not api-1
      expect(registry.getById('api-2', 'tenant-b')).toBeDefined();
      expect(registry.getById('api-1', 'tenant-b')).toBeUndefined();

      // Listing by tenant returns only tenant's integrations
      expect(registry.listByTenant('tenant-a')).toHaveLength(1);
      expect(registry.listByTenant('tenant-b')).toHaveLength(1);
    });
  });
});
