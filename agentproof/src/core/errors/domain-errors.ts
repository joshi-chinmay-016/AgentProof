/**
 * AgentProof Core Domain Errors
 * 
 * Typed domain exception hierarchy for verification failures and schema rejections.
 */

export class VerificationDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationDomainError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends VerificationDomainError {
  public readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = []) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export class UnsupportedPredicateError extends VerificationDomainError {
  public readonly operator: string;

  constructor(operator: string) {
    super(`Unsupported predicate operator: ${operator}`);
    this.name = 'UnsupportedPredicateError';
    this.operator = operator;
  }
}

export class EvidenceIntegrityError extends VerificationDomainError {
  public readonly evidenceId: string;

  constructor(evidenceId: string, message: string) {
    super(`Evidence integrity error for [${evidenceId}]: ${message}`);
    this.name = 'EvidenceIntegrityError';
    this.evidenceId = evidenceId;
  }
}
