/**
 * AgentProof Simulation & Failure Injection — Public API
 * 
 * Provides an in-memory, deterministic simulated environment and failure injection harness
 * to verify AI agent actions against independent ground truth.
 */

// Domain & Clock
export * from './domain/clock.js';
export * from './domain/subscription.js';

// Repositories
export * from './repositories/subscription-repository.interface.js';
export * from './repositories/in-memory-subscription-repository.js';

// Failure Injection
export * from './failure-injection/failure-mode.js';

// Action Execution
export * from './actions/mock-action-adapter.interface.js';
export * from './actions/mock-action-adapter.js';

// Observation & Evidence Generation
export * from './observation/state-reader.interface.js';
export * from './observation/in-memory-state-reader.js';
export * from './observation/evidence-adapter.js';

// Scenarios & Orchestration
export * from './scenarios/scenario-types.js';
export * from './scenarios/scenario-runner.js';
export * from './scenarios/scenarios.js';
