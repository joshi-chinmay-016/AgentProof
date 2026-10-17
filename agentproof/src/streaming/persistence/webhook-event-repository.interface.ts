/**
 * AgentProof Streaming & Webhooks — Webhook Event Repository Contract
 */

import { WebhookEventRecord, WebhookEventStatus } from '../contracts/webhook.interface.js';

export interface WebhookEventQueryOptions {
  tenantId: string;
  sourceId?: string;
  status?: WebhookEventStatus | WebhookEventStatus[];
  limit?: number;
}

export interface WebhookStatusUpdateOptions {
  lastError?: string;
  errorCategory?: string;
  incrementAttempts?: boolean;
  correlationId?: string;
  traceId?: string;
  completedAt?: string;
}

export interface IWebhookEventRepository {
  /**
   * Durably records an accepted webhook event.
   */
  create(event: WebhookEventRecord): Promise<void>;

  /**
   * Retrieves an event by its internal event ID within a tenant boundary.
   */
  getById(tenantId: string, internalEventId: string): Promise<WebhookEventRecord | null>;

  /**
   * Retrieves an event by external event ID for a given source and tenant.
   */
  getByExternalId(tenantId: string, sourceId: string, externalEventId: string): Promise<WebhookEventRecord | null>;

  /**
   * Queries events matching tenant-scoped criteria.
   */
  query(options: WebhookEventQueryOptions): Promise<WebhookEventRecord[]>;

  /**
   * Retrieves pending events eligible for processing (e.g. QUEUED, RETRYABLE_FAILURE).
   */
  getPendingEvents(tenantId?: string, limit?: number): Promise<WebhookEventRecord[]>;

  /**
   * Atomically transitions event status according to the valid lifecycle state machine.
   */
  updateStatus(
    tenantId: string,
    internalEventId: string,
    nextStatus: WebhookEventStatus,
    updates?: WebhookStatusUpdateOptions
  ): Promise<WebhookEventRecord>;

  /**
   * Startup crash recovery: resets any uncompleted in-flight (PROCESSING) events to QUEUED or RETRYABLE_FAILURE.
   * Returns the count of recovered events.
   */
  recoverInFlightEvents(tenantId?: string): Promise<number>;
}
