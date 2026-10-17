import { describe, it, expect } from 'vitest';
import { buildTools, McpApplicationFactory } from '@nitrostack/core';
import { VerificationTools, VerificationModule } from '../../src/modules/verification/index.js';
import { AppModule } from '../../src/app.module.js';

describe('MCP Tool Registration', () => {
  it('registers all four required AgentProof tools on VerificationTools controller', () => {
    const controller = new VerificationTools();
    const tools = buildTools(controller);

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('verify_outcome');
    expect(toolNames).toContain('inspect_trace');
    expect(toolNames).toContain('run_scenario');
    expect(toolNames).toContain('list_scenarios');
    expect(tools).toHaveLength(4);
  });

  it('converts each tool to valid MCP protocol format with descriptions and input schemas', async () => {
    const controller = new VerificationTools();
    const tools = buildTools(controller);

    for (const tool of tools) {
      const mcpTool = await tool.toMcpTool();
      expect(mcpTool.name).toBeDefined();
      expect(mcpTool.description).toBeDefined();
      expect(mcpTool.description.length).toBeGreaterThan(10);
      expect(mcpTool.inputSchema).toBeDefined();
      expect(mcpTool.inputSchema.type).toBe('object');
    }
  });

  it('registers VerificationModule tools into the global NitroStack server instance', async () => {
    const server = await McpApplicationFactory.create(AppModule);
    const toolsMap = server.getTools();

    expect(toolsMap.has('verify_outcome')).toBe(true);
    expect(toolsMap.has('inspect_trace')).toBe(true);
    expect(toolsMap.has('run_scenario')).toBe(true);
    expect(toolsMap.has('list_scenarios')).toBe(true);

    // Verify resolveTool and execute through the server instance
    const listTool = await server.resolveTool('list_scenarios');
    expect(listTool).toBeDefined();

    const ctx = server.createContext({ toolName: 'list_scenarios' });
    const listResult: any = await listTool!.execute({}, ctx);
    expect(listResult.status).toBe('success');
    expect(listResult.count).toBe(8);

    const runTool = await server.resolveTool('run_scenario');
    expect(runTool).toBeDefined();
    const runResult: any = await runTool!.execute({ scenarioId: 'SCENARIO_B' }, ctx);
    expect(runResult.status).toBe('success');
    expect(runResult.verificationVerdict).toBe('FAIL');
  });
});
