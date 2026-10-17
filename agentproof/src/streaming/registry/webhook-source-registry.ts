/**
 * AgentProof Streaming & Webhooks — Webhook Source Registry
 * 
 * Manages trusted webhook source configurations with strict tenant isolation.
 */

import { WebhookSourceConfig, WebhookSourceConfigSchema } from './webhook-source.schema.js';

export interface IWebhookSourceRegistry {
  register(config: WebhookSourceConfig): void;
  getBySourceId(sourceId: string, tenantId?: string): WebhookSourceConfig | undefined;
  getSource(sourceId: string, tenantId?: string): Promise<WebhookSourceConfig | null> | WebhookSourceConfig | null | undefined;
  listByTenant(tenantId: string): readonly WebhookSourceConfig[];
  clear(): void;
}

export class InMemoryWebhookSourceRegistry implements IWebhookSourceRegistry {
  private readonly sources = new Map<string, WebhookSourceConfig>();

  public register(config: WebhookSourceConfig): void {
    const validated = WebhookSourceConfigSchema.parse(config);
    const key = `${validated.tenantId}:${validated.sourceId}`;
    this.sources.set(key, JSON.parse(JSON.stringify(validated)));
  }

  public getBySourceId(sourceId: string, tenantId?: string): WebhookSourceConfig | undefined {
    if (tenantId && tenantId !== '*') {
      const key = `${tenantId}:${sourceId}`;
      const found = this.sources.get(key);
      if (!found) return undefined;
      return JSON.parse(JSON.stringify(found));
    }

    // Lookup across sources matching sourceId (for inbound webhook routing where sourceId is in URL)
    for (const config of this.sources.values()) {
      if (config.sourceId === sourceId) {
        return JSON.parse(JSON.stringify(config));
      }
    }
    return undefined;
  }

  public getSource(sourceId: string, tenantId?: string): WebhookSourceConfig | null {
    const found = this.getBySourceId(sourceId, tenantId);
    return found ?? null;
  }

  public listByTenant(tenantId: string): readonly WebhookSourceConfig[] {
    const list: WebhookSourceConfig[] = [];
    for (const config of this.sources.values()) {
      if ((tenantId === '*' || config.tenantId === tenantId) && config.enabled) {
        list.push(JSON.parse(JSON.stringify(config)));
      }
    }
    return Object.freeze(list);
  }

  public clear(): void {
    this.sources.clear();
  }
}

export const defaultWebhookSourceRegistry = new InMemoryWebhookSourceRegistry();
