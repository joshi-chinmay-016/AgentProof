/**
 * AgentProof Streaming & Webhooks — Replay Store Interface
 * 
 * Formal contract for atomic, tenant-scoped replay detection and event claiming.
 */

export type ReplayClaimStatus =
  | 'FIRST_SEEN'
  | 'DUPLICATE_IDENTICAL'
  | 'DUPLICATE_CONFLICT';

export interface ReplayRecord {
  readonly tenantId: string;
  readonly sourceId: string;
  readonly eventId: string;
  readonly payloadDigest: string;
  readonly eventTimestamp: string;
  readonly claimedAt: string;
  readonly expiresAt: string;
}

export interface ReplayClaimResult {
  readonly status: ReplayClaimStatus;
  readonly record: ReplayRecord;
  readonly isAllowed: boolean;
}

export interface IWebhookReplayStore {
  /**
   * Atomically claims an event ID within a tenant and source scope.
   */
  claimEvent(
    tenantId: string,
    sourceId: string,
    eventId: string,
    payloadDigest: string,
    eventTimestamp: string,
    retentionMs?: number
  ): Promise<ReplayClaimResult>;

  claim(
    tenantId: string,
    sourceId: string,
    eventId: string,
    payloadDigest: string,
    eventTimestamp: string,
    retentionMs?: number
  ): Promise<ReplayClaimResult>;

  /**
   * Checks whether an event was already claimed without modifying state.
   */
  hasEvent(tenantId: string, sourceId: string, eventId: string): Promise<boolean>;

  /**
   * Purges expired replay records.
   */
  purgeExpired(nowMs?: number): Promise<number>;

  /**
   * Clears all records (for testing).
   */
  clear(): Promise<void>;
}
