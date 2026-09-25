// permission-card.js (UI side)
// Renders and manages interactive tool permission approval cards in the Webview
// Strict traditional function declarations only

import { vscode } from '../controller/vscode-api.js';

export function sendPermissionResponse(toolCallId, approved, always, toolName, sessionId) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'permissionResponse',
      toolCallId: toolCallId,
      approved: Boolean(approved),
      always: Boolean(always),
      tool: toolName,
      sessionId: sessionId
    });
  }
}

export function buildPermissionCardHtml(req) {
  var toolName = escapeHtml(req.tool || 'Unknown Tool');
  var toolCallId = escapeHtml(req.id || '');
  var sessionId = escapeHtml(req.sessionId || '');
  var argsStr = escapeHtml(JSON.stringify(req.arguments || {}, null, 2));

  return `
    <div class="cr-permission-card" id="perm_${toolCallId}">
      <div class="cr-permission-header">
        <span class="cr-permission-icon">🛡️</span>
        <span class="cr-permission-title">Permission Required: <strong>${toolName}</strong></span>
      </div>
      <div class="cr-permission-body">
        <pre class="cr-permission-args"><code>${argsStr}</code></pre>
      </div>
      <div class="cr-permission-actions">
        <button class="cr-btn cr-btn-primary" onclick="window.handlePermAction('${toolCallId}', true, false, '${toolName}', '${sessionId}')">Allow</button>
        <button class="cr-btn cr-btn-secondary" onclick="window.handlePermAction('${toolCallId}', true, true, '${toolName}', '${sessionId}')">Always Allow</button>
        <button class="cr-btn cr-btn-danger" onclick="window.handlePermAction('${toolCallId}', false, false, '${toolName}', '${sessionId}')">Deny</button>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
