/**
 * AgentProof Observation — Real REST API State Reader
 * 
 * Independently queries an external HTTP/REST API to observe resource state.
 * Enforces SSRF prevention, strictly read-only methods, credential redaction,
 * bounded response sizes, request timeouts, and reliable status mapping.
 */

import { ResourceTarget } from '../../core/index.js';
import {
  IExternalStateReader,
  ExternalObservationRecord,
} from '../contracts/state-reader.interface.js';
import { RestApiIntegrationConfig } from '../registry/integration-config.schema.js';
import { SsrfGuard } from '../security/ssrf-guard.js';
import { ISecretProvider, EnvironmentSecretProvider } from '../security/secret-provider.js';

export interface RestApiStateReaderOptions {
  readonly secretProvider?: ISecretProvider;
  readonly ssrfGuard?: SsrfGuard;
  readonly fetchFn?: typeof fetch;
}

export class RestApiStateReader implements IExternalStateReader {
  public readonly sourceId: string;
  public readonly sourceType = 'REST_API' as const;
  public readonly integrationId: string;
  public readonly tenantId: string;

  private readonly config: RestApiIntegrationConfig;
  private readonly secretProvider: ISecretProvider;
  private readonly ssrfGuard: SsrfGuard;
  private readonly fetchFn: typeof fetch;

  constructor(config: RestApiIntegrationConfig, options?: RestApiStateReaderOptions) {
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
   * Independently reads current resource state from the configured REST endpoint.
   */
  public async readState(target: ResourceTarget): Promise<ExternalObservationRecord> {
    const now = new Date().toISOString();

    // 1. Build and validate target path
    const resolvedPath = this.resolveResourcePath(target);
    const isPathAllowed = this.ssrfGuard.validatePath(
      resolvedPath,
      this.config.allowedResourcePatterns
    );

    if (!isPathAllowed) {
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
        errorMessage: `Path '${resolvedPath}' is not permitted by integration allowlist.`,
      };
    }

    // 2. Validate full target URL against SSRF rules
    let targetUrl: URL;
    try {
      const fullUrlStr = new URL(resolvedPath, this.config.baseUrl).toString();
      targetUrl = this.ssrfGuard.validateUrl(fullUrlStr);
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
        errorMessage: `SSRF validation failed: ${err.message}`,
      };
    }

    // 3. Prepare headers & authenticate
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'AgentProof-Verifier/1.0',
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
        errorMessage: `Authentication configuration error: ${err.message}`,
      };
    }

    // 4. Execute HTTP request with strict timeouts and response size bounds
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.config.timeoutMs);

    try {
      const response = await this.fetchFn(targetUrl.toString(), {
        method: 'GET',
        headers,
        signal: abortController.signal,
        redirect: 'error', // strictly disallow automated redirects to prevent SSRF bypass
      });

      clearTimeout(timeoutId);

      // Redact sensitive headers for safe metadata recording
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        responseHeaders[key] = val;
      });
      const safeHeaders = this.ssrfGuard.redactHeaders(responseHeaders);

      // 5. Handle HTTP status codes deterministically
      if (response.status === 200) {
        // Enforce Content-Length bound if header present
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > this.config.maxResponseSizeBytes) {
          return {
            status: 'READ_ERROR',
            target,
            observedAt: now,
            payload: null,
            sourceId: this.sourceId,
            sourceType: this.sourceType,
            integrationId: this.integrationId,
            tenantId: this.tenantId,
            errorCategory: 'RESPONSE_TOO_LARGE',
            errorMessage: `Response size exceeds configured limit (${this.config.maxResponseSizeBytes} bytes).`,
          };
        }

        const rawText = await response.text();
        if (rawText.length > this.config.maxResponseSizeBytes) {
          return {
            status: 'READ_ERROR',
            target,
            observedAt: now,
            payload: null,
            sourceId: this.sourceId,
            sourceType: this.sourceType,
            integrationId: this.integrationId,
            tenantId: this.tenantId,
            errorCategory: 'RESPONSE_TOO_LARGE',
            errorMessage: `Response payload exceeds configured limit.`,
          };
        }

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(rawText);
        } catch {
          return {
            status: 'READ_ERROR',
            target,
            observedAt: now,
            payload: null,
            sourceId: this.sourceId,
            sourceType: this.sourceType,
            integrationId: this.integrationId,
            tenantId: this.tenantId,
            errorCategory: 'MALFORMED_PAYLOAD',
            errorMessage: 'Remote endpoint returned invalid JSON body.',
          };
        }

        return {
          status: 'FOUND',
          target,
          observedAt: now,
          payload: parsedJson,
          sourceId: this.sourceId,
          sourceType: this.sourceType,
          integrationId: this.integrationId,
          tenantId: this.tenantId,
          metadata: {
            statusCode: 200,
            headers: safeHeaders,
          },
        };
      }

      // 404: Confirmed absence of resource
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
          errorMessage: `Remote endpoint rejected observation with status ${response.status}.`,
        };
      }

      // 429: Rate limited
      if (response.status === 429) {
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
          errorMessage: 'Observation endpoint rate limit exceeded (HTTP 429).',
        };
      }

      // 5xx / other unexpected statuses
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
        errorMessage: `Remote endpoint returned error status ${response.status}.`,
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
          errorMessage: `Observation timed out after ${this.config.timeoutMs}ms.`,
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
        errorMessage: `HTTP network failure: ${err.message}`,
      };
    }
  }

  /**
   * Resolves target into URL pathname using pathMapping or default template.
   */
  private resolveResourcePath(target: ResourceTarget): string {
    const mapping = this.config.pathMapping[target.resourceType];
    if (mapping) {
      return mapping
        .replace('{id}', encodeURIComponent(target.resourceId))
        .replace('{resourceId}', encodeURIComponent(target.resourceId))
        .replace('{tenantId}', encodeURIComponent(target.tenantId ?? this.tenantId));
    }

    // Default RESTful path: /api/<resourceType>s/<resourceId>
    return `/api/${encodeURIComponent(target.resourceType)}s/${encodeURIComponent(target.resourceId)}`;
  }

  /**
   * Applies configured credentials to outgoing request headers without leaking them.
   */
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
      throw new Error(`Secret reference '${auth.secretRef}' could not be resolved by secret provider.`);
    }

    if (auth.type === 'BEARER') {
      headers['Authorization'] = `Bearer ${secret}`;
    } else if (auth.type === 'API_KEY' || auth.type === 'CUSTOM_HEADER') {
      const headerName = auth.headerName || 'Authorization';
      const prefix = auth.headerPrefix || '';
      headers[headerName] = `${prefix}${secret}`;
    } else if (auth.type === 'BASIC') {
      const username = auth.username || '';
      const encoded = Buffer.from(`${username}:${secret}`).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
    }
  }
}
