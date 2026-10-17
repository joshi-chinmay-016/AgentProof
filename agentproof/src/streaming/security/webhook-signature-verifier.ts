/**
 * AgentProof Streaming & Webhooks — Webhook Signature Verifier
 * 
 * Verifies cryptographic webhook signatures (HMAC-SHA256 and RSA-SHA256)
 * over exact raw request bytes with constant-time equality comparisons.
 */

import * as crypto from 'node:crypto';
import {
  WebhookRawRequest,
  SignatureVerificationResult,
} from '../contracts/webhook.interface.js';
import { WebhookSourceConfig } from '../registry/webhook-source.schema.js';

export interface IWebhookSignatureVerifier {
  verify(
    request: WebhookRawRequest,
    source: WebhookSourceConfig,
    secret: string,
    publicKey?: string
  ): Promise<SignatureVerificationResult>;
}

export class WebhookSignatureVerifier implements IWebhookSignatureVerifier {
  private static readonly defaultInstance = new WebhookSignatureVerifier();

  public static async verify(
    request: WebhookRawRequest,
    source: WebhookSourceConfig,
    secret: string,
    publicKey?: string
  ): Promise<SignatureVerificationResult> {
    return WebhookSignatureVerifier.defaultInstance.verify(request, source, secret, publicKey);
  }

  public async verify(
    request: WebhookRawRequest,
    source: WebhookSourceConfig,
    secret: string,
    publicKey?: string
  ): Promise<SignatureVerificationResult> {
    const now = new Date().toISOString();

    if (!secret && source.signatureScheme === 'HMAC_SHA256') {
      return {
        isValid: false,
        category: 'MISSING_SECRET',
        scheme: source.signatureScheme,
        verifiedAt: now,
        errorMessage: 'Signing secret is missing or could not be resolved.',
      };
    }

    // 1. Extract signature header
    const rawSigHeader = this.getHeader(request.headers, source.signatureHeader);
    if (!rawSigHeader) {
      return {
        isValid: false,
        category: 'MISSING_SIGNATURE',
        scheme: source.signatureScheme,
        verifiedAt: now,
        errorMessage: `Missing required signature header '${source.signatureHeader}'.`,
      };
    }

    // 2. Extract timestamp and event ID headers if present
    const timestampHeaderVal = this.getHeader(request.headers, source.timestampHeader);
    const eventIdHeaderVal = this.getHeader(request.headers, source.eventIdHeader);

    // 3. Dispatch to scheme verifier
    if (source.signatureScheme === 'HMAC_SHA256') {
      return this.verifyHmacSha256(
        request,
        source,
        rawSigHeader,
        secret,
        timestampHeaderVal,
        eventIdHeaderVal,
        now
      );
    } else if (source.signatureScheme === 'RSA_SHA256') {
      return this.verifyRsaSha256(request, source, rawSigHeader, publicKey, now);
    }

    return {
      isValid: false,
      category: 'UNSUPPORTED_SCHEME',
      scheme: source.signatureScheme,
      verifiedAt: now,
      errorMessage: `Unsupported signature scheme '${source.signatureScheme}'.`,
    };
  }

  /**
   * Verifies HMAC-SHA256 signatures over raw body.
   */
  private verifyHmacSha256(
    request: WebhookRawRequest,
    source: WebhookSourceConfig,
    sigHeader: string,
    secret: string,
    timestampHeaderVal: string | undefined,
    eventIdHeaderVal: string | undefined,
    verifiedAt: string
  ): SignatureVerificationResult {
    let extractedSignature = sigHeader.trim();
    let signedTimestamp: string | undefined = timestampHeaderVal;

    // Support GitHub style 'sha256=...' prefix
    if (extractedSignature.startsWith('sha256=')) {
      extractedSignature = extractedSignature.slice(7);
    }

    // Support Stripe style 't=1234567,v1=...' format
    if (sigHeader.includes('t=') && sigHeader.includes('v1=')) {
      const parts = sigHeader.split(',').map((p) => p.trim());
      for (const part of parts) {
        if (part.startsWith('t=')) {
          signedTimestamp = part.slice(2);
        } else if (part.startsWith('v1=')) {
          extractedSignature = part.slice(3);
        }
      }
    }

    // Validate hex signature format
    if (!/^[0-9a-fA-F]{64}$/.test(extractedSignature)) {
      return {
        isValid: false,
        category: 'MALFORMED_SIGNATURE',
        scheme: 'HMAC_SHA256',
        verifiedAt,
        errorMessage: 'Signature is not a valid 64-character hex string.',
      };
    }

    // Prepare signed payload bytes
    let payloadToSign: Buffer;
    const bodyBuffer = Buffer.isBuffer(request.rawBody)
      ? request.rawBody
      : Buffer.from(request.rawBody, 'utf8');

    // If source provider signs timestamp along with body (Stripe / AWS / Custom with timestamp)
    if (source.provider === 'STRIPE' && signedTimestamp) {
      payloadToSign = Buffer.concat([
        Buffer.from(`${signedTimestamp}.`, 'utf8'),
        bodyBuffer,
      ]);
    } else {
      payloadToSign = bodyBuffer;
    }

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payloadToSign);
    const expectedHex = hmac.digest('hex');

    const expectedBuffer = Buffer.from(expectedHex, 'utf8');
    const actualBuffer = Buffer.from(extractedSignature.toLowerCase(), 'utf8');

    // Constant-time equality comparison
    if (expectedBuffer.length !== actualBuffer.length) {
      return {
        isValid: false,
        category: 'INVALID_SIGNATURE',
        scheme: 'HMAC_SHA256',
        verifiedAt,
        signedTimestamp,
        signedEventId: eventIdHeaderVal,
        errorMessage: 'Webhook signature verification failed.',
      };
    }

    const isMatch = crypto.timingSafeEqual(expectedBuffer, actualBuffer);
    if (!isMatch) {
      return {
        isValid: false,
        category: 'INVALID_SIGNATURE',
        scheme: 'HMAC_SHA256',
        verifiedAt,
        signedTimestamp,
        signedEventId: eventIdHeaderVal,
        errorMessage: 'Webhook signature verification failed.',
      };
    }

    return {
      isValid: true,
      category: 'VALID',
      scheme: 'HMAC_SHA256',
      verifiedAt,
      signedTimestamp,
      signedEventId: eventIdHeaderVal,
    };
  }

  /**
   * Verifies RSA-SHA256 asymmetric signatures over raw body.
   */
  private verifyRsaSha256(
    request: WebhookRawRequest,
    source: WebhookSourceConfig,
    sigHeader: string,
    publicKey: string | undefined,
    verifiedAt: string
  ): SignatureVerificationResult {
    if (!publicKey) {
      return {
        isValid: false,
        category: 'MISSING_SECRET',
        scheme: 'RSA_SHA256',
        verifiedAt,
        errorMessage: 'Public key is required for RSA-SHA256 verification.',
      };
    }

    try {
      const verifier = crypto.createVerify('RSA-SHA256');
      const bodyBuffer = Buffer.isBuffer(request.rawBody)
        ? request.rawBody
        : Buffer.from(request.rawBody, 'utf8');
      verifier.update(bodyBuffer);

      // Support hex or base64 encoding
      const encoding: crypto.BinaryToTextEncoding = /^[0-9a-fA-F]+$/.test(sigHeader)
        ? 'hex'
        : 'base64';

      const isValid = verifier.verify(publicKey, sigHeader, encoding);
      return {
        isValid,
        category: isValid ? 'VALID' : 'INVALID_SIGNATURE',
        scheme: 'RSA_SHA256',
        verifiedAt,
        errorMessage: isValid ? undefined : 'RSA signature verification failed.',
      };
    } catch (err: any) {
      return {
        isValid: false,
        category: 'MALFORMED_SIGNATURE',
        scheme: 'RSA_SHA256',
        verifiedAt,
        errorMessage: `RSA verification error: ${err.message}`,
      };
    }
  }

  private getHeader(
    headers: Readonly<Record<string, string | string[] | undefined>>,
    name: string
  ): string | undefined {
    const target = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === target) {
        if (Array.isArray(value)) return value[0];
        return value;
      }
    }
    return undefined;
  }
}
