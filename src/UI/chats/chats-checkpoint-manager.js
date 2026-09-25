// chats-checkpoint-manager.js (UI side)
// Manages file mutation checkpoint cards and rollback actions
// Strict traditional function declarations only

import { vscode } from '../controller/vscode-api.js';

export function rollbackCheckpointFromUi(checkpointId, filePath, sessionId) {
  if (!checkpointId && !filePath) return;
  console.log('[CODERUN UI] Rolling back checkpoint:', checkpointId || filePath);
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'undoCheckpoint',
      checkpointId: checkpointId,
      filePath: filePath,
      sessionId: sessionId
    });
  }
}

export function handleUndoComplete(message) {
  console.log('[CODERUN UI] Undo complete notification:', message.message);
}
