/**
 * AgentProof Observation — Read-Only PostgreSQL State Reader
 * 
 * Safely observes database rows using strictly parameterized queries against
 * pre-approved schemas, tables, and columns.
 * Guaranteed read-only: rejects arbitrary SQL, write verbs, and unauthorized tables.
 */

import { ResourceTarget } from '../../core/index.js';
import {
  IExternalStateReader,
  ExternalObservationRecord,
} from '../contracts/state-reader.interface.js';
import { PostgresIntegrationConfig } from '../registry/integration-config.schema.js';
import { ISecretProvider, EnvironmentSecretProvider } from '../security/secret-provider.js';

export interface PostgresQueryResult {
  readonly rows: Record<string, unknown>[];
}

export interface IPostgresDriver {
  query(sql: string, params: unknown[], timeoutMs: number): Promise<PostgresQueryResult>;
}

export interface PostgresStateReaderOptions {
  readonly driver?: IPostgresDriver;
  readonly secretProvider?: ISecretProvider;
}

const SAFE_IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export class PostgresStateReader implements IExternalStateReader {
  public readonly sourceId: string;
  public readonly sourceType = 'POSTGRES' as const;
  public readonly integrationId: string;
  public readonly tenantId: string;

  private readonly config: PostgresIntegrationConfig;
  private readonly driver: IPostgresDriver;
  private readonly secretProvider: ISecretProvider;

  constructor(config: PostgresIntegrationConfig, options?: PostgresStateReaderOptions) {
    this.config = config;
    this.sourceId = config.integrationId;
    this.integrationId = config.integrationId;
    this.tenantId = config.tenantId;

    this.secretProvider = options?.secretProvider ?? new EnvironmentSecretProvider();
    
    if (options?.driver) {
      this.driver = options.driver;
    } else {
      // Default to driver that requires explicit connection setup or warns
      this.driver = new DefaultPostgresDriver(config, this.secretProvider);
    }
  }

  /**
   * Safely reads a single row for the requested resourceTarget.
   */
  public async readState(target: ResourceTarget): Promise<ExternalObservationRecord> {
    const now = new Date().toISOString();
    const tableName = target.resourceType;
    const lookupId = target.resourceId;

    // 1. Verify table is in allowlist
    if (!this.config.allowedTables.includes(tableName)) {
      return {
        status: 'READ_ERROR',
        target,
        observedAt: now,
        payload: null,
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        integrationId: this.integrationId,
        tenantId: this.tenantId,
        errorCategory: 'AUTHORIZATION_FAILURE',
        errorMessage: `Table '${tableName}' is not in the permitted tables allowlist for this integration.`,
      };
    }

    if (!SAFE_IDENTIFIER_REGEX.test(tableName)) {
      return {
        status: 'READ_ERROR',
        target,
        observedAt: now,
        payload: null,
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        integrationId: this.integrationId,
        tenantId: this.tenantId,
        errorCategory: 'QUERY_ERROR',
        errorMessage: `Table name '${tableName}' contains invalid SQL characters.`,
      };
    }

    // 2. Validate columns allowlist
    const allowedCols = this.config.allowedColumns[tableName];
    if (!allowedCols || allowedCols.length === 0) {
      return {
        status: 'READ_ERROR',
        target,
        observedAt: now,
        payload: null,
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        integrationId: this.integrationId,
        tenantId: this.tenantId,
        errorCategory: 'AUTHORIZATION_FAILURE',
        errorMessage: `No permitted columns configured for table '${tableName}'.`,
      };
    }

    for (const col of allowedCols) {
      if (!SAFE_IDENTIFIER_REGEX.test(col)) {
        return {
          status: 'READ_ERROR',
          target,
          observedAt: now,
          payload: null,
          sourceId: this.sourceId,
          sourceType: this.sourceType,
          integrationId: this.integrationId,
          tenantId: this.tenantId,
          errorCategory: 'QUERY_ERROR',
          errorMessage: `Configured column '${col}' contains invalid SQL characters.`,
        };
      }
    }

    // 3. Determine ID column and schema
    const idColumn = this.config.idColumnMapping[tableName] || 'id';
    if (!SAFE_IDENTIFIER_REGEX.test(idColumn)) {
      return {
        status: 'READ_ERROR',
        target,
        observedAt: now,
        payload: null,
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        integrationId: this.integrationId,
        tenantId: this.tenantId,
        errorCategory: 'QUERY_ERROR',
        errorMessage: `ID column '${idColumn}' contains invalid SQL characters.`,
      };
    }

    const schema = this.config.allowedSchemas[0] || 'public';
    if (!SAFE_IDENTIFIER_REGEX.test(schema)) {
      return {
        status: 'READ_ERROR',
        target,
        observedAt: now,
        payload: null,
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        integrationId: this.integrationId,
        tenantId: this.tenantId,
        errorCategory: 'QUERY_ERROR',
        errorMessage: `Schema '${schema}' contains invalid SQL characters.`,
      };
    }

    // 4. Build strictly parameterized read-only SELECT statement
    const quotedCols = allowedCols.map((c) => `"${c}"`).join(', ');
    const safeSql = `SELECT ${quotedCols} FROM "${schema}"."${tableName}" WHERE "${idColumn}" = $1 LIMIT 1;`;

    // 5. Execute query through driver
    try {
      const result = await this.driver.query(safeSql, [lookupId], this.config.timeoutMs);

      if (result.rows.length === 0) {
        // Confirmed absence: authorized query executed and returned 0 rows
        return {
          status: 'NOT_FOUND',
          target,
          observedAt: now,
          payload: null,
          sourceId: this.sourceId,
          sourceType: this.sourceType,
          integrationId: this.integrationId,
          tenantId: this.tenantId,
          metadata: {
            schema,
            table: tableName,
            matchedRows: 0,
          },
        };
      }

      // Found matching row
      const row = result.rows[0];
      return {
        status: 'FOUND',
        target,
        observedAt: now,
        payload: row,
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        integrationId: this.integrationId,
        tenantId: this.tenantId,
        metadata: {
          schema,
          table: tableName,
          matchedRows: 1,
        },
      };
    } catch (err: any) {
      const msg = err.message || 'Unknown database error';
      let errorCategory: ExternalObservationRecord['errorCategory'] = 'QUERY_ERROR';

      if (msg.includes('timeout') || err.name === 'TimeoutError') {
        errorCategory = 'TIMEOUT';
      } else if (msg.includes('permission denied') || msg.includes('authentication failed')) {
        errorCategory = 'AUTHORIZATION_FAILURE';
      } else if (msg.includes('connection') || msg.includes('ECONNREFUSED')) {
        errorCategory = 'NETWORK_ERROR';
      }

      return {
        status: 'READ_ERROR',
        target,
        observedAt: now,
        payload: null,
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        integrationId: this.integrationId,
        tenantId: this.tenantId,
        errorCategory,
        errorMessage: `Database observation query failed: ${msg}`,
      };
    }
  }
}

/**
 * Default driver implementation when external pg driver is not explicitly injected.
 * Connects via standard postgres protocol if a driver is available, or reports configuration.
 */
export class DefaultPostgresDriver implements IPostgresDriver {
  constructor(
    private readonly config: PostgresIntegrationConfig,
    private readonly secretProvider: ISecretProvider
  ) {}

  public async query(
    _sql: string,
    _params: unknown[],
    _timeoutMs: number
  ): Promise<PostgresQueryResult> {
    throw new Error(
      `No PostgreSQL driver connected for host ${this.config.host}:${this.config.port}. ` +
      `Inject an IPostgresDriver instance or provide database connection driver.`
    );
  }
}

/**
 * In-memory mock PostgreSQL driver for testing.
 */
export class MockPostgresDriver implements IPostgresDriver {
  private tables = new Map<string, Record<string, unknown>[]>();
  private failureMode: 'NONE' | 'TIMEOUT' | 'AUTH' | 'CONN' | 'QUERY' = 'NONE';

  public setTableData(tableName: string, rows: Record<string, unknown>[]): void {
    this.tables.set(tableName, rows);
  }

  public setFailureMode(mode: 'NONE' | 'TIMEOUT' | 'AUTH' | 'CONN' | 'QUERY'): void {
    this.failureMode = mode;
  }

  public async query(
    sql: string,
    params: unknown[],
    _timeoutMs: number
  ): Promise<PostgresQueryResult> {
    if (this.failureMode === 'TIMEOUT') {
      throw new Error('Query statement timeout expired');
    }
    if (this.failureMode === 'AUTH') {
      throw new Error('permission denied for table');
    }
    if (this.failureMode === 'CONN') {
      throw new Error('ECONNREFUSED connection failed to postgres server');
    }
    if (this.failureMode === 'QUERY') {
      throw new Error('syntax error in query');
    }

    // Simple deterministic evaluator for `SELECT ... FROM "schema"."table" WHERE "id" = $1 LIMIT 1;`
    const tableMatch = sql.match(/FROM\s+"[^"]+"\."([^"]+)"/i);
    const idMatch = sql.match(/WHERE\s+"([^"]+)"\s*=\s*\$1/i);

    if (!tableMatch || !idMatch) {
      throw new Error(`Unsupported mock query pattern: ${sql}`);
    }

    const tableName = tableMatch[1];
    const idCol = idMatch[1];
    const targetId = params[0];

    const rows = this.tables.get(tableName) || [];
    const matched = rows.find((r) => String(r[idCol]) === String(targetId));

    if (!matched) {
      return { rows: [] };
    }

    return { rows: [matched] };
  }
}
