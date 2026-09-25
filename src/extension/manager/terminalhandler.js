// terminalhandler.js (extension side)
// Handles direct terminal executions, file opening, and workspace folder queries
// Strict traditional function declarations only

import * as vscode from 'vscode';
import * as terminalManager from '../tools/terminalManager.js';
import * as pathSecurity from '../tools/pathSecurity.js';
import * as rulesLoader from '../context/rulesLoader.js';
import { getWorkspaceFolder } from '../context/workspaceContext.js';

export function handleRunInTerminal(message) {
  var cmdText = message.text || message.command || '';
  terminalManager.executeCommandLegacy(cmdText);
}

export function handleOpenFile(message) {
  if (!message.path) return;
  var wsPath = getWorkspaceFolder();
  var paths = rulesLoader.getRulesPaths(wsPath);
  if (message.path === paths.globalPath) {
    vscode.workspace.openTextDocument(message.path).then(function onOpenDoc(doc) {
      vscode.window.showTextDocument(doc);
    }, function onOpenDocErr(err) {
      console.error('[TERMINAL] Failed to open global rules file:', err);
    });
    return;
  }
  var safe = pathSecurity.resolveSafePath(message.path, wsPath);
  if (safe.safe) {
    vscode.workspace.openTextDocument(safe.canonicalPath).then(function onOpenDoc(doc) {
      vscode.window.showTextDocument(doc);
    }, function onOpenDocErr(err) {
      console.error('[TERMINAL] Failed to open file:', err);
    });
  } else {
    console.warn('[TERMINAL] Blocked unsafe openFile path:', message.path, safe.error);
  }
}

export function handleShowAlert(message) {
  if (message.message) {
    vscode.window.showErrorMessage(message.message);
  }
}

export function handleRequestWorkspaceFolder(webview) {
  if (webview && typeof webview.postMessage === 'function') {
    webview.postMessage({ type: 'workspaceFolder', path: getWorkspaceFolder() });
  }
}
