// extension.js (extension side)
// Main entry point for VS Code Extension Host.
// Pure functions, traditional function declarations only.

import * as vscode from 'vscode';
import * as path from 'path';
import * as config from '../agents/config.js';
import { runAgent } from '../agents/agent.js';
import * as terminalManager from '../tools/terminalManager.js';
import * as permissions from '../tools/permissions.js';
import * as executionTrace from '../execution/executionTrace.js';
import { registerAllTools } from '../tools/tools.js';
import * as subagentManager from '../agents/subagentManager.js';
import * as mediaManager from '../media/mediaManager.js';
import * as mcpManager from '../mcp/mcpManager.js';
import * as pathSecurity from '../tools/pathSecurity.js';
import * as workspaceIntelligence from '../context/workspaceIntelligence.js';
import * as projectKnowledge from '../context/projectKnowledge.js';
import * as events from '../agents/events.js';
import { EVENT_TYPES } from '../agents/constants.js';
import { getWorkspaceFolder } from '../context/workspaceContext.js';
import { checkProviderHealth, refreshAllProviderModels } from '../manager/modelshandler.js';
import { sendCurrentSettings } from '../manager/settingshandler.js';
import { handleAgentEvent } from '../manager/chatshandler.js';
import { handleAskPermission } from '../permission-manager/permission-store.js';
import {
  handleOpenSidebarCommand,
  handleOpenPanelCommand,
  handleNewChatCommand,
  handleUndoLastEditCommand
} from './commands-manager.js';
import {
  createAgentViewProvider,
  createOrShowPanel,
  getActiveWebview,
  getAllActiveWebviews,
  broadcastToAllWebviews
} from './agentview-manager.js';

var statusBarItem = null;
var extensionContext = null;

export function activate(context) {
  console.log('[CODERUN] Activating extension...');
  extensionContext = context;

  if (context.globalStorageUri) {
    try {
      executionTrace.setStoragePath(context.globalStorageUri.fsPath);
      mediaManager.setStoragePath(path.join(context.globalStorageUri.fsPath, 'media'));
    } catch (e) {
      console.warn('[CODERUN] Failed to initialize storage paths:', e ? e.message : e);
    }
  }

  registerAllTools();

  subagentManager.setAgentRunner(function runChildSubagent(taskPrompt, model, wsFolder, subHist, subCfg, onEv, onAsk, opts) {
    return runAgent(taskPrompt, model, wsFolder, subHist, subCfg, onEv, onAsk, opts);
  });

  try {
    subagentManager.initializePersistence(context);
    subagentManager.configureLimits({
      maxConcurrent: config.getConfig().subagentMaxConcurrent || 10,
      maxIterations: config.getConfig().subagentMaxIterations || 20,
      maxDepth: config.getConfig().subagentMaxDepth || 1
    });
    subagentManager.configureSubagentDefaults({
      provider: config.getConfig().subagentProvider || '',
      model: config.getConfig().subagentModel || ''
    });
  } catch (limErr) {
    console.warn('[CODERUN] Failed to set initial subagent limits:', limErr ? limErr.message : limErr);
  }

  permissions.setExtensionContext(context);
  terminalManager.registerTerminalListeners(context);

  try {
    projectKnowledge.initialize(context);
  } catch (pkErr) {
    console.warn('[CODERUN] Failed to initialize project knowledge:', pkErr ? pkErr.message : pkErr);
  }

  mcpManager.initMcpManager(context).then(function onMcpInit() {
    console.log('[CODERUN] MCP Manager initialized');
  }).catch(function onMcpErr(mcpErr) {
    console.warn('[CODERUN] Failed to initialize MCP Manager:', mcpErr ? mcpErr.message : mcpErr);
  });

  try {
    pathSecurity.getCanonicalSandboxRoot();
  } catch (sbErr) {
    console.warn('[CODERUN] Failed to initialize sandbox path security:', sbErr ? sbErr.message : sbErr);
  }

  mcpManager.ensureLocalBrowserInstalled().catch(function onBrowserErr(bErr) {
    console.warn('[CODERUN] Background browser check error:', bErr ? bErr.message : bErr);
  });

  var wsFolder = getWorkspaceFolder();
  if (wsFolder) {
    workspaceIntelligence.scan(wsFolder).catch(function onScanErr(scanErr) {
      console.warn('[CODERUN] Background workspace scan error:', scanErr ? scanErr.message : scanErr);
    });
  }

  function forwardSubagentEvent(ev) {
    if (ev && (ev.sessionId || ev.agentId)) {
      broadcastToAllWebviews({
        type: 'subagent_event',
        event: ev
      });
    }
  }

  var subEventTypes = [
    EVENT_TYPES.SUBAGENT_SPAWNED,
    EVENT_TYPES.SUBAGENT_STATUS,
    EVENT_TYPES.SUBAGENT_COMPLETED,
    EVENT_TYPES.SUBAGENT_FAILED,
    EVENT_TYPES.SUBAGENT_PAUSED,
    EVENT_TYPES.SUBAGENT_RESUMED,
    EVENT_TYPES.SUBAGENT_STOPPED
  ];

  for (var si = 0; si < subEventTypes.length; si++) {
    events.on(subEventTypes[si], forwardSubagentEvent);
  }

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(comment-discussion) CodeRun';
  statusBarItem.tooltip = 'Click to open CodeRun Agent';
  statusBarItem.command = 'coderun.openSidebar';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(vscode.commands.registerCommand('coderun.openSidebar', handleOpenSidebarCommand));

  context.subscriptions.push(vscode.commands.registerCommand('coderun.openPanel', function onOpenPanel() {
    handleOpenPanelCommand(context, function showPanel() {
      createOrShowPanel(context, statusBarItem);
    });
  }));

  context.subscriptions.push(vscode.commands.registerCommand('coderun.newChat', function onNewChat() {
    handleNewChatCommand(getActiveWebview());
  }));

  context.subscriptions.push(vscode.commands.registerCommand('coderun.undoLastEdit', function onUndoLastEdit() {
    handleUndoLastEditCommand(getActiveWebview());
  }));

  var provider = createAgentViewProvider(context, statusBarItem);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('coderun.chatView', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  checkProviderHealth(null, null, context, statusBarItem);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(function onConfigChange(e) {
      if (e.affectsConfiguration('coderun')) {
        config.reloadConfig();
        var actWv = getActiveWebview();
        if (actWv) {
          sendCurrentSettings(actWv, context);
        }
        checkProviderHealth(actWv, null, context, statusBarItem);
      }
    })
  );

  var rulesWatcher = vscode.workspace.createFileSystemWatcher('**/.coderunrules');
  function onRulesChange() {
    var actWv = getActiveWebview();
    if (actWv) {
      import('../manager/ruleshandler.js').then(function onRulesHandler(rh) {
        rh.handleLoadRules({}, actWv);
      });
    }
  }
  rulesWatcher.onDidChange(onRulesChange);
  rulesWatcher.onDidCreate(onRulesChange);
  rulesWatcher.onDidDelete(onRulesChange);
  context.subscriptions.push(rulesWatcher);

  console.log('[CODERUN] Extension activated successfully');
}

export async function deactivate() {
  if (statusBarItem) statusBarItem.dispose();
  terminalManager.dispose();
  permissions.cancelAllPermissions();
  try {
    await projectKnowledge.dispose();
  } catch (pkErr) {
    console.debug('[CODERUN] Error disposing project knowledge:', pkErr ? pkErr.message : pkErr);
  }
  try {
    mcpManager.stopAllServers();
  } catch (mcpErr) {
    console.debug('[CODERUN] Error stopping MCP servers:', mcpErr ? mcpErr.message : mcpErr);
  }
}
