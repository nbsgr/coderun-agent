// permissions.js — Permission handling for dangerous tools
// Supports per-call Allow/Deny AND chat-scoped "Always Allow" / "Always Deny"
// decisions per tool name.

import { DANGEROUS_TOOLS } from '../agents/constants.js';

var pendingPermissions = {};
var chatDecisions = {}; // { [toolName]: 'allow' | 'deny' }

export function setExtensionContext(context) {
  if (context && context.globalState) {
    try { context.globalState.update('coderun_permission_decisions', '{}'); } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }
  }
}

/**
 * Remember a decision for a given tool in the current chat only.
 * decision must be 'allow' or 'deny'.
 */
export function setAlwaysDecision(toolName, decision) {
  if (!toolName || (decision !== 'allow' && decision !== 'deny')) return;
  chatDecisions[toolName] = decision;
}

export function clearAlwaysDecision(toolName) {
  if (!toolName) {
    chatDecisions = {};
  } else if (chatDecisions[toolName]) {
    delete chatDecisions[toolName];
  }
}

export function getAlwaysDecision(toolName) {
  return chatDecisions[toolName] || null;
}

export function listAlwaysDecisions() {
  var out = {};
  for (var k in chatDecisions) out[k] = chatDecisions[k];
  return out;
}

export function resetChatDecisions() {
  chatDecisions = {};
}

/**
 * Request user permission. Returns a promise that resolves to:
 *   true   — user allowed
 *   false  — user denied
 *
 * Chat-scoped "always" decisions short-circuit the prompt for this chat only.
 */
function executePermissionPromise(id, resolve) {
  pendingPermissions[id] = resolve;
}

export function requestPermission(toolName, args, id, sendEvent) {
  var chatDecision = getAlwaysDecision(toolName);
  if (chatDecision === 'allow') return Promise.resolve(true);
  if (chatDecision === 'deny') return Promise.resolve(false);

  return new Promise(executePermissionPromise.bind(null, id));
}

/**
 * Resolve a pending permission request. The frontend calls this when the
 * user clicks Allow / Deny. For "always" variants, remember the decision
 * for the current chat.
 */
export function resolvePermission(id, approved, options) {
  options = options || {};
  var resolver = pendingPermissions[id];
  if (!resolver) return false;
  resolver(!!approved);
  delete pendingPermissions[id];

  if (options.always && options.tool) {
    setAlwaysDecision(options.tool, approved ? 'allow' : 'deny');
  }
  return true;
}

export function cancelAllPermissions() {
  for (var id in pendingPermissions) {
    pendingPermissions[id](false);
  }
  pendingPermissions = {};
}

export { DANGEROUS_TOOLS };
