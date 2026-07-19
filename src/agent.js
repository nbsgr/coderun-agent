// agent.js — Public agent API
// Thin wrapper around agentLoop. The rest of the extension calls this.

import { runAgentLoop } from './agentLoop.js';

export async function runAgent(message, model, workspace, history, config, sendEvent, askPermission, options) {
  console.log('[AGENT] Starting runner. Model: ' + model + ', Workspace: ' + workspace);

  var providerConfig = Object.assign({}, config, { model: model });
  options = options || {};
  var signal = options.signal || null;

  return await runAgentLoop(message, providerConfig, {
    workspace: workspace,
    history: history,
    sendEvent: sendEvent,
    askPermission: askPermission,
    signal: signal,
    images: options.image ? [options.image] : (options.images || [])
  });
}