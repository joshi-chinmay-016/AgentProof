/**
 * AgentProof Observation Module — Public API
 * 
 * Production-ready external state readers, security controls,
 * integration registry, and evidence adapters.
 */

// Contracts
export * from './contracts/state-reader.interface.js';

// Security
export * from './security/secret-provider.js';
export * from './security/ssrf-guard.js';

// Registry
export * from './registry/integration-config.schema.js';
export * from './registry/integration-registry.interface.js';
export * from './registry/in-memory-integration-registry.js';

// Readers
export * from './readers/rest-api-state-reader.js';
export * from './readers/s3-object-state-reader.js';
export * from './readers/postgres-state-reader.js';

// Adapters
export * from './adapters/external-evidence-adapter.js';
