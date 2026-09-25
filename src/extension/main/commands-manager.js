// commands-manager.js (extension side)
// Registers and handles VS Code command palette actions
// Strict traditional function declarations only

import * as vscode from 'vscode';
import { getWorkspaceFolder } from '../context/workspaceContext.js';
import * as checkpointManager from '../tools/checkpointManager.js';

export function handleOpenSidebarCommand() {
  vscode.commands.executeCommand('coderun.chatView.focus');
}

export function handleOpenPanelCommand(context, createOrShowPanelFn) {
  if (typeof createOrShowPanelFn === 'function') {
    createOrShowPanelFn(context.extensionUri);
  }
}

export function handleNewChatCommand(currentWebviewRef) {
  if (currentWebviewRef && typeof currentWebviewRef.postMessage === 'function') {
    currentWebviewRef.postMessage({ type: 'newChat' });
  }
}

export async function handleUndoLastEditCommand(currentWebviewRef) {
  var ws = getWorkspaceFolder();
  if (!ws) {
    vscode.window.showInformationMessage('No workspace folder open');
    return;
  }
  var result = await checkpointManager.undoLast(ws, null);
  if (result && result.success) {
    vscode.window.showInformationMessage(result.message);
    if (currentWebviewRef && typeof currentWebviewRef.postMessage === 'function') {
      currentWebviewRef.postMessage({ type: 'undoComplete', message: result.message });
    }
  } else {
    vscode.window.showInformationMessage((result && result.message) || 'Nothing to undo');
  }
}
