// traces-manager.js (UI side)
// Renders execution trace trees, LLM step cards, and trace copy/export actions
// Strict traditional function declarations only

import { vscode } from '../controller/vscode-api.js';

export function requestTraces(sessionId) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'getTraces',
      sessionId: sessionId
    });
  }
}

export function requestSubagentTraces(sessionId) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'getSubagentTraces',
      sessionId: sessionId
    });
  }
}

export function copyTraceToClipboard(trace) {
  if (!trace) return;
  var jsonStr = JSON.stringify(trace, null, 2);
  if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(jsonStr).catch(function onCopyErr(err) {
      console.warn('[TRACES UI] Clipboard write failed:', err);
    });
  }
}
