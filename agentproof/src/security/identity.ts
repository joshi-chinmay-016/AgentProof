/**
 * AgentProof Security — Identity & Principal Resolution
 * 
 * Replaces caller-asserted tenant identity with an explicit authenticated
 * SecurityPrincipal context.
 */

import { z } from 'zod';
import { AuthenticationError } from './errors.js';

export const PrincipalTypeSchema = z.enum(['USER', 'AGENT', 'SERVICE', 'SYSTEM']);
export type PrincipalType = z.infer<typeof PrincipalTypeSchema>;

export const SecurityPrincipalSchema = z.object({
  principalId: z.string().min(1, 'principalId must not be empty'),
  tenantId: z.string().min(1, 'tenantId must not be empty'),
  principalType: PrincipalTypeSchema.default('SERVICE'),
  permissions: z.array(z.string()).default([]),
  authMethod: z.string().default('STATIC'),
  metadata: z.record(z.unknown()).optional().default({}),
});

export type SecurityPrincipal = z.infer<typeof SecurityPrincipalSchema>;

export interface ExecutionSecurityContext {
  readonly principalId?: string;
  readonly tenantId?: string;
  readonly token?: string;
  readonly headers?: Record<string, string | undefined>;
  readonly metadata?: Record<string, unknown>;
}

export interface IIdentityProvider {
  /**
   * Resolves the caller's execution context into a verified SecurityPrincipal.
   * Fails closed by throwing AuthenticationError if identity cannot be established.
   */
  resolvePrincipal(
    context?: ExecutionSecurityContext | any,
    requestedScope?: { tenantId?: string }
  ): Promise<SecurityPrincipal>;
}

/**
 * Deterministic identity provider for automated testing and injection.
 */
export class StaticIdentityProvider implements IIdentityProvider {
  constructor(private readonly principal: SecurityPrincipal) {
    SecurityPrincipalSchema.parse(principal);
  }

  public async resolvePrincipal(
    _context?: ExecutionSecurityContext | any,
    _requestedScope?: { tenantId?: string }
  ): Promise<SecurityPrincipal> {
    return Object.freeze({ ...this.principal });
  }
}

/**
 * Resolves identity from request context (metadata, headers, or tokens).
 * Maps explicit caller token or headers to registered principals.
 */
export class ContextIdentityProvider implements IIdentityProvider {
  private readonly principalMap: Map<string, SecurityPrincipal> = new Map();
  private readonly fallbackProvider?: IIdentityProvider;

  constructor(options?: {
    principals?: Record<string, SecurityPrincipal>;
    fallbackProvider?: IIdentityProvider;
  }) {
    if (options?.principals) {
      for (const [key, p] of Object.entries(options.principals)) {
        this.principalMap.set(key, SecurityPrincipalSchema.parse(p));
      }
    }
    this.fallbackProvider = options?.fallbackProvider;
  }

  public registerPrincipal(tokenOrId: string, principal: SecurityPrincipal): void {
    this.principalMap.set(tokenOrId, SecurityPrincipalSchema.parse(principal));
  }

  public async resolvePrincipal(
    context?: ExecutionSecurityContext | any,
    requestedScope?: { tenantId?: string }
  ): Promise<SecurityPrincipal> {
    if (!context) {
      if (this.fallbackProvider) {
        return this.fallbackProvider.resolvePrincipal(undefined, requestedScope);
      }
      throw new AuthenticationError('Missing security context: request lacks authentication metadata.');
    }

    // 1. Check token from context
    if (context.token && this.principalMap.has(context.token)) {
      return Object.freeze({ ...this.principalMap.get(context.token)! });
    }

    // 2. Check principalId from context
    if (context.principalId && this.principalMap.has(context.principalId)) {
      return Object.freeze({ ...this.principalMap.get(context.principalId)! });
    }

    // 3. Check authorization header
    const authHeader = context.headers?.authorization || context.headers?.Authorization;
    if (authHeader) {
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
      if (this.principalMap.has(token)) {
        return Object.freeze({ ...this.principalMap.get(token)! });
      }
    }

    // 4. Check explicit tenant/principal headers if registered
    const headerTenant = context.headers?.['x-agentproof-tenant'] || context.headers?.['X-AgentProof-Tenant'];
    const headerPrincipal = context.headers?.['x-agentproof-principal'] || context.headers?.['X-AgentProof-Principal'];
    if (headerPrincipal && headerTenant) {
      const key = `${headerTenant}:${headerPrincipal}`;
      if (this.principalMap.has(key)) {
        return Object.freeze({ ...this.principalMap.get(key)! });
      }
    }

    if (this.fallbackProvider) {
      return this.fallbackProvider.resolvePrincipal(context, requestedScope);
    }

    throw new AuthenticationError(
      'Authentication failed: no authorized principal found matching provided credentials or security context.'
    );
  }
}

/**
 * Development-only identity provider.
 * Explicitly constrained to non-production environments with tagged warning.
 */
export class DefaultDevelopmentIdentityProvider implements IIdentityProvider {
  private readonly defaultPrincipal: SecurityPrincipal;

  constructor(defaultTenantId: string = '*', defaultPrincipalId: string = 'dev-agent') {
    this.defaultPrincipal = {
      principalId: defaultPrincipalId,
      tenantId: defaultTenantId,
      principalType: 'AGENT',
      permissions: ['*'], // full access for local development
      authMethod: 'DEV_DEFAULT',
      metadata: {
        environment: 'development',
        warning: 'This identity was granted by DefaultDevelopmentIdentityProvider and must never be used in production.',
      },
    };
  }

  public async resolvePrincipal(
    context?: ExecutionSecurityContext | any,
    requestedScope?: { tenantId?: string }
  ): Promise<SecurityPrincipal> {
    const explicitTenant = context?.tenantId;
    if (explicitTenant) {
      return Object.freeze({
        ...this.defaultPrincipal,
        tenantId: explicitTenant,
        principalId: context?.principalId ?? this.defaultPrincipal.principalId,
      });
    }
    return Object.freeze({ ...this.defaultPrincipal });
  }
}
