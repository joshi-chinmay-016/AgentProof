/**
 * AgentProof Observation Security — Secret Provider
 * 
 * Provides secure access to integration credentials without hardcoding secrets,
 * committing them to source control, or exposing them in evidence payloads.
 */

export interface ISecretProvider {
  /**
   * Resolves a secret reference key (e.g. env var name or vault key) into the raw secret string.
   */
  getSecret(keyRef: string): Promise<string | undefined>;
}

export class EnvironmentSecretProvider implements ISecretProvider {
  private readonly prefix: string;

  constructor(options?: { prefix?: string }) {
    this.prefix = options?.prefix ?? '';
  }

  public async getSecret(keyRef: string): Promise<string | undefined> {
    const fullKey = this.prefix ? `${this.prefix}${keyRef}` : keyRef;
    return process.env[fullKey] ?? process.env[keyRef];
  }
}

export class StaticSecretProvider implements ISecretProvider {
  private readonly secrets: Map<string, string>;

  constructor(secrets: Record<string, string> = {}) {
    this.secrets = new Map(Object.entries(secrets));
  }

  public async getSecret(keyRef: string): Promise<string | undefined> {
    return this.secrets.get(keyRef);
  }

  public setSecret(keyRef: string, secret: string): void {
    this.secrets.set(keyRef, secret);
  }
}
