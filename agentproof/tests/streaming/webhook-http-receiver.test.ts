/**
 * AgentProof Streaming & Webhooks — Webhook HTTP Receiver End-to-End Test Suite
 * 
 * Tests the live HTTP server, raw body verification, status codes, payload limits,
 * duplicate delivery acknowledgements, security conflicts, and graceful shutdown.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { AddressInfo } from 'node:net';
import {
  WebhookReceiver,
  InMemoryWebhookSourceRegistry,
  InMemoryWebhookReplayStore,
  InMemoryWebhookEventRepository,
  WebhookSourceConfig,
} from '../../src/streaming/index.js';

describe('WebhookReceiver HTTP End-to-End', () => {
  let receiver: WebhookReceiver;
  let sourceRegistry: InMemoryWebhookSourceRegistry;
  let replayStore: InMemoryWebhookReplayStore;
  let eventRepo: InMemoryWebhookEventRepository;
  let server: http.Server;
  let baseUrl: string;

  const secret = 'test-receiver-signing-secret-key-32ch';
  const tenantId = 'tenant-http-live';
  const sourceId = 'stripe-live';

  const sourceConfig: WebhookSourceConfig = {
    sourceId,
    tenantId,
    provider: 'STRIPE',
    signatureScheme: 'HMAC_SHA256',
    secretRef: 'env:STRIPE_SECRET',
    signatureHeader: 'stripe-signature',
    timestampHeader: 'x-timestamp',
    eventIdHeader: 'x-event-id',
    maxClockSkewMs: 15000,
    replayRetentionMs: 86400000,
    allowedEvents: ['*'],
    enabled: true,
    autoVerifyState: false,
    correlationRule: {
      targetSystem: 'stripe',
      targetResourceTypeField: 'resourceType',
      targetResourceIdField: 'id',
    },
  };

  const disabledConfig: WebhookSourceConfig = {
    ...sourceConfig,
    sourceId: 'disabled-source',
    enabled: false,
  };

  beforeAll(async () => {
    sourceRegistry = new InMemoryWebhookSourceRegistry();
    replayStore = new InMemoryWebhookReplayStore();
    eventRepo = new InMemoryWebhookEventRepository();

    sourceRegistry.register(sourceConfig);
    sourceRegistry.register(disabledConfig);

    receiver = new WebhookReceiver({
      sourceRegistry,
      replayStore,
      eventRepository: eventRepo,
      maxPayloadBytes: 10 * 1024, // 10 KB limit for testing
      secretResolver: (ref) => (ref === 'env:STRIPE_SECRET' ? secret : undefined),
    });

    server = await receiver.start(0, '127.0.0.1');
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await receiver.stop();
  });

  function makeRequest(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string | Buffer
  ): Promise<{ statusCode: number; data: any; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const reqHeaders: Record<string, string> = { ...headers };
      if (body) {
        reqHeaders['Content-Length'] = Buffer.byteLength(body).toString();
      }
      const req = http.request(
        url,
        {
          method,
          headers: reqHeaders,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf-8');
            let data: any = raw;
            try {
              data = JSON.parse(raw);
            } catch {}
            resolve({
              statusCode: res.statusCode ?? 0,
              data,
              headers: res.headers,
            });
          });
        }
      );

      req.on('error', reject);
      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  it('accepts and records a valid signed webhook request (202 Accepted)', async () => {
    const rawBody = JSON.stringify({ id: 'evt_stripe_1', amount: 5000 });
    const nowSec = Math.floor(Date.now() / 1000);
    const signedPayload = `${nowSec}.${rawBody}`;
    const v1Sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

    const res = await makeRequest(
      'POST',
      `/webhooks/${sourceId}`,
      {
        'Content-Type': 'application/json',
        'stripe-signature': `t=${nowSec},v1=${v1Sig}`,
        'x-event-id': 'evt_stripe_1',
      },
      rawBody
    );

    expect(res.statusCode).toBe(202);
    expect(res.data.accepted).toBe(true);
    expect(res.data.status).toBe('QUEUED');
    expect(res.data.eventId).toBeDefined();

    // Verify durable storage
    const stored = await eventRepo.getById(tenantId, res.data.eventId);
    expect(stored).not.toBeNull();
    expect(stored?.externalEventId).toBe('evt_stripe_1');
  });

  it('acknowledges identical duplicate delivery with 200 OK without re-ingesting', async () => {
    const rawBody = JSON.stringify({ id: 'evt_stripe_dup', amount: 1200 });
    const nowSec = Math.floor(Date.now() / 1000);
    const signedPayload = `${nowSec}.${rawBody}`;
    const v1Sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

    const headers = {
      'Content-Type': 'application/json',
      'stripe-signature': `t=${nowSec},v1=${v1Sig}`,
      'x-event-id': 'evt_stripe_dup',
    };

    // First delivery
    const res1 = await makeRequest('POST', `/webhooks/${sourceId}`, headers, rawBody);
    expect(res1.statusCode).toBe(202);

    // Second identical delivery
    const res2 = await makeRequest('POST', `/webhooks/${sourceId}`, headers, rawBody);
    expect(res2.statusCode).toBe(200);
    expect(res2.data.duplicate).toBe(true);
  });

  it('rejects duplicate event ID with altered payload (409 Conflict)', async () => {
    const rawBody1 = JSON.stringify({ id: 'evt_conflict_1', amount: 100 });
    const rawBody2 = JSON.stringify({ id: 'evt_conflict_1', amount: 999999 }); // Tampered!
    const nowSec = Math.floor(Date.now() / 1000);

    const sig1 = crypto.createHmac('sha256', secret).update(`${nowSec}.${rawBody1}`).digest('hex');
    const sig2 = crypto.createHmac('sha256', secret).update(`${nowSec}.${rawBody2}`).digest('hex');

    // First request
    const res1 = await makeRequest(
      'POST',
      `/webhooks/${sourceId}`,
      {
        'stripe-signature': `t=${nowSec},v1=${sig1}`,
        'x-event-id': 'evt_conflict_1',
      },
      rawBody1
    );
    expect(res1.statusCode).toBe(202);

    // Replay with altered body
    const res2 = await makeRequest(
      'POST',
      `/webhooks/${sourceId}`,
      {
        'stripe-signature': `t=${nowSec},v1=${sig2}`,
        'x-event-id': 'evt_conflict_1',
      },
      rawBody2
    );
    expect(res2.statusCode).toBe(409);
    expect(res2.data.error).toBe('Conflict');
  });

  it('rejects invalid signature with 401 Unauthorized', async () => {
    const rawBody = JSON.stringify({ id: 'evt_bad_sig' });

    const res = await makeRequest(
      'POST',
      `/webhooks/${sourceId}`,
      {
        'stripe-signature': 't=1234567,v1=bad_signature_value',
      },
      rawBody
    );

    expect(res.statusCode).toBe(401);
    expect(res.data.error).toBe('Unauthorized');
  });

  it('rejects oversized payload with 413 Payload Too Large', async () => {
    const hugeBody = 'x'.repeat(15 * 1024); // 15KB exceeds 10KB limit

    const res = await makeRequest(
      'POST',
      `/webhooks/${sourceId}`,
      {
        'stripe-signature': 't=123,v1=sig',
      },
      hugeBody
    );

    expect(res.statusCode).toBe(413);
  });

  it('rejects unknown source endpoint with 404 Not Found', async () => {
    const res = await makeRequest('POST', '/webhooks/non-existent-source', {}, '{}');
    expect(res.statusCode).toBe(404);
  });

  it('rejects disabled source with 403 Forbidden', async () => {
    const res = await makeRequest('POST', '/webhooks/disabled-source', {}, '{}');
    expect(res.statusCode).toBe(403);
  });

  it('rejects non-POST HTTP methods with 405 Method Not Allowed', async () => {
    const res = await makeRequest('GET', `/webhooks/${sourceId}`, {});
    expect(res.statusCode).toBe(405);
  });
});
