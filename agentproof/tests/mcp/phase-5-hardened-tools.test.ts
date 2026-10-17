/**
 * AgentProof Phase 5 Test Suite — Hardened MCP Tools End-to-End
 * 
 * Verifies that the four MCP tools enforce trusted identity, authorization,
 * tenant isolation, durable persistence, evidence trust, and resource bounds.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { VerificationTools } from '../../src/modules/verification/verification.tools.js';
import { FileTraceRepository } from '../../src/persistence/index.js';
import {
  StaticIdentityProvider,
  Permissions,
  AuthorizationError,
  TenantAccessDeniedError,
  TraceNotFoundError,
} from '../../src/security/index.js';

describe('Hardened MCP Tools — Phase 5 Security & Persistence', () => {
  let tempDir: string;
  let fileRepo: FileTraceRepository;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentproof-test-mcp-phase5-'));
    fileRepo = new FileTraceRepository({ storageDir: tempDir });
  });

  afterEach(async () => {
    await fileRepo.close();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('Identity & Authorization Enforcement at Tool Boundaries', () => {
    it('denies verifyOutcome to principal lacking VERIFY_EXECUTE permission', async () => {
      // Principal with only TRACE_READ permission
      const readonlyIdentity = new StaticIdentityProvider({
        principalId: 'auditor-1',
        tenantId: 'tenant-secure',
        principalType: 'USER',
        permissions: [Permissions.TRACE_READ],
        authMethod: 'API_KEY',
      });

      const controller = new VerificationTools({
        identityProvider: readonlyIdentity,
        traceRepository: fileRepo,
      });

      const input = {
        tenantId: 'tenant-secure',
        target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-1', tenantId: 'tenant-secure' },
        intent: { operation: 'cancel', summary: 'cancel', expectedChanges: {} },
        postconditions: [
          { id: 'p1', description: 'test', path: 'status', operator: 'EQUALS' as const, expectedValue: 'CANCELLED' },
        ],
        evidence: [
          {
            sourceId: 'db',
            target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-1', tenantId: 'tenant-secure' },
            observedPayload: { status: 'CANCELLED' },
          },
        ],
      };

      await expect(controller.verifyOutcome(input)).rejects.toThrow(AuthorizationError);
    });

    it('denies verifyOutcome when caller requests resource scope outside authorized tenant', async () => {
      // Principal authorized only for tenant-alpha
      const tenantAlphaIdentity = new StaticIdentityProvider({
        principalId: 'agent-alpha',
        tenantId: 'tenant-alpha',
        principalType: 'AGENT',
        permissions: [Permissions.VERIFY_EXECUTE, Permissions.TRACE_READ],
        authMethod: 'TOKEN',
      });

      const controller = new VerificationTools({
        identityProvider: tenantAlphaIdentity,
        traceRepository: fileRepo,
      });

      // Caller attempts to execute verification on tenant-beta
      const spoofedInput = {
        tenantId: 'tenant-beta', // Spoofed scope!
        target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-1', tenantId: 'tenant-beta' },
        intent: { operation: 'cancel', summary: 'cancel', expectedChanges: {} },
        postconditions: [
          { id: 'p1', description: 'test', path: 'status', operator: 'EQUALS' as const, expectedValue: 'CANCELLED' },
        ],
        evidence: [],
      };

      await expect(controller.verifyOutcome(spoofedInput)).rejects.toThrow(TenantAccessDeniedError);
    });

    it('denies inspectTrace for a foreign tenant without revealing trace existence', async () => {
      // 1. Controller for Tenant A executes a verification and saves trace
      const tenantAController = new VerificationTools({
        identityProvider: new StaticIdentityProvider({
          principalId: 'agent-A',
          tenantId: 'tenant-A',
          principalType: 'AGENT',
          permissions: ['*'],
          authMethod: 'TOKEN',
        }),
        traceRepository: fileRepo,
      });

      const verifyResult = await tenantAController.verifyOutcome({
        tenantId: 'tenant-A',
        target: { system: 'crm', resourceType: 'account', resourceId: 'acc-1', tenantId: 'tenant-A' },
        intent: { operation: 'activate', summary: 'activate', expectedChanges: { status: 'ACTIVE' } },
        postconditions: [
          { id: 'p1', description: 'active', path: 'status', operator: 'EQUALS' as const, expectedValue: 'ACTIVE' },
        ],
        evidence: [
          {
            sourceId: 'crm-db',
            target: { system: 'crm', resourceType: 'account', resourceId: 'acc-1', tenantId: 'tenant-A' },
            observedPayload: { status: 'ACTIVE' },
          },
        ],
      });

      const traceIdA = verifyResult.traceId;

      // 2. Tenant B principal attempts to inspect Tenant A's trace
      const tenantBController = new VerificationTools({
        identityProvider: new StaticIdentityProvider({
          principalId: 'agent-B',
          tenantId: 'tenant-B',
          principalType: 'AGENT',
          permissions: [Permissions.TRACE_READ],
          authMethod: 'TOKEN',
        }),
        traceRepository: fileRepo,
      });

      // Must be rejected: Trace not found or access denied without leaking Tenant A contents
      await expect(
        tenantBController.inspectTrace({ traceId: traceIdA, tenantId: 'tenant-B' })
      ).rejects.toThrow(TraceNotFoundError);
    });
  });

  describe('Durable Trace Persistence Across Tools', () => {
    it('persists verification trace durably to disk and survives reopen', async () => {
      const controller = new VerificationTools({
        traceRepository: fileRepo,
      });

      const result = await controller.verifyOutcome({
        tenantId: 'tenant-audit-durable',
        target: { system: 'ledger', resourceType: 'tx', resourceId: 'tx-100', tenantId: 'tenant-audit-durable' },
        intent: { operation: 'post', summary: 'post tx', expectedChanges: { posted: true } },
        postconditions: [
          { id: 'p1', description: 'posted check', path: 'posted', operator: 'EQUALS' as const, expectedValue: true },
        ],
        evidence: [
          {
            sourceId: 'ledger-reader',
            target: { system: 'ledger', resourceType: 'tx', resourceId: 'tx-100', tenantId: 'tenant-audit-durable' },
            observedPayload: { posted: true },
          },
        ],
      });

      expect(result.status).toBe('success');
      expect(result.overallVerdict).toBe('PASS');

      // Close repository and reopen new instance
      await fileRepo.close();

      const reopenedRepo = new FileTraceRepository({ storageDir: tempDir });
      const newController = new VerificationTools({
        traceRepository: reopenedRepo,
      });

      const inspected = await newController.inspectTrace({
        traceId: result.traceId,
        tenantId: 'tenant-audit-durable',
      });

      expect(inspected.status).toBe('success');
      expect(inspected.traceId).toBe(result.traceId);
      expect(inspected.result.overallVerdict).toBe('PASS');

      await reopenedRepo.close();
    });
  });

  describe('Evidence Trust & Input Resource Limits', () => {
    it('rejects verification requests exceeding maximum postconditions bound', async () => {
      const controller = new VerificationTools({ traceRepository: fileRepo });

      // Create 51 postconditions (limit is 50)
      const postconditions = Array.from({ length: 51 }, (_, i) => ({
        id: `post-${i}`,
        description: `Condition ${i}`,
        path: `field_${i}`,
        operator: 'EQUALS' as const,
        expectedValue: 'ok',
      }));

      await expect(
        controller.verifyOutcome({
          target: { system: 'sys', resourceType: 'res', resourceId: '1' },
          intent: { operation: 'op', summary: 'op', expectedChanges: {} },
          postconditions,
          evidence: [],
        })
      ).rejects.toThrow();
    });

    it('rejects verification requests exceeding maximum evidence items bound', async () => {
      const controller = new VerificationTools({ traceRepository: fileRepo });

      // Create 101 evidence items (limit is 100)
      const evidence = Array.from({ length: 101 }, (_, i) => ({
        sourceId: 'db',
        target: { system: 'sys', resourceType: 'res', resourceId: '1' },
        observedPayload: { val: i },
      }));

      await expect(
        controller.verifyOutcome({
          target: { system: 'sys', resourceType: 'res', resourceId: '1' },
          intent: { operation: 'op', summary: 'op', expectedChanges: {} },
          postconditions: [
            { id: 'p1', description: 'check', path: 'val', operator: 'EQUALS' as const, expectedValue: 1 },
          ],
          evidence,
        })
      ).rejects.toThrow();
    });
  });
});
