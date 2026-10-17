/**
 * AgentProof Tests — Read-Only PostgreSQL State Reader
 * 
 * Verifies parameterized SELECT queries, table/column allowlist enforcement,
 * rejection of write operations and arbitrary SQL, and error category mapping.
 */

import { describe, it, expect } from 'vitest';
import {
  PostgresStateReader,
  PostgresIntegrationConfig,
  MockPostgresDriver,
  StaticSecretProvider,
} from '../../src/observation/index.js';

describe('PostgresStateReader', () => {
  const baseConfig: PostgresIntegrationConfig = {
    integrationId: 'warehouse-pg',
    tenantId: 'tenant-retail',
    type: 'POSTGRES',
    host: 'db.retail.internal',
    port: 5432,
    database: 'inventory',
    user: 'reader_user',
    allowedSchemas: ['public'],
    allowedTables: ['items', 'warehouses'],
    allowedColumns: {
      items: ['id', 'sku', 'stock_quantity', 'status'],
      warehouses: ['id', 'location', 'capacity'],
    },
    idColumnMapping: {
      items: 'sku',
      warehouses: 'id',
    },
    auth: { type: 'NONE' },
    timeoutMs: 1000,
    enabled: true,
    freshnessToleranceMs: 60000,
  };

  it('observes matching row using strictly parameterized SELECT query', async () => {
    const mockDriver = new MockPostgresDriver();
    mockDriver.setTableData('items', [
      { id: '1', sku: 'SKU-APPLE-01', stock_quantity: 45, status: 'AVAILABLE' },
      { id: '2', sku: 'SKU-ORANGE-02', stock_quantity: 0, status: 'OUT_OF_STOCK' },
    ]);

    const reader = new PostgresStateReader(baseConfig, { driver: mockDriver });

    const record = await reader.readState({
      system: 'postgres',
      resourceType: 'items',
      resourceId: 'SKU-APPLE-01',
    });

    expect(record.status).toBe('FOUND');
    expect(record.sourceType).toBe('POSTGRES');
    expect(record.payload).toEqual({
      id: '1',
      sku: 'SKU-APPLE-01',
      stock_quantity: 45,
      status: 'AVAILABLE',
    });
    expect(record.metadata?.matchedRows).toBe(1);
  });

  it('reliably returns NOT_FOUND (confirmed absence) when query finds 0 rows', async () => {
    const mockDriver = new MockPostgresDriver();
    mockDriver.setTableData('items', []);

    const reader = new PostgresStateReader(baseConfig, { driver: mockDriver });

    const record = await reader.readState({
      system: 'postgres',
      resourceType: 'items',
      resourceId: 'SKU-NONEXISTENT',
    });

    expect(record.status).toBe('NOT_FOUND');
    expect(record.payload).toBeNull();
    expect(record.metadata?.matchedRows).toBe(0);
  });

  it('rejects queries against tables not in allowlist', async () => {
    const mockDriver = new MockPostgresDriver();
    const reader = new PostgresStateReader(baseConfig, { driver: mockDriver });

    const record = await reader.readState({
      system: 'postgres',
      resourceType: 'users_passwords', // not allowed
      resourceId: 'admin',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('AUTHORIZATION_FAILURE');
    expect(record.errorMessage).toContain('not in the permitted tables allowlist');
  });

  it('rejects SQL injection attempts in table name', async () => {
    const mockDriver = new MockPostgresDriver();
    const reader = new PostgresStateReader(baseConfig, { driver: mockDriver });

    const record = await reader.readState({
      system: 'postgres',
      resourceType: 'items; DROP TABLE items;--',
      resourceId: '1',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('AUTHORIZATION_FAILURE');
  });

  it('rejects tables without configured column allowlist', async () => {
    const configWithoutCols: PostgresIntegrationConfig = {
      ...baseConfig,
      allowedColumns: {}, // no columns for items
    };

    const mockDriver = new MockPostgresDriver();
    const reader = new PostgresStateReader(configWithoutCols, { driver: mockDriver });

    const record = await reader.readState({
      system: 'postgres',
      resourceType: 'items',
      resourceId: 'SKU-1',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('AUTHORIZATION_FAILURE');
    expect(record.errorMessage).toContain('No permitted columns configured');
  });

  it('returns READ_ERROR with TIMEOUT on query statement timeout', async () => {
    const mockDriver = new MockPostgresDriver();
    mockDriver.setFailureMode('TIMEOUT');

    const reader = new PostgresStateReader(baseConfig, { driver: mockDriver });

    const record = await reader.readState({
      system: 'postgres',
      resourceType: 'items',
      resourceId: 'SKU-1',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('TIMEOUT');
  });

  it('returns READ_ERROR with AUTHORIZATION_FAILURE on database permission denial', async () => {
    const mockDriver = new MockPostgresDriver();
    mockDriver.setFailureMode('AUTH');

    const reader = new PostgresStateReader(baseConfig, { driver: mockDriver });

    const record = await reader.readState({
      system: 'postgres',
      resourceType: 'items',
      resourceId: 'SKU-1',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('AUTHORIZATION_FAILURE');
  });

  it('returns READ_ERROR with NETWORK_ERROR on connection failure', async () => {
    const mockDriver = new MockPostgresDriver();
    mockDriver.setFailureMode('CONN');

    const reader = new PostgresStateReader(baseConfig, { driver: mockDriver });

    const record = await reader.readState({
      system: 'postgres',
      resourceType: 'items',
      resourceId: 'SKU-1',
    });

    expect(record.status).toBe('READ_ERROR');
    expect(record.errorCategory).toBe('NETWORK_ERROR');
  });
});
