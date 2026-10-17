/**
 * AgentProof Core Verification Engine — Public API
 * 
 * Pure, framework-independent verification domain.
 */

// Domain Types and Entities
export * from './domain/verification-request.js';
export * from './domain/action-record.js';
export * from './domain/evidence.js';
export * from './domain/verification-result.js';
export * from './domain/verification-trace.js';

// Contracts
export * from './contracts/verifier.js';

// Verification Engine & Components
export * from './verification/reason-codes.js';
export * from './verification/condition-evaluator.js';
export * from './verification/verdict-aggregator.js';
export * from './verification/verification-engine.js';
export * from './verification/evidence-trust-validator.js';

// Domain Errors
export * from './errors/domain-errors.js';
