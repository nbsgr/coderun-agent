// diffshandler.js (extension side)
// Handles interactive diff reviews, patch application, and checkpoint undo actions
// Strict traditional function declarations only

import * as vscode from 'vscode';
import { getWorkspaceFolder } from '../context/workspaceContext.js';
import * as diffManager from '../tools/diffManager.js';
import * as checkpointManager from '../tools/checkpointManager.js';
import * as subagentManager from '../agents/subagentManager.js';

export async function handleAcceptDiff(message, webview) {
  var wsPath = getWorkspaceFolder();
  var diffSessionId = message.sessionId || message.conversationId;
  var result = await diffManager.applyPatch(message.diffId, wsPath, diffSessionId);
  if (subagentManager && typeof subagentManager.updateSubagentDiffStatus === 'function') {
    subagentManager.updateSubagentDiffStatus(message.diffId, 'approved');
  }
  webview.postMessage({ type: 'diffResult', diffId: message.diffId, sessionId: diffSessionId, result: result });
}

export async function handleAcceptAllDiffs(message, webview) {
  var wsPath = getWorkspaceFolder();
  var diffSessionId = message.sessionId || message.conversationId;
  var results = await diffManager.acceptAll(wsPath, diffSessionId);
  if (subagentManager && typeof subagentManager.updateSubagentDiffStatus === 'function' && Array.isArray(results)) {
    for (var rIdx = 0; rIdx < results.length; rIdx++) {
      if (results[rIdx] && results[rIdx].diffId) {
        subagentManager.updateSubagentDiffStatus(results[rIdx].diffId, results[rIdx].success ? 'approved' : 'rejected');
      }
    }
  }
  webview.postMessage({ type: 'diffAllResult', sessionId: diffSessionId, results: results });
}

export function handleRejectDiff(message, webview) {
  if (!message.diffId) return;
  var diffSessionId = message.sessionId || message.conversationId;
  var result = diffManager.rejectPatch(message.diffId, diffSessionId);
  if (subagentManager && typeof subagentManager.updateSubagentDiffStatus === 'function') {
    subagentManager.updateSubagentDiffStatus(message.diffId, 'rejected');
  }
  webview.postMessage({ type: 'diffResult', diffId: message.diffId, sessionId: diffSessionId, result: result });
}

export function handleRejectAllDiffs(message, webview) {
  var diffSessionId = message.sessionId || message.conversationId;
  var results = diffManager.rejectAll(diffSessionId);
  if (subagentManager && typeof subagentManager.updateSubagentDiffStatus === 'function' && Array.isArray(results)) {
    for (var rIdx2 = 0; rIdx2 < results.length; rIdx2++) {
      if (results[rIdx2] && results[rIdx2].diffId) {
        subagentManager.updateSubagentDiffStatus(results[rIdx2].diffId, 'rejected');
      }
    }
  }
  webview.postMessage({ type: 'diffAllResult', sessionId: diffSessionId, results: results });
}

export function handleOpenDiffEditor(message) {
  if (message.diffId) {
    var wsPath = getWorkspaceFolder();
    var diffSessionId = message.sessionId || message.conversationId;
    diffManager.openDiffEditor(message.diffId, wsPath, diffSessionId);
  }
}

export async function handleUndoFile(message, webview) {
  var wsPath = getWorkspaceFolder();
  var undoSessionId = message.sessionId || message.conversationId;
  var result;
  if (message.path) {
    result = await checkpointManager.undoFile(message.path, wsPath, undoSessionId);
  } else {
    result = await checkpointManager.undoLast(wsPath, undoSessionId);
  }
  if (result && result.success) {
    vscode.window.showInformationMessage(result.message);
    webview.postMessage({ type: 'undoComplete', message: result.message });
  } else {
    var errMsg = (result && result.message) || 'Nothing to undo';
    vscode.window.showInformationMessage(errMsg);
    webview.postMessage({ type: 'undoComplete', message: errMsg });
  }
}

export async function handleUndoCheckpoint(message, webview) {
  var wsPath = getWorkspaceFolder();
  var undoSessionId = message.sessionId || message.conversationId;
  var result = null;
  if (message.checkpointId) {
    result = await checkpointManager.undoCheckpointById(message.checkpointId, wsPath, undoSessionId);
  } else if (message.filePath) {
    result = await checkpointManager.undoFile(message.filePath, wsPath, undoSessionId);
  }
  webview.postMessage({
    type: 'undoCheckpointResult',
    filePath: (result && result.filePath) || message.filePath,
    checkpointId: message.checkpointId,
    success: result ? result.success : false,
    message: result ? result.message : 'Failed'
  });
  if (result && result.success) {
    if (subagentManager && typeof subagentManager.markSubagentDiffUndone === 'function') {
      subagentManager.markSubagentDiffUndone(message.filePath || (result && result.filePath), message.checkpointId);
    }
    vscode.window.showInformationMessage(result.message);
  }
}
