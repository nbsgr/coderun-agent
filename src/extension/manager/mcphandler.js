// mcphandler.js (extension side)
// Handles Model Context Protocol (MCP) server lifecycle & tool enablement
// Strict traditional function declarations only

import * as mcpManager from '../mcp/mcpManager.js';

export async function handleLoadMcpServers(message, webview) {
  try {
    var mcpList = await mcpManager.getServersSummary();
    var bTools = mcpManager.getBuiltinAgentTools();
    webview.postMessage({
      type: 'mcpServersLoaded',
      servers: mcpList,
      builtinAgentTools: bTools
    });
  } catch (mcpErr) {
    console.error('[MCP] Failed to load MCP servers:', mcpErr ? mcpErr.message : mcpErr);
  }
}

export async function handleAddMcpServer(message, webview) {
  try {
    await mcpManager.addServer(message.server);
    var updatedServers = await mcpManager.getServersSummary();
    var bTools = mcpManager.getBuiltinAgentTools();
    webview.postMessage({
      type: 'mcpServersLoaded',
      servers: updatedServers,
      builtinAgentTools: bTools,
      success: true,
      message: 'MCP server added successfully'
    });
  } catch (addErr) {
    webview.postMessage({
      type: 'mcpServerError',
      error: addErr ? addErr.message : String(addErr)
    });
  }
}

export async function handleRemoveMcpServer(message, webview) {
  try {
    await mcpManager.removeServer(message.serverId);
    var remainingServers = await mcpManager.getServersSummary();
    var bTools = mcpManager.getBuiltinAgentTools();
    webview.postMessage({
      type: 'mcpServersLoaded',
      servers: remainingServers,
      builtinAgentTools: bTools
    });
  } catch (remErr) {
    console.error('[MCP] Failed to remove MCP server:', remErr ? remErr.message : remErr);
  }
}

export async function handleToggleMcpServer(message, webview) {
  try {
    await mcpManager.toggleServer(message.serverId, message.enabled);
    var toggledServers = await mcpManager.getServersSummary();
    var bTools = mcpManager.getBuiltinAgentTools();
    webview.postMessage({
      type: 'mcpServersLoaded',
      servers: toggledServers,
      builtinAgentTools: bTools
    });
  } catch (togErr) {
    console.error('[MCP] Failed to toggle MCP server:', togErr ? togErr.message : togErr);
  }
}

export async function handleToggleMcpTool(message, webview) {
  try {
    await mcpManager.toggleServerTool(message.serverId, message.toolName, message.enabled);
    var toolToggledServers = await mcpManager.getServersSummary();
    var bTools = mcpManager.getBuiltinAgentTools();
    webview.postMessage({
      type: 'mcpServersLoaded',
      servers: toolToggledServers,
      builtinAgentTools: bTools
    });
  } catch (toolTogErr) {
    console.error('[MCP] Failed to toggle MCP tool:', toolTogErr ? toolTogErr.message : toolTogErr);
  }
}

export async function handleToggleBuiltinTool(message, webview) {
  try {
    await mcpManager.toggleBuiltinTool(message.toolName, message.enabled);
    var currentServers = await mcpManager.getServersSummary();
    var updatedBuiltinTools = mcpManager.getBuiltinAgentTools();
    webview.postMessage({
      type: 'mcpServersLoaded',
      servers: currentServers,
      builtinAgentTools: updatedBuiltinTools
    });
  } catch (builtinToolErr) {
    console.error('[MCP] Failed to toggle builtin agent tool:', builtinToolErr ? builtinToolErr.message : builtinToolErr);
  }
}

export async function handleToggleAllBuiltinTools(message, webview) {
  try {
    await mcpManager.toggleAllBuiltinTools(message.enabled);
    var curServers = await mcpManager.getServersSummary();
    var allBTools = mcpManager.getBuiltinAgentTools();
    webview.postMessage({
      type: 'mcpServersLoaded',
      servers: curServers,
      builtinAgentTools: allBTools
    });
  } catch (allBuiltinErr) {
    console.error('[MCP] Failed to toggle all builtin agent tools:', allBuiltinErr ? allBuiltinErr.message : allBuiltinErr);
  }
}

export async function handleRefreshMcpServer(message, webview) {
  try {
    await mcpManager.refreshServer(message.serverId);
    var refreshedServers = await mcpManager.getServersSummary();
    var bTools = mcpManager.getBuiltinAgentTools();
    webview.postMessage({
      type: 'mcpServersLoaded',
      servers: refreshedServers,
      builtinAgentTools: bTools
    });
  } catch (refErr) {
    console.error('[MCP] Failed to refresh MCP server:', refErr ? refErr.message : refErr);
  }
}
