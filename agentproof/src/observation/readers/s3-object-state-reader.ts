/**
 * AgentProof Observation — S3-Compatible Object State Reader
 * 
 * Independently verifies object existence and metadata on S3-compatible object storage
 * (AWS S3, MinIO, Cloudflare R2, Ceph) using read-only HEAD/GET operations.
 * Enforces bucket/prefix allowlists, SSRF protections, credential redaction,
 * and strict separation between ETag and SHA-256 content verification.
 */

import { ResourceTarget } from '../../core/index.js';
import {
  IExternalStateReader,
  ExternalObservationRecord,
} from '../contracts/state-reader.interface.js';
import { S3IntegrationConfig } from '../registry/integration-config.schema.js';
import { SsrfGuard } from '../security/ssrf-guard.js';
import { ISecretProvider, EnvironmentSecretProvider } from '../security/secret-provider.js';

export interface S3ObjectStateReaderOptions {
  readonly secretProvider?: ISecretProvider;
  readonly ssrfGuard?: SsrfGuard;
  readonly fetchFn?: typeof fetch;
}

export class S3ObjectStateReader implements IExternalStateReader {
  public readonly sourceId: string;
  public readonly sourceType = 'S3_STORAGE' as const;
  public readonly integrationId: string;
  public readonly tenantId: string;

  private readonly config: S3IntegrationConfig;
  private readonly secretProvider: ISecretProvider;
  private readonly ssrfGuard: SsrfGuard;
  private readonly fetchFn: typeof fetch;

  constructor(config: S3IntegrationConfig, options?: S3ObjectStateReaderOptions) {
    this.config = config;
    this.sourceId = config.integrationId;
    this.integrationId = config.integrationId;
    this.tenantId = config.tenantId;

    this.secretProvider = options?.secretProvider ?? new EnvironmentSecretProvider();
    this.ssrfGuard =
      options?.ssrfGuard ??
      new SsrfGuard({
        allowLoopback: config.allowLoopback,
        allowedSchemes: config.allowLoopback ? ['https', 'http'] : ['https'],
      });
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
  }

  /**
   * Independently observes object metadata and existence using S3 HEAD Object request.
   * Does NOT download full object contents by default to prevent memory/bandwidth exhaustion.
   */
  public async readState(target: ResourceTarget): Promise<ExternalObservationRecord> {
    const now = new Date().toISOString();
    const objectKey = target.resourceId;

    // 1. Validate key syntax and path traversal
    if (!objectKey || objectKey.trim().length === 0) {
      return {
        status: 'READ_ERROR',
        target,
        observedAt: now,
        payload: null,
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        integrationId: this.integrationId,
        tenantId: this.tenantId,
        errorCategory: 'QUERY_ERROR',
        errorMessage: 'Target resourceId (S3 object key) must be non-empty.',
      };
    }

    if (objectKey.includes('..') || objectKey.startsWith('/') || objectKey.includes('\\')) {
      return {
        status: 'READ_ERROR',
        target,
        observedAt: now,
        payload: null,
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        integrationId: this.integrationId,
        tenantId: this.tenantId,
        errorCategory: 'SSRF_VIOLATION',
        errorMessage: 'S3 object key contains illegal path traversal characters.',
      };
    }

    // 2. Validate prefix allowlist
    const isPrefixAllowed = this.config.allowedPrefixes.some((prefix) =>
      objectKey.startsWith(prefix)
    );

    if (!isPrefixAllowed) {
      return {
        status: 'READ_ERROR',
        target,
        observedAt: now,
        payload: null,
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        integrationId: this.integrationId,
        tenantId: this.tenantId,
        errorCategory: 'SSRF_VIOLATION',
        errorMessage: `S3 key '${objectKey}' does not match any configured allowed prefixes [${this.config.allowedPrefixes.join(', ')}].`,
      };
    }

    // 3. Construct and validate S3 URL (path-style: <endpoint>/<bucket>/<key>)
    let s3Url: URL;
    try {
      const sanitizedEndpoint = this.config.endpoint.endsWith('/')
        ? this.config.endpoint
        : `${this.config.endpoint}/`;
      const fullUrlStr = new URL(
        `${encodeURIComponent(this.config.bucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`,
        sanitizedEndpoint
      ).toString();

      s3Url = this.ssrfGuard.validateUrl(fullUrlStr);
    } catch (err: any) {
      return {
        status: 'READ_ERROR',
        target,
        observedAt: now,
        payload: null,
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        integrationId: this.integrationId,
        tenantId: this.tenantId,
        errorCategory: 'SSRF_VIOLATION',
        errorMessage: `S3 URL validation failed: ${err.message}`,
      };
    }

    // 4. Authenticate request if configured
    const headers: Record<string, string> = {
      'User-Agent': 'AgentProof-S3Reader/1.0',
    };

    try {
      await this.applyAuthentication(headers);
    } catch (err: any) {
      return {
        status: 'READ_ERROR',
        target,
        observedAt: now,
        payload: null,
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        integrationId: this.integrationId,
        tenantId: this.tenantId,
        errorCategory: 'AUTHENTICATION_FAILURE',
        errorMessage: `S3 authentication error: ${err.message}`,
      };
    }

    // 5. Execute read-only HEAD request
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.config.timeoutMs);

    try {
      const response = await this.fetchFn(s3Url.toString(), {
        method: 'HEAD',
        headers,
        signal: abortController.signal,
        redirect: 'error',
      });

      clearTimeout(timeoutId);

      // Extract safe headers and S3 user metadata (x-amz-meta-*)
      const responseHeaders: Record<string, string> = {};
      const customMetadata: Record<string, string> = {};

      response.headers.forEach((val, key) => {
        const lowerKey = key.toLowerCase();
        responseHeaders[lowerKey] = val;
        if (lowerKey.startsWith('x-amz-meta-')) {
          customMetadata[lowerKey.replace('x-amz-meta-', '')] = val;
        }
      });

      const safeHeaders = this.ssrfGuard.redactHeaders(responseHeaders);

      // 200 OK: Object exists
      if (response.status === 200) {
        const contentLength = response.headers.get('content-length')
          ? parseInt(response.headers.get('content-length')!, 10)
          : undefined;
        const etag = response.headers.get('etag')?.replace(/^"|"$/g, '') || undefined;
        const lastModified = response.headers.get('last-modified') || undefined;
        const contentType = response.headers.get('content-type') || undefined;

        return {
          status: 'FOUND',
          target,
          observedAt: now,
          payload: {
            exists: true,
            bucket: this.config.bucket,
            key: objectKey,
            contentLength,
            etag,
            lastModified,
            contentType,
            metadata: customMetadata,
          },
          sourceId: this.sourceId,
          sourceType: this.sourceType,
          integrationId: this.integrationId,
          tenantId: this.tenantId,
          metadata: {
            statusCode: 200,
            headers: safeHeaders,
          },
          limitations: [
            'ETag is an S3-specific identifier and does not prove SHA-256 payload integrity.',
            'HEAD request confirms object presence and headers without downloading complete body.',
          ],
        };
      }

      // 404: Confirmed absence of object
      if (response.status === 404) {
        return {
          status: 'NOT_FOUND',
          target,
          observedAt: now,
          payload: null,
          sourceId: this.sourceId,
          sourceType: this.sourceType,
          integrationId: this.integrationId,
          tenantId: this.tenantId,
          metadata: {
            statusCode: 404,
            headers: safeHeaders,
          },
        };
      }

      // 401 / 403: Remote authentication/authorization failure
      if (response.status === 401 || response.status === 403) {
        return {
          status: 'READ_ERROR',
          target,
          observedAt: now,
          payload: null,
          sourceId: this.sourceId,
          sourceType: this.sourceType,
          integrationId: this.integrationId,
          tenantId: this.tenantId,
          errorCategory: 'AUTHORIZATION_FAILURE',
          errorMessage: `S3 endpoint denied access (HTTP ${response.status}).`,
        };
      }

      // 429 / 503: Throttling / SlowDown
      if (response.status === 429 || response.status === 503) {
        return {
          status: 'READ_ERROR',
          target,
          observedAt: now,
          payload: null,
          sourceId: this.sourceId,
          sourceType: this.sourceType,
          integrationId: this.integrationId,
          tenantId: this.tenantId,
          errorCategory: 'RATE_LIMITED',
          errorMessage: `S3 endpoint throttled observation (HTTP ${response.status}).`,
        };
      }

      // 5xx / Other
      return {
        status: 'READ_ERROR',
        target,
        observedAt: now,
        payload: null,
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        integrationId: this.integrationId,
        tenantId: this.tenantId,
        errorCategory: 'NETWORK_ERROR',
        errorMessage: `S3 endpoint returned unexpected status ${response.status}.`,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        return {
          status: 'READ_ERROR',
          target,
          observedAt: now,
          payload: null,
          sourceId: this.sourceId,
          sourceType: this.sourceType,
          integrationId: this.integrationId,
          tenantId: this.tenantId,
          errorCategory: 'TIMEOUT',
          errorMessage: `S3 observation timed out after ${this.config.timeoutMs}ms.`,
        };
      }

      return {
        status: 'READ_ERROR',
        target,
        observedAt: now,
        payload: null,
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        integrationId: this.integrationId,
        tenantId: this.tenantId,
        errorCategory: 'NETWORK_ERROR',
        errorMessage: `S3 network communication failure: ${err.message}`,
      };
    }
  }

  private async applyAuthentication(headers: Record<string, string>): Promise<void> {
    const auth = this.config.auth;
    if (!auth || auth.type === 'NONE') {
      return;
    }

    if (!auth.secretRef) {
      throw new Error(`Authentication type '${auth.type}' requires secretRef.`);
    }

    const secret = await this.secretProvider.getSecret(auth.secretRef);
    if (!secret) {
      throw new Error(`Secret reference '${auth.secretRef}' could not be resolved.`);
    }

    if (auth.type === 'BEARER') {
      headers['Authorization'] = `Bearer ${secret}`;
    } else if (auth.type === 'API_KEY' || auth.type === 'CUSTOM_HEADER') {
      const headerName = auth.headerName || 'Authorization';
      const prefix = auth.headerPrefix || '';
      headers[headerName] = `${prefix}${secret}`;
    }
  }
}
