/**
 * AgentProof Observation Registry — Integration Registry Contract
 * 
 * Defines the contract for managing and retrieving trusted external integration configurations.
 * Enforces tenant-scoped access and prevents unauthorized integration discovery.
 */

import { IntegrationConfig } from './integration-config.schema.js';

export interface IIntegrationRegistry {
  /**
   * Registers a validated external integration configuration.
   */
  register(config: IntegrationConfig): void;

  /**
   * Retrieves an integration strictly scoped to an authorized tenant.
   * Returns undefined if the integration does not exist or belongs to another tenant.
   */
  getByTenantAndId(tenantId: string, integrationId: string): IntegrationConfig | undefined;

  /**
   * Retrieves an integration by ID with optional tenant filtering.
   */
  getById(integrationId: string, tenantId?: string): IntegrationConfig | undefined;

  /**
   * Lists all enabled integrations belonging to the specified tenant.
   */
  listByTenant(tenantId: string): readonly IntegrationConfig[];

  /**
   * Registers a pre-instantiated external state reader.
   */
  registerReader?(reader: any): void;

  /**
   * Retrieves a pre-instantiated external state reader.
   */
  getReader?(integrationId: string, tenantId?: string): any;

  /**
   * Removes all integrations (primarily for testing).
   */
  clear(): void;
}
