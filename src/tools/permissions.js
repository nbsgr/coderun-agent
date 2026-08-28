// permissions.js — Permission handling for dangerous tools
// Supports per-call Allow/Deny AND chat-scoped "Always Allow" / "Always Deny"
// decisions isolated per session.

import { DANGEROUS_TOOLS } from '../agents/constants.js';

var pendingPermissions = {}; // id -> { resolve, timer, sessionId, toolName }
var chatDecisions = {}; // { [sessionId]: { [toolName]: 'allow' | 'deny' } }
var PERMISSION_TIMEOUT_MS = 300000; // 5 minutes (300s) timeout to allow ample time for user review

export function setExtensionContext(context) {
  if (context && context.globalState) {
    try {
      context.globalState.update('coderun_permission_decisions', '{}');
    } catch (_) {
      // Intentionally ignored
    }
  }
}

function getSessionDecisions(sessionId) {
  var sid = sessionId || 'default';
  if (!chatDecisions[sid]) {
    chatDecisions[sid] = {};
  }
  return chatDecisions[sid];
}

// Remember a decision for a given tool in the specified chat session only.
export function setAlwaysDecision(toolName, decision, sessionId) {
  if (!toolName || (decision !== 'allow' && decision !== 'deny')) return;
  var sDecisions = getSessionDecisions(sessionId);
  sDecisions[toolName] = decision;
}

export function clearAlwaysDecision(toolName, sessionId) {
  if (!sessionId) {
    chatDecisions = {};
  } else if (!toolName) {
    delete chatDecisions[sessionId];
  } else if (chatDecisions[sessionId]) {
    delete chatDecisions[sessionId][toolName];
  }
}

export function getAlwaysDecision(toolName, sessionId) {
  var sDecisions = getSessionDecisions(sessionId);
  return sDecisions[toolName] || null;
}

export function listAlwaysDecisions(sessionId) {
  var sDecisions = getSessionDecisions(sessionId);
  var out = {};
  for (var k in sDecisions) {
    out[k] = sDecisions[k];
  }
  return out;
}

export function resetChatDecisions(sessionId) {
  if (sessionId) {
    delete chatDecisions[sessionId];
  } else {
    chatDecisions = {};
  }
}

// Request user permission with a 5-minute timeout.
export function requestPermission(toolName, args, id, sendEvent, sessionId) {
  var chatDecision = getAlwaysDecision(toolName, sessionId);
  if (chatDecision === 'allow') return Promise.resolve(true);
  if (chatDecision === 'deny') return Promise.resolve(false);

  function permissionPromise(resolve) {
    var timer = setTimeout(function onPermissionTimeout() {
      if (pendingPermissions[id]) {
        console.warn('[PERMISSIONS] Request timed out for tool:', toolName, 'id:', id);
        delete pendingPermissions[id];
        resolve(false);
      }
    }, PERMISSION_TIMEOUT_MS);

    pendingPermissions[id] = {
      resolve: resolve,
      timer: timer,
      sessionId: sessionId || 'default',
      toolName: toolName
    };
  }

  return new Promise(permissionPromise);
}

// Resolve a pending permission request.
export function resolvePermission(id, approved, options, sessionId) {
  options = options || {};
  var entry = pendingPermissions[id];
  var toolName = options.toolName || options.tool || (entry && entry.toolName);
  var sid = sessionId || options.sessionId || (entry && entry.sessionId) || 'default';

  if (entry) {
    clearTimeout(entry.timer);
    delete pendingPermissions[id];
    if (options.always && toolName) {
      setAlwaysDecision(toolName, approved ? 'allow' : 'deny', sid);
    }
    entry.resolve(approved);
    return true;
  }
  if (options.always && toolName) {
    setAlwaysDecision(toolName, approved ? 'allow' : 'deny', sid);
    return true;
  }
  return false;
}

export function cancelAllPermissions() {
  cancelAllPending();
}

export function cancelSessionPending(sessionId) {
  var sid = sessionId || 'default';
  for (var id in pendingPermissions) {
    var entry = pendingPermissions[id];
    if (entry.sessionId === sid) {
      clearTimeout(entry.timer);
      try {
        entry.resolve(false);
      } catch (_) {
        // Intentionally ignored
      }
      delete pendingPermissions[id];
    }
  }
}

export function cancelAllPending() {
  for (var id in pendingPermissions) {
    var entry = pendingPermissions[id];
    clearTimeout(entry.timer);
    try {
      entry.resolve(false);
    } catch (_) {
      // Intentionally ignored
    }
  }
  pendingPermissions = {};
}
