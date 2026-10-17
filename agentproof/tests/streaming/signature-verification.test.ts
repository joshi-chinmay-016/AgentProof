/**
 * AgentProof Streaming & Webhooks — Signature Verification Test Suite
 * 
 * Tests HMAC-SHA256, RSA-SHA256, constant-time comparison, header extraction,
 * body tampering, timestamps, and error classifications.
 */

import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import {
  WebhookSignatureVerifier,
  WebhookRawRequest,
  WebhookSourceConfig,
} from '../../src/streaming/index.js';

describe('WebhookSignatureVerifier', () => {
  const secret = 'super-secret-webhook-key-32-chars-long!';
  const tenantId = 'tenant-test-1';
  const sourceId = 'source-stripe-mock';

  const baseConfig: WebhookSourceConfig = {
    sourceId,
    tenantId,
    provider: 'CUSTOM_HMAC',
    signatureScheme: 'HMAC_SHA256',
    secretRef: 'env:WEBHOOK_SECRET',
    signatureHeader: 'x-hub-signature-256',
    timestampHeader: 'x-timestamp',
    eventIdHeader: 'x-event-id',
    maxClockSkewMs: 10000,
    replayRetentionMs: 86400000,
    allowedEvents: ['*'],
    enabled: true,
    autoVerifyState: false,
    correlationRule: {
      targetSystem: 'external',
      targetResourceTypeField: 'resourceType',
      targetResourceIdField: 'id',
    },
  };

  it('validates a valid standard HMAC-SHA256 signature', async () => {
    const rawBody = JSON.stringify({ event: 'payment.success', amount: 1000 });
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const request: WebhookRawRequest = {
      path: `/api/v1/webhooks/${sourceId}`,
      method: 'POST',
      headers: {
        'x-hub-signature-256': `sha256=${signature}`,
      },
      rawBody: Buffer.from(rawBody, 'utf-8'),
    };

    const result = await WebhookSignatureVerifier.verify(request, baseConfig, secret);
    expect(result.isValid).toBe(true);
    expect(result.category).toBe('VALID');
  });

  it('validates hex signature without sha256= prefix', async () => {
    const rawBody = 'simple-raw-text';
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const request: WebhookRawRequest = {
      path: `/webhooks/${sourceId}`,
      method: 'POST',
      headers: {
        'x-hub-signature-256': signature,
      },
      rawBody: Buffer.from(rawBody, 'utf-8'),
    };

    const result = await WebhookSignatureVerifier.verify(request, baseConfig, secret);
    expect(result.isValid).toBe(true);
  });

  it('rejects an invalid HMAC signature (wrong secret)', async () => {
    const rawBody = JSON.stringify({ event: 'test' });
    const wrongSignature = crypto.createHmac('sha256', 'wrong-secret').update(rawBody).digest('hex');

    const request: WebhookRawRequest = {
      path: `/webhooks/${sourceId}`,
      method: 'POST',
      headers: {
        'x-hub-signature-256': wrongSignature,
      },
      rawBody: Buffer.from(rawBody, 'utf-8'),
    };

    const result = await WebhookSignatureVerifier.verify(request, baseConfig, secret);
    expect(result.isValid).toBe(false);
    expect(result.category).toBe('INVALID_SIGNATURE');
  });

  it('rejects tampered body even if signature was valid for original body', async () => {
    const originalBody = JSON.stringify({ amount: 100 });
    const tamperedBody = JSON.stringify({ amount: 999999 });
    const signature = crypto.createHmac('sha256', secret).update(originalBody).digest('hex');

    const request: WebhookRawRequest = {
      path: `/webhooks/${sourceId}`,
      method: 'POST',
      headers: {
        'x-hub-signature-256': signature,
      },
      rawBody: Buffer.from(tamperedBody, 'utf-8'),
    };

    const result = await WebhookSignatureVerifier.verify(request, baseConfig, secret);
    expect(result.isValid).toBe(false);
    expect(result.category).toBe('INVALID_SIGNATURE');
  });

  it('rejects missing signature header', async () => {
    const request: WebhookRawRequest = {
      path: `/webhooks/${sourceId}`,
      method: 'POST',
      headers: {},
      rawBody: Buffer.from('{}', 'utf-8'),
    };

    const result = await WebhookSignatureVerifier.verify(request, baseConfig, secret);
    expect(result.isValid).toBe(false);
    expect(result.category).toBe('MISSING_SIGNATURE');
  });

  it('rejects malformed signature header encoding', async () => {
    const request: WebhookRawRequest = {
      path: `/webhooks/${sourceId}`,
      method: 'POST',
      headers: {
        'x-hub-signature-256': 'not-a-valid-hex-or-base64!',
      },
      rawBody: Buffer.from('{}', 'utf-8'),
    };

    const result = await WebhookSignatureVerifier.verify(request, baseConfig, secret);
    expect(result.isValid).toBe(false);
  });

  it('rejects missing signing secret', async () => {
    const request: WebhookRawRequest = {
      path: `/webhooks/${sourceId}`,
      method: 'POST',
      headers: { 'x-hub-signature-256': 'abc' },
      rawBody: Buffer.from('{}', 'utf-8'),
    };

    const result = await WebhookSignatureVerifier.verify(request, baseConfig, '');
    expect(result.isValid).toBe(false);
    expect(result.category).toBe('MISSING_SECRET');
  });

  it('validates Stripe style t=timestamp,v1=signature format', async () => {
    const stripeConfig: WebhookSourceConfig = {
      ...baseConfig,
      provider: 'STRIPE',
      signatureHeader: 'stripe-signature',
    };

    const rawBody = JSON.stringify({ id: 'evt_stripe_1', object: 'event' });
    const nowSec = Math.floor(Date.now() / 1000);
    const signedPayload = `${nowSec}.${rawBody}`;
    const v1Sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

    const request: WebhookRawRequest = {
      path: `/webhooks/${sourceId}`,
      method: 'POST',
      headers: {
        'stripe-signature': `t=${nowSec},v1=${v1Sig}`,
      },
      rawBody: Buffer.from(rawBody, 'utf-8'),
    };

    const result = await WebhookSignatureVerifier.verify(request, stripeConfig, secret);
    expect(result.isValid).toBe(true);
    expect(result.category).toBe('VALID');
    expect(result.signedTimestamp).toBeDefined();
  });

  it('validates asymmetric RSA-SHA256 signature when configured', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const rsaConfig: WebhookSourceConfig = {
      ...baseConfig,
      signatureScheme: 'RSA_SHA256',
      signatureHeader: 'x-rsa-signature',
      publicKeyId: 'key-2026-rsa',
    };

    const rawBody = JSON.stringify({ resource: 'account', status: 'verified' });
    const signer = crypto.createSign('SHA256');
    signer.update(rawBody);
    signer.end();
    const signatureBase64 = signer.sign(privateKey, 'base64');

    const request: WebhookRawRequest = {
      path: `/webhooks/${sourceId}`,
      method: 'POST',
      headers: {
        'x-rsa-signature': signatureBase64,
      },
      rawBody: Buffer.from(rawBody, 'utf-8'),
    };

    const result = await WebhookSignatureVerifier.verify(request, rsaConfig, '', publicKey);
    expect(result.isValid).toBe(true);
    expect(result.category).toBe('VALID');
  });

  it('rejects invalid RSA-SHA256 signature on tampered payload', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const rsaConfig: WebhookSourceConfig = {
      ...baseConfig,
      signatureScheme: 'RSA_SHA256',
      signatureHeader: 'x-rsa-signature',
    };

    const originalBody = 'legitimate message';
    const signer = crypto.createSign('SHA256');
    signer.update(originalBody);
    signer.end();
    const signature = signer.sign(privateKey, 'base64');

    const request: WebhookRawRequest = {
      path: `/webhooks/${sourceId}`,
      method: 'POST',
      headers: {
        'x-rsa-signature': signature,
      },
      rawBody: Buffer.from('forged message', 'utf-8'),
    };

    const result = await WebhookSignatureVerifier.verify(request, rsaConfig, '', publicKey);
    expect(result.isValid).toBe(false);
    expect(result.category).toBe('INVALID_SIGNATURE');
  });
});
