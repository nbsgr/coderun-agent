// tools-handler.js (UI side)
// IPC communication handler for tool permission requests and responses
// Pure functions, traditional function declarations only

import { vscode } from './vscode-api.js';

export function handleToolPermissionRequest(message) {
  if (!message) return;

  var requestId = message.requestId || (message.event && message.event.id);
  var toolName = message.tool || (message.event && message.event.tool) || '';
  var args = message.arguments || message.params || (message.event && message.event.arguments) || {};
  var sessionId = message.sessionId || (message.event && message.event.sessionId) || '';

  console.log('[CODERUN UI] Handling permission request for tool:', toolName, 'ID:', requestId);

  if (typeof window.renderToolPermissionCard === 'function') {
    window.renderToolPermissionCard(requestId, toolName, args, sessionId);
  }
}

export function sendToolPermissionResponse(requestId, approved, always, toolName, sessionId) {
  console.log('[CODERUN UI] Sending permission response for:', requestId, 'approved:', approved);

  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'permissionResponse',
      toolCallId: requestId,
      approved: Boolean(approved),
      always: Boolean(always),
      tool: toolName,
      sessionId: sessionId
    });
  }
}
