// agent.js — Public agent API
// Thin wrapper around agentLoop. The rest of the extension calls this.

import { runAgentLoop } from './agentLoop.js';

export async function runAgent(message, model, workspace, history, config, sendEvent, askPermission) {
  console.log('[AGENT] Starting runner. Model: ' + model + ', Workspace: ' + workspace);

  var providerConfig = Object.assign({}, config, { model: model });

  return await runAgentLoop(message, providerConfig, {
    workspace: workspace,
    history: history,
    sendEvent: sendEvent,
    askPermission: askPermission
  });
}