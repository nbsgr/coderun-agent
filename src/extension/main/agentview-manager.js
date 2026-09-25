// agentview-manager.js (extension side)
// Registers and manages the Webview View Provider (sidebar) and Webview Panel (tab)
// Strict traditional function declarations only

import * as vscode from 'vscode';
import { getWebviewHtml, getWebviewLocalResourceRoots } from './html-manager.js';
import { uiresponse } from '../controller/UI-controller.js';

var currentWebviewView = null;
var currentWebviewPanel = null;
var activeWebviews = [];

export function getActiveWebview() {
  return currentWebviewView ? currentWebviewView.webview : (currentWebviewPanel ? currentWebviewPanel.webview : null);
}

export function getAllActiveWebviews() {
  return activeWebviews;
}

export function broadcastToAllWebviews(message) {
  for (var i = 0; i < activeWebviews.length; i++) {
    try {
      activeWebviews[i].postMessage(message);
    } catch (e) {
      console.debug('[AGENTVIEW] Failed to post message to webview:', e ? e.message : e);
    }
  }
}

export function createAgentViewProvider(context, statusBarItem) {
  return {
    resolveWebviewView: function resolveWebviewView(webviewView) {
      handleResolveWebviewView(webviewView, context, statusBarItem);
    }
  };
}

function handleResolveWebviewView(webviewView, context, statusBarItem) {
  currentWebviewView = webviewView;
  var webview = webviewView.webview;

  webview.options = {
    enableScripts: true,
    localResourceRoots: getWebviewLocalResourceRoots(context.extensionUri, context)
  };

  activeWebviews.push(webview);

  uiresponse(webviewView, context, statusBarItem);

  webview.html = getWebviewHtml(webview, context.extensionUri, context);

  webviewView.onDidDispose(function onDispose() {
    var idx = activeWebviews.indexOf(webview);
    if (idx !== -1) {
      activeWebviews.splice(idx, 1);
    }
    if (currentWebviewView === webviewView) {
      currentWebviewView = null;
    }
  });
}

export function createOrShowPanel(context, statusBarItem) {
  if (currentWebviewPanel) {
    currentWebviewPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  var panel = vscode.window.createWebviewPanel(
    'coderunPanel',
    'CodeRun Agent',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: getWebviewLocalResourceRoots(context.extensionUri, context)
    }
  );

  currentWebviewPanel = panel;
  var webview = panel.webview;
  activeWebviews.push(webview);

  uiresponse(panel, context, statusBarItem);

  webview.html = getWebviewHtml(webview, context.extensionUri, context);

  panel.onDidDispose(function onPanelDispose() {
    var idx = activeWebviews.indexOf(webview);
    if (idx !== -1) {
      activeWebviews.splice(idx, 1);
    }
    currentWebviewPanel = null;
  });
}
