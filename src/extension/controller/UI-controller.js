// UI-controller.js (extension side)
// Main message router between UI webview and Extension Backend
// Pure functions, traditional function declarations only. Zero business logic.

import {
  handleWebviewReady,
  handleStartChat,
  handleStopChat,
  handleCompactConversation,
  handleSaveConversations,
  handleRequestConversations,
  handleConfirmDelete,
  handleConfirmClearAll
} from '../manager/chatshandler.js';

import {
  sendCurrentSettings,
  handleSaveSettings,
  handleSaveApiKey,
  handleRemoveProviderConfig,
  handleSaveSelectedModel,
  handleSavePinnedModels
} from '../manager/settingshandler.js';

import {
  checkProviderHealth,
  refreshAllProviderModels
} from '../manager/modelshandler.js';

import {
  handleAcceptDiff,
  handleAcceptAllDiffs,
  handleRejectDiff,
  handleRejectAllDiffs,
  handleOpenDiffEditor,
  handleUndoFile,
  handleUndoCheckpoint
} from '../manager/diffshandler.js';

import {
  handleSaveTrace,
  handleGetTraces,
  handleGetSubagentTraces
} from '../manager/traceshandler.js';

import {
  handleGetSubagents,
  handlePauseSubagent,
  handleResumeSubagent,
  handleStopSubagent
} from '../manager/subagentshandler.js';

import {
  handleSaveMediaToWorkspace,
  handleGetMediaData
} from '../manager/mediahandler.js';

import {
  handleLoadMcpServers,
  handleAddMcpServer,
  handleRemoveMcpServer,
  handleToggleMcpServer,
  handleToggleMcpTool,
  handleToggleBuiltinTool,
  handleToggleAllBuiltinTools,
  handleRefreshMcpServer
} from '../manager/mcphandler.js';

import {
  handleLoadRules,
  handleSaveRules
} from '../manager/ruleshandler.js';

import {
  handleQuestionResponse,
  handlePermissionResponse,
  handleClearPermissionDecision
} from '../permission-manager/permission-store.js';

import {
  handleRunInTerminal,
  handleOpenFile,
  handleShowAlert,
  handleRequestWorkspaceFolder
} from '../manager/terminalhandler.js';

export function uiresponse(webviewView, context, statusBarItem) {
  console.log('[CODERUN] Message listener attached to webviewView');
  var webview = webviewView.webview || webviewView;
  webview.onDidReceiveMessage(function onMessage(message) {
    ondidreceivemessage(message, webview, context, statusBarItem);
  });
}

function ondidreceivemessage(message, webview, context, statusBarItem) {
  console.log('[CODERUN] Routing UI message:', message.type || message.command || message.id);
  handlemessage(message, webview, context, statusBarItem);
}

function handlemessage(message, webview, context, statusBarItem) {
  var msgType = message.type || message.command || message.id;

  if (msgType === 'webviewReady') {
    handleWebviewReady(webview, context, statusBarItem);
  } else if (msgType === 'getSettings' || msgType === 'loadSettings') {
    sendCurrentSettings(webview, context);
  } else if (msgType === 'startChat') {
    handleStartChat(message, webview, context);
  } else if (msgType === 'stopChat') {
    handleStopChat(message);
  } else if (msgType === 'questionResponse') {
    handleQuestionResponse(message);
  } else if (msgType === 'permissionResponse') {
    handlePermissionResponse(message);
  } else if (msgType === 'clearPermissionDecision') {
    handleClearPermissionDecision(message, webview);
  } else if (msgType === 'showAlert') {
    handleShowAlert(message);
  } else if (msgType === 'confirmDelete') {
    handleConfirmDelete(message, webview);
  } else if (msgType === 'confirmClearAll') {
    handleConfirmClearAll(webview);
  } else if (msgType === 'runInTerminal' || msgType === 'terminalCommand') {
    handleRunInTerminal(message);
  } else if (msgType === 'requestWorkspaceFolder') {
    handleRequestWorkspaceFolder(webview);
  } else if (msgType === 'saveConversations') {
    handleSaveConversations(message, context);
  } else if (msgType === 'compactConversation') {
    handleCompactConversation(message, webview);
  } else if (msgType === 'saveTrace') {
    handleSaveTrace(message, context);
  } else if (msgType === 'getTraces') {
    handleGetTraces(message, webview, context);
  } else if (msgType === 'getSubagents') {
    handleGetSubagents(message, webview, context);
  } else if (msgType === 'getSubagentTraces') {
    handleGetSubagentTraces(message, webview, context);
  } else if (msgType === 'pauseSubagent') {
    handlePauseSubagent(message);
  } else if (msgType === 'resumeSubagent') {
    handleResumeSubagent(message);
  } else if (msgType === 'stopSubagent') {
    handleStopSubagent(message);
  } else if (msgType === 'saveMediaToWorkspace') {
    handleSaveMediaToWorkspace(message, webview, context);
  } else if (msgType === 'getMediaData') {
    handleGetMediaData(message, webview, context);
  } else if (msgType === 'saveSelectedModel') {
    handleSaveSelectedModel(message, webview, context);
  } else if (msgType === 'savePinnedModels') {
    handleSavePinnedModels(message, context);
  } else if (msgType === 'saveSettings') {
    handleSaveSettings(message, webview, context, statusBarItem);
  } else if (msgType === 'saveApiKey') {
    handleSaveApiKey(message, webview, context, statusBarItem);
  } else if (msgType === 'removeProviderConfig') {
    handleRemoveProviderConfig(message, webview, context, statusBarItem);
  } else if (msgType === 'requestConversations') {
    handleRequestConversations(webview, context);
  } else if (msgType === 'checkHealth') {
    checkProviderHealth(webview, null, context, statusBarItem);
  } else if (msgType === 'refreshAllModels') {
    refreshAllProviderModels(webview, context, statusBarItem);
  } else if (msgType === 'openFile') {
    handleOpenFile(message);
  } else if (msgType === 'undoFile') {
    handleUndoFile(message, webview);
  } else if (msgType === 'undoCheckpoint') {
    handleUndoCheckpoint(message, webview);
  } else if (msgType === 'acceptDiff') {
    handleAcceptDiff(message, webview);
  } else if (msgType === 'acceptAllDiffs') {
    handleAcceptAllDiffs(message, webview);
  } else if (msgType === 'rejectDiff') {
    handleRejectDiff(message, webview);
  } else if (msgType === 'rejectAllDiffs') {
    handleRejectAllDiffs(message, webview);
  } else if (msgType === 'openDiffEditor') {
    handleOpenDiffEditor(message);
  } else if (msgType === 'loadRules') {
    handleLoadRules(message, webview);
  } else if (msgType === 'saveRules') {
    handleSaveRules(message, webview);
  } else if (msgType === 'loadMcpServers') {
    handleLoadMcpServers(message, webview);
  } else if (msgType === 'addMcpServer') {
    handleAddMcpServer(message, webview);
  } else if (msgType === 'removeMcpServer') {
    handleRemoveMcpServer(message, webview);
  } else if (msgType === 'toggleMcpServer') {
    handleToggleMcpServer(message, webview);
  } else if (msgType === 'toggleMcpTool') {
    handleToggleMcpTool(message, webview);
  } else if (msgType === 'toggleBuiltinTool') {
    handleToggleBuiltinTool(message, webview);
  } else if (msgType === 'toggleAllBuiltinTools') {
    handleToggleAllBuiltinTools(message, webview);
  } else if (msgType === 'refreshMcpServer') {
    handleRefreshMcpServer(message, webview);
  } else {
    console.log('[CODERUN] Unknown message type:', msgType);
  }
}
