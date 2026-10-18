/**
 * AgentProof Test Fixture — Real Local HTTP Customer Service
 * 
 * Provides an actual running HTTP service for end-to-end REST evidence reader verification.
 * Supports authentication headers, status code simulation, latency simulation,
 * and CRUD operations against an in-memory customer database.
 */

import * as http from 'node:http';

export interface CustomerRecord {
  id: string;
  name: string;
  status: string;
  plan: string;
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export class TestCustomerService {
  private server?: http.Server;
  private readonly customers: Map<string, CustomerRecord> = new Map();
  public readonly expectedApiKey: string;
  public simulateTimeout: boolean = false;
  public simulateServerError: boolean = false;

  constructor(options?: { expectedApiKey?: string }) {
    this.expectedApiKey = options?.expectedApiKey ?? 'test-customer-key';
  }

  public async start(preferredPort: number = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'INTERNAL_ERROR', message: err.message }));
        }
      });

      this.server.listen(preferredPort, '127.0.0.1', () => {
        const addr = this.server?.address();
        if (typeof addr === 'object' && addr !== null) {
          resolve(addr.port);
        } else {
          resolve(preferredPort);
        }
      });

      this.server.on('error', reject);
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  public setCustomer(id: string, record: Partial<CustomerRecord> & { name: string }): CustomerRecord {
    const now = new Date().toISOString();
    const fullRecord: CustomerRecord = {
      id,
      name: record.name,
      status: record.status ?? 'ACTIVE',
      plan: record.plan ?? 'enterprise',
      balance: record.balance ?? 1000,
      createdAt: record.createdAt ?? now,
      updatedAt: now,
    };
    this.customers.set(id, fullRecord);
    return fullRecord;
  }

  public getCustomer(id: string): CustomerRecord | undefined {
    return this.customers.get(id);
  }

  public clear(): void {
    this.customers.clear();
    this.simulateTimeout = false;
    this.simulateServerError = false;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    // 1. Timeout simulation
    if (this.simulateTimeout || pathname === '/simulate/timeout') {
      // Deliberately do not reply to trigger client timeout
      return;
    }

    // 2. Server Error simulation
    if (this.simulateServerError || pathname === '/simulate/error') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'SERVER_ERROR', message: 'Simulated backend service fault.' }));
      return;
    }

    // 3. Malformed JSON simulation
    if (pathname === '/simulate/malformed') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{ invalid json: true, missing quotes }');
      return;
    }

    // 4. Oversized response simulation
    if (pathname === '/simulate/oversized') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const largeData = 'A'.repeat(2 * 1024 * 1024); // 2 MB
      res.end(JSON.stringify({ data: largeData }));
      return;
    }

    // 5. Authentication check
    const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
    const validKey = apiKey === this.expectedApiKey || apiKey === `Bearer ${this.expectedApiKey}`;
    if (!validKey && pathname.startsWith('/customers')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid or missing API key header.' }));
      return;
    }

    // 6. Routes
    if (pathname === '/customers' && method === 'POST') {
      const body = await this.readBody(req);
      const id = body.id || `cust-${Math.random().toString(36).substring(2, 9)}`;
      const customer = this.setCustomer(id, body);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'created', customer }));
      return;
    }

    if (pathname.startsWith('/customers/')) {
      const customerId = decodeURIComponent(pathname.slice('/customers/'.length));

      if (method === 'GET') {
        const customer = this.customers.get(customerId);
        if (!customer) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'NOT_FOUND', message: `Customer '${customerId}' was not found.` }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(customer));
        return;
      }

      if (method === 'PUT') {
        const body = await this.readBody(req);
        const existing = this.customers.get(customerId);
        if (!existing) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'NOT_FOUND', message: `Customer '${customerId}' was not found.` }));
          return;
        }
        const updated = this.setCustomer(customerId, { ...existing, ...body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'updated', customer: updated }));
        return;
      }

      if (method === 'DELETE') {
        const existed = this.customers.delete(customerId);
        if (!existed) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'NOT_FOUND', message: `Customer '${customerId}' was not found.` }));
          return;
        }
        res.writeHead(204);
        res.end();
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'ROUTE_NOT_FOUND', message: `No route for ${method} ${pathname}` }));
  }

  private readBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const str = Buffer.concat(chunks).toString('utf-8');
          resolve(str ? JSON.parse(str) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }
}
