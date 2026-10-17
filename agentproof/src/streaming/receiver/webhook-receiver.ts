/**
 * AgentProof Streaming & Webhooks — Webhook Ingestion Receiver
 * 
 * HTTP receiver implementing raw-body capture, signature verification,
 * replay protection, durable event persistence, and safe response semantics.
 */

import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { IWebhookSourceRegistry } from '../registry/webhook-source-registry.js';
import { WebhookSignatureVerifier } from '../security/webhook-signature-verifier.js';
import { IWebhookReplayStore } from '../security/replay-store.interface.js';
import { IWebhookEventRepository } from '../persistence/webhook-event-repository.interface.js';
import {
  WebhookRawRequest,
  WebhookEventRecord,
} from '../contracts/webhook.interface.js';
import { WebhookSourceConfig } from '../registry/webhook-source.schema.js';

export interface WebhookReceiverOptions {
  readonly sourceRegistry: IWebhookSourceRegistry;
  readonly replayStore: IWebhookReplayStore;
  readonly eventRepository: IWebhookEventRepository;
  readonly maxPayloadBytes?: number; // Default: 1MB
  readonly secretResolver?: (secretRef: string) => Promise<string | undefined> | string | undefined;
  readonly onEventQueued?: (tenantId: string, internalEventId: string) => void | Promise<void>;
}

export class WebhookReceiver {
  private readonly sourceRegistry: IWebhookSourceRegistry;
  private readonly replayStore: IWebhookReplayStore;
  private readonly eventRepository: IWebhookEventRepository;
  private readonly maxPayloadBytes: number;
  private readonly secretResolver?: (secretRef: string) => Promise<string | undefined> | string | undefined;
  private readonly onEventQueued?: (tenantId: string, internalEventId: string) => void | Promise<void>;
  private server?: http.Server;

  constructor(options: WebhookReceiverOptions) {
    this.sourceRegistry = options.sourceRegistry;
    this.replayStore = options.replayStore;
    this.eventRepository = options.eventRepository;
    this.maxPayloadBytes = options.maxPayloadBytes ?? 1024 * 1024; // 1 MB
    this.secretResolver = options.secretResolver;
    this.onEventQueued = options.onEventQueued;
  }

  /**
   * Matches request URL to extract sourceId.
   * Matches patterns:
   *   /api/v1/webhooks/:sourceId
   *   /webhooks/:sourceId
   */
  private extractSourceId(pathname: string): string | null {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 2 && parts[0] === 'webhooks') {
      return decodeURIComponent(parts[1]);
    }
    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'v1' && parts[2].startsWith('webhooks/')) {
      return decodeURIComponent(parts[2].replace('webhooks/', ''));
    }
    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'webhooks') {
      return decodeURIComponent(parts[3]);
    }
    return null;
  }

  /**
   * Reads raw request body up to configured maxPayloadBytes limit.
   */
  private readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      let exceeded = false;
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      req.on('data', (chunk: Buffer) => {
        if (exceeded) return;
        totalBytes += chunk.length;
        if (totalBytes > this.maxPayloadBytes) {
          exceeded = true;
          req.resume(); // Drain remainder so socket doesn't hang
          reject(new Error('PAYLOAD_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (!exceeded) {
          resolve(Buffer.concat(chunks));
        }
      });

      req.on('error', (err) => {
        reject(err);
      });
    });
  }

  private sendJson(res: http.ServerResponse, statusCode: number, data: Record<string, unknown>): void {
    const json = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json),
      'Cache-Control': 'no-store',
      'Connection': statusCode === 413 ? 'close' : 'keep-alive',
    });
    res.end(json);
  }

  /**
   * Core request dispatcher suitable for integration into existing HTTP servers or standalone listening.
   */
  public async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const sourceId = this.extractSourceId(url.pathname);

    if (!sourceId) {
      this.sendJson(res, 404, {
        error: 'Not Found',
        message: 'Unsupported webhook endpoint route',
      });
      return;
    }

    if (req.method !== 'POST') {
      this.sendJson(res, 405, {
        error: 'Method Not Allowed',
        message: 'Webhooks must be delivered via POST',
      });
      return;
    }

    // 1. Read raw body with size limit
    let rawBuffer: Buffer;
    try {
      rawBuffer = await this.readRequestBody(req);
    } catch (err: any) {
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        this.sendJson(res, 413, {
          error: 'Payload Too Large',
          message: `Request body exceeds size limit of ${this.maxPayloadBytes} bytes`,
        });
        return;
      }
      this.sendJson(res, 400, {
        error: 'Bad Request',
        message: 'Failed to read request body stream',
      });
      return;
    }

    // 2. Resolve configured source
    const source = await this.sourceRegistry.getSource(sourceId);
    if (!source) {
      this.sendJson(res, 404, {
        error: 'Not Found',
        message: `Unknown webhook source '${sourceId}'`,
      });
      return;
    }

    if (!source.enabled) {
      this.sendJson(res, 403, {
        error: 'Forbidden',
        message: `Webhook source '${sourceId}' is disabled`,
      });
      return;
    }

    // 3. Resolve signing secret or public key
    let secret = source.secretRef;
    if (this.secretResolver) {
      const resolved = await this.secretResolver(source.secretRef);
      if (resolved) {
        secret = resolved;
      }
    }

    const rawRequest: WebhookRawRequest = {
      path: url.pathname,
      method: req.method,
      headers: req.headers,
      rawBody: rawBuffer,
    };

    // 4. Verify signature
    const sigResult = await WebhookSignatureVerifier.verify(rawRequest, source, secret);
    if (!sigResult.isValid) {
      this.sendJson(res, 401, {
        error: 'Unauthorized',
        message: 'Webhook signature verification failed',
        category: sigResult.category,
      });
      return;
    }

    // 5. Compute payload digest
    const payloadDigest = crypto.createHash('sha256').update(rawBuffer).digest('hex');

    // 6. Extract eventId
    const eventIdHeader = source.eventIdHeader.toLowerCase();
    const rawEventId = req.headers[eventIdHeader];
    const externalEventId = Array.isArray(rawEventId)
      ? rawEventId[0]
      : rawEventId || sigResult.signedEventId || `gen_${payloadDigest.substring(0, 16)}`;

    // 7. Check Replay Protection
    const eventTimestamp = sigResult.signedTimestamp || new Date().toISOString();
    const replayClaim = await this.replayStore.claim(
      source.tenantId,
      source.sourceId,
      externalEventId,
      payloadDigest,
      eventTimestamp,
      source.replayRetentionMs
    );

    if (replayClaim.status === 'DUPLICATE_CONFLICT') {
      this.sendJson(res, 409, {
        error: 'Conflict',
        message: 'Security conflict: Replay detected with modified payload digest for the same event ID',
      });
      return;
    }

    if (replayClaim.status === 'DUPLICATE_IDENTICAL') {
      // Idempotent acknowledgement of identical delivery
      this.sendJson(res, 200, {
        accepted: true,
        duplicate: true,
        message: 'Event previously accepted with identical payload digest',
      });
      return;
    }

    // 8. Parse payload
    let parsedPayload: unknown;
    try {
      const rawText = rawBuffer.toString('utf-8');
      parsedPayload = rawText.length > 0 ? JSON.parse(rawText) : {};
    } catch {
      this.sendJson(res, 400, {
        error: 'Bad Request',
        message: 'Malformed JSON payload',
      });
      return;
    }

    // 9. Create and persist event record
    const internalEventId = `evt_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const eventRecord: WebhookEventRecord = {
      internalEventId,
      tenantId: source.tenantId,
      sourceId: source.sourceId,
      externalEventId,
      eventType: (parsedPayload as any)?.type || (parsedPayload as any)?.event || (source.allowedEvents && source.allowedEvents[0] !== '*' ? source.allowedEvents[0] : 'webhook.event'),
      payloadDigest,
      rawBody: rawBuffer.toString('utf-8'),
      parsedPayload,
      receivedAt: new Date().toISOString(),
      eventTimestamp,
      signatureVerification: sigResult,
      status: 'QUEUED',
      attempts: 0,
    };

    try {
      await this.eventRepository.create(eventRecord);
    } catch (storageErr: any) {
      this.sendJson(res, 500, {
        error: 'Internal Server Error',
        message: 'Failed to durably persist accepted webhook event',
      });
      return;
    }

    // 10. Trigger asynchronous processing hook if registered
    if (this.onEventQueued) {
      try {
        const dispatchResult = this.onEventQueued(source.tenantId, internalEventId);
        if (dispatchResult instanceof Promise) {
          dispatchResult.catch((err) => {
            // Asynchronous dispatch failure should not impact HTTP response
            console.error(`[WebhookReceiver] Error in onEventQueued callback: ${err?.message}`);
          });
        }
      } catch (err: any) {
        console.error(`[WebhookReceiver] Sync error in onEventQueued callback: ${err?.message}`);
      }
    }

    // 11. Return 202 Accepted response
    this.sendJson(res, 202, {
      accepted: true,
      eventId: internalEventId,
      externalEventId,
      status: 'QUEUED',
    });
  }

  /**
   * Starts a standalone HTTP server on the given port and host.
   */
  public async start(port: number, host: string = '127.0.0.1'): Promise<http.Server> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleHttpRequest(req, res).catch((err) => {
          if (!res.headersSent) {
            this.sendJson(res, 500, {
              error: 'Internal Server Error',
              message: 'Unhandled server error',
            });
          }
        });
      });

      server.on('error', reject);

      server.listen(port, host, () => {
        this.server = server;
        resolve(server);
      });
    });
  }

  /**
   * Gracefully shuts down the HTTP receiver.
   */
  public async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
