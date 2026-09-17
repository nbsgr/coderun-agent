// extension.js — CodeRun AI Agent Extension
// All provider settings (URL, model, provider) are read from VS Code user settings.
// API key is stored in VS Code secrets.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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
import * as questionManager from './tools/questionManager.js';
import * as pathSecurity from './tools/pathSecurity.js';
import * as workspaceIntelligence from './context/workspaceIntelligence.js';
import { PROVIDER_DEFAULTS, EVENT_TYPES } from './agents/constants.js';
import * as runtime from './agents/runtime.js';
import * as events from './agents/events.js';
import { buildCompactCheckpoint } from './context/compactionManager.js';
import * as executionTrace from './execution/executionTrace.js';
import * as rulesLoader from './context/rulesLoader.js';
import * as mcpManager from './mcp/mcpManager.js';
import * as subagentManager from './agents/subagentManager.js';
import * as mediaManager from './media/mediaManager.js';

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

function handleAskPermission(webview, toolName, args, id, sessionId, parentSessionId) {
  var sid = sessionId || 'default';
  var parentSid = parentSessionId || null;
  var subagentRec = null;
  try {
    subagentRec = subagentManager.getSubagent(sid);
    if (subagentRec && subagentRec.parentSessionId) {
      parentSid = subagentRec.parentSessionId;
    }
  } catch (_) {}

  var chatDecision = permissions.getAlwaysDecision(toolName, sid);
  if (!chatDecision && parentSid) {
    chatDecision = permissions.getAlwaysDecision(toolName, parentSid);
  }

  if (chatDecision) {
    webview.postMessage({
      type: 'agentEvent',
      event: {
        type: 'requestPermission',
        tool: toolName,
        arguments: args,
        id: id,
        sessionId: sid,
        parentSessionId: parentSid,
        autoResolved: true,
        decision: chatDecision,
        subagentName: subagentRec && subagentRec.identity ? subagentRec.identity.name : null,
        subagentRole: subagentRec && subagentRec.identity ? subagentRec.identity.role : null,
        agentType: subagentRec ? 'subagent' : 'main'
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
      sessionId: sid,
      parentSessionId: parentSid,
      subagentName: subagentRec && subagentRec.identity ? subagentRec.identity.name : null,
      subagentRole: subagentRec && subagentRec.identity ? subagentRec.identity.role : null,
      agentType: subagentRec ? 'subagent' : 'main'
    }
  });
  return permissions.requestPermission(toolName, args, id, null, sid, parentSid);
}

function convertPathToWebviewUri(webview, filePath) {
  if (!filePath || typeof filePath !== 'string' || !webview || !webview.asWebviewUri) return filePath;
  try {
    return webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
  } catch (_) {
    return filePath;
  }
}

function rewriteMarkdownMediaPaths(webview, text) {
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

function convertMediaPathsToWebviewUris(webview, obj) {
  if (!obj || typeof obj !== 'object') return obj;
  try {
    var mediaObj = obj.media || (obj.message && obj.message.media) || obj;
    if (mediaObj && mediaObj.filePath && typeof mediaObj.filePath === 'string') {
      var localUri = convertPathToWebviewUri(webview, mediaObj.filePath);
      mediaObj.webviewUri = localUri;
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
  } catch (_) {}
  return obj;
}

function convertStoredConversationsToWebviewUris(webview, storedRaw) {
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
  } catch (_) {
    return storedRaw;
  }
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

  // Convert local media file paths to webview safe URIs
  convertMediaPathsToWebviewUris(webview, eventForWebview);

  webview.postMessage({ type: 'agentEvent', event: eventForWebview });
  if (event && event.type === 'trace_updated' && event.sessionId && extensionContext && extensionContext.globalStorageUri) {
    executionTrace.saveTraceToDisk(extensionContext.globalStorageUri.fsPath, event.sessionId).catch(function onTraceSaveError(err) {
      console.warn('[CODERUN] Failed to persist live trace:', err.message);
    });
  }
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
  if (context && context.globalStorageUri) {
    executionTrace.setDefaultStoragePath(context.globalStorageUri.fsPath);
    mediaManager.setDefaultMediaStoragePath(context.globalStorageUri.fsPath);
    try {
      var mediaFolderOnActivate = path.join(context.globalStorageUri.fsPath, 'media');
      if (!fs.existsSync(mediaFolderOnActivate)) {
        fs.mkdirSync(mediaFolderOnActivate, { recursive: true });
      }
    } catch (_) {}
  }

  // Register all tools
  registerAllTools();
  subagentManager.setAgentRunner(agentLoop.runAgentLoop);
  subagentManager.initializePersistence(context);
  var subagentConfig = config.getConfig();
  subagentManager.configureLimits({
    maxDepth: subagentConfig.subagentMaxDepth,
    maxConcurrent: subagentConfig.subagentMaxConcurrent,
    maxIterations: subagentConfig.subagentMaxIterations,
    timeoutMs: subagentConfig.subagentTimeoutMs
  });

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

  // Initialize MCP Manager and connect enabled servers (non-blocking background task)
  mcpManager.initMcpManager().catch(function onMcpErr(mcpInitErr) {
    console.error('[CODERUN] MCP Manager init failed:', mcpInitErr);
  });
  // Ensure user-accessible sandbox directory exists (~/.coderun/sandbox/)
  try {
    pathSecurity.getCanonicalSandboxRoot();
  } catch (sbErr) {
    console.warn('[CODERUN] Could not initialize sandbox directory:', sbErr.message);
  }

  // Check or background-install Chromium browser for Puppeteer MCP
  try {
    mcpManager.ensureLocalBrowserInstalled().catch(function onBrowserErr(err) {
      console.warn('[CODERUN] Browser setup error:', err.message);
    });
  } catch (brErr) {
    console.warn('[CODERUN] Could not trigger browser check:', brErr.message);
  }

  // Warm up workspace intelligence cache (non-blocking)
  workspaceIntelligence.scan(getWorkspaceFolder());

  // Forward subagent lifecycle events to active webview
  function forwardSubagentEvent(subagentType, data) {
    if (currentWebview) {
      currentWebview.postMessage({
        type: 'subagentEvent',
        subagentType: subagentType,
        data: data,
        agentId: data && data.agentId,
        sessionId: data && data.parentSessionId,
        status: data && data.status,
        role: data && data.role,
        task: data && data.task
      });
    }
  }

  function onSubagentSpawned(d) { forwardSubagentEvent('spawned', d); }
  function onSubagentStatus(d) { forwardSubagentEvent('status', d); }
  function onSubagentCompleted(d) { forwardSubagentEvent('completed', d); }
  function onSubagentFailed(d) { forwardSubagentEvent('failed', d); }
  function onSubagentPaused(d) { forwardSubagentEvent('paused', d); }
  function onSubagentResumed(d) { forwardSubagentEvent('resumed', d); }
  function onSubagentStopped(d) { forwardSubagentEvent('stopped', d); }

  events.on(EVENT_TYPES.SUBAGENT_SPAWNED, onSubagentSpawned);
  events.on(EVENT_TYPES.SUBAGENT_STATUS, onSubagentStatus);
  events.on(EVENT_TYPES.SUBAGENT_COMPLETED, onSubagentCompleted);
  events.on(EVENT_TYPES.SUBAGENT_FAILED, onSubagentFailed);
  events.on(EVENT_TYPES.SUBAGENT_PAUSED, onSubagentPaused);
  events.on(EVENT_TYPES.SUBAGENT_RESUMED, onSubagentResumed);
  events.on(EVENT_TYPES.SUBAGENT_STOPPED, onSubagentStopped);

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

function getWebviewLocalResourceRoots(extensionUri, ctx) {
  var roots = [
    vscode.Uri.file(path.join(extensionUri.fsPath, 'src')),
    extensionUri
  ];
  var effCtx = (ctx && ctx.globalStorageUri) ? ctx : extensionContext;
  if (effCtx && effCtx.globalStorageUri) {
    roots.push(effCtx.globalStorageUri);
    roots.push(vscode.Uri.file(path.join(effCtx.globalStorageUri.fsPath, 'media')));
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

function handleResolveWebviewView(extensionUri, webviewView, context, token) {
  console.log('[CODERUN] resolveWebviewView called');
  sidebarWebviewView = webviewView;
  activeWebviews.sidebar = webviewView.webview;

  webviewView.webview.options = {
    enableScripts: true,
    localResourceRoots: getWebviewLocalResourceRoots(extensionUri, extensionContext)
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
      localResourceRoots: getWebviewLocalResourceRoots(extensionUri, extensionContext)
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
  var subagentPanelCss = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'SubagentPanel.css'))).toString() + '?cb=' + cb;
  var markdownJs = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'MarkdownRenderer.js'))).toString() + '?cb=' + cb;
  var webviewSharedJs = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'webview-shared.js'))).toString() + '?cb=' + cb;
  var dashboardJs = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'Dashboard.js'))).toString() + '?cb=' + cb;
  var chatSpaceJs = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'ChatSpace.js'))).toString() + '?cb=' + cb;
  var subagentPanelJs = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'SubagentPanel.js'))).toString() + '?cb=' + cb;
  var botAvatarUri = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'bot-avatar.jpg'))).toString();
  var userAvatarUri = webview.asWebviewUri(vscode.Uri.file(path.join(srcPath, 'user-avatar.svg'))).toString();

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

  var hasKeyMap = {};
  var providerKeys = Object.keys(providerConfigs);
  for (var pi = 0; pi < providerKeys.length; pi++) {
    var pk = providerKeys[pi];
    try {
      var pkKey = await config.getApiKey(extensionContext, pk);
      hasKeyMap[pk] = !!pkKey && pkKey.length > 0;
    } catch (_) {
      hasKeyMap[pk] = false;
    }
  }

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
      enableTools: cfg.enableTools !== false,
      hasApiKey: hasKey,
      subagentProvider: config.getConfig().subagentProvider || '',
      subagentModel: config.getConfig().subagentModel || '',
      subagentMaxConcurrent: config.getConfig().subagentMaxConcurrent || 10,
      subagentMaxIterations: config.getConfig().subagentMaxIterations || 20,
      subagentMaxDepth: config.getConfig().subagentMaxDepth || 1
    },
    providerConfigs: providerConfigs,
    providerHasKeyMap: hasKeyMap
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
        var storedWithWebviewUris = convertStoredConversationsToWebviewUris(webview, stored);
        webview.postMessage({ type: 'loadConversations', conversations: storedWithWebviewUris, selectedModel: selectedModel, selectedProvider: selectedProvider });
        webview.postMessage({ type: 'loadPinnedModels', pinnedModels: pinnedModels });
        webview.postMessage({
          type: 'permissionState',
          decisions: permissions.listAlwaysDecisions()
        });
        var initialMcpServers = await mcpManager.getServersSummary();
        var initialBuiltinTools = mcpManager.getBuiltinAgentTools();
        webview.postMessage({
          type: 'mcpServersLoaded',
          servers: initialMcpServers,
          builtinAgentTools: initialBuiltinTools
        });
      } catch (e) {
        console.error('[CODERUN] Failed to send initial data:', e);
      }
      await sendCurrentSettings(webview);
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

      if (abortControllers[convSessionId]) {
        try {
          abortControllers[convSessionId].abort();
          abortControllers[convSessionId].stopped = true;
        } catch (_) {}
      }
      abortControllers[convSessionId] = new AbortController();
      var abortCtrl = abortControllers[convSessionId];
      abortCtrl.stopped = false;

      try {
        console.log('[EXTENSION] Calling runAgent for sessionId:', convSessionId);

        function onAgentEvent(ev) {
          handleAgentEvent(webview, ev);
        }

        function onAskPermission(tool, args, tcId, sendEv, sId, pId) {
          return handleAskPermission(webview, tool, args, tcId, sId || convSessionId, pId || convSessionId);
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
        if (abortControllers[convSessionId] === abortCtrl) {
          delete abortControllers[convSessionId];
        }
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
        questionManager.cancelSessionQuestions(stopSessionId);
        terminalManager.stopTerminal(stopSessionId);
        subagentManager.stopSubagents(stopSessionId, 'Parent agent stopped');
      } else {
        for (var sidKey in abortControllers) {
          if (abortControllers[sidKey]) {
            try { abortControllers[sidKey].abort(); } catch (_) {}
            abortControllers[sidKey].stopped = true;
          }
        }
        permissions.cancelAllPermissions();
        diffManager.cancelAll();
        questionManager.cancelAllQuestions();
        terminalManager.dispose();
        subagentManager.stopAllSubagents('Parent agent stopped');
      }
      break;
    }

    case 'questionResponse': {
      var qRespSessionId = message.sessionId || message.conversationId || 'default';
      questionManager.resolveQuestion(message.questionId, message.answer, qRespSessionId);
      break;
    }

    case 'permissionResponse': {
      var respSessionId = message.sessionId || message.conversationId || 'default';
      var parentSid = null;
      try {
        var subagentRec = subagentManager.getSubagent(respSessionId);
        if (subagentRec && subagentRec.parentSessionId) {
          parentSid = subagentRec.parentSessionId;
        }
      } catch (_) {}
      permissions.resolvePermission(
        message.toolCallId,
        !!message.approved,
        { always: !!message.always, tool: message.tool, toolName: message.tool, sessionId: respSessionId, parentSessionId: parentSid },
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
      if (message.sessionId) {
        try {
          var inMemTraces = executionTrace.getTraces(message.sessionId) || [];
          var activeTr = executionTrace.getActiveTrace(message.sessionId);
          var mergedTraces = [];
          var seenIds = {};

          for (var mi = 0; mi < inMemTraces.length; mi++) {
            if (inMemTraces[mi] && inMemTraces[mi].id) {
              seenIds[inMemTraces[mi].id] = true;
              mergedTraces.push(inMemTraces[mi]);
            }
          }
          if (activeTr && activeTr.id && !seenIds[activeTr.id]) {
            seenIds[activeTr.id] = true;
            mergedTraces.push(activeTr);
          }

          if (extensionContext && extensionContext.globalStorageUri) {
            var storagePath = extensionContext.globalStorageUri.fsPath;
            var diskTraces = await executionTrace.loadTracesFromDisk(storagePath, message.sessionId);
            for (var di = 0; di < diskTraces.length; di++) {
              var dt = diskTraces[di];
              if (dt && dt.id) {
                if (!seenIds[dt.id]) {
                  seenIds[dt.id] = true;
                  mergedTraces.push(dt);
                } else {
                  for (var mti = 0; mti < mergedTraces.length; mti++) {
                    if (mergedTraces[mti].id === dt.id && (!mergedTraces[mti].steps || !mergedTraces[mti].steps.length)) {
                      mergedTraces[mti] = dt;
                    }
                  }
                }
              }
            }
          }

          webview.postMessage({
            type: 'loadedTraces',
            sessionId: message.sessionId,
            traces: mergedTraces
          });
        } catch (e) {
          console.error('[CODERUN] Failed to load traces:', e);
        }
      }
      break;
    }

    case 'getSubagents': {
      if (message.sessionId) {
        try {
          var subs = subagentManager.listSubagents(message.sessionId);
          var subTracesList = executionTrace.getSubagentTraces(message.sessionId);
          if (extensionContext && extensionContext.globalStorageUri) {
            var diskSubTraces = await executionTrace.loadSubagentTracesFromDisk(extensionContext.globalStorageUri.fsPath, message.sessionId);
            for (var dti = 0; dti < diskSubTraces.length; dti++) {
              var diskTrace = diskSubTraces[dti];
              var alreadyLoaded = false;
              for (var sti = 0; sti < subTracesList.length; sti++) {
                if (subTracesList[sti].id === diskTrace.id) {
                  subTracesList[sti] = diskTrace;
                  alreadyLoaded = true;
                  break;
                }
              }
              if (!alreadyLoaded) subTracesList.push(diskTrace);
            }
          }

          for (var sIdx = 0; sIdx < subs.length; sIdx++) {
            var subItem = subs[sIdx];
            if (!subItem.trace || !subItem.trace.steps || !subItem.trace.steps.length) {
              for (var trIdx = 0; trIdx < subTracesList.length; trIdx++) {
                var candidateTr = subTracesList[trIdx];
                if (candidateTr.agentId === subItem.agentId || candidateTr.agentId === subItem.id || candidateTr.sessionId === subItem.sessionId) {
                  subItem.trace = candidateTr;
                  break;
                }
              }
            }
          }

          webview.postMessage({
            type: 'loadedSubagents',
            sessionId: message.sessionId,
            subagents: subs
          });
        } catch (e) {
          console.error('[CODERUN] Failed to list subagents:', e);
        }
      }
      break;
    }

    case 'getSubagentTraces': {
      if (message.sessionId) {
        try {
          var subTraces = executionTrace.getSubagentTraces(message.sessionId);
          if (extensionContext && extensionContext.globalStorageUri) {
            var diskSubTraces = await executionTrace.loadSubagentTracesFromDisk(extensionContext.globalStorageUri.fsPath, message.sessionId);
            for (var dti = 0; dti < diskSubTraces.length; dti++) {
              var diskTrace = diskSubTraces[dti];
              var alreadyLoaded = false;
              for (var sti = 0; sti < subTraces.length; sti++) {
                if (subTraces[sti].id === diskTrace.id) {
                  subTraces[sti] = diskTrace;
                  alreadyLoaded = true;
                  break;
                }
              }
              if (!alreadyLoaded) subTraces.push(diskTrace);
            }
          }
          webview.postMessage({
            type: 'loadedSubagentTraces',
            sessionId: message.sessionId,
            traces: subTraces
          });
        } catch (e) {
          console.error('[CODERUN] Failed to get subagent traces:', e);
        }
      }
      break;
    }

    case 'pauseSubagent': {
      if (message.agentId) {
        try {
          await subagentManager.pauseSubagent(message.agentId, message.sessionId || message.conversationId);
        } catch (e) {
          console.error('[CODERUN] Failed to pause subagent:', e);
        }
      }
      break;
    }

    case 'saveMediaToWorkspace': {
      var rawPath = message.sourcePath || message.filePath || '';
      if (rawPath) {
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
            } catch (_) {
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
      break;
    }

    case 'getMediaData': {
      var reqPath = message.path || message.filePath || '';
      if (reqPath) {
        try {
          var mediaFolder = extensionContext && extensionContext.globalStorageUri ? path.join(extensionContext.globalStorageUri.fsPath, 'media') : mediaManager.getDefaultMediaStoragePath();
          var resolvedFile = reqPath;
          if (!fs.existsSync(resolvedFile)) {
            var decoded = '';
            try {
              decoded = decodeURIComponent(resolvedFile.split('?')[0].split('#')[0]);
            } catch (_) {
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
      break;
    }

    case 'resumeSubagent': {
      if (message.agentId) {
        try {
          await subagentManager.resumeSubagent(message.agentId, message.sessionId || message.conversationId);
        } catch (e) {
          console.error('[CODERUN] Failed to resume subagent:', e);
        }
      }
      break;
    }

    case 'stopSubagent': {
      if (message.agentId) {
        try {
          await subagentManager.stopSubagent(message.agentId, message.sessionId || message.conversationId, message.reason);
        } catch (e) {
          console.error('[CODERUN] Failed to stop subagent:', e);
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
          if (message.settings.enableTools !== undefined) settingsToUpdate.enableTools = message.settings.enableTools;
          if (message.settings.subagentProvider !== undefined) settingsToUpdate.subagentProvider = message.settings.subagentProvider;
          if (message.settings.subagentModel !== undefined) settingsToUpdate.subagentModel = message.settings.subagentModel;
          if (message.settings.subagentMaxConcurrent !== undefined) settingsToUpdate.subagentMaxConcurrent = message.settings.subagentMaxConcurrent;
          if (message.settings.subagentMaxIterations !== undefined) settingsToUpdate.subagentMaxIterations = message.settings.subagentMaxIterations;
          if (message.settings.subagentMaxDepth !== undefined) settingsToUpdate.subagentMaxDepth = message.settings.subagentMaxDepth;

          console.log('[CODERUN] Updating VS Code settings:', JSON.stringify(settingsToUpdate));
          await config.updateSettings(settingsToUpdate, vscode.ConfigurationTarget.Global);
          try {
            var subagentMgr = await import('./agents/subagentManager.js');
            subagentMgr.configureLimits({
              maxConcurrent: settingsToUpdate.subagentMaxConcurrent,
              maxIterations: settingsToUpdate.subagentMaxIterations,
              maxDepth: settingsToUpdate.subagentMaxDepth
            });
            subagentMgr.configureSubagentDefaults({
              provider: settingsToUpdate.subagentProvider || '',
              model: settingsToUpdate.subagentModel || ''
            });
          } catch (limErr) {
            console.error('[CODERUN] Failed to update subagent limits:', limErr);
          }
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
        var storedWithWebviewUris = convertStoredConversationsToWebviewUris(webview, stored);
        webview.postMessage({ type: 'loadConversations', conversations: storedWithWebviewUris, selectedModel: selectedModel, selectedProvider: selectedProvider });
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
        var paths = rulesLoader.getRulesPaths(wsPath);
        if (message.path === paths.globalPath) {
          vscode.workspace.openTextDocument(message.path).then(handleOpenTextDocumentResolve, handleOpenTextDocumentReject);
          break;
        }
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
        if (subagentManager && typeof subagentManager.markSubagentDiffUndone === 'function') {
          subagentManager.markSubagentDiffUndone(message.filePath || (result && result.filePath), message.checkpointId);
        }
        vscode.window.showInformationMessage(result.message);
      }
      break;
    }

    case 'acceptDiff': {
      var wsPath = getWorkspaceFolder();
      var diffSessionId = message.sessionId || message.conversationId;
      var result = await diffManager.applyPatch(message.diffId, wsPath, diffSessionId);
      if (subagentManager && typeof subagentManager.updateSubagentDiffStatus === 'function') {
        subagentManager.updateSubagentDiffStatus(message.diffId, 'approved');
      }
      webview.postMessage({ type: 'diffResult', diffId: message.diffId, sessionId: diffSessionId, result: result });
      break;
    }

    case 'acceptAllDiffs': {
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
      break;
    }

    case 'rejectDiff': {
      if (message.diffId) {
        var diffSessionId = message.sessionId || message.conversationId;
        var result = diffManager.rejectPatch(message.diffId, diffSessionId);
        if (subagentManager && typeof subagentManager.updateSubagentDiffStatus === 'function') {
          subagentManager.updateSubagentDiffStatus(message.diffId, 'rejected');
        }
        webview.postMessage({ type: 'diffResult', diffId: message.diffId, sessionId: diffSessionId, result: result });
      }
      break;
    }

    case 'rejectAllDiffs': {
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

    case 'loadMcpServers': {
      try {
        var mcpList = await mcpManager.getServersSummary();
        var bTools = mcpManager.getBuiltinAgentTools();
        webview.postMessage({
          type: 'mcpServersLoaded',
          servers: mcpList,
          builtinAgentTools: bTools
        });
      } catch (mcpErr) {
        console.error('[CODERUN] Failed to load MCP servers:', mcpErr);
      }
      break;
    }

    case 'addMcpServer': {
      try {
        var addRes = await mcpManager.addServer(message.server);
        var updatedServers = await mcpManager.getServersSummary();
        var bTools = mcpManager.getBuiltinAgentTools();
        webview.postMessage({
          type: 'mcpServersLoaded',
          servers: updatedServers,
          builtinAgentTools: bTools,
          success: true,
          message: 'MCP server added successfully'
        });
      } catch (addErr) {
        webview.postMessage({
          type: 'mcpServerError',
          error: addErr ? addErr.message : String(addErr)
        });
      }
      break;
    }

    case 'removeMcpServer': {
      try {
        await mcpManager.removeServer(message.serverId);
        var remainingServers = await mcpManager.getServersSummary();
        var bTools = mcpManager.getBuiltinAgentTools();
        webview.postMessage({
          type: 'mcpServersLoaded',
          servers: remainingServers,
          builtinAgentTools: bTools
        });
      } catch (remErr) {
        console.error('[CODERUN] Failed to remove MCP server:', remErr);
      }
      break;
    }

    case 'toggleMcpServer': {
      try {
        await mcpManager.toggleServer(message.serverId, message.enabled);
        var toggledServers = await mcpManager.getServersSummary();
        var bTools = mcpManager.getBuiltinAgentTools();
        webview.postMessage({
          type: 'mcpServersLoaded',
          servers: toggledServers,
          builtinAgentTools: bTools
        });
      } catch (togErr) {
        console.error('[CODERUN] Failed to toggle MCP server:', togErr);
      }
      break;
    }

    case 'toggleMcpTool': {
      try {
        await mcpManager.toggleServerTool(message.serverId, message.toolName, message.enabled);
        var toolToggledServers = await mcpManager.getServersSummary();
        var bTools = mcpManager.getBuiltinAgentTools();
        webview.postMessage({
          type: 'mcpServersLoaded',
          servers: toolToggledServers,
          builtinAgentTools: bTools
        });
      } catch (toolTogErr) {
        console.error('[CODERUN] Failed to toggle MCP tool:', toolTogErr);
      }
      break;
    }

    case 'toggleBuiltinTool': {
      try {
        await mcpManager.toggleBuiltinTool(message.toolName, message.enabled);
        var currentServers = await mcpManager.getServersSummary();
        var updatedBuiltinTools = mcpManager.getBuiltinAgentTools();
        webview.postMessage({
          type: 'mcpServersLoaded',
          servers: currentServers,
          builtinAgentTools: updatedBuiltinTools
        });
      } catch (builtinToolErr) {
        console.error('[CODERUN] Failed to toggle builtin agent tool:', builtinToolErr);
      }
      break;
    }

    case 'toggleAllBuiltinTools': {
      try {
        await mcpManager.toggleAllBuiltinTools(message.enabled);
        var curServers = await mcpManager.getServersSummary();
        var allBTools = mcpManager.getBuiltinAgentTools();
        webview.postMessage({
          type: 'mcpServersLoaded',
          servers: curServers,
          builtinAgentTools: allBTools
        });
      } catch (allBuiltinErr) {
        console.error('[CODERUN] Failed to toggle all builtin agent tools:', allBuiltinErr);
      }
      break;
    }

    case 'refreshMcpServer': {
      try {
        await mcpManager.refreshServer(message.serverId);
        var refreshedServers = await mcpManager.getServersSummary();
        var bTools = mcpManager.getBuiltinAgentTools();
        webview.postMessage({
          type: 'mcpServersLoaded',
          servers: refreshedServers,
          builtinAgentTools: bTools
        });
      } catch (refErr) {
        console.error('[CODERUN] Failed to refresh MCP server:', refErr);
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
async function checkOneSavedProvider(webview, provName) {
  try {
    var provCfg = await config.getProviderConfigByName(extensionContext, provName);
    await checkProviderHealth(webview, provCfg);
  } catch (err) {
    console.error('[CODERUN] Failed refreshing provider ' + provName + ':', err.message);
  }
}

var isRefreshingModels = false;

async function refreshAllProviderModels(webview) {
  if (isRefreshingModels) {
    return;
  }
  isRefreshingModels = true;
  try {
    var allConfigs = config.getAllProviderConfigs(extensionContext);
    var providerKeys = Object.keys(allConfigs);

    if (!providerKeys.length) {
      await checkProviderHealth(webview);
      return;
    }

    var promises = [];
    for (var i = 0; i < providerKeys.length; i++) {
      promises.push(checkOneSavedProvider(webview, providerKeys[i]));
    }
    await Promise.allSettled(promises);
  } finally {
    isRefreshingModels = false;
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
  try {
    mcpManager.stopAllServers();
  } catch (_) {}
  currentAbortController = null;
}
