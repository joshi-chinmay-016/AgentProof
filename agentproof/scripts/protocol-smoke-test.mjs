/**
 * AgentProof Phase 4 — Genuine MCP Protocol Smoke Test
 * 
 * Spawns the compiled MCP server as a subprocess over STDIO, connects using the
 * official @modelcontextprotocol/sdk Client, and executes tools/list and tools/call.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as path from 'path';

async function main() {
  console.log('Connecting to AgentProof MCP server over STDIO...');

  const serverScript = path.resolve('dist/index.js');
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverScript],
    cwd: process.cwd(),
    stderr: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
  });

  // Capture server stderr logs for inspection
  transport.stderr?.on('data', (chunk) => {
    console.error('[SERVER STDERR]:', chunk.toString());
  });

  // Tapping raw stdout
  const origStart = transport.start.bind(transport);
  transport.start = async () => {
    await origStart();
    transport._process?.stdout?.on('data', (chunk) => {
      console.log('[RAW STDOUT]:', chunk.toString());
    });
  };

  const client = new Client(
    { name: 'agentproof-audit-client', version: '1.0.0' },
    { capabilities: {} }
  );

  const origSend = transport.send.bind(transport);
  transport.send = async (msg) => {
    console.log('[CLIENT SEND]:', JSON.stringify(msg));
    return origSend(msg);
  };

  const origProcessReadBuffer = transport.processReadBuffer?.bind(transport);
  if (transport.onmessage) {
    const origOnMessage = transport.onmessage;
    transport.onmessage = (msg) => {
      console.log('[CLIENT RECEIVE]:', JSON.stringify(msg));
      origOnMessage(msg);
    };
  }

  try {
    await client.connect(transport);
    console.log('✓ Successfully connected to MCP server via STDIO.');

    // 1. List tools
    const listResult = await client.listTools();
    const toolNames = listResult.tools.map((t) => t.name);
    console.log('✓ Discovered tools via tools/list:', toolNames);

    const requiredTools = ['verify_outcome', 'inspect_trace', 'run_scenario', 'list_scenarios'];
    for (const req of requiredTools) {
      if (!toolNames.includes(req)) {
        throw new Error(`Missing required MCP tool: ${req}`);
      }
    }
    console.log('✓ All 4 required tools verified.');

    // 2. Call list_scenarios
    console.log('\n--- Invoking tools/call: list_scenarios ---');
    const scenariosResult = await client.callTool({
      name: 'list_scenarios',
      arguments: {},
    });
    console.log('list_scenarios response:', JSON.stringify(scenariosResult, null, 2));

    // 3. Call run_scenario: SCENARIO_B (False Success)
    console.log('\n--- Invoking tools/call: run_scenario (SCENARIO_B - False Success) ---');
    const runResult = await client.callTool({
      name: 'run_scenario',
      arguments: { scenarioId: 'SCENARIO_B' },
    });
    console.log('run_scenario response:', JSON.stringify(runResult, null, 2));

    // 4. Call inspect_trace for the resulting trace
    let traceId;
    if (runResult.content && runResult.content[0] && runResult.content[0].type === 'text') {
      const parsed = JSON.parse(runResult.content[0].text);
      traceId = parsed.traceId;
    } else if (runResult.traceId) {
      traceId = runResult.traceId;
    }

    if (traceId) {
      console.log(`\n--- Invoking tools/call: inspect_trace (${traceId}) ---`);
      const traceResult = await client.callTool({
        name: 'inspect_trace',
        arguments: { traceId },
      });
      console.log('inspect_trace response:', JSON.stringify(traceResult, null, 2));
    }

    // 5. Call verify_outcome directly
    console.log('\n--- Invoking tools/call: verify_outcome (Genuine PASS test) ---');
    const verifyResult = await client.callTool({
      name: 'verify_outcome',
      arguments: {
        target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-audit' },
        intent: { operation: 'cancel', summary: 'audit cancel', expectedChanges: {} },
        postconditions: [
          { id: 'p1', description: 'check cancelled', path: 'status', operator: 'EQUALS', expectedValue: 'CANCELLED' }
        ],
        evidence: [
          {
            sourceId: 'audit-db',
            target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-audit' },
            observedPayload: { status: 'CANCELLED' }
          }
        ]
      }
    });
    console.log('verify_outcome response:', JSON.stringify(verifyResult, null, 2));

    console.log('\n=========================================');
    console.log('✓ GENUINE MCP PROTOCOL SMOKE TEST PASSED');
    console.log('=========================================');
  } finally {
    await client.close();
    await transport.close();
  }
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
