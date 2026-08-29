// extension.js — CodeRun AI Agent Extension
// All provider settings (URL, model, provider) are read from VS Code user settings.
// API key is stored in VS Code secrets.

import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { runAgent } from './agents/agent.js';
import * as agentLoop from './agents/agentLoop.js';
import { registerAllTools } from './tools/tools.js';
import * as config from './agents/config.js';
import * as providerManager from './providers/providerManager.js';
import { getWorkspaceFolder } from './context/workspaceContext.js';
import * as terminalManager from './tools/terminalManager.js';
import * as permissions from './tools/permissions.js';
import * as projectKnowledge from './context/projectKnowledge.js';
import * as checkpointManager from './tools/checkpointManager.js';
import * as diffManager from './tools/diffManager.js';
import * as pathSecurity from './tools/pathSecurity.js';
import * as workspaceIntelligence from './context/workspaceIntelligence.js';
import { PROVIDER_DEFAULTS } from './agents/constants.js';
import * as runtime from './agents/runtime.js';
import * as events from './agents/events.js';
import { buildCompactCheckpoint } from './context/compactionManager.js';
import * as executionTrace from './execution/executionTrace.js';
import * as rulesLoader from './context/rulesLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let statusBarItem;
let currentWebview = null;
let sidebarWebviewView = null;
let activeWebviews = { sidebar: null, panel: null, sessionWebviews: {} };
let extensionContext = null;
var abortControllers = {};

// =====================================================
// TOP LEVEL EVENT HANDLERS / HELPER FUNCTIONS
// =====================================================



function handleOpenSidebarCommand() {
  vscode.commands.executeCommand('coderun.chatView.focus');
}

function handleOpenPanelCommand(context) {
  createOrShowPanel(context.extensionUri);
}

function handleNewChatCommand() {
  if (currentWebview) {
    currentWebview.postMessage({ type: 'newChat' });
  }
}

async function handleUndoLastEditCommand() {
  var ws = getWorkspaceFolder();
  if (!ws) {
    vscode.window.showInformationMessage('No workspace folder open');
    return;
  }
  var result = await checkpointManager.undoLast(ws, null);
  if (result.success) {
    vscode.window.showInformationMessage(result.message);
    if (currentWebview) {
      currentWebview.postMessage({ type: 'undoComplete', message: result.message });
    }
  } else {
    vscode.window.showInformationMessage(result.message || 'Nothing to undo');
  }
}

function handleTerminalCloseEvent(terminal) {
  terminalManager.onTerminalClosed(terminal);
}

async function handleConfigurationChangeEvent(e) {
  if (e.affectsConfiguration('coderun')) {
    config.invalidateCache();
    if (currentWebview) {
      await sendCurrentSettings(currentWebview);
      await checkProviderHealth(currentWebview);
    }
  }
}

function handleFrontendMessageReceive(webview, message) {
  handleFrontendMessage(message, webview);
}

function sendAgentEventToWebview(webview, event) {
  webview.postMessage({ type: 'agentEvent', event: event });
}

function handleAskPermission(webview, toolName, args, id, sessionId) {
  var sid = sessionId || 'default';
  var chatDecision = permissions.getAlwaysDecision(toolName, sid);
  if (chatDecision) {
    webview.postMessage({
      type: 'agentEvent',
      event: {
        type: 'requestPermission',
        tool: toolName,
        arguments: args,
        id: id,
        sessionId: sid,
        autoResolved: true,
        decision: chatDecision
      }
    });
    return Promise.resolve(chatDecision === 'allow');
  }
  webview.postMessage({
    type: 'agentEvent',
    event: {
      type: 'requestPermission',
      tool: toolName,
      arguments: args,
      id: id,
      sessionId: sid
    }
  });
  return permissions.requestPermission(toolName, args, id, null, sid);
}

function handleAgentEvent(webview, event) {
  var eventForWebview = event;
  if (event && event.type === 'request_diff' && event.deferred) {
    // The deferred object (Promise + resolve function) cannot be serialized
    // through webview.postMessage. Strip it before sending to the UI.
    eventForWebview = {};
    for (var key in event) {
      if (key !== 'deferred') eventForWebview[key] = event[key];
    }
  }
  webview.postMessage({ type: 'agentEvent', event: eventForWebview });
  if (event.type === 'request_diff' && event.id) {
    diffManager.storePatch(event);
  }
}

function handleConfirmDeleteResult(webview, id, choice) {
  if (choice === 'Delete' && webview) {
    webview.postMessage({ type: 'deleteConversationConfirmed', id: id });
  }
}

function handleConfirmClearAllResult(webview, choice) {
  if (choice === 'Delete All' && webview) {
    webview.postMessage({ type: 'clearAllConversationsConfirmed' });
  }
}

function handleOpenTextDocumentResolve(doc) {
  vscode.window.showTextDocument(doc);
}

function handleOpenTextDocumentReject(err) {
  console.error('[CODERUN] Failed to open file:', err);
}

// =====================================================
// ACTIVATE
// =====================================================
export async function activate(context) {
  console.log('[CODERUN] Extension Activated');
  extensionContext = context;

  // Register all tools
  registerAllTools();

  // Give the permission system access to extensionContext for "always" persistence
  permissions.setExtensionContext(context);

  // Register terminal shell integration listeners
  terminalManager.registerTerminalListeners(context);

  // Initialize project knowledge base (SQLite, indexing, file watcher, memory)
  try {
    await projectKnowledge.initialize(context);
  } catch (err) {
    console.error('[CODERUN] projectKnowledge init failed:', err);
  }



  // Warm up workspace intelligence cache (non-blocking)
  workspaceIntelligence.scan(getWorkspaceFolder());

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'coderun.openSidebar';
  statusBarItem.text = '$(comment-discussion) CodeRun';
  statusBarItem.tooltip = 'Open CodeRun AI Agent';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('coderun.openSidebar', handleOpenSidebarCommand)
  );

  function onOpenPanelCommand() {
    handleOpenPanelCommand(context);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('coderun.openPanel', onOpenPanelCommand)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('coderun.newChat', handleNewChatCommand)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('coderun.undoLastEdit', handleUndoLastEditCommand)
  );

  // Sidebar provider
  var sidebarProvider = createSidebarWebviewViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('coderun.chatView', sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Terminal cleanup
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(handleTerminalCloseEvent)
  );

  // Config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(handleConfigurationChangeEvent)
  );

  // Rules file watcher
  var rulesWatcher = vscode.workspace.createFileSystemWatcher('**/.coderunrules');
  rulesWatcher.onDidChange(handleRulesChanged);
  rulesWatcher.onDidCreate(handleRulesChanged);
  rulesWatcher.onDidDelete(handleRulesChanged);
  context.subscriptions.push(rulesWatcher);
}

function handleRulesChanged() {
  rulesLoader.invalidateCache();
}

// =====================================================
// SIDEBAR WEBVIEW PROVIDER
// =====================================================
function createSidebarWebviewViewProvider(extensionUri) {
  function resolveWebviewView(webviewView, context, token) {
    handleResolveWebviewView(extensionUri, webviewView, context, token);
  }
  return {
    resolveWebviewView: resolveWebviewView
  };
}

function handleResolveWebviewView(extensionUri, webviewView, context, token) {
  console.log('[CODERUN] resolveWebviewView called');
  sidebarWebviewView = webviewView;
  activeWebviews.sidebar = webviewView.webview;

  webviewView.webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.file(path.join(extensionUri.fsPath, 'src'))]
  };

  webviewView.webview.html = getWebviewHtml(webviewView.webview, extensionUri);

  function onSidebarMessageReceive(msg) {
    handleFrontendMessageReceive(webviewView.webview, msg);
  }
  webviewView.webview.onDidReceiveMessage(onSidebarMessageReceive);

  currentWebview = webviewView.webview;
}

// =====================================================
// PANEL CREATOR
// =====================================================
function createOrShowPanel(extensionUri) {
  var panel = vscode.window.createWebviewPanel(
    'coderunPanel',
    'CodeRun Agent',
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(path.join(extensionUri.fsPath, 'src'))]
    }
  );

  activeWebviews.panel = panel.webview;

  panel.webview.html = getWebviewHtml(panel.webview, extensionUri);

  function onPanelMessageReceive(msg) {
    handleFrontendMessageReceive(panel.webview, msg);
  }
  panel.webview.onDidReceiveMessage(onPanelMessageReceive);

  panel.onDidDispose(function onPanelDispose() {
    if (activeWebviews.panel === panel.webview) {
      activeWebviews.panel = null;
    }
  });

  currentWebview = panel.webview;
}

// =====================================================
// HTML GENERATOR
// =====================================================
function getWebviewHtml(webview, extensionUri) {
  var srcPath = path.join(extensionUri.fsPath, 'src');
  var nonce = getNonce();

  var cb = Date.now();
  var dashboardCss = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'Dashboard.css'))).toString() + '?cb=' + cb;
  var chatSpaceCss = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'ChatSpace.css'))).toString() + '?cb=' + cb;
  var markdownJs = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'MarkdownRenderer.js'))).toString() + '?cb=' + cb;
  var webviewSharedJs = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'webview-shared.js'))).toString() + '?cb=' + cb;
  var dashboardJs = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'Dashboard.js'))).toString() + '?cb=' + cb;
  var chatSpaceJs = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'ChatSpace.js'))).toString() + '?cb=' + cb;

  var workspaceFolder = getWorkspaceFolder();
  var cfg = config.getConfig();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data: blob:; font-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-eval'; connect-src https: http:;">
  <title>CodeRun Agent</title>
  <link rel="stylesheet" href="${dashboardCss}">
  <link rel="stylesheet" href="${chatSpaceCss}">
</head>
<body>
  <div id="app"></div>

  <script nonce="${nonce}">
    window.CODERUN_CONFIG = ${JSON.stringify({ provider: cfg.provider, baseUrl: cfg.baseUrl, model: cfg.model })};
    window.WORKSPACE_FOLDER = ${JSON.stringify(workspaceFolder)};
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

function getNonce() {
  return crypto.randomBytes(16).toString('hex');
}

// =====================================================
// SEND CURRENT SETTINGS TO WEBVIEW
// =====================================================
async function sendCurrentSettings(webview) {
  var activeProvider = extensionContext?.globalState.get('coderun_selected_provider', '') || '';
  var cfg;
  if (activeProvider) {
    var saved = config.getSavedProviderConfig(extensionContext, activeProvider) || {};
    var isCompatible = activeProvider.startsWith('compatible');
    var defaults = isCompatible ? PROVIDER_DEFAULTS.compatible : (PROVIDER_DEFAULTS[activeProvider] || PROVIDER_DEFAULTS.ollama);
    var currentSelectedModel = extensionContext?.globalState.get('coderun_selected_model', '') || '';
    var selectedProv = extensionContext?.globalState.get('coderun_selected_provider', '') || '';
    var modelToUse = saved.model || (selectedProv === activeProvider ? currentSelectedModel : '');
    cfg = {
      provider: activeProvider,
      baseUrl: saved.baseUrl || defaults.baseUrl,
      model: modelToUse,
      maxIterations: config.getConfig().maxIterations,
      streaming: config.getConfig().streaming,
      showThinking: config.getConfig().showThinking,
      confirmDangerous: config.getConfig().confirmDangerous
    };
  } else {
    cfg = config.getConfig();
  }

  var hasKey = false;
  try {
    if (activeProvider) {
      var key = await config.getApiKey(extensionContext, activeProvider);
      var saved = config.getSavedProviderConfig(extensionContext, activeProvider);
      hasKey = (!!key && key.length > 0) || (saved && !!saved.apiKey);
    } else {
      var key = await config.getApiKey(extensionContext);
      hasKey = !!key && key.length > 0;
    }
  } catch (e) {
    // Intentionally fallback to false if reading keys from VS Code secret storage fails
    hasKey = false;
  }

  var providerConfigs = config.getAllProviderConfigs(extensionContext);

  webview.postMessage({
    type: 'currentSettings',
    settings: {
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      maxIterations: cfg.maxIterations,
      streaming: cfg.streaming,
      showThinking: cfg.showThinking,
      confirmDangerous: cfg.confirmDangerous,
      hasApiKey: hasKey
    },
    providerConfigs: providerConfigs
  });
}

// =====================================================
// FRONTEND MESSAGE HANDLER
// =====================================================
async function handleFrontendMessage(message, webview) {
  console.log('[CODERUN] Received message:', message.type || message.command);
  var msgType = message.type || message.command;

  switch (msgType) {
    case 'webviewReady': {
      var wsFolder = getWorkspaceFolder();
      webview.postMessage({ type: 'workspaceFolder', path: wsFolder });
      try {
        var stored = extensionContext?.globalState.get('coderun_conversations', '[]') || '[]';
        var selectedModel = extensionContext?.globalState.get('coderun_selected_model', '') || '';
        var selectedProvider = extensionContext?.globalState.get('coderun_selected_provider', '') || '';
        var pinnedModels = extensionContext?.globalState.get('coderun_pinned_models', {}) || {};
        webview.postMessage({ type: 'loadConversations', conversations: stored, selectedModel: selectedModel, selectedProvider: selectedProvider });
        webview.postMessage({ type: 'loadPinnedModels', pinnedModels: pinnedModels });
        webview.postMessage({
          type: 'permissionState',
          decisions: permissions.listAlwaysDecisions()
        });
      } catch (e) {
        console.error('[CODERUN] Failed to send initial data:', e);
      }
      await sendCurrentSettings(webview);
      await checkProviderHealth(webview);
      await refreshAllProviderModels(webview);
      break;
    }

    case 'startChat': {
      var userPrompt = message.message;
      var userImage = message.image || null;
      var history = message.history;
      var workspaceFolder = message.workspaceFolder;
      var plan = message.plan;
      var convSessionId = message.conversationId || message.sessionId || (history && history.length > 0 ? String(history[0].session_id || '') : '') || ('session_' + Date.now());

      if (!history || history.length === 0) {
        terminalManager.resetTerminal(convSessionId);
        permissions.resetChatDecisions(convSessionId);
      }

      var providerName = message.provider || '';
      var frontendModel = message.model || '';

      var providerConfig;
      if (providerName && (PROVIDER_DEFAULTS[providerName] || providerName.startsWith('compatible:'))) {
        providerConfig = await config.getProviderConfigByName(extensionContext, providerName);
      } else {
        providerConfig = await config.getProviderConfigWithKey(extensionContext);
      }

      if (frontendModel && frontendModel.trim()) {
        providerConfig.model = frontendModel.trim();
      }

      if (!providerConfig.model) {
        webview.postMessage({
          type: 'agentEvent',
          event: { type: 'stream_error', error: 'No model configured. Please select a model in the CodeRun model dropdown.' }
        });
        break;
      }

      if (config.needsApiKey(providerConfig.provider) && !providerConfig.apiKey) {
        webview.postMessage({
          type: 'agentEvent',
          event: { type: 'stream_error', error: 'API key required for ' + providerConfig.provider + '. Please set it in CodeRun settings.' }
        });
        break;
      }

      function onSendTerminalEvent(ev) {
        sendAgentEventToWebview(webview, ev);
      }
      terminalManager.setSendEventCallback(onSendTerminalEvent, convSessionId);

      abortControllers[convSessionId] = new AbortController();
      var abortCtrl = abortControllers[convSessionId];
      abortCtrl.stopped = false;

      try {
        console.log('[EXTENSION] Calling runAgent for sessionId:', convSessionId);

        function onAgentEvent(ev) {
          handleAgentEvent(webview, ev);
        }

        function onAskPermission(tool, args, tcId, sendEv, sId) {
          return handleAskPermission(webview, tool, args, tcId, sId || convSessionId);
        }

        await runAgent(userPrompt, providerConfig.model, workspaceFolder, history, providerConfig, onAgentEvent, onAskPermission, { signal: abortCtrl, image: userImage, sessionId: convSessionId, isContinuation: !!message.isContinuation });
        console.log('[EXTENSION] runAgent completed');
        if (extensionContext && extensionContext.globalStorageUri) {
          try {
            await executionTrace.saveTraceToDisk(extensionContext.globalStorageUri.fsPath, convSessionId);
          } catch (_) {}
        }
        webview.postMessage({ type: 'agentEvent', event: { type: 'stream_end', stopped: abortCtrl.stopped } });
      } catch (err) {
        console.error('[EXTENSION] Agent error:', err);
        var errMsg = err ? (err.message || String(err)) : 'Unknown error';
        var activeTraceSessionId = convSessionId;
        if (activeTraceSessionId) {
          try {
            var failedTrace = executionTrace.finishRun(activeTraceSessionId, 'failed', { error: errMsg });
            if (extensionContext && extensionContext.globalStorageUri) {
              await executionTrace.saveTraceToDisk(extensionContext.globalStorageUri.fsPath, activeTraceSessionId);
            }
            if (failedTrace) {
              webview.postMessage({ type: 'agentEvent', event: { type: 'trace_updated', sessionId: activeTraceSessionId, trace: failedTrace } });
            }
          } catch (_) {}
        }
        webview.postMessage({ type: 'agentEvent', event: { type: 'stream_error', error: errMsg } });
      } finally {
        console.log('[EXTENSION] runAgent finally block for sessionId:', convSessionId);
        delete abortControllers[convSessionId];
      }
      break;
    }

    case 'stopChat': {
      var stopSessionId = message.sessionId || message.conversationId || '';
      if (stopSessionId) {
        if (abortControllers[stopSessionId]) {
          try { abortControllers[stopSessionId].abort(); } catch (_) {}
          abortControllers[stopSessionId].stopped = true;
        }
        permissions.cancelSessionPending(stopSessionId);
        diffManager.cancelSession(stopSessionId);
        terminalManager.stopTerminal(stopSessionId);
      } else {
        for (var sidKey in abortControllers) {
          if (abortControllers[sidKey]) {
            try { abortControllers[sidKey].abort(); } catch (_) {}
            abortControllers[sidKey].stopped = true;
          }
        }
        permissions.cancelAllPermissions();
        diffManager.cancelAll();
        terminalManager.dispose();
      }
      break;
    }

    case 'permissionResponse': {
      var respSessionId = message.sessionId || message.conversationId || 'default';
      permissions.resolvePermission(
        message.toolCallId,
        !!message.approved,
        { always: !!message.always, tool: message.tool, toolName: message.tool, sessionId: respSessionId },
        respSessionId
      );
      break;
    }

    case 'clearPermissionDecision': {
      var clearSessionId = message.sessionId || message.conversationId;
      if (message.tool) {
        permissions.clearAlwaysDecision(message.tool, clearSessionId);
      } else {
        permissions.clearAlwaysDecision(null, clearSessionId);
      }
      webview.postMessage({
        type: 'permissionState',
        decisions: permissions.listAlwaysDecisions(clearSessionId)
      });
      break;
    }

    case 'showAlert': {
      if (message.message) vscode.window.showErrorMessage(message.message);
      break;
    }

    case 'confirmDelete': {
      function onConfirmDelete(res) {
        handleConfirmDeleteResult(webview, message.id, res);
      }
      vscode.window.showWarningMessage(
        'Delete this conversation?',
        { modal: true },
        'Delete'
      ).then(onConfirmDelete);
      break;
    }

    case 'confirmClearAll': {
      function onConfirmClearAll(res) {
        handleConfirmClearAllResult(webview, res);
      }
      vscode.window.showWarningMessage(
        'Delete ALL conversations? This cannot be undone.',
        { modal: true },
        'Delete All'
      ).then(onConfirmClearAll);
      break;
    }

    case 'runInTerminal':
    case 'terminalCommand': {
      terminalManager.executeCommandLegacy(message.text);
      break;
    }

    case 'requestWorkspaceFolder': {
      webview.postMessage({ type: 'workspaceFolder', path: getWorkspaceFolder() });
      break;
    }

    case 'saveConversations': {
      if (message.conversations && extensionContext) {
        try {
          await extensionContext.globalState.update('coderun_conversations', message.conversations);
        } catch (e) {
          console.error('[CODERUN] Failed to save conversations:', e);
        }
      }
      break;
    }

    case 'compactConversation': {
      var compactMessages = message.messages || [];
      var compactCheckpointNum = message.checkpointNumber || 1;
      var conversationId = message.conversationId || '';

      if (compactMessages.length < 2) {
        webview.postMessage({
          type: 'compactError',
          error: 'Not enough messages to compact.'
        });
        break;
      }

      try {
        var checkpoint = buildCompactCheckpoint(compactMessages, compactCheckpointNum);
        checkpoint.conversationId = conversationId;

        console.log('[CODERUN] Compact checkpoint created locally:', checkpoint.id, 'compactedUpTo:', checkpoint.compactedUpTo);

        webview.postMessage({
          type: 'compactCheckpoint',
          conversationId: conversationId,
          checkpoint: checkpoint
        });
      } catch (compactErr) {
        console.error('[CODERUN] Compaction failed:', compactErr);
        webview.postMessage({
          type: 'compactError',
          error: 'Compaction failed: ' + compactErr.message
        });
      }
      break;
    }

    case 'saveTrace': {
      if (message.sessionId && extensionContext) {
        try {
          var storagePath = extensionContext.globalStorageUri.fsPath;
          await executionTrace.saveTraceToDisk(storagePath, message.sessionId);
        } catch (e) {
          console.error('[CODERUN] Failed to save trace to disk:', e);
        }
      }
      break;
    }

    case 'getTraces': {
      if (message.sessionId && extensionContext) {
        try {
          var storagePath = extensionContext.globalStorageUri.fsPath;
          var traces = await executionTrace.loadTracesFromDisk(storagePath, message.sessionId);
          webview.postMessage({
            type: 'loadedTraces',
            sessionId: message.sessionId,
            traces: traces
          });
        } catch (e) {
          console.error('[CODERUN] Failed to load traces from disk:', e);
        }
      }
      break;
    }

    case 'saveSelectedModel': {
      if (message.model && extensionContext) {
        try {
          await extensionContext.globalState.update('coderun_selected_model', message.model);
        } catch (e) {
          console.error('[CODERUN] Failed to save model:', e);
        }
      }
      if (message.provider !== undefined && extensionContext) {
        try {
          await extensionContext.globalState.update('coderun_selected_provider', message.provider);
        } catch (e) {
          console.error('[CODERUN] Failed to save provider:', e);
        }
      }
      if (message.provider && message.model && extensionContext) {
        try {
          var existingCfg = config.getSavedProviderConfig(extensionContext, message.provider) || {};
          existingCfg.model = message.model;
          await config.saveProviderConfig(extensionContext, message.provider, existingCfg);
        } catch (e) {
          console.error('[CODERUN] Failed to update provider model config:', e);
        }
      }
      await sendCurrentSettings(webview);
      break;
    }

    case 'savePinnedModels': {
      if (message.pinnedModels && extensionContext) {
        try {
          await extensionContext.globalState.update('coderun_pinned_models', message.pinnedModels);
        } catch (e) {
          console.error('[CODERUN] Failed to save pinned models:', e);
        }
      }
      break;
    }

    case 'saveSettings': {
      if (message.settings) {
        console.log('[CODERUN] Saving settings:', JSON.stringify(message.settings));
        try {
          var settingsToUpdate = {};
          if (message.settings.provider !== undefined) settingsToUpdate.provider = message.settings.provider;
          if (message.settings.baseUrl !== undefined) settingsToUpdate.baseUrl = message.settings.baseUrl;
          if (message.settings.model !== undefined) settingsToUpdate.model = message.settings.model;
          if (message.settings.maxIterations !== undefined) settingsToUpdate.maxIterations = message.settings.maxIterations;
          if (message.settings.streaming !== undefined) settingsToUpdate.streaming = message.settings.streaming;
          if (message.settings.showThinking !== undefined) settingsToUpdate.showThinking = message.settings.showThinking;
          if (message.settings.confirmDangerous !== undefined) settingsToUpdate.confirmDangerous = message.settings.confirmDangerous;

          console.log('[CODERUN] Updating VS Code settings:', JSON.stringify(settingsToUpdate));
          await config.updateSettings(settingsToUpdate, vscode.ConfigurationTarget.Global);
          console.log('[CODERUN] Settings saved successfully');

          var savedProvider = message.settings.provider || config.getConfig().provider;
          var savedBaseUrl = message.settings.baseUrl || config.getConfig().baseUrl;

          var resolvedApiKey = '';
          if (message.apiKey !== undefined && message.apiKey !== null) {
            if (message.apiKey === '') {
              console.log('[CODERUN] Deleting API key from secrets for provider:', savedProvider);
              await config.deleteApiKey(extensionContext, savedProvider);
            } else if (message.apiKey !== '••••••••') {
              console.log('[CODERUN] Saving API key to secrets for provider:', savedProvider);
              await config.setApiKey(extensionContext, message.apiKey, savedProvider);
              resolvedApiKey = message.apiKey;
            } else {
              try {
                resolvedApiKey = await config.getApiKey(extensionContext, savedProvider) || '';
              } catch (_) {
                // Intentionally ignore retrieval errors; fall back to empty string
              }
            }
          }

          await config.saveProviderConfig(extensionContext, savedProvider, {
            baseUrl: savedBaseUrl,
            apiKey: resolvedApiKey,
            model: message.settings.model || '',
            apiType: message.settings.apiType || 'openai'
          });

          var overrideCfg = await config.getProviderConfigWithKey(extensionContext);
          if (message.settings.provider) overrideCfg.provider = message.settings.provider;
          if (message.settings.baseUrl) overrideCfg.baseUrl = message.settings.baseUrl;
          if (message.settings.model) overrideCfg.model = message.settings.model;

          await sendCurrentSettings(webview);
          await checkProviderHealth(webview, overrideCfg);
          await refreshAllProviderModels(webview);
        } catch (e) {
          console.error('[CODERUN] Failed to save settings:', e);
          webview.postMessage({ type: 'showAlert', message: 'Failed to save settings: ' + e.message });
        }
      }
      break;
    }

    case 'saveApiKey': {
      if (message.apiKey !== undefined && extensionContext) {
        if (message.apiKey === '') {
          await config.deleteApiKey(extensionContext);
        } else {
          await config.setApiKey(extensionContext, message.apiKey);
        }
        await sendCurrentSettings(webview);
        await checkProviderHealth(webview);
        await refreshAllProviderModels(webview);
      }
      break;
    }

    case 'removeProviderConfig': {
      if (message.provider && extensionContext) {
        console.log('[CODERUN] Removing saved config for provider:', message.provider);
        await config.deleteProviderConfig(extensionContext, message.provider);
        await sendCurrentSettings(webview);
        await refreshAllProviderModels(webview);
      }
      break;
    }

    case 'requestConversations': {
      if (!extensionContext) {
        webview.postMessage({ type: 'loadConversations', conversations: '[]', selectedModel: '', selectedProvider: '' });
        return;
      }
      try {
        var stored = extensionContext.globalState.get('coderun_conversations', '[]');
        var selectedModel = extensionContext.globalState.get('coderun_selected_model', '');
        var selectedProvider = extensionContext.globalState.get('coderun_selected_provider', '');
        webview.postMessage({ type: 'loadConversations', conversations: stored, selectedModel: selectedModel, selectedProvider: selectedProvider });
      } catch (e) {
        // Intentionally fall back to empty list on globalState reading exception
        webview.postMessage({ type: 'loadConversations', conversations: '[]', selectedModel: '', selectedProvider: '' });
      }
      break;
    }

    case 'checkHealth': {
      await checkProviderHealth(webview);
      break;
    }

    case 'refreshAllModels': {
      await refreshAllProviderModels(webview);
      break;
    }

    case 'openFile': {
      if (message.path) {
        var wsPath = getWorkspaceFolder();
        var safe = pathSecurity.resolveSafePath(message.path, wsPath);
        if (safe.safe) {
          vscode.workspace.openTextDocument(safe.canonicalPath).then(handleOpenTextDocumentResolve, handleOpenTextDocumentReject);
        } else {
          console.warn('[CODERUN] Blocked unsafe openFile path:', message.path, safe.error);
        }
      }
      break;
    }

    case 'undoFile': {
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
      break;
    }

    case 'undoCheckpoint': {
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
        vscode.window.showInformationMessage(result.message);
      }
      break;
    }

    case 'acceptDiff': {
      var wsPath = getWorkspaceFolder();
      var diffSessionId = message.sessionId || message.conversationId;
      var result = await diffManager.applyPatch(message.diffId, wsPath, diffSessionId);
      webview.postMessage({ type: 'diffResult', diffId: message.diffId, result: result });
      break;
    }

    case 'acceptAllDiffs': {
      var wsPath = getWorkspaceFolder();
      var diffSessionId = message.sessionId || message.conversationId;
      var results = await diffManager.acceptAll(wsPath, diffSessionId);
      webview.postMessage({ type: 'diffAllResult', results: results });
      break;
    }

    case 'rejectDiff': {
      if (message.diffId) {
        var diffSessionId = message.sessionId || message.conversationId;
        var result = diffManager.rejectPatch(message.diffId, diffSessionId);
        webview.postMessage({ type: 'diffResult', diffId: message.diffId, result: result });
      }
      break;
    }

    case 'rejectAllDiffs': {
      var diffSessionId = message.sessionId || message.conversationId;
      var results = diffManager.rejectAll(diffSessionId);
      webview.postMessage({ type: 'diffAllResult', results: results });
      break;
    }

    case 'openDiffEditor': {
      if (message.diffId) {
        var wsPath = getWorkspaceFolder();
        var diffSessionId = message.sessionId || message.conversationId;
        diffManager.openDiffEditor(message.diffId, wsPath, diffSessionId);
      }
      break;
    }

    case 'loadRules': {
      var wsPath = getWorkspaceFolder();
      var paths = rulesLoader.getRulesPaths(wsPath);
      try {
        var globalRules = await rulesLoader.readRulesFile(paths.globalPath);
        var workspaceRules = wsPath ? await rulesLoader.readRulesFile(paths.workspacePath) : '';
        webview.postMessage({
          type: 'rulesLoaded',
          globalRules: globalRules,
          workspaceRules: workspaceRules,
          globalPath: paths.globalPath,
          workspacePath: paths.workspacePath,
          hasWorkspace: !!wsPath
        });
      } catch (err) {
        console.error('[CODERUN] Failed to load rules:', err);
      }
      break;
    }

    case 'saveRules': {
      var wsPath = getWorkspaceFolder();
      var paths = rulesLoader.getRulesPaths(wsPath);
      var targetPath = message.level === 'global' ? paths.globalPath : paths.workspacePath;
      if (targetPath) {
        try {
          await rulesLoader.writeRulesFile(targetPath, message.content);
          webview.postMessage({
            type: 'rulesSaved',
            level: message.level,
            success: true
          });
        } catch (err) {
          console.error('[CODERUN] Failed to save rules:', err);
          webview.postMessage({
            type: 'rulesSaved',
            level: message.level,
            success: false,
            error: err ? err.message : 'Unknown error'
          });
        }
      }
      break;
    }

    default: {
      console.log('[CODERUN] Unknown message type:', msgType);
    }
  }
}

// =====================================================
// HEALTH CHECK & MODEL FETCH
// =====================================================
async function checkProviderHealth(webview, overrideConfig) {
  var cfg = overrideConfig;
  if (!cfg) {
    var activeProvider = extensionContext?.globalState.get('coderun_selected_provider', '') || '';
    if (activeProvider) {
      cfg = await config.getProviderConfigByName(extensionContext, activeProvider);
    } else {
      cfg = await config.getProviderConfigWithKey(extensionContext);
    }
  }
  console.log('[CODERUN] Checking health for provider:', cfg.provider, 'at', cfg.baseUrl, 'model:', cfg.model);

  if (!cfg.baseUrl) {
    console.error('[CODERUN] Health check skipped: No baseUrl configured');
    statusBarItem.text = '$(warning) CodeRun (No URL)';
    statusBarItem.tooltip = 'Please configure base URL in CodeRun settings';
    if (webview) {
      webview.postMessage({
        type: 'healthStatus',
        online: false,
        provider: cfg.provider || 'none',
        error: 'No base URL configured. Please set it in settings.'
      });
    }
    return;
  }

  if (config.needsApiKey(cfg.provider) && !cfg.apiKey) {
    console.error('[CODERUN] Health check skipped: API key required but not set');
    statusBarItem.text = '$(warning) CodeRun (No API Key)';
    statusBarItem.tooltip = 'Please set API key in CodeRun settings';
    if (webview) {
      webview.postMessage({
        type: 'healthStatus',
        online: false,
        provider: cfg.provider || 'none',
        error: 'API key required. Please enter your API key in settings and click Save.',
        models: []
      });
    }
    return;
  }

  try {
    var provider = (await import('./providers/providerManager.js')).createProvider(cfg);
    var models = await provider.listModels(cfg);

    statusBarItem.text = '$(comment-discussion) CodeRun (Online)';
    statusBarItem.tooltip = cfg.provider + ': ' + cfg.baseUrl + ' | Models: ' + models.length;

    if (webview) {
      webview.postMessage({
        type: 'healthStatus',
        online: true,
        provider: cfg.provider,
        models: models
      });
    }
  } catch (err) {
    console.error('[CODERUN] Health check failed:', err.message);
    console.error('[CODERUN] Config used:', JSON.stringify({ provider: cfg.provider, baseUrl: cfg.baseUrl, model: cfg.model, hasKey: !!cfg.apiKey }));
    statusBarItem.text = '$(warning) CodeRun (Offline)';
    statusBarItem.tooltip = 'Cannot reach ' + cfg.provider + ' at ' + cfg.baseUrl + ' - ' + err.message;

    if (webview) {
      webview.postMessage({
        type: 'healthStatus',
        online: false,
        provider: cfg.provider,
        error: err.message,
        models: []
      });
    }
  }
}

/**
 * Refresh models from ALL saved provider configurations.
 */
async function refreshAllProviderModels(webview) {
  var allConfigs = config.getAllProviderConfigs(extensionContext);
  var providerKeys = Object.keys(allConfigs);

  if (!providerKeys.length) {
    await checkProviderHealth(webview);
    return;
  }

  for (var i = 0; i < providerKeys.length; i++) {
    var provName = providerKeys[i];
    var provCfg = await config.getProviderConfigByName(extensionContext, provName);
    await checkProviderHealth(webview, provCfg);
  }
}

// =====================================================
// DEACTIVATE
// =====================================================
export async function deactivate() {
  if (statusBarItem) statusBarItem.dispose();
  terminalManager.dispose();
  permissions.cancelAllPermissions();
  try {
    await projectKnowledge.dispose();
  } catch (_) {}
  currentAbortController = null;
}
