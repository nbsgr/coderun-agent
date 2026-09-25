// html-manager.js (extension side)
// Synchronously builds and returns the Webview HTML template with secure CSP,
// resource root resolution, and bootstrap scripts.
// Strict traditional function declarations only

import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { getWorkspaceFolder } from '../context/workspaceContext.js';
import * as config from '../agents/config.js';
import * as mediaManager from '../media/mediaManager.js';

export function getNonce() {
  return crypto.randomBytes(16).toString('hex');
}

export function getWebviewLocalResourceRoots(extensionUri, ctx) {
  var roots = [
    vscode.Uri.file(path.join(extensionUri.fsPath, 'src')),
    vscode.Uri.file(path.join(extensionUri.fsPath, 'src', 'UI')),
    extensionUri
  ];
  if (ctx && ctx.globalStorageUri) {
    roots.push(ctx.globalStorageUri);
    roots.push(vscode.Uri.file(path.join(ctx.globalStorageUri.fsPath, 'media')));
  }
  var defStorage = mediaManager.getDefaultMediaStoragePath();
  if (defStorage) {
    roots.push(vscode.Uri.file(defStorage));
    roots.push(vscode.Uri.file(path.join(defStorage, 'media')));
  }
  var ws = getWorkspaceFolder();
  if (ws) {
    roots.push(vscode.Uri.file(ws));
  }
  if (vscode.workspace && vscode.workspace.workspaceFolders) {
    for (var i = 0; i < vscode.workspace.workspaceFolders.length; i++) {
      roots.push(vscode.workspace.workspaceFolders[i].uri);
    }
  }
  return roots;
}

export function getWebviewHtml(webview, extensionUri, extensionContext) {
  var uiPath = path.join(extensionUri.fsPath, 'src', 'UI');
  var nonce = getNonce();
  var cb = Date.now();

  var dashboardCss = webview.asWebviewUri(vscode.Uri.file(path.join(uiPath, 'dashboard', 'dashboard.css'))).toString() + '?cb=' + cb;
  var chatSpaceCss = webview.asWebviewUri(vscode.Uri.file(path.join(uiPath, 'chats', 'chat.css'))).toString() + '?cb=' + cb;
  var subagentPanelCss = webview.asWebviewUri(vscode.Uri.file(path.join(uiPath, 'chats', 'SubagentPanel.css'))).toString() + '?cb=' + cb;
  var markdownJs = webview.asWebviewUri(vscode.Uri.file(path.join(uiPath, 'MarkdownRenderer.js'))).toString() + '?cb=' + cb;
  var webviewSharedJs = webview.asWebviewUri(vscode.Uri.file(path.join(uiPath, 'webview-shared.js'))).toString() + '?cb=' + cb;
  var dashboardJs = webview.asWebviewUri(vscode.Uri.file(path.join(uiPath, 'dashboard', 'dashboard.js'))).toString() + '?cb=' + cb;
  var chatSpaceJs = webview.asWebviewUri(vscode.Uri.file(path.join(uiPath, 'chats', 'chats.js'))).toString() + '?cb=' + cb;
  var subagentPanelJs = webview.asWebviewUri(vscode.Uri.file(path.join(uiPath, 'chats', 'SubagentPanel.js'))).toString() + '?cb=' + cb;
  var botAvatarUri = webview.asWebviewUri(vscode.Uri.file(path.join(uiPath, 'bot-avatar.jpg'))).toString();
  var logoUri = webview.asWebviewUri(vscode.Uri.file(path.join(extensionUri.fsPath, 'logo.png'))).toString();
  var userAvatarUri = webview.asWebviewUri(vscode.Uri.file(path.join(uiPath, 'user-avatar.svg'))).toString();

  var mediaDirPath = '';
  var mediaRootUri = '';
  if (extensionContext && extensionContext.globalStorageUri) {
    var mediaDiskFolder = path.join(extensionContext.globalStorageUri.fsPath, 'media');
    mediaDirPath = mediaDiskFolder;
    mediaRootUri = webview.asWebviewUri(vscode.Uri.file(mediaDiskFolder)).toString();
  }

  var workspaceFolder = getWorkspaceFolder();
  var cfg = config.getConfig();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data: blob:; media-src ${webview.cspSource} https: data: blob:; font-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-eval'; connect-src https: http:;">
  <title>CodeRun Agent</title>
  <style>
    html, body {
      width: 100% !important;
      height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
    }
    #app {
      width: 100% !important;
      height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
    }
  </style>
  <link rel="stylesheet" href="${dashboardCss}">
  <link rel="stylesheet" href="${chatSpaceCss}">
  <link rel="stylesheet" href="${subagentPanelCss}">
</head>
<body>
  <div id="app"></div>

  <script nonce="${nonce}">
    window.CODERUN_CONFIG = ${JSON.stringify({ provider: cfg.provider, baseUrl: cfg.baseUrl, model: cfg.model })};
    window.WORKSPACE_FOLDER = ${JSON.stringify(workspaceFolder)};
    window.CODERUN_BOT_AVATAR = "${botAvatarUri}";
    window.CODERUN_LOGO_URI = "${logoUri}";
    window.CODERUN_USER_AVATAR = "${userAvatarUri}";
    window.CODERUN_MEDIA_DIR_PATH = ${JSON.stringify(mediaDirPath)};
    window.CODERUN_MEDIA_ROOT_URI = ${JSON.stringify(mediaRootUri)};
    window.VSCODE = true;
    try {
      const vscode = acquireVsCodeApi();
      window.VSCODE_API = vscode;
      console.log("[CODERUN WEBVIEW] VS Code API acquired");
    } catch(e) {
      console.error("[CODERUN WEBVIEW] Failed to acquire VS Code API:", e);
    }
  </script>

  <script nonce="${nonce}" src="${markdownJs}"></script>
  <script nonce="${nonce}" src="${webviewSharedJs}"></script>
  <script nonce="${nonce}" src="${dashboardJs}"></script>
  <script nonce="${nonce}" src="${chatSpaceJs}"></script>

  <script nonce="${nonce}">
    console.log("[CODERUN WEBVIEW] Scripts loaded, calling renderDashboard...");
    if (typeof renderDashboard === 'function') {
      renderDashboard(document.getElementById('app'));
    } else {
      document.getElementById('app').innerHTML = '<div style="color:red;padding:20px;">Error: renderDashboard not found</div>';
    }
  </script>
</body>
</html>`;
}
