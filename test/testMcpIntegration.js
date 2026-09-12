// testMcpIntegration.js — Automated integration tests for MCP Client, Manager, and ToolRegistry
// Tests stdio JSON-RPC handshake, tool discovery, execution, permissions, and lifecycle.

import * as assert from 'assert';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import * as toolRegistry from '../src/tools/toolRegistry.js';
import * as approvalSystem from '../src/tools/approvalSystem.js';
import { createMcpClient } from '../src/mcp/mcpClient.js';
import * as mcpManager from '../src/mcp/mcpManager.js';
import { registerAllTools } from '../src/tools/tools.js';

var SCRATCH_DIR = path.resolve('test/scratch/mcp_test');
var DUMMY_SERVER_PATH = path.join(SCRATCH_DIR, 'mockMcpServer.cjs');

function ensureScratchDir() {
  if (!existsSync(SCRATCH_DIR)) {
    mkdirSync(SCRATCH_DIR, { recursive: true });
  }
}

async function createMockMcpServer() {
  ensureScratchDir();
  var serverCode = [
    "const readline = require('readline');",
    "const rl = readline.createInterface({ input: process.stdin, terminal: false });",
    "",
    "rl.on('line', function handleLine(line) {",
    "  const str = line.trim();",
    "  if (!str) return;",
    "  try {",
    "    const msg = JSON.parse(str);",
    "    if (msg.method === 'initialize') {",
    "      const resp = {",
    "        jsonrpc: '2.0',",
    "        id: msg.id,",
    "        result: {",
    "          protocolVersion: '2024-11-05',",
    "          capabilities: { tools: {} },",
    "          serverInfo: { name: 'mock-mcp-server', version: '1.0.0' }",
    "        }",
    "      };",
    "      process.stdout.write(JSON.stringify(resp) + '\\n');",
    "    } else if (msg.method === 'notifications/initialized') {",
    "      // Handshake confirmed",
    "    } else if (msg.method === 'tools/list') {",
    "      const resp = {",
    "        jsonrpc: '2.0',",
    "        id: msg.id,",
    "        result: {",
    "          tools: [",
    "            {",
    "              name: 'calculate_sum',",
    "              description: 'Calculate sum of two numbers',",
    "              inputSchema: {",
    "                type: 'object',",
    "                properties: {",
    "                  a: { type: 'number', description: 'First number' },",
    "                  b: { type: 'number', description: 'Second number' }",
    "                },",
    "                required: ['a', 'b']",
    "              }",
    "            }",
    "          ]",
    "        }",
    "      };",
    "      process.stdout.write(JSON.stringify(resp) + '\\n');",
    "    } else if (msg.method === 'tools/call') {",
    "      const args = msg.params.arguments || {};",
    "      const sum = (Number(args.a) || 0) + (Number(args.b) || 0);",
    "      const resp = {",
    "        jsonrpc: '2.0',",
    "        id: msg.id,",
    "        result: {",
    "          content: [",
    "            { type: 'text', text: 'Result: ' + sum }",
    "          ]",
    "        }",
    "      };",
    "      process.stdout.write(JSON.stringify(resp) + '\\n');",
    "    }",
    "  } catch (err) {",
    "    process.stderr.write('Server parse error: ' + err.message + '\\n');",
    "  }",
    "});"
  ].join('\n');

  await fs.writeFile(DUMMY_SERVER_PATH, serverCode, 'utf8');
}

async function runMcpClientDirectTest() {
  console.log('--- TEST: MCP Client Direct JSON-RPC Handshake & Tool Calling ---');

  var client = createMcpClient({
    name: 'test-mock-server',
    transport: 'stdio',
    command: 'node',
    args: [DUMMY_SERVER_PATH]
  });

  try {
    var initResult = await client.start();
    assert.ok(initResult, 'Init result should be returned');
    assert.strictEqual(initResult.protocolVersion, '2024-11-05');

    var listResult = await client.listTools();
    assert.ok(listResult && listResult.tools, 'Tools list should be returned');
    assert.strictEqual(listResult.tools.length, 1);
    assert.strictEqual(listResult.tools[0].name, 'calculate_sum');

    var callResult = await client.callTool('calculate_sum', { a: 15, b: 27 });
    assert.ok(callResult && callResult.content, 'Tool call result should contain content');
    assert.strictEqual(callResult.content[0].text, 'Result: 42');

    console.log('✓ MCP Client Direct JSON-RPC test passed.');
  } finally {
    client.stop();
  }
}

async function runMcpManagerAndToolRegistryTest() {
  console.log('--- TEST: MCP Manager Dynamic Registration, Permissions & Execution ---');

  var serverData = {
    id: 'mock_math',
    name: 'mock_math',
    transport: 'stdio',
    command: 'node',
    args: [DUMMY_SERVER_PATH],
    enabled: true,
    alwaysAllow: false
  };

  try {
    var addRes = await mcpManager.addServer(serverData);
    assert.ok(addRes && addRes.result && addRes.result.success, 'Server should add and connect successfully');

    var expectedToolName = 'mcp__mock_math__calculate_sum';
    assert.ok(toolRegistry.has(expectedToolName), 'Tool should be registered in toolRegistry');

    var defs = toolRegistry.getDefinitions();
    var foundDef = null;
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].function && defs[i].function.name === expectedToolName) {
        foundDef = defs[i];
        break;
      }
    }
    assert.ok(foundDef, 'Tool definition should exist for LLM providers');

    // Permission check
    var needsPerm = approvalSystem.requiresApproval(expectedToolName, { a: 1, b: 2 }, { confirmDangerous: true });
    assert.strictEqual(needsPerm, true, 'Tool without alwaysAllow should require permission approval');

    // Execute via toolRegistry generator
    var gen = toolRegistry.execute(expectedToolName, { a: 10, b: 25 }, { sessionId: 'test_session_mcp' });
    var events = [];
    var nextItem = await gen.next();
    while (!nextItem.done) {
      events.push(nextItem.value);
      nextItem = await gen.next();
    }

    assert.strictEqual(events.length, 2, 'Should yield action and result events');
    assert.strictEqual(events[0].type, 'action');
    assert.strictEqual(events[1].type, 'tool_result');
    assert.ok(events[1].content.includes('Result: 35'), 'Result should be formatted correctly');

    // Test Per-Tool Disable
    await mcpManager.toggleServerTool('mock_math', 'calculate_sum', false);
    assert.strictEqual(toolRegistry.has(expectedToolName), false, 'Tool should be unregistered when tool is disabled individually');

    // Test Per-Tool Enable
    await mcpManager.toggleServerTool('mock_math', 'calculate_sum', true);
    assert.strictEqual(toolRegistry.has(expectedToolName), true, 'Tool should be re-registered when tool is re-enabled');

    // Test Toggle Disable Server
    await mcpManager.toggleServer('mock_math', false);
    assert.strictEqual(toolRegistry.has(expectedToolName), false, 'Tool should be unregistered when server is disabled');

    // Test Toggle Enable Server
    await mcpManager.toggleServer('mock_math', true);
    assert.strictEqual(toolRegistry.has(expectedToolName), true, 'Tool should be re-registered when server is enabled');

    // Test Remove Server
    await mcpManager.removeServer('mock_math');
    assert.strictEqual(toolRegistry.has(expectedToolName), false, 'Tool should be unregistered after server removal');

    // Test Builtin Servers Presence & Protection
    var summary = await mcpManager.getServersSummary();
    var memoryServer = null;
    for (var sIdx = 0; sIdx < summary.length; sIdx++) {
      if (summary[sIdx].id === 'memory') {
        memoryServer = summary[sIdx];
        break;
      }
    }
    assert.ok(memoryServer, 'Built-in Memory server should exist in summary');
    assert.strictEqual(memoryServer.builtin, true, 'Memory server should be marked builtin: true');

    var caughtErr = null;
    try {
      await mcpManager.removeServer('memory');
    } catch (e) {
      caughtErr = e;
    }
    assert.ok(caughtErr, 'Attempting to remove a builtin server should throw an error');
    assert.ok(caughtErr.message.includes('Built-in server'), 'Error message should indicate builtin protection');

    console.log('✓ MCP Manager & ToolRegistry lifecycle and permission tests passed.');
  } finally {
    mcpManager.stopAllServers();
  }
}

async function runBuiltinAgentToolsTest() {
  console.log('--- TEST: Agent Built-in Tools Dropdown, Toggle & Definition Suppression ---');

  registerAllTools();
  await mcpManager.toggleBuiltinTool('write_file', true);

  try {
    var builtinTools = toolRegistry.listBuiltinTools();
    assert.ok(Array.isArray(builtinTools) && builtinTools.length > 0, 'Built-in tools list should not be empty');

    var writeFileTool = null;
    for (var i = 0; i < builtinTools.length; i++) {
      assert.notStrictEqual(builtinTools[i].category, 'mcp', 'Built-in tool category must not be mcp');
      if (builtinTools[i].name === 'write_file') {
        writeFileTool = builtinTools[i];
      }
    }
    assert.ok(writeFileTool, 'write_file should exist in built-in tools list');
    assert.strictEqual(writeFileTool.enabled, true, 'write_file should initially be enabled');

    // Verify it exists in LLM definitions initially
    var initialDefs = toolRegistry.getDefinitions();
    var hasWriteFileInDefs = false;
    for (var j = 0; j < initialDefs.length; j++) {
      if (initialDefs[j].function && initialDefs[j].function.name === 'write_file') {
        hasWriteFileInDefs = true;
        break;
      }
    }
    assert.strictEqual(hasWriteFileInDefs, true, 'write_file should initially be present in LLM tool definitions');

    // Disable write_file via mcpManager
    var toggleRes = await mcpManager.toggleBuiltinTool('write_file', false);
    assert.strictEqual(toggleRes.success, true, 'Toggling built-in tool off should succeed');
    assert.strictEqual(toolRegistry.isBuiltinToolDisabled('write_file'), true, 'write_file should be flagged disabled');

    // Verify it is excluded from LLM definitions
    var disabledDefs = toolRegistry.getDefinitions();
    var foundInDisabledDefs = false;
    for (var k = 0; k < disabledDefs.length; k++) {
      if (disabledDefs[k].function && disabledDefs[k].function.name === 'write_file') {
        foundInDisabledDefs = true;
        break;
      }
    }
    assert.strictEqual(foundInDisabledDefs, false, 'write_file MUST be omitted from LLM tool definitions when disabled');

    // Verify execution yields disabled notice
    var gen = toolRegistry.execute('write_file', { path: 'dummy.txt', content: 'test' });
    var events = [];
    var nextItem = await gen.next();
    while (!nextItem.done) {
      events.push(nextItem.value);
      nextItem = await gen.next();
    }
    assert.strictEqual(events.length, 1, 'Should yield tool_result event for disabled tool');
    assert.strictEqual(events[0].type, 'tool_result');
    assert.strictEqual(events[0].success, false);
    assert.ok(events[0].message.includes('is disabled in your Agent Tools settings'), 'Result should inform user tool is disabled');

    // Re-enable write_file
    var enableRes = await mcpManager.toggleBuiltinTool('write_file', true);
    assert.strictEqual(enableRes.success, true, 'Toggling built-in tool back on should succeed');
    assert.strictEqual(toolRegistry.isBuiltinToolDisabled('write_file'), false, 'write_file should no longer be disabled');

    // Verify it is restored to LLM definitions
    var restoredDefs = toolRegistry.getDefinitions();
    var foundInRestoredDefs = false;
    for (var m = 0; m < restoredDefs.length; m++) {
      if (restoredDefs[m].function && restoredDefs[m].function.name === 'write_file') {
        foundInRestoredDefs = true;
        break;
      }
    }
    assert.strictEqual(foundInRestoredDefs, true, 'write_file should be restored to LLM definitions');

    // Test toggleAllBuiltinTools(false)
    await mcpManager.toggleAllBuiltinTools(false);
    var allDisabledDefs = toolRegistry.getDefinitions();
    assert.strictEqual(allDisabledDefs.length, 0, 'When all built-in tools are disabled, definitions must be empty');

    // Test toggleAllBuiltinTools(true)
    await mcpManager.toggleAllBuiltinTools(true);
    var allRestoredDefs = toolRegistry.getDefinitions();
    assert.ok(allRestoredDefs.length > 0, 'When all built-in tools are enabled, definitions must be restored');

    console.log('✓ Agent Built-in Tools toggle, bulk actions & LLM schema suppression tests passed.');
  } finally {
    await mcpManager.toggleAllBuiltinTools(true);
  }
}

async function runAllMcpTests() {
  console.log('================================================================');
  console.log('=== STARTING MCP INTEGRATION TEST SUITE ===');
  console.log('================================================================\n');

  try {
    await createMockMcpServer();
    await runMcpClientDirectTest();
    await runMcpManagerAndToolRegistryTest();
    await runBuiltinAgentToolsTest();

    console.log('\n================================================================');
    console.log('=== ALL MCP INTEGRATION TESTS PASSED CLEANLY ===');
    console.log('================================================================\n');
  } catch (err) {
    console.error('❌ MCP Test Failed:', err);
    process.exit(1);
  } finally {
    mcpManager.stopAllServers();
  }
}

runAllMcpTests();
