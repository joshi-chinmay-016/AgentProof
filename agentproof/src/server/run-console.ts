/**
 * AgentProof Web Console — Server CLI Entrypoint
 * 
 * Boots the HTTP console server independently of MCP STDIO.
 */

import { ConsoleServer } from './console-server.js';

async function main() {
  const port = parseInt(process.env.PORT ?? process.env.CONSOLE_PORT ?? '3000', 10);
  const host = process.env.HOST ?? process.env.CONSOLE_HOST ?? '0.0.0.0';

  const server = new ConsoleServer({ port, host });
  const addr = await server.start();

  console.log(`[AgentProof] Web Console running at http://${addr.host === '0.0.0.0' ? 'localhost' : addr.host}:${addr.port}`);
  console.log(`[AgentProof] API Base URL: http://${addr.host === '0.0.0.0' ? 'localhost' : addr.host}:${addr.port}/api`);
  console.log(`[AgentProof] Webhook Ingest URL: http://${addr.host === '0.0.0.0' ? 'localhost' : addr.host}:${addr.port}/api/v1/webhooks/:sourceId`);

  const shutdown = async () => {
    console.log('\n[AgentProof] Shutting down console server...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[AgentProof] Fatal error starting console server:', err);
  process.exit(1);
});
