/**
 * AgentProof Observation Security — SSRF Guard & Network Protection
 * 
 * Protects external state readers against Server-Side Request Forgery (SSRF),
 * arbitrary internal network probing, credential leakage, and unapproved destination requests.
 */

import * as net from 'node:net';

export interface SsrfGuardOptions {
  /**
   * If true, allows requests to 127.0.0.1 and localhost (for local test servers).
   * Must be false in production configurations.
   */
  readonly allowLoopback?: boolean;

  /**
   * Allowed URL schemes. Defaults to ['https'] in production, or ['https', 'http'] when loopback allowed.
   */
  readonly allowedSchemes?: readonly string[];

  /**
   * Specific domain/host allowlist if configured.
   */
  readonly allowedHosts?: readonly string[];
}

export class SsrfGuard {
  private readonly allowLoopback: boolean;
  private readonly allowedSchemes: ReadonlySet<string>;
  private readonly allowedHosts?: ReadonlySet<string>;

  private static readonly SENSITIVE_HEADERS = new Set([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
    'x-amz-security-token',
    'apikey',
    'secret',
  ]);

  constructor(options?: SsrfGuardOptions) {
    this.allowLoopback = options?.allowLoopback ?? false;
    const defaultSchemes = this.allowLoopback ? ['https', 'http'] : ['https'];
    this.allowedSchemes = new Set(options?.allowedSchemes ?? defaultSchemes);
    this.allowedHosts = options?.allowedHosts ? new Set(options.allowedHosts.map((h) => h.toLowerCase())) : undefined;
  }

  /**
   * Validates a target URL against SSRF and network security rules.
   * Throws Error if URL is dangerous, private, or violates protocol constraints.
   */
  public validateUrl(rawUrl: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid URL: malformed URL string [${rawUrl}].`);
    }

    // 1. Validate Scheme
    const scheme = parsed.protocol.replace(':', '').toLowerCase();
    if (!this.allowedSchemes.has(scheme)) {
      throw new Error(
        `SSRF Protection: Insecure URL scheme '${scheme}:'. Allowed schemes: ${Array.from(this.allowedSchemes).join(', ')}.`
      );
    }

    // 2. Reject embedded credentials in URL (e.g. https://user:pass@example.com)
    if (parsed.username || parsed.password) {
      throw new Error('SSRF Protection: Embedded credentials in URLs are strictly prohibited.');
    }

    const hostname = parsed.hostname.toLowerCase();

    // 3. Host allowlist check if configured
    if (this.allowedHosts && !this.allowedHosts.has(hostname)) {
      throw new Error(
        `SSRF Protection: Destination host '${hostname}' is not in the configured allowed hosts list.`
      );
    }

    // 4. IP / Private Network / Cloud Metadata Checks
    this.validateHostnameOrIp(hostname);

    return parsed;
  }

  /**
   * Validates that a hostname or IP address is not an internal or private address.
   */
  public validateHostnameOrIp(host: string): void {
    const cleanHost = host.replace(/^\[|\]$/g, '');
    const isIp = net.isIP(cleanHost);

    if (cleanHost === 'localhost' || cleanHost.endsWith('.localhost')) {
      if (!this.allowLoopback) {
        throw new Error(`SSRF Protection: Requests to '${host}' are prohibited in non-loopback mode.`);
      }
      return;
    }

    if (isIp === 4) {
      if (this.isPrivateOrRestrictedIpv4(cleanHost)) {
        if (this.allowLoopback && (cleanHost === '127.0.0.1' || cleanHost.startsWith('127.'))) {
          return;
        }
        throw new Error(
          `SSRF Protection: Target IP '${cleanHost}' belongs to a private, link-local, or cloud-metadata network.`
        );
      }
    } else if (isIp === 6) {
      if (this.isPrivateOrRestrictedIpv6(cleanHost)) {
        if (this.allowLoopback && (cleanHost === '::1' || cleanHost === '0:0:0:0:0:0:0:1')) {
          return;
        }
        throw new Error(
          `SSRF Protection: Target IPv6 '${cleanHost}' belongs to a private or loopback network.`
        );
      }
    }
  }

  /**
   * Checks if an IPv4 address is in a private, loopback, link-local, or metadata range.
   */
  private isPrivateOrRestrictedIpv4(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    const [a, b] = parts;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;

    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;

    // 10.0.0.0/8 (Private RFC 1918)
    if (a === 10) return true;

    // 172.16.0.0/12 (Private RFC 1918: 172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.0.0/16 (Private RFC 1918)
    if (a === 192 && b === 168) return true;

    // 169.254.0.0/16 (Link-local & AWS/GCP/Azure Metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;

    // 255.255.255.255 (Broadcast)
    if (parts.every((p) => p === 255)) return true;

    return false;
  }

  /**
   * Checks if an IPv6 address is loopback, unique-local, or link-local.
   */
  private isPrivateOrRestrictedIpv6(ip: string): boolean {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // Unique local (fc00::/7)
    if (normalized.startsWith('fe80:')) return true; // Link-local
    return false;
  }

  /**
   * Validates that a requested path matches at least one permitted resource pattern
   * and prevents path traversal (e.g. '/api/../etc/passwd').
   */
  public validatePath(pathname: string, allowedPatterns: readonly string[]): boolean {
    if (pathname.includes('..') || pathname.includes('//')) {
      return false;
    }

    if (!allowedPatterns || allowedPatterns.length === 0) {
      return false;
    }

    return allowedPatterns.some((pattern) => {
      if (pattern === '*' || pattern === '/*') return true;

      // Convert glob pattern to regex: escape regex special chars except *
      if (pattern.includes('*')) {
        const regexStr =
          '^' +
          pattern
            .split('*')
            .map((seg) => seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
            .join('[^/]+') +
          '$';
        return new RegExp(regexStr).test(pathname);
      }

      // Exact match
      return pathname === pattern;
    });
  }

  /**
   * Redacts sensitive headers before logging or inclusion in evidence metadata.
   */
  public redactHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (SsrfGuard.SENSITIVE_HEADERS.has(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}
