// chats-subagent-manager.js (UI side)
// Manages child subagent cards, status pills, and execution monitoring
// Strict traditional function declarations only

import { vscode } from '../controller/vscode-api.js';

export function pauseSubagentFromUi(agentId, sessionId) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({ type: 'pauseSubagent', agentId: agentId, sessionId: sessionId });
  }
}

export function resumeSubagentFromUi(agentId, sessionId) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({ type: 'resumeSubagent', agentId: agentId, sessionId: sessionId });
  }
}

export function stopSubagentFromUi(agentId, sessionId) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({ type: 'stopSubagent', agentId: agentId, sessionId: sessionId });
  }
}
