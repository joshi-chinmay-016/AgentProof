/**
 * AgentProof Streaming & Webhooks — File-Backed Replay Store
 * 
 * Provides durable, crash-safe, tenant-partitioned replay protection across server restarts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  IWebhookReplayStore,
  ReplayClaimResult,
  ReplayRecord,
} from './replay-store.interface.js';

export interface FileWebhookReplayStoreOptions {
  readonly storageDir?: string;
  readonly defaultRetentionMs?: number;
}

export class FileWebhookReplayStore implements IWebhookReplayStore {
  private readonly storageDir: string;
  private readonly defaultRetentionMs: number;
  private readonly memoryCache = new Map<string, ReplayRecord>();

  constructor(options?: FileWebhookReplayStoreOptions) {
    this.storageDir = options?.storageDir ?? path.resolve('.agentproof/data/replay');
    this.defaultRetentionMs = options?.defaultRetentionMs ?? 86400000; // 24 hours

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    this.loadAllFromDisk();
  }

  public async claimEvent(
    tenantId: string,
    sourceId: string,
    eventId: string,
    payloadDigest: string,
    eventTimestamp: string,
    retentionMs: number = this.defaultRetentionMs
  ): Promise<ReplayClaimResult> {
    const key = `${tenantId}:${sourceId}:${eventId}`;
    const now = Date.now();
    const existing = this.memoryCache.get(key);

    if (existing) {
      const expiresAtMs = new Date(existing.expiresAt).getTime();
      // If record expired, allow reclaim
      if (expiresAtMs <= now) {
        this.memoryCache.delete(key);
      } else {
        // Active replay record exists
        if (existing.payloadDigest === payloadDigest) {
          return {
            status: 'DUPLICATE_IDENTICAL',
            record: existing,
            isAllowed: true, // Same payload, idempotent delivery
          };
        } else {
          return {
            status: 'DUPLICATE_CONFLICT',
            record: existing,
            isAllowed: false, // Security violation: duplicate ID with altered payload!
          };
        }
      }
    }

    // New event claim
    const claimedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + retentionMs).toISOString();

    const newRecord: ReplayRecord = {
      tenantId,
      sourceId,
      eventId,
      payloadDigest,
      eventTimestamp,
      claimedAt,
      expiresAt,
    };

    this.memoryCache.set(key, newRecord);
    this.persistSourceRecords(tenantId, sourceId);

    return {
      status: 'FIRST_SEEN',
      record: newRecord,
      isAllowed: true,
    };
  }

  public async hasEvent(tenantId: string, sourceId: string, eventId: string): Promise<boolean> {
    const key = `${tenantId}:${sourceId}:${eventId}`;
    const existing = this.memoryCache.get(key);
    if (!existing) return false;
    const expiresAtMs = new Date(existing.expiresAt).getTime();
    if (expiresAtMs <= Date.now()) {
      this.memoryCache.delete(key);
      return false;
    }
    return true;
  }

  public async purgeExpired(nowMs: number = Date.now()): Promise<number> {
    let purged = 0;
    const sourcesToPersist = new Set<string>();

    for (const [key, record] of this.memoryCache.entries()) {
      const expiresAtMs = new Date(record.expiresAt).getTime();
      if (expiresAtMs <= nowMs) {
        this.memoryCache.delete(key);
        sourcesToPersist.add(`${record.tenantId}:${record.sourceId}`);
        purged++;
      }
    }

    for (const sourceKey of sourcesToPersist) {
      const [tenantId, sourceId] = sourceKey.split(':');
      this.persistSourceRecords(tenantId, sourceId);
    }

    return purged;
  }

  public async clear(): Promise<void> {
    this.memoryCache.clear();
    if (fs.existsSync(this.storageDir)) {
      fs.rmSync(this.storageDir, { recursive: true, force: true });
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private persistSourceRecords(tenantId: string, sourceId: string): void {
    const tenantDir = path.join(this.storageDir, this.sanitize(tenantId));
    if (!fs.existsSync(tenantDir)) {
      fs.mkdirSync(tenantDir, { recursive: true });
    }

    const filePath = path.join(tenantDir, `${this.sanitize(sourceId)}.json`);
    const tempPath = `${filePath}.tmp.${Date.now()}`;

    // Collect all records for this tenant & source
    const records: ReplayRecord[] = [];
    for (const record of this.memoryCache.values()) {
      if (record.tenantId === tenantId && record.sourceId === sourceId) {
        records.push(record);
      }
    }

    // Atomic write via temp file
    fs.writeFileSync(tempPath, JSON.stringify(records, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  }

  private loadAllFromDisk(): void {
    if (!fs.existsSync(this.storageDir)) return;

    try {
      const tenants = fs.readdirSync(this.storageDir);
      for (const tenant of tenants) {
        const tenantDir = path.join(this.storageDir, tenant);
        if (fs.statSync(tenantDir).isDirectory()) {
          const files = fs.readdirSync(tenantDir);
          for (const file of files) {
            if (file.endsWith('.json') && !file.includes('.tmp')) {
              const fullPath = path.join(tenantDir, file);
              const content = fs.readFileSync(fullPath, 'utf8');
              const records = JSON.parse(content) as ReplayRecord[];
              for (const r of records) {
                const key = `${r.tenantId}:${r.sourceId}:${r.eventId}`;
                this.memoryCache.set(key, r);
              }
            }
          }
        }
      }
    } catch {
      // Ignore recovery read errors on clean directories
    }
  }

  public async claim(
    tenantId: string,
    sourceId: string,
    eventId: string,
    payloadDigest: string,
    eventTimestamp: string,
    retentionMs: number = this.defaultRetentionMs
  ): Promise<ReplayClaimResult> {
    return this.claimEvent(tenantId, sourceId, eventId, payloadDigest, eventTimestamp, retentionMs);
  }

  private sanitize(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}

export class InMemoryWebhookReplayStore implements IWebhookReplayStore {
  private readonly memoryCache = new Map<string, ReplayRecord>();
  private readonly defaultRetentionMs: number;

  constructor(defaultRetentionMs: number = 86400000) {
    this.defaultRetentionMs = defaultRetentionMs;
  }

  public async claimEvent(
    tenantId: string,
    sourceId: string,
    eventId: string,
    payloadDigest: string,
    eventTimestamp: string,
    retentionMs: number = this.defaultRetentionMs
  ): Promise<ReplayClaimResult> {
    const key = `${tenantId}:${sourceId}:${eventId}`;
    const now = Date.now();
    const existing = this.memoryCache.get(key);

    if (existing) {
      const expiresAtMs = new Date(existing.expiresAt).getTime();
      if (expiresAtMs <= now) {
        this.memoryCache.delete(key);
      } else {
        if (existing.payloadDigest === payloadDigest) {
          return {
            status: 'DUPLICATE_IDENTICAL',
            record: existing,
            isAllowed: true,
          };
        } else {
          return {
            status: 'DUPLICATE_CONFLICT',
            record: existing,
            isAllowed: false,
          };
        }
      }
    }

    const claimedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + retentionMs).toISOString();

    const newRecord: ReplayRecord = {
      tenantId,
      sourceId,
      eventId,
      payloadDigest,
      eventTimestamp,
      claimedAt,
      expiresAt,
    };

    this.memoryCache.set(key, newRecord);
    return {
      status: 'FIRST_SEEN',
      record: newRecord,
      isAllowed: true,
    };
  }

  public async claim(
    tenantId: string,
    sourceId: string,
    eventId: string,
    payloadDigest: string,
    eventTimestamp: string,
    retentionMs: number = this.defaultRetentionMs
  ): Promise<ReplayClaimResult> {
    return this.claimEvent(tenantId, sourceId, eventId, payloadDigest, eventTimestamp, retentionMs);
  }

  public async hasEvent(tenantId: string, sourceId: string, eventId: string): Promise<boolean> {
    const key = `${tenantId}:${sourceId}:${eventId}`;
    const record = this.memoryCache.get(key);
    if (!record) return false;
    return new Date(record.expiresAt).getTime() > Date.now();
  }

  public async purgeExpired(nowMs: number = Date.now()): Promise<number> {
    let purged = 0;
    for (const [key, record] of this.memoryCache.entries()) {
      if (new Date(record.expiresAt).getTime() <= nowMs) {
        this.memoryCache.delete(key);
        purged++;
      }
    }
    return purged;
  }

  public async clear(): Promise<void> {
    this.memoryCache.clear();
  }
}
