/**
 * AgentProof Observation Registry — In-Memory Integration Registry
 * 
 * In-memory storage for trusted external integration configurations.
 * Enforces strict tenant boundaries and deep immutability.
 */

import { IIntegrationRegistry } from './integration-registry.interface.js';
import { IntegrationConfig, IntegrationConfigSchema } from './integration-config.schema.js';

export class InMemoryIntegrationRegistry implements IIntegrationRegistry {
  private readonly storage: Map<string, IntegrationConfig> = new Map();

  public register(config: IntegrationConfig): void {
    const validated = IntegrationConfigSchema.parse(config);
    // Key by composite tenant:integrationId to prevent global ID collision
    const key = `${validated.tenantId}:${validated.integrationId}`;
    this.storage.set(key, JSON.parse(JSON.stringify(validated)));
  }

  public getByTenantAndId(tenantId: string, integrationId: string): IntegrationConfig | undefined {
    if (tenantId === '*') {
      return this.getById(integrationId);
    }
    const key = `${tenantId}:${integrationId}`;
    const found = this.storage.get(key);
    if (!found || !found.enabled) {
      return undefined;
    }
    return JSON.parse(JSON.stringify(found));
  }

  public getById(integrationId: string, tenantId?: string): IntegrationConfig | undefined {
    if (tenantId && tenantId !== '*') {
      return this.getByTenantAndId(tenantId, integrationId);
    }

    // If tenantId is wildcard or omitted, search for matching integrationId
    for (const config of this.storage.values()) {
      if (config.integrationId === integrationId && config.enabled) {
        return JSON.parse(JSON.stringify(config));
      }
    }
    return undefined;
  }

  public listByTenant(tenantId: string): readonly IntegrationConfig[] {
    const list: IntegrationConfig[] = [];
    for (const config of this.storage.values()) {
      if ((tenantId === '*' || config.tenantId === tenantId) && config.enabled) {
        list.push(JSON.parse(JSON.stringify(config)));
      }
    }
    return Object.freeze(list);
  }

  private readonly readers: Map<string, any> = new Map();

  public registerReader(reader: any): void {
    const key = `${reader.tenantId}:${reader.integrationId}`;
    this.readers.set(key, reader);
  }

  public getReader(integrationId: string, tenantId?: string): any {
    if (tenantId && tenantId !== '*') {
      return this.readers.get(`${tenantId}:${integrationId}`);
    }
    for (const reader of this.readers.values()) {
      if (reader.integrationId === integrationId) {
        return reader;
      }
    }
    return undefined;
  }

  public clear(): void {
    this.storage.clear();
    this.readers.clear();
  }
}

export const defaultIntegrationRegistry = new InMemoryIntegrationRegistry();
