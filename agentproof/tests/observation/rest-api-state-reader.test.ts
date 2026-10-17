/**
 * AgentProof Tests — Real REST API State Reader
 * 
 * Verifies authenticated HTTP reads, SSRF prevention, status code mappings,
 * bounded sizes, request timeouts, and credential protections.
 */

import { describe, it, expect } from 'vitest';
import {
  RestApiStateReader,
  RestApiIntegrationConfig,
  StaticSecretProvider,
  SsrfGuard,
} from '../../src/observation/index.js';

describe('RestApiStateReader', () => {
  const baseConfig: RestApiIntegrationConfig = {
    integrationId: 'billing-api',
    tenantId: 'tenant-acme',
    type: 'REST_API',
    baseUrl: 'https://billing.example.internal',
    allowedResourcePatterns: ['/api/subscriptions/*', '/api/invoices/*'],
    pathMapping: {
      subscription: '/api/subscriptions/{id}',
      invoice: '/api/invoices/{id}',
    },
    auth: {
      type: 'BEARER',
      secretRef: 'BILLING_TOKEN',
    },
    timeoutMs: 1000,
    maxResponseSizeBytes: 1024 * 1024,
    allowedMethods: ['GET', 'HEAD'],
    allowLoopback: true, // permitted for local/test transport
    enabled: true,
    freshnessToleranceMs: 60000,
  };

  const secretProvider = new StaticSecretProvider({
    BILLING_TOKEN: 'secret-bearer-token-12345',
    API_KEY_VAL: 'my-api-key-999',
    BASIC_PASS: 'super-password',
  });

  it('successfully reads state with Bearer authentication and valid JSON payload', async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedMethod = '';

    const mockFetch: typeof fetch = async (url, init) => {
      capturedMethod = init?.method ?? 'GET';
      capturedHeaders = init?.headers as Record<string, string>;

      return new Response(
        JSON.stringify({
          id: 'sub-100',
          plan: 'enterprise',
          status: 'ACTIVE',
          seats: 50,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Server-Id': 'srv-prod-1',
            Authorization: 'Bearer should-be-redacted',
          },
        }
      );
    };

    const reader = new RestApiStateReader(baseConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });

    const record = await reader.readState({
      system: 'billing',
      resourceType: 'subscription',
      resourceId: 'sub-100',
    });

    expect(capturedMethod).toBe('GET');
    expect(capturedHeaders['Authorization']).toBe('Bearer secret-bearer-token-12345');
    expect(record.status).toBe('FOUND');
    expect(record.payload).toEqual({
      id: 'sub-100',
      plan: 'enterprise',
      status: 'ACTIVE',
      seats: 50,
    });
    expect(record.sourceType).toBe('REST_API');
    expect(record.integrationId).toBe('billing-api');
    expect(record.metadata?.statusCode).toBe(200);
    // Sensitive header redacted in metadata
    expect((record.metadata?.headers as any)?.authorization).toBe('[REDACTED]');
  });

  it('supports API_KEY authentication', async () => {
    let capturedHeaders: Record<string, string> = {};

    const mockFetch: typeof fetch = async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ id: 'inv-1', status: 'PAID' }), { status: 200 });
    };

    const apiKeyConfig: RestApiIntegrationConfig = {
      ...baseConfig,
      auth: {
        type: 'API_KEY',
        secretRef: 'API_KEY_VAL',
        headerName: 'X-API-Key',
        headerPrefix: '',
      },
    };

    const reader = new RestApiStateReader(apiKeyConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });

    const record = await reader.readState({
      system: 'billing',
      resourceType: 'invoice',
      resourceId: 'inv-1',
    });

    expect(record.status).toBe('FOUND');
    expect(capturedHeaders['X-API-Key']).toBe('my-api-key-999');
  });

  it('supports BASIC authentication without logging credentials', async () => {
    let capturedHeaders: Record<string, string> = {};

    const mockFetch: typeof fetch = async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ id: 'inv-2', status: 'PAID' }), { status: 200 });
    };

    const basicConfig: RestApiIntegrationConfig = {
      ...baseConfig,
      auth: {
        type: 'BASIC',
        secretRef: 'BASIC_PASS',
        username: 'admin',
      },
    };

    const reader = new RestApiStateReader(basicConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });

    const record = await reader.readState({
      system: 'billing',
      resourceType: 'invoice',
      resourceId: 'inv-2',
    });

    expect(record.status).toBe('FOUND');
    const expectedBase64 = Buffer.from('admin:super-password').toString('base64');
    expect(capturedHeaders['Authorization']).toBe(`Basic ${expectedBase64}`);
  });

  it('reliably returns NOT_FOUND (confirmed absence) on 404 response', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(JSON.stringify({ error: 'Subscription not found' }), {
        status: 404,
      });
    };

    const reader = new RestApiStateReader(baseConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });

    const record = await reader.readState({
      system: 'billing',
      resourceType: 'subscription',
      resourceId: 'sub-missing-999',
    });

    expect(record.status).toBe('NOT_FOUND');
    expect(record.payload).toBeNull();
    expect(record.metadata?.statusCode).toBe(404);
  });

  it('returns READ_ERROR with AUTHORIZATION_FAILURE on 401 or 403 response', async () => {
    const mockFetch401: typeof fetch = async () => {
      return new Response('Unauthorized', { status: 401 });
    };

    const reader401 = new RestApiStateReader(baseConfig, {
      secretProvider,
      fetchFn: mockFetch401,
    });

    const record401 = await reader401.readState({
      system: 'billing',
      resourceType: 'subscription',
      resourceId: 'sub-1',
    });

    expect(record401.status).toBe('READ_ERROR');
    expect(record401.errorCategory).toBe('AUTHORIZATION_FAILURE');

    const mockFetch403: typeof fetch = async () => {
      return new Response('Forbidden', { status: 403 });
    };

    const reader403 = new RestApiStateReader(baseConfig, {
      secretProvider,
      fetchFn: mockFetch403,
    });

    const record403 = await reader403.readState({
      system: 'billing',
      resourceType: 'subscription',
      resourceId: 'sub-1',
    });

    expect(record403.status).toBe('READ_ERROR');
    expect(record403.errorCategory).toBe('AUTHORIZATION_FAILURE');
  });

  it('returns READ_ERROR with RATE_LIMITED on 429 response', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response('Too many requests', { status: 429 });
    };

    const reader = new RestApiStateReader(baseConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });

    const record = await reader.readState({
      system: 'billing',
      resourceType: 'subscription',
      resourceId: 'sub-1',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('RATE_LIMITED');
  });

  it('returns READ_ERROR with NETWORK_ERROR on 500 response', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response('Internal Server Error', { status: 500 });
    };

    const reader = new RestApiStateReader(baseConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });

    const record = await reader.readState({
      system: 'billing',
      resourceType: 'subscription',
      resourceId: 'sub-1',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('NETWORK_ERROR');
  });

  it('returns READ_ERROR with TIMEOUT when request times out or is aborted', async () => {
    const mockFetch: typeof fetch = async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    };

    const reader = new RestApiStateReader(baseConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });

    const record = await reader.readState({
      system: 'billing',
      resourceType: 'subscription',
      resourceId: 'sub-1',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('TIMEOUT');
  });

  it('returns READ_ERROR with MALFORMED_PAYLOAD when remote returns invalid JSON', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response('<!DOCTYPE html><html><body>Error</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    };

    const reader = new RestApiStateReader(baseConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });

    const record = await reader.readState({
      system: 'billing',
      resourceType: 'subscription',
      resourceId: 'sub-1',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('MALFORMED_PAYLOAD');
  });

  it('returns READ_ERROR with RESPONSE_TOO_LARGE when response exceeds size limit', async () => {
    const smallLimitConfig: RestApiIntegrationConfig = {
      ...baseConfig,
      maxResponseSizeBytes: 50, // 50 bytes limit
    };

    const mockFetch: typeof fetch = async () => {
      const largeJson = JSON.stringify({
        id: 'sub-1',
        description: 'A very large text payload that exceeds fifty bytes easily...',
      });
      return new Response(largeJson, { status: 200 });
    };

    const reader = new RestApiStateReader(smallLimitConfig, {
      secretProvider,
      fetchFn: mockFetch,
    });

    const record = await reader.readState({
      system: 'billing',
      resourceType: 'subscription',
      resourceId: 'sub-1',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('RESPONSE_TOO_LARGE');
  });

  it('rejects target paths that do not match configured resource allowlist', async () => {
    const reader = new RestApiStateReader(baseConfig, { secretProvider });

    const record = await reader.readState({
      system: 'billing',
      resourceType: 'unapproved_resource',
      resourceId: '123',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('SSRF_VIOLATION');
    expect(record.errorMessage).toContain('not permitted by integration allowlist');
  });

  it('rejects missing or unresolved authentication secret', async () => {
    const unresolvableConfig: RestApiIntegrationConfig = {
      ...baseConfig,
      auth: {
        type: 'BEARER',
        secretRef: 'MISSING_SECRET_KEY',
      },
    };

    const reader = new RestApiStateReader(unresolvableConfig, {
      secretProvider, // does not have MISSING_SECRET_KEY
    });

    const record = await reader.readState({
      system: 'billing',
      resourceType: 'subscription',
      resourceId: 'sub-1',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('AUTHENTICATION_FAILURE');
  });
});
