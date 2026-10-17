/**
 * AgentProof Persistence — File Trace Repository
 * 
 * Provides durable, crash-safe, tenant-partitioned verification trace storage
 * across server restarts.
 * 
 * Guarantees:
 * 1. Durability across restarts: files persist in partitioned tenant directories.
 * 2. Atomic writes: writes via write-ahead temp files and atomic rename to prevent partial writes.
 * 3. Integrity verification: each stored trace envelope contains a SHA-256 checksum.
 * 4. Write-once immutability: rejects duplicate traceId submissions with DuplicateTraceError.
 * 5. Tenant isolation: tenant records are physically partitioned into separate subdirectories.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { VerificationTrace } from '../core/index.js';
import { ITraceRepository, TraceListOptions } from './trace-repository.interface.js';
import { DuplicateTraceError, CorruptedRecordError } from '../security/errors.js';

export interface FileTraceRepositoryOptions {
  readonly storageDir?: string;
  readonly autoInitialize?: boolean;
}

interface StoredTraceEnvelope {
  readonly schemaVersion: string;
  readonly traceId: string;
  readonly tenantId: string;
  readonly storedAt: string;
  readonly checksum: string;
  readonly trace: VerificationTrace;
}

export class FileTraceRepository implements ITraceRepository {
  public static readonly CURRENT_SCHEMA_VERSION = '1.0.0';
  private readonly storageDir: string;
  private readonly tenantsDir: string;
  private isClosed: boolean = false;

  constructor(options?: FileTraceRepositoryOptions) {
    this.storageDir = options?.storageDir ?? process.env.AGENTPROOF_STORAGE_DIR ?? path.resolve('.agentproof/data/traces');
    this.tenantsDir = path.join(this.storageDir, 'tenants');

    if (options?.autoInitialize !== false) {
      this.initialize();
    }
  }

  /**
   * Initializes the repository storage layout if not already present.
   * Safe to call multiple times across server restarts.
   */
  public initialize(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    if (!fs.existsSync(this.tenantsDir)) {
      fs.mkdirSync(this.tenantsDir, { recursive: true });
    }

    const metadataPath = path.join(this.storageDir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      const metadata = {
        schemaVersion: FileTraceRepository.CURRENT_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        engine: 'AgentProof-FileTraceRepository',
      };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    }
  }

  private sanitizeIdentifier(id: string, name: string): string {
    if (!id || typeof id !== 'string') {
      throw new Error(`Invalid ${name}: must be a non-empty string.`);
    }
    const trimmed = id.trim();
    if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\') || path.basename(trimmed) !== trimmed) {
      throw new Error(`Security validation error: ${name} [${id}] contains invalid path traversal characters.`);
    }
    return trimmed;
  }

  private getTenantDir(tenantId: string): string {
    const safeTenantId = this.sanitizeIdentifier(tenantId, 'tenantId');
    const tenantDir = path.join(this.tenantsDir, safeTenantId);
    if (!fs.existsSync(tenantDir)) {
      fs.mkdirSync(tenantDir, { recursive: true });
    }
    return tenantDir;
  }

  private getTraceFilePath(tenantId: string, traceId: string): string {
    const tenantDir = this.getTenantDir(tenantId);
    const safeTraceId = this.sanitizeIdentifier(traceId, 'traceId');
    return path.join(tenantDir, `${safeTraceId}.json`);
  }

  private computeChecksum(data: unknown): string {
    const str = JSON.stringify(data);
    return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
  }

  public async save(trace: VerificationTrace, tenantId?: string): Promise<void> {
    if (this.isClosed) {
      throw new Error('Repository is closed.');
    }
    if (!trace || !trace.traceId) {
      throw new Error('Cannot store trace: traceId is required.');
    }

    const effectiveTenant = tenantId ?? trace.request?.target?.tenantId ?? '_global';
    const targetFile = this.getTraceFilePath(effectiveTenant, trace.traceId);

    // 1. Enforce write-once immutability
    if (fs.existsSync(targetFile)) {
      throw new DuplicateTraceError(trace.traceId);
    }

    // 2. Prepare envelope with SHA-256 integrity checksum
    const snapshot: VerificationTrace = JSON.parse(JSON.stringify(trace));
    const checksum = this.computeChecksum(snapshot);

    const envelope: StoredTraceEnvelope = {
      schemaVersion: FileTraceRepository.CURRENT_SCHEMA_VERSION,
      traceId: trace.traceId,
      tenantId: effectiveTenant,
      storedAt: new Date().toISOString(),
      checksum,
      trace: snapshot,
    };

    // 3. Atomic write-ahead temp file + rename
    const tempFile = path.join(
      this.getTenantDir(effectiveTenant),
      `.tmp-${trace.traceId}-${crypto.randomUUID().slice(0, 8)}`
    );

    try {
      fs.writeFileSync(tempFile, JSON.stringify(envelope, null, 2), 'utf8');
      fs.renameSync(tempFile, targetFile);
    } catch (err) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch {}
      throw err;
    }
  }

  public async saveForTenant(tenantId: string, trace: VerificationTrace): Promise<void> {
    return this.save(trace, tenantId);
  }

  public async getByTenantAndId(tenantId: string, traceId: string): Promise<VerificationTrace | null> {
    if (this.isClosed) {
      throw new Error('Repository is closed.');
    }
    const safeTenant = this.sanitizeIdentifier(tenantId, 'tenantId');
    const safeTrace = this.sanitizeIdentifier(traceId, 'traceId');
    const filePath = path.join(this.tenantsDir, safeTenant, `${safeTrace}.json`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }

    let parsed: StoredTraceEnvelope;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new CorruptedRecordError(traceId, 'JSON parse failure in stored trace file.');
    }

    // Verify record integrity checksum
    const computed = this.computeChecksum(parsed.trace);
    if (computed !== parsed.checksum) {
      throw new CorruptedRecordError(traceId, `Checksum mismatch: expected [${parsed.checksum}] but calculated [${computed}].`);
    }

    return parsed.trace;
  }

  public async getById(traceId: string, tenantId?: string): Promise<VerificationTrace | null> {
    if (this.isClosed) {
      throw new Error('Repository is closed.');
    }
    const safeTraceId = this.sanitizeIdentifier(traceId, 'traceId');

    if (tenantId) {
      return this.getByTenantAndId(tenantId, traceId);
    }

    // If tenantId omitted, search partitioned tenant directories
    if (!fs.existsSync(this.tenantsDir)) {
      return null;
    }

    const tenantFolders = fs.readdirSync(this.tenantsDir);
    for (const folder of tenantFolders) {
      const candidatePath = path.join(this.tenantsDir, folder, `${safeTraceId}.json`);
      if (fs.existsSync(candidatePath)) {
        return this.getByTenantAndId(folder, traceId);
      }
    }

    return null;
  }

  public async listByTenant(tenantId: string, options?: TraceListOptions): Promise<readonly VerificationTrace[]> {
    if (this.isClosed) {
      throw new Error('Repository is closed.');
    }
    const safeTenant = this.sanitizeIdentifier(tenantId, 'tenantId');
    const tenantDir = path.join(this.tenantsDir, safeTenant);

    if (!fs.existsSync(tenantDir)) {
      return Object.freeze([]);
    }

    const files = fs.readdirSync(tenantDir).filter((f) => f.endsWith('.json') && !f.startsWith('.tmp'));
    const traces: VerificationTrace[] = [];

    for (const file of files) {
      const traceId = path.basename(file, '.json');
      const trace = await this.getByTenantAndId(tenantId, traceId);
      if (trace) {
        if (!options?.verdict || trace.result?.overallVerdict === options.verdict) {
          traces.push(trace);
        }
      }
    }

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? traces.length;
    return Object.freeze(traces.slice(offset, offset + limit));
  }

  public async has(traceId: string, tenantId?: string): Promise<boolean> {
    if (this.isClosed) {
      throw new Error('Repository is closed.');
    }
    const safeTraceId = this.sanitizeIdentifier(traceId, 'traceId');

    if (tenantId) {
      const safeTenant = this.sanitizeIdentifier(tenantId, 'tenantId');
      return fs.existsSync(path.join(this.tenantsDir, safeTenant, `${safeTraceId}.json`));
    }

    return (await this.getById(traceId)) !== null;
  }

  public async count(tenantId?: string): Promise<number> {
    if (this.isClosed) {
      throw new Error('Repository is closed.');
    }
    if (tenantId) {
      const safeTenant = this.sanitizeIdentifier(tenantId, 'tenantId');
      const tenantDir = path.join(this.tenantsDir, safeTenant);
      if (!fs.existsSync(tenantDir)) return 0;
      return fs.readdirSync(tenantDir).filter((f) => f.endsWith('.json') && !f.startsWith('.tmp')).length;
    }

    if (!fs.existsSync(this.tenantsDir)) return 0;
    let total = 0;
    const tenantFolders = fs.readdirSync(this.tenantsDir);
    for (const folder of tenantFolders) {
      const folderPath = path.join(this.tenantsDir, folder);
      if (fs.statSync(folderPath).isDirectory()) {
        total += fs.readdirSync(folderPath).filter((f) => f.endsWith('.json') && !f.startsWith('.tmp')).length;
      }
    }
    return total;
  }

  public async clear(): Promise<void> {
    if (fs.existsSync(this.tenantsDir)) {
      fs.rmSync(this.tenantsDir, { recursive: true, force: true });
      fs.mkdirSync(this.tenantsDir, { recursive: true });
    }
  }

  public async close(): Promise<void> {
    this.isClosed = true;
  }
}
