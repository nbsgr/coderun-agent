// mcp-manager.js (UI side)
// Manages MCP server configuration forms, transport cards, and tool toggles
// Strict traditional function declarations only

import { vscode } from '../controller/vscode-api.js';

export function requestMcpServers() {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({ type: 'loadMcpServers' });
  }
}

export function addMcpServerFromUi(serverConfig) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'addMcpServer',
      server: serverConfig
    });
  }
}

export function removeMcpServerFromUi(serverId) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'removeMcpServer',
      serverId: serverId
    });
  }
}

export function toggleMcpServerFromUi(serverId, enabled) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'toggleMcpServer',
      serverId: serverId,
      enabled: Boolean(enabled)
    });
  }
}

export function toggleMcpToolFromUi(serverId, toolName, enabled) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'toggleMcpTool',
      serverId: serverId,
      toolName: toolName,
      enabled: Boolean(enabled)
    });
  }
}

export function refreshMcpServerFromUi(serverId) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'refreshMcpServer',
      serverId: serverId
    });
  }
}
