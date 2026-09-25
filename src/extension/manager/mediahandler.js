// mediahandler.js (extension side)
// Handles media requests from UI: workspace copying, base64 resolution,
// and markdown/JSON media URI transformations.
// Strict traditional function declarations only

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getWorkspaceFolder } from '../context/workspaceContext.js';
import * as mediaManager from '../media/mediaManager.js';

export function convertPathToWebviewUri(webview, filePath) {
  if (!filePath || typeof filePath !== 'string' || !webview || !webview.asWebviewUri) return filePath;
  try {
    return webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
  } catch (err) {
    console.debug('[MEDIA] convertPathToWebviewUri error:', err ? err.message : err);
    return filePath;
  }
}

export function rewriteMarkdownMediaPaths(webview, text) {
  if (!text || typeof text !== 'string' || !webview || !webview.asWebviewUri) return text;
  function onMarkdownMediaMatch(match, alt, src) {
    var cleanSrc = String(src || '').trim();
    if (cleanSrc.startsWith('http://') || cleanSrc.startsWith('https://') || cleanSrc.startsWith('vscode-webview:') || cleanSrc.startsWith('data:')) {
      return match;
    }
    var webviewUri = convertPathToWebviewUri(webview, cleanSrc);
    return '![' + alt + '](' + webviewUri + ')';
  }
  return text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, onMarkdownMediaMatch);
}

export function convertMediaPathsToWebviewUris(webview, obj) {
  if (!obj || typeof obj !== 'object') return obj;
  try {
    var mediaObj = obj.media || (obj.message && obj.message.media) || obj;
    if (mediaObj && mediaObj.filePath && typeof mediaObj.filePath === 'string') {
      mediaObj.webviewUri = convertPathToWebviewUri(webview, mediaObj.filePath);
    }
    if (obj.filePath && typeof obj.filePath === 'string') {
      obj.webviewUri = convertPathToWebviewUri(webview, obj.filePath);
    }
    if (obj.media && typeof obj.media === 'object') {
      if (obj.media.filePath && typeof obj.media.filePath === 'string') {
        obj.media.webviewUri = convertPathToWebviewUri(webview, obj.media.filePath);
      }
    }
    if (obj.message && typeof obj.message === 'object') {
      if (obj.message.media && typeof obj.message.media.filePath === 'string') {
        obj.message.media.webviewUri = convertPathToWebviewUri(webview, obj.message.media.filePath);
      }
      if (typeof obj.message.content === 'string') {
        obj.message.content = rewriteMarkdownMediaPaths(webview, obj.message.content);
      }
    }
    if (typeof obj.content === 'string') {
      obj.content = rewriteMarkdownMediaPaths(webview, obj.content);
    }
    if (typeof obj.full_content === 'string') {
      obj.full_content = rewriteMarkdownMediaPaths(webview, obj.full_content);
    }
  } catch (err) {
    console.debug('[MEDIA] convertMediaPathsToWebviewUris error:', err ? err.message : err);
  }
  return obj;
}

export function convertStoredConversationsToWebviewUris(webview, storedRaw) {
  if (!storedRaw || !webview || !webview.asWebviewUri) return storedRaw;
  try {
    var convs = typeof storedRaw === 'string' ? JSON.parse(storedRaw) : storedRaw;
    if (!Array.isArray(convs)) return storedRaw;
    for (var ci = 0; ci < convs.length; ci++) {
      var conv = convs[ci];
      if (conv && Array.isArray(conv.messages)) {
        for (var mi = 0; mi < conv.messages.length; mi++) {
          convertMediaPathsToWebviewUris(webview, conv.messages[mi]);
        }
      }
    }
    return JSON.stringify(convs);
  } catch (err) {
    console.debug('[MEDIA] convertStoredConversationsToWebviewUris parse error:', err ? err.message : err);
    return storedRaw;
  }
}

export async function handleSaveMediaToWorkspace(message, webview, extensionContext) {
  var rawPath = message.sourcePath || message.filePath || '';
  if (!rawPath) return;

  try {
    var ws = getWorkspaceFolder();
    if (!ws) throw new Error('No workspace folder open in VS Code. Please open a workspace folder first.');
    var mediaFolder = extensionContext && extensionContext.globalStorageUri ? path.join(extensionContext.globalStorageUri.fsPath, 'media') : mediaManager.getDefaultMediaStoragePath();
    var resolvedSourcePath = rawPath;

    if (typeof rawPath === 'string' && rawPath.startsWith('data:')) {
      var savedFromData = await mediaManager.saveMediaFromDataOrUrl(mediaFolder, 'save_' + Date.now(), rawPath);
      if (savedFromData && savedFromData.filePath) {
        resolvedSourcePath = savedFromData.filePath;
      }
    } else if (typeof rawPath === 'string' && (rawPath.startsWith('http://') || rawPath.startsWith('https://')) && rawPath.indexOf('vscode-resource') === -1 && rawPath.indexOf('vscode-cdn') === -1) {
      var savedFromUrl = await mediaManager.saveMediaFromDataOrUrl(mediaFolder, 'download_' + Date.now(), rawPath);
      if (savedFromUrl && savedFromUrl.filePath) {
        resolvedSourcePath = savedFromUrl.filePath;
      }
    } else if (!fs.existsSync(resolvedSourcePath)) {
      var decoded = '';
      try {
        decoded = decodeURIComponent(resolvedSourcePath.split('?')[0].split('#')[0]);
      } catch (decErr) {
        console.debug('[MEDIA] URI decode error:', decErr ? decErr.message : decErr);
        decoded = resolvedSourcePath.split('?')[0].split('#')[0];
      }
      var winPathMatch = decoded.match(/([a-zA-Z]:[\\\/].+)$/);
      if (winPathMatch && fs.existsSync(winPathMatch[1])) {
        resolvedSourcePath = winPathMatch[1];
      } else {
        var cleanBase = path.basename(decoded);
        var candidatePath = mediaFolder ? path.join(mediaFolder, cleanBase) : '';
        if (candidatePath && fs.existsSync(candidatePath)) {
          resolvedSourcePath = candidatePath;
        } else if (mediaFolder && fs.existsSync(mediaFolder)) {
          var mediaFiles = fs.readdirSync(mediaFolder);
          for (var fi = 0; fi < mediaFiles.length; fi++) {
            if (mediaFiles[fi] === cleanBase || cleanBase.indexOf(mediaFiles[fi]) !== -1 || mediaFiles[fi].indexOf(cleanBase) !== -1) {
              resolvedSourcePath = path.join(mediaFolder, mediaFiles[fi]);
              break;
            }
          }
        }
      }
    }

    var targetRel = message.targetRelPath || path.basename(resolvedSourcePath.split('?')[0]);
    if (!targetRel || targetRel === '.' || targetRel === '/') {
      targetRel = 'assets/' + path.basename(resolvedSourcePath);
    }
    var savedDest = await mediaManager.copyMediaToWorkspace(resolvedSourcePath, targetRel, ws);
    var relDisplay = path.relative(ws, savedDest);

    function onSavedAction(action) {
      if (action === 'Open File') {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(savedDest));
      }
    }
    vscode.window.showInformationMessage('Image saved to workspace: ' + relDisplay, 'Open File').then(onSavedAction);

    webview.postMessage({
      type: 'mediaSavedResult',
      success: true,
      path: savedDest,
      relPath: relDisplay,
      sourcePath: rawPath,
      reqId: message.reqId
    });
  } catch (err) {
    vscode.window.showErrorMessage('Failed to save media: ' + err.message);
    webview.postMessage({
      type: 'mediaSavedResult',
      success: false,
      error: err.message,
      sourcePath: rawPath,
      reqId: message.reqId
    });
  }
}

export async function handleGetMediaData(message, webview, extensionContext) {
  var reqPath = message.path || message.filePath || '';
  if (!reqPath) return;

  try {
    var mediaFolder = extensionContext && extensionContext.globalStorageUri ? path.join(extensionContext.globalStorageUri.fsPath, 'media') : mediaManager.getDefaultMediaStoragePath();
    var resolvedFile = reqPath;
    if (!fs.existsSync(resolvedFile)) {
      var decoded = '';
      try {
        decoded = decodeURIComponent(resolvedFile.split('?')[0].split('#')[0]);
      } catch (decErr) {
        console.debug('[MEDIA] URI decode error:', decErr ? decErr.message : decErr);
        decoded = resolvedFile.split('?')[0].split('#')[0];
      }
      var winMatch = decoded.match(/([a-zA-Z]:[\\\/].+)$/);
      if (winMatch && fs.existsSync(winMatch[1])) {
        resolvedFile = winMatch[1];
      } else {
        var cleanName = path.basename(decoded);
        var candidate = mediaFolder ? path.join(mediaFolder, cleanName) : '';
        if (candidate && fs.existsSync(candidate)) {
          resolvedFile = candidate;
        } else if (mediaFolder && fs.existsSync(mediaFolder)) {
          var allFiles = fs.readdirSync(mediaFolder);
          for (var afi = 0; afi < allFiles.length; afi++) {
            if (allFiles[afi] === cleanName || cleanName.indexOf(allFiles[afi]) !== -1 || allFiles[afi].indexOf(cleanName) !== -1) {
              resolvedFile = path.join(mediaFolder, allFiles[afi]);
              break;
            }
          }
        }
      }
    }
    if (fs.existsSync(resolvedFile)) {
      var fileBuf = await fs.promises.readFile(resolvedFile);
      var ext = path.extname(resolvedFile).replace(/^\./, '').toLowerCase() || 'png';
      var mimeType = 'image/png';
      if (ext === 'jpg' || ext === 'jpeg') {
        mimeType = 'image/jpeg';
      } else if (ext === 'webp') {
        mimeType = 'image/webp';
      } else if (ext === 'gif') {
        mimeType = 'image/gif';
      } else if (ext === 'mp4') {
        mimeType = 'video/mp4';
      }
      var dataUri = 'data:' + mimeType + ';base64,' + fileBuf.toString('base64');
      webview.postMessage({
        type: 'mediaDataResult',
        success: true,
        path: reqPath,
        resolvedPath: resolvedFile,
        dataUri: dataUri
      });
    } else {
      webview.postMessage({
        type: 'mediaDataResult',
        success: false,
        path: reqPath,
        error: 'File not found on disk'
      });
    }
  } catch (readErr) {
    webview.postMessage({
      type: 'mediaDataResult',
      success: false,
      path: reqPath,
      error: readErr.message
    });
  }
}
