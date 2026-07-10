// workspaceContext.js — Workspace folder detection

import * as vscode from 'vscode';

export function getWorkspaceFolder() {
  var folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return '';
  return folders[0].uri.fsPath;
}