// extension.js — CodeRun AI Agent Extension
// All provider settings (URL, model, provider) are read from VS Code user settings.
// API key is stored in VS Code secrets.

import * as vscode from 'vscode';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runAgent } from './agent.js';
import { registerAllTools } from './tools.js';
import * as config from './config.js';
import * as providerManager from './providerManager.js';
import { getWorkspaceFolder } from './workspaceContext.js';
import * as terminalManager from './terminalManager.js';
import * as permissions from './permissions.js';
import { PROVIDER_DEFAULTS } from './constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let statusBarItem;
let currentWebview = null;
let sidebarWebviewView = null;
let extensionContext = null;
let currentAbortController = null;

// =====================================================
// ACTIVATE
// =====================================================
export function activate(context) {
  console.log('[CODERUN] Extension Activated');
  extensionContext = context;

  // Register all tools
  registerAllTools();

  // Give the permission system access to extensionContext for "always" persistence
  permissions.setExtensionContext(context);

  // Register terminal shell integration listeners
  terminalManager.registerTerminalListeners(context);

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'coderun.openSidebar';
  statusBarItem.text = '$(comment-discussion) CodeRun';
  statusBarItem.tooltip = 'Open CodeRun AI Agent';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('coderun.openSidebar', function() {
      vscode.commands.executeCommand('coderun.chatView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('coderun.openPanel', function() {
      createOrShowPanel(context.extensionUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('coderun.newChat', function() {
      if (currentWebview) {
        currentWebview.postMessage({ type: 'newChat' });
      }
    })
  );

  // Sidebar provider
  var sidebarProvider = new SidebarWebviewViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('coderun.chatView', sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Terminal cleanup
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(function(terminal) {
      terminalManager.onTerminalClosed(terminal);
    })
  );

  // Config changes — when user edits settings.json, notify webview
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async function(e) {
      if (e.affectsConfiguration('coderun')) {
        config.invalidateCache();
        if (currentWebview) {
          await sendCurrentSettings(currentWebview);
          await checkProviderHealth(currentWebview);
        }
      }
    })
  );
}

// =====================================================
// SIDEBAR WEBVIEW PROVIDER
// =====================================================
class SidebarWebviewViewProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
  }

  resolveWebviewView(webviewView, context, token) {
    console.log('[CODERUN] resolveWebviewView called');
    sidebarWebviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(this.extensionUri.fsPath, 'src'))]
    };

    webviewView.webview.html = getWebviewHtml(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage(function(message) {
      handleFrontendMessage(message, webviewView.webview);
    });

    currentWebview = webviewView.webview;
  }
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

  panel.webview.html = getWebviewHtml(panel.webview, extensionUri);

  panel.webview.onDidReceiveMessage(function(message) {
    handleFrontendMessage(message, panel.webview);
  });

  currentWebview = panel.webview;
}

// =====================================================
// HTML GENERATOR
// =====================================================
function getWebviewHtml(webview, extensionUri) {
  var srcPath = path.join(extensionUri.fsPath, 'src');
  var nonce = getNonce();

  var dashboardCss = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'Dashboard.css')));
  var chatSpaceCss = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'ChatSpace.css')));
  var markdownJs = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'MarkdownRenderer.js')));
  var dashboardJs = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'Dashboard.js')));
  var chatSpaceJs = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'ChatSpace.js')));

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
  var text = '';
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (var i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// =====================================================
// SEND CURRENT SETTINGS TO WEBVIEW
// =====================================================
async function sendCurrentSettings(webview) {
  var cfg = config.getConfig();
  var hasKey = false;
  try {
    var key = await config.getApiKey(extensionContext);
    hasKey = !!key && key.length > 0;
  } catch (e) {
    hasKey = false;
  }

  // Include all saved provider configs so the frontend can show them
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
        webview.postMessage({ type: 'loadConversations', conversations: stored, selectedModel: selectedModel, selectedProvider: selectedProvider });
        // Send the current "Always Allow / Always Deny" map so the UI can
        // mark persistent decisions without needing an extra round-trip.
        webview.postMessage({
          type: 'permissionState',
          decisions: permissions.listAlwaysDecisions()
        });
      } catch (e) {
        console.error('[CODERUN] Failed to send initial data:', e);
      }
      // Send current VS Code settings to frontend so UI is in sync
      await sendCurrentSettings(webview);
      // Check active provider health first, then refresh all saved providers
      await checkProviderHealth(webview);
      await refreshAllProviderModels(webview);
      break;
    }

    case 'startChat': {
      var userPrompt = message.message;
      var history = message.history;
      var workspaceFolder = message.workspaceFolder;

      // Determine which provider to use from the frontend
      var providerName = message.provider || '';
      var frontendModel = message.model || '';

      // If frontend sent a provider, look up its saved config
      var providerConfig;
      if (providerName && PROVIDER_DEFAULTS[providerName]) {
        providerConfig = await config.getProviderConfigByName(extensionContext, providerName);
      } else {
        // Fallback: read the currently active provider from VS Code settings
        providerConfig = await config.getProviderConfigWithKey(extensionContext);
      }

      // Override model from frontend (most important — user selected it)
      if (frontendModel && frontendModel.trim()) {
        providerConfig.model = frontendModel.trim();
      }

      // Validate we have required config
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

      // Set up terminal event forwarding callback
      terminalManager.setSendEventCallback(function(event) {
        webview.postMessage({ type: 'agentEvent', event: event });
      });

      // Build a permission bridge: the agent calls askPermission(toolName, args, id);
      // we ask the webview, the user clicks Allow/Deny/Always-*, and the webview
      // calls back via 'permissionResponse' which routes into
      // permissions.resolvePermission — which resolves the right Promise.
      var askPermission = function(toolName, args, id) {
        // Short-circuit: if a persistent "always" decision exists, requestPermission
        // returns a resolved promise immediately and no UI prompt is needed.
        var persistent = permissions.getAlwaysDecision(toolName);
        if (persistent) {
          sendEvent({
            type: 'requestPermission',
            tool: toolName,
            arguments: args,
            id: id,
            autoResolved: true,
            decision: persistent
          });
          return Promise.resolve(persistent === 'allow');
        }
        // Otherwise: ask the webview to render the 4-button permission card.
        sendEvent({
          type: 'requestPermission',
          tool: toolName,
          arguments: args,
          id: id
        });
        return permissions.requestPermission(toolName, args, id, null);
      };

      var sendEvent = function(event) {
        webview.postMessage({ type: 'agentEvent', event: event });
      };

      // Cooperative stop: the frontend can fire 'stopChat' to set this flag,
      // the agent loop checks it between iterations.
      currentAbortController = { stopped: false };
      var abortCtrl = currentAbortController;

      try {
        await runAgent(userPrompt, providerConfig.model, workspaceFolder, history, providerConfig, sendEvent, askPermission, { signal: abortCtrl });
        webview.postMessage({ type: 'agentEvent', event: { type: 'stream_end', stopped: abortCtrl.stopped } });
      } catch (err) {
        console.error('[CODERUN] Agent error:', err);
        webview.postMessage({ type: 'agentEvent', event: { type: 'stream_error', error: err.message } });
      } finally {
        if (currentAbortController === abortCtrl) currentAbortController = null;
      }
      break;
    }

    case 'stopChat': {
      if (currentAbortController) {
        currentAbortController.stopped = true;
      }
      permissions.cancelAllPermissions();
      break;
    }

    case 'permissionResponse': {
      permissions.resolvePermission(
        message.toolCallId,
        !!message.approved,
        { always: !!message.always, tool: message.tool }
      );
      break;
    }

    case 'clearPermissionDecision': {
      if (message.tool) {
        permissions.clearAlwaysDecision(message.tool);
      } else {
        permissions.clearAlwaysDecision();
      }
      webview.postMessage({
        type: 'permissionState',
        decisions: permissions.listAlwaysDecisions()
      });
      break;
    }

    case 'showAlert': {
      if (message.message) vscode.window.showErrorMessage(message.message);
      break;
    }

    case 'confirmDelete': {
      vscode.window.showWarningMessage(
        'Delete this conversation?',
        { modal: true },
        'Delete'
      ).then(function(choice) {
        if (choice === 'Delete' && webview) {
          webview.postMessage({ type: 'deleteConversationConfirmed', id: message.id });
        }
      });
      break;
    }

    case 'confirmClearAll': {
      vscode.window.showWarningMessage(
        'Delete ALL conversations? This cannot be undone.',
        { modal: true },
        'Delete All'
      ).then(function(choice) {
        if (choice === 'Delete All' && webview) {
          webview.postMessage({ type: 'clearAllConversationsConfirmed' });
        }
      });
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
      break;
    }

    case 'saveSettings': {
      // Save provider settings to VS Code configuration (settings.json)
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

          // Save API key to secrets BEFORE health check
          var resolvedApiKey = '';
          if (message.apiKey !== undefined && message.apiKey !== null) {
            if (message.apiKey === '') {
              console.log('[CODERUN] Deleting API key from secrets');
              await config.deleteApiKey(extensionContext);
            } else if (message.apiKey !== '••••••••') {
              console.log('[CODERUN] Saving API key to secrets');
              await config.setApiKey(extensionContext, message.apiKey);
              resolvedApiKey = message.apiKey;
            } else {
              // Placeholder — get existing key
              try { resolvedApiKey = await config.getApiKey(extensionContext) || ''; } catch (_) {}
            }
          }

          // Also save per-provider config for multi-provider support
          var savedProvider = message.settings.provider || config.getConfig().provider;
          var savedBaseUrl = message.settings.baseUrl || config.getConfig().baseUrl;
          await config.saveProviderConfig(extensionContext, savedProvider, {
            baseUrl: savedBaseUrl,
            apiKey: resolvedApiKey,
            model: message.settings.model || ''
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
        var fullPath = path.join(wsPath, message.path);
        vscode.workspace.openTextDocument(fullPath).then(function(doc) {
          vscode.window.showTextDocument(doc);
        }).catch(function(err) {
          console.error('[CODERUN] Failed to open file:', err);
        });
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
  var cfg = overrideConfig || await config.getProviderConfigWithKey(extensionContext);
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
    var provider = (await import('./providerManager.js')).createProvider(cfg);
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
 * Iterates over every saved provider and sends individual health status
 * messages so the frontend accumulates all models in the dropdown.
 */
async function refreshAllProviderModels(webview) {
  var allConfigs = config.getAllProviderConfigs(extensionContext);
  var providerKeys = Object.keys(allConfigs);

  if (!providerKeys.length) {
    // No saved configs — fall back to the active provider
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
export function deactivate() {
  if (statusBarItem) statusBarItem.dispose();
  terminalManager.dispose();
  permissions.cancelAllPermissions();
  currentAbortController = null;
}