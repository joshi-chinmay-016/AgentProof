/**
 * AgentProof Tests — S3-Compatible Object State Reader
 * 
 * Verifies read-only HEAD observation, prefix enforcement, metadata extraction,
 * ETag separation from SHA-256 digest, and error mappings.
 */

import { describe, it, expect } from 'vitest';
import {
  S3ObjectStateReader,
  S3IntegrationConfig,
  StaticSecretProvider,
} from '../../src/observation/index.js';

describe('S3ObjectStateReader', () => {
  const baseConfig: S3IntegrationConfig = {
    integrationId: 'audit-s3',
    tenantId: 'tenant-finance',
    type: 'S3_STORAGE',
    endpoint: 'https://s3.us-east-1.amazonaws.com',
    bucket: 'finance-reports',
    allowedPrefixes: ['monthly/', 'annual/'],
    auth: {
      type: 'BEARER',
      secretRef: 'S3_AUTH_TOKEN',
    },
    timeoutMs: 1000,
    allowLoopback: true,
    enabled: true,
    freshnessToleranceMs: 60000,
  };

  const secretProvider = new StaticSecretProvider({
    S3_AUTH_TOKEN: 's3-secret-token-xyz',
  });

  it('observes existing object metadata via HEAD request without downloading payload', async () => {
    let capturedMethod = '';

    const mockFetch: typeof fetch = async (url, init) => {
      capturedMethod = init?.method ?? '';
      return new Response(null, {
        status: 200,
        headers: {
          'Content-Length': '1048576',
          ETag: '"d41d8cd98f00b204e9800998ecf8427e"',
          'Last-Modified': 'Wed, 21 Oct 2026 07:28:00 GMT',
          'Content-Type': 'application/pdf',
          'x-amz-meta-generated-by': 'agent-reporter',
          'x-amz-meta-verified': 'true',
        },
      });
    };

    const reader = new S3ObjectStateReader(baseConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });

    const record = await reader.readState({
      system: 's3',
      resourceType: 'object',
      resourceId: 'monthly/2026-10-report.pdf',
    });

    expect(capturedMethod).toBe('HEAD');
    expect(record.status).toBe('FOUND');
    expect(record.sourceType).toBe('S3_STORAGE');
    expect(record.payload).toEqual({
      exists: true,
      bucket: 'finance-reports',
      key: 'monthly/2026-10-report.pdf',
      contentLength: 1048576,
      etag: 'd41d8cd98f00b204e9800998ecf8427e',
      lastModified: 'Wed, 21 Oct 2026 07:28:00 GMT',
      contentType: 'application/pdf',
      metadata: {
        'generated-by': 'agent-reporter',
        verified: 'true',
      },
    });

    // Validates that limitations clearly disclose ETag is not SHA-256
    expect(record.limitations).toContain(
      'ETag is an S3-specific identifier and does not prove SHA-256 payload integrity.'
    );
  });

  it('reliably returns NOT_FOUND (confirmed absence) when S3 returns 404', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(null, { status: 404 });
    };

    const reader = new S3ObjectStateReader(baseConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });

    const record = await reader.readState({
      system: 's3',
      resourceType: 'object',
      resourceId: 'monthly/nonexistent.pdf',
    });

    expect(record.status).toBe('NOT_FOUND');
    expect(record.payload).toBeNull();
  });

  it('rejects keys outside configured allowed prefixes', async () => {
    const reader = new S3ObjectStateReader(baseConfig, { secretProvider });

    const record = await reader.readState({
      system: 's3',
      resourceType: 'object',
      resourceId: 'unapproved/secret-keys.txt',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('SSRF_VIOLATION');
    expect(record.errorMessage).toContain('does not match any configured allowed prefixes');
  });

  it('rejects path traversal attempts in object key', async () => {
    const reader = new S3ObjectStateReader(baseConfig, { secretProvider });

    const record = await reader.readState({
      system: 's3',
      resourceType: 'object',
      resourceId: 'monthly/../../etc/passwd',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('SSRF_VIOLATION');
    expect(record.errorMessage).toContain('path traversal');
  });

  it('returns READ_ERROR with AUTHORIZATION_FAILURE on 401 or 403', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(null, { status: 403 });
    };

    const reader = new S3ObjectStateReader(baseConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });

    const record = await reader.readState({
      system: 's3',
      resourceType: 'object',
      resourceId: 'monthly/secret.pdf',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('AUTHORIZATION_FAILURE');
  });

  it('returns READ_ERROR with RATE_LIMITED on 429 or 503 SlowDown', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(null, { status: 503 });
    };

    const reader = new S3ObjectStateReader(baseConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });

    const record = await reader.readState({
      system: 's3',
      resourceType: 'object',
      resourceId: 'monthly/secret.pdf',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('RATE_LIMITED');
  });

  it('returns READ_ERROR with TIMEOUT on request abort', async () => {
    const mockFetch: typeof fetch = async () => {
      const err = new Error('Timeout');
      err.name = 'AbortError';
      throw err;
    };

    const reader = new S3ObjectStateReader(baseConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });

    const record = await reader.readState({
      system: 's3',
      resourceType: 'object',
      resourceId: 'monthly/report.pdf',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('TIMEOUT');
  });
});
