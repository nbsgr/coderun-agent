// chatshandler.js (extension side)
// Coordinates chat loop executions, abort signals, context compaction, and conversation storage.
// Strict traditional function declarations only

import * as vscode from 'vscode';
import { runAgent } from '../agents/agent.js';
import * as config from '../agents/config.js';
import { PROVIDER_DEFAULTS } from '../agents/constants.js';
import { getWorkspaceFolder } from '../context/workspaceContext.js';
import * as terminalManager from '../tools/terminalManager.js';
import * as permissions from '../tools/permissions.js';
import * as diffManager from '../tools/diffManager.js';
import * as questionManager from '../tools/questionManager.js';
import * as subagentManager from '../agents/subagentManager.js';
import * as executionTrace from '../execution/executionTrace.js';
import * as mcpManager from '../mcp/mcpManager.js';
import { buildCompactCheckpoint } from '../context/compactionManager.js';
import { handleAskPermission } from '../permission-manager/permission-store.js';
import { convertMediaPathsToWebviewUris, convertStoredConversationsToWebviewUris } from './mediahandler.js';
import { sendCurrentSettings } from './settingshandler.js';
import { refreshAllProviderModels } from './modelshandler.js';

var abortControllers = {};

export function getAbortControllers() {
  return abortControllers;
}

export function handleAgentEvent(webview, event, extensionContext) {
  var eventForWebview = event;
  if (event && event.type === 'request_diff' && event.deferred) {
    eventForWebview = {};
    for (var key in event) {
      if (key !== 'deferred') eventForWebview[key] = event[key];
    }
  }

  convertMediaPathsToWebviewUris(webview, eventForWebview);

  if (webview && typeof webview.postMessage === 'function') {
    webview.postMessage({ type: 'agentEvent', event: eventForWebview });
  }

  if (event && event.type === 'trace_updated' && event.sessionId && extensionContext && extensionContext.globalStorageUri) {
    executionTrace.saveTraceToDisk(extensionContext.globalStorageUri.fsPath, event.sessionId).catch(function onTraceSaveError(err) {
      console.warn('[CHAT] Failed to persist live trace:', err ? err.message : err);
    });
  }
  if (event && event.type === 'request_diff' && event.id) {
    diffManager.storePatch(event);
  }
}

export async function handleWebviewReady(webview, extensionContext, statusBarItem) {
  var wsFolder = getWorkspaceFolder();
  webview.postMessage({ type: 'workspaceFolder', path: wsFolder });
  await sendCurrentSettings(webview, extensionContext);
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
    console.error('[CHAT] Failed to send initial data to webview:', e ? e.message : e);
  }
  await refreshAllProviderModels(webview, extensionContext, statusBarItem);
}

export async function handleStartChat(message, webview, extensionContext) {
  var userPrompt = message.message;
  var userImage = message.image || null;
  var history = message.history;
  var workspaceFolder = message.workspaceFolder;
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
    return;
  }

  if (config.needsApiKey(providerConfig.provider) && !providerConfig.apiKey) {
    webview.postMessage({
      type: 'agentEvent',
      event: { type: 'stream_error', error: 'API key required for ' + providerConfig.provider + '. Please set it in CodeRun settings.' }
    });
    return;
  }

  function onSendTerminalEvent(ev) {
    if (webview && typeof webview.postMessage === 'function') {
      webview.postMessage({ type: 'agentEvent', event: ev });
    }
  }
  terminalManager.setSendEventCallback(onSendTerminalEvent, convSessionId);

  if (abortControllers[convSessionId]) {
    try {
      abortControllers[convSessionId].abort();
      abortControllers[convSessionId].stopped = true;
    } catch (abErr) {
      console.debug('[CHAT] Abort error on startChat:', abErr ? abErr.message : abErr);
    }
  }
  abortControllers[convSessionId] = new AbortController();
  var abortCtrl = abortControllers[convSessionId];
  abortCtrl.stopped = false;

  try {
    console.log('[EXTENSION] Calling runAgent for sessionId:', convSessionId);

    function onAgentEvent(ev) {
      handleAgentEvent(webview, ev, extensionContext);
    }

    function onAskPermission(tool, args, tcId, sendEv, sId, pId) {
      return handleAskPermission(webview, tool, args, tcId, sId || convSessionId, pId || convSessionId);
    }

    await runAgent(userPrompt, providerConfig.model, workspaceFolder, history, providerConfig, onAgentEvent, onAskPermission, { signal: abortCtrl, image: userImage, sessionId: convSessionId, isContinuation: Boolean(message.isContinuation) });
    console.log('[EXTENSION] runAgent completed');
    if (extensionContext && extensionContext.globalStorageUri) {
      try {
        await executionTrace.saveTraceToDisk(extensionContext.globalStorageUri.fsPath, convSessionId);
      } catch (trSaveErr) {
        console.warn('[CHAT] Trace save error on runAgent complete:', trSaveErr ? trSaveErr.message : trSaveErr);
      }
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
      } catch (failedTrErr) {
        console.debug('[CHAT] Failed trace save error:', failedTrErr ? failedTrErr.message : failedTrErr);
      }
    }
    webview.postMessage({ type: 'agentEvent', event: { type: 'stream_error', error: errMsg } });
  } finally {
    if (abortControllers[convSessionId] === abortCtrl) {
      delete abortControllers[convSessionId];
    }
  }
}

export function handleStopChat(message) {
  var stopSessionId = message.sessionId || message.conversationId || '';
  if (stopSessionId) {
    if (abortControllers[stopSessionId]) {
      try { abortControllers[stopSessionId].abort(); } catch (e) {
        console.debug('[CHAT] Abort error on stopChat:', e ? e.message : e);
      }
      abortControllers[stopSessionId].stopped = true;
    }
    permissions.cancelSessionPending(stopSessionId);
    diffManager.cancelSession(stopSessionId);
    questionManager.cancelSessionQuestions(stopSessionId);
    var stopTarget = (message && message.target) || 'foreground';
    terminalManager.stopTerminal(stopSessionId, stopTarget);
    subagentManager.stopSubagents(stopSessionId, 'Parent agent stopped');
  } else {
    for (var sidKey in abortControllers) {
      if (abortControllers[sidKey]) {
        try { abortControllers[sidKey].abort(); } catch (e2) {
          console.debug('[CHAT] Global abort error:', e2 ? e2.message : e2);
        }
        abortControllers[sidKey].stopped = true;
      }
    }
    permissions.cancelAllPermissions();
    diffManager.cancelAll();
    questionManager.cancelAllQuestions();
    terminalManager.dispose();
    subagentManager.stopAllSubagents('Parent agent stopped');
  }
}

export function handleCompactConversation(message, webview) {
  var compactMessages = message.messages || [];
  var compactCheckpointNum = message.checkpointNumber || 1;
  var conversationId = message.conversationId || '';

  if (compactMessages.length < 2) {
    webview.postMessage({
      type: 'compactError',
      error: 'Not enough messages to compact.'
    });
    return;
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
}

export async function handleSaveConversations(message, extensionContext) {
  if (message.conversations && extensionContext) {
    try {
      await extensionContext.globalState.update('coderun_conversations', message.conversations);
    } catch (e) {
      console.error('[CODERUN] Failed to save conversations:', e ? e.message : e);
    }
  }
}

export function handleRequestConversations(webview, extensionContext) {
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
    console.debug('[CHAT] Error loading stored conversations:', e ? e.message : e);
    webview.postMessage({ type: 'loadConversations', conversations: '[]', selectedModel: '', selectedProvider: '' });
  }
}

export function handleConfirmDelete(message, webview) {
  function onConfirmDelete(res) {
    if (res === 'Delete' && webview && typeof webview.postMessage === 'function') {
      webview.postMessage({ type: 'deleteConversationConfirmed', id: message.id });
    }
  }
  vscode.window.showWarningMessage(
    'Delete this conversation?',
    { modal: true },
    'Delete'
  ).then(onConfirmDelete);
}

export function handleConfirmClearAll(webview) {
  function onConfirmClearAll(res) {
    if (res === 'Delete All' && webview && typeof webview.postMessage === 'function') {
      webview.postMessage({ type: 'clearAllConversationsConfirmed' });
    }
  }
  vscode.window.showWarningMessage(
    'Delete ALL conversations? This cannot be undone.',
    { modal: true },
    'Delete All'
  ).then(onConfirmClearAll);
}
