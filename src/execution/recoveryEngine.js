// recoveryEngine.js — Production-grade Recovery Engine
// Diagnoses tool errors and executes policy-driven recovery actions (retries, dependencies installs, or fallbacks).

import * as memoryManager from '../context/memoryManager.js';
import * as runtime from '../agents/runtime.js';

var MAX_RETRIES = 3;

function executeRecoverySleep(ms, resolve) {
  setTimeout(resolve, ms);
}

function recoverySleep(ms) {
  return new Promise(executeRecoverySleep.bind(null, ms));
}

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

/**
 * Diagnose a tool failure and suggest a recovery path.
 *
 * @param {string} toolName - Name of the failed tool
 * @param {string} errorMsg - Capture error string
 * @param {object} context  - Workspace / execution context
 * @returns {Promise<object>} Recovery action recommendation
 */
export async function diagnoseAndRecover(toolName, errorMsg, context) {
  var err = String(errorMsg || '').toLowerCase();
  var recoveryKey = toolName + '_' + (context.activeTaskId || 'general');

  // Record error in memory
  try {
    memoryManager.recordError(toolName + ' failed: ' + errorMsg);
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }

  // Load and increment retries
  var retries = 0;
  try {
    memoryManager.recordRetry(recoveryKey);
    var allRetries = memoryManager.getRetries();
    retries = allRetries[recoveryKey] || 1;
  } catch (_) {
    // Intentionally fallback to 1 retry if memoryManager retrieval fails
    retries = 1;
  }

  console.log('[RECOVERY ENGINE] Diagnosis run for ' + toolName + '. Retry #' + retries + '/' + MAX_RETRIES);

  if (retries > MAX_RETRIES) {
    return {
      action: 'ask_user',
      message: 'Max retries (' + MAX_RETRIES + ') exceeded for tool ' + toolName + '. Requesting human intervention.'
    };
  }

  // 1. Diagnose: Missing node dependency
  if (err.includes('cannot find module') || err.includes('module_not_found') || err.includes('not found') && err.includes('require')) {
    var match = err.match(/cannot find module\s*['"](.+?)['"]/);
    var pkgName = match ? match[1] : '';
    return {
      action: 'fallback',
      command: pkgName ? 'npm install ' + pkgName : 'npm install',
      message: 'Diagnosed missing dependency: ' + (pkgName || 'node_modules') + '. Initiating auto-install fallback.'
    };
  }

  // 2. Diagnose: File lock or resource busy
  if (err.includes('ebusy') || err.includes('resource busy') || err.includes('lock')) {
    // Suggest immediate retry after short backoff
    await recoverySleep(1000 * retries);
    return {
      action: 'retry',
      message: 'Diagnosed resource lock. Retrying after backoff delay.'
    };
  }

  // 3. Diagnose: Git merge conflict
  if (err.includes('conflict') && toolName.includes('git')) {
    return {
      action: 'ask_user',
      message: 'Diagnosed Git merge conflicts. Requesting human conflict resolution.'
    };
  }

  // Default: Generic retry policy for recoverable tool errors
  return {
    action: 'retry',
    message: 'Generic failure. Retrying tool call (attempt ' + retries + '/' + MAX_RETRIES + ').'
  };
}
