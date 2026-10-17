/**
 * AgentProof Web Console — Production Server
 * 
 * Standalone HTTP server for the AgentProof Web Console SPA, dedicated API,
 * and webhook ingestion receiver.
 * 
 * Boundary Guarantee:
 * - Runs strictly over HTTP.
 * - Does not intercept, pollute, or interfere with MCP STDIO transport.
 * - Serves frontend static assets, REST API endpoints, and webhook receiver.
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConsoleApiHandler } from './console-api-handler.js';
import { WebhookReceiver } from '../streaming/index.js';
import { InMemoryWebhookSourceRegistry } from '../streaming/index.js';
import { FileWebhookEventRepository } from '../streaming/index.js';
import { FileWebhookReplayStore } from '../streaming/index.js';

export interface ConsoleServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly staticDir?: string;
  readonly apiHandler?: ConsoleApiHandler;
  readonly webhookReceiver?: WebhookReceiver;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export class ConsoleServer {
  private readonly port: number;
  private readonly host: string;
  private readonly staticDir: string;
  private readonly apiHandler: ConsoleApiHandler;
  private readonly webhookReceiver: WebhookReceiver;
  private server?: http.Server;

  constructor(options: ConsoleServerOptions = {}) {
    this.port = options.port ?? parseInt(process.env.CONSOLE_PORT ?? '3000', 10);
    this.host = options.host ?? process.env.CONSOLE_HOST ?? '0.0.0.0';

    // Resolve static directory: prioritize explicit, then public/ at project root
    const rootDir = process.cwd();
    this.staticDir = options.staticDir
      ? path.resolve(options.staticDir)
      : path.resolve(rootDir, 'public');

    this.apiHandler = options.apiHandler ?? new ConsoleApiHandler();

    // Setup webhook receiver if not provided
    if (options.webhookReceiver) {
      this.webhookReceiver = options.webhookReceiver;
    } else {
      const sourceRegistry = new InMemoryWebhookSourceRegistry();
      const replayStore = new FileWebhookReplayStore();
      const eventRepository = new FileWebhookEventRepository();
      this.webhookReceiver = new WebhookReceiver({
        sourceRegistry,
        replayStore,
        eventRepository,
      });
    }
  }

  /**
   * Dispatches incoming HTTP requests between webhooks, API, and static assets.
   */
  public async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // 1. Webhook Ingestion Routes
    if (pathname.startsWith('/api/v1/webhooks') || pathname.startsWith('/webhooks')) {
      return this.webhookReceiver.handleHttpRequest(req, res);
    }

    // 2. API & Health Routes
    if (pathname.startsWith('/api/') || pathname === '/healthz' || pathname === '/readyz') {
      return this.apiHandler.handleHttpRequest(req, res);
    }

    // 3. Static Files & SPA Fallback
    return this.serveStatic(req, res, pathname);
  }

  /**
   * Serves static frontend files with correct MIME types and SPA fallback.
   */
  private serveStatic(_req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
    let cleanPath = pathname === '/' ? '/index.html' : pathname;
    let filePath = path.join(this.staticDir, cleanPath);

    // Prevent directory traversal attacks
    if (!filePath.startsWith(this.staticDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // Check if target file exists
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // SPA fallback to index.html for client-side routing
      const indexPath = path.join(this.staticDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        filePath = indexPath;
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html><head><title>AgentProof Console</title></head><body><h1>AgentProof Web Console</h1><p>Static assets directory not yet populated: ${this.staticDir}</p></body></html>`);
        return;
      }
    }

    try {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
      const content = fs.readFileSync(filePath);

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': content.length,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      });
      res.end(content);
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Failed to read file: ${err.message}`);
    }
  }

  /**
   * Starts the HTTP server on configured port and host.
   */
  public start(port?: number, host?: string): Promise<{ port: number; host: string }> {
    const listenPort = port ?? this.port;
    const listenHost = host ?? this.host;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }));
          }
        });
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(listenPort, listenHost, () => {
        const addr = this.server?.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : listenPort;
        resolve({ port: actualPort, host: listenHost });
      });
    });
  }

  /**
   * Gracefully shuts down the HTTP server.
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = undefined;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public getServer(): http.Server | undefined {
    return this.server;
  }
}
