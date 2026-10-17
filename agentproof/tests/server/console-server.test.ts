/**
 * AgentProof Web Console — Server Integration Test
 * 
 * Verifies live HTTP server lifecycle, static asset serving, SPA fallback,
 * API routing, and webhook routing coexistence.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { ConsoleServer } from '../../src/server/console-server.js';
import { InMemoryTraceRegistry } from '../../src/modules/verification/trace-registry.js';
import { ConsoleApiHandler } from '../../src/server/console-api-handler.js';

function httpGet(url: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

describe('ConsoleServer HTTP Integration', () => {
  let server: ConsoleServer;
  let baseUrl: string;

  beforeAll(async () => {
    const traceRepo = new InMemoryTraceRegistry();
    const apiHandler = new ConsoleApiHandler({ traceRepository: traceRepo });
    // Use ephemeral port (0) for test isolation
    server = new ConsoleServer({
      port: 0,
      host: '127.0.0.1',
      apiHandler,
    });
    const addr = await server.start();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('serves index.html at root route /', async () => {
    const res = await httpGet(`${baseUrl}/`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('AgentProof');
    expect(res.body).toContain('app-sidebar');
  });

  it('serves theme.css with text/css content type', async () => {
    const res = await httpGet(`${baseUrl}/styles/theme.css`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
    expect(res.body).toContain('--bg-canvas');
  });

  it('serves app.js with application/javascript content type', async () => {
    const res = await httpGet(`${baseUrl}/js/app.js`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.body).toContain('AgentProof Web Console');
  });

  it('supports SPA fallback for client-side routes like /verifications', async () => {
    const res = await httpGet(`${baseUrl}/verifications`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<div id="app">');
  });

  it('routes /api/* to ConsoleApiHandler', async () => {
    const res = await httpGet(`${baseUrl}/api/health`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toBe('healthy');
  });

  it('routes /api/v1/webhooks/* to WebhookReceiver', async () => {
    const res = await httpGet(`${baseUrl}/api/v1/webhooks/unregistered-test-source`);
    // Webhook receiver responds with 405 Method Not Allowed on GET (must be POST)
    expect(res.statusCode).toBe(405);
  });
});
