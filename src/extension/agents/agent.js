// agent.js — Public agent API
// Thin wrapper around agentLoop. The rest of the extension calls this.

import { runAgentLoop } from './agentLoop.js';

export async function runAgent(message, model, workspace, history, config, sendEvent, askPermission, options) {
  if (model && typeof model === 'object' && workspace && typeof workspace === 'object' && workspace.workspace !== undefined) {
    return await runAgentLoop(message, model, workspace);
  }

  var rawWs = workspace || '';
  var wsStr = typeof rawWs === 'string' ? rawWs : (rawWs && (rawWs.fsPath || rawWs.workspace || rawWs.path || '')) || '';
  console.log('[AGENT] Starting runner. Model: ' + (typeof model === 'string' ? model : (model && model.model)) + ', Workspace: ' + wsStr);

  var providerConfig = Object.assign({}, config, typeof model === 'object' ? model : { model: model });
  options = options || {};
  var signal = options.signal || null;

  return await runAgentLoop(message, providerConfig, {
    workspace: wsStr,
    history: history,
    sendEvent: sendEvent,
    askPermission: askPermission,
    signal: signal,
    sessionId: options.sessionId,
    isContinuation: options.isContinuation,
    agentIdentity: options.agentIdentity,
    agentRunner: options.agentRunner,
    pauseSignal: options.pauseSignal,
    rootSessionId: options.rootSessionId,
    images: options.image ? [options.image] : (options.images || [])
  });
}