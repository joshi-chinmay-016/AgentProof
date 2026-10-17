/**
 * AgentProof Streaming & Webhooks — Signed Audit Checkpoint Manager
 * 
 * Creates and cryptographically verifies RSA-SHA256 signed checkpoints of
 * audit chain heads.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AuditCheckpoint,
  AuditCheckpointSchema,
} from '../contracts/audit.interface.js';
import { AuditCanonicalizer } from './audit-canonicalizer.js';

export class AuditCheckpointManager {
  private readonly baseDir: string;
  private initialized = false;

  constructor(baseDir: string = path.join(process.cwd(), '.agentproof', 'data', 'audit')) {
    this.baseDir = path.resolve(baseDir);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.baseDir, { recursive: true });
    this.initialized = true;
  }

  private getCheckpointsDir(tenantId: string): string {
    const safeTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.baseDir, safeTenant, 'checkpoints');
  }

  /**
   * Signs an audit checkpoint using an RSA private key.
   */
  public static signCheckpoint(
    tenantId: string,
    sequenceNumber: number,
    chainDigest: string,
    keyId: string,
    privateKeyPem: string,
    checkpointId?: string
  ): AuditCheckpoint {
    const id = checkpointId ?? `chk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = new Date().toISOString();

    const unsigned: Omit<AuditCheckpoint, 'signature'> = {
      schemaVersion: '1.0.0',
      checkpointId: id,
      tenantId,
      sequenceNumber,
      chainDigest,
      timestamp,
      keyId,
      signatureAlgorithm: 'RSA-SHA256',
    };

    const canonical = AuditCanonicalizer.canonicalizeCheckpoint(unsigned);
    const signer = crypto.createSign('SHA256');
    signer.update(canonical, 'utf8');
    signer.end();

    const signature = signer.sign(privateKeyPem, 'base64');

    const checkpoint: AuditCheckpoint = {
      ...unsigned,
      signature,
    };

    return AuditCheckpointSchema.parse(checkpoint);
  }

  /**
   * Cryptographically verifies an audit checkpoint's signature against an RSA public key.
   */
  public static verifyCheckpoint(
    checkpoint: AuditCheckpoint,
    publicKeyPem: string
  ): boolean {
    try {
      const parsed = AuditCheckpointSchema.safeParse(checkpoint);
      if (!parsed.success) {
        return false;
      }

      if (checkpoint.signatureAlgorithm !== 'RSA-SHA256') {
        return false;
      }

      const unsigned: Omit<AuditCheckpoint, 'signature'> = {
        schemaVersion: checkpoint.schemaVersion,
        checkpointId: checkpoint.checkpointId,
        tenantId: checkpoint.tenantId,
        sequenceNumber: checkpoint.sequenceNumber,
        chainDigest: checkpoint.chainDigest,
        timestamp: checkpoint.timestamp,
        keyId: checkpoint.keyId,
        signatureAlgorithm: checkpoint.signatureAlgorithm,
      };

      const canonical = AuditCanonicalizer.canonicalizeCheckpoint(unsigned);
      const verifier = crypto.createVerify('SHA256');
      verifier.update(canonical, 'utf8');
      verifier.end();

      return verifier.verify(publicKeyPem, checkpoint.signature, 'base64');
    } catch {
      return false;
    }
  }

  /**
   * Saves a checkpoint to disk.
   */
  async saveCheckpoint(checkpoint: AuditCheckpoint): Promise<void> {
    await this.ensureInitialized();
    const dir = this.getCheckpointsDir(checkpoint.tenantId);
    await fs.mkdir(dir, { recursive: true });

    const safeId = checkpoint.checkpointId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(dir, `${safeId}.json`);
    const tempPath = `${filePath}.${Date.now()}.tmp`;

    await fs.writeFile(tempPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);
  }

  /**
   * Loads all checkpoints for a tenant.
   */
  async getCheckpoints(tenantId: string): Promise<AuditCheckpoint[]> {
    await this.ensureInitialized();
    const dir = this.getCheckpointsDir(tenantId);
    try {
      const files = await fs.readdir(dir);
      const checkpoints: AuditCheckpoint[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const content = await fs.readFile(path.join(dir, file), 'utf-8');
        checkpoints.push(JSON.parse(content) as AuditCheckpoint);
      }
      return checkpoints.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }
}
