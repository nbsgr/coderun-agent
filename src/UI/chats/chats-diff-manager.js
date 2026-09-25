// chats-diff-manager.js (UI side)
// Manages interactive diff cards, patch reviews, and resolutions
// Strict traditional function declarations only

import { vscode } from '../controller/vscode-api.js';

export function resolveDiffFromUi(diffId, accepted, sessionId) {
  if (!diffId) return;
  console.log('[CODERUN UI] Resolving diff:', diffId, 'accepted:', accepted);
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: accepted ? 'acceptDiff' : 'rejectDiff',
      diffId: diffId,
      sessionId: sessionId
    });
  }
}

export function handleDiffResult(message) {
  var diffId = message.diffId;
  var card = document.getElementById('diff_' + diffId);
  if (card) {
    var actionDiv = card.querySelector('.cr-diff-actions');
    if (actionDiv) {
      if (message.result && message.result.success) {
        actionDiv.innerHTML = '<span class="cr-diff-status accepted">✓ Changes Applied</span>';
      } else {
        var errText = (message.result && (message.result.error || message.result.message)) || 'Failed';
        actionDiv.innerHTML = '<span class="cr-diff-status error">✗ ' + escapeHtml(errText) + '</span>';
      }
    }
  }
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
