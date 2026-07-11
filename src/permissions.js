// permissions.js — Permission handling for dangerous tools
// Supports per-call Allow/Deny AND persistent "Always Allow" / "Always Deny"
// decisions per tool name. Persistent decisions are stored via the VS Code
// globalState API when an extensionContext is provided.

import { DANGEROUS_TOOLS } from './constants.js';

var pendingPermissions = {};
var persistentDecisions = {}; // { [toolName]: 'allow' | 'deny' }
var extensionContext = null;
var STORAGE_KEY = 'coderun_permission_decisions';

export function setExtensionContext(context) {
  extensionContext = context;
  loadPersistent();
}

function loadPersistent() {
  if (!extensionContext) return;
  try {
    var raw = extensionContext.globalState.get(STORAGE_KEY, '{}');
    persistentDecisions = JSON.parse(raw || '{}') || {};
  } catch (_) {
    persistentDecisions = {};
  }
}

function savePersistent() {
  if (!extensionContext) return;
  try {
    extensionContext.globalState.update(STORAGE_KEY, JSON.stringify(persistentDecisions));
  } catch (e) {
    console.error('[PERMISSIONS] Failed to save decisions:', e);
  }
}

/**
 * Persist a decision for a given tool so future calls of that tool do not
 * need to prompt. decision must be 'allow' or 'deny'.
 */
export function setAlwaysDecision(toolName, decision) {
  if (!toolName || (decision !== 'allow' && decision !== 'deny')) return;
  persistentDecisions[toolName] = decision;
  savePersistent();
}

export function clearAlwaysDecision(toolName) {
  if (!toolName) {
    persistentDecisions = {};
  } else if (persistentDecisions[toolName]) {
    delete persistentDecisions[toolName];
  }
  savePersistent();
}

export function getAlwaysDecision(toolName) {
  return persistentDecisions[toolName] || null;
}

export function listAlwaysDecisions() {
  var out = {};
  for (var k in persistentDecisions) out[k] = persistentDecisions[k];
  return out;
}

/**
 * Request user permission. Returns a promise that resolves to:
 *   true   — user allowed
 *   false  — user denied
 *
 * Persistent "always" decisions short-circuit the prompt entirely.
 */
export function requestPermission(toolName, args, id, sendEvent) {
  // Short-circuit if user has set an "always" decision for this tool.
  var persistent = getAlwaysDecision(toolName);
  if (persistent === 'allow') return Promise.resolve(true);
  if (persistent === 'deny') return Promise.resolve(false);

  return new Promise(function(resolve) {
    pendingPermissions[id] = resolve;
  });
}

/**
 * Resolve a pending permission request. The frontend calls this when the
 * user clicks Allow / Deny. For "always" variants, also persist the
 * decision for the current tool.
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
