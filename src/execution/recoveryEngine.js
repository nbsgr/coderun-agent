// recoveryEngine.js — Production-grade Recovery Engine
// Diagnoses tool errors and executes policy-driven recovery actions (retries, dependency analysis, or fallbacks).
// Capped at 1 retry before passing control to the LLM.

import * as fs from 'fs';
import * as path from 'path';
import * as memoryManager from '../context/memoryManager.js';
import * as runtime from '../agents/runtime.js';

var MAX_RETRIES = 1;

function recoverySleep(ms) {
  function sleepPromise(resolve) {
    setTimeout(resolve, ms);
  }
  return new Promise(sleepPromise);
}

function detectPythonEnvironment(workspace) {
  var ws = workspace || process.cwd();
  try {
    var venvWin = path.join(ws, '.venv', 'Scripts', 'python.exe');
    var venvPosix = path.join(ws, '.venv', 'bin', 'python');
    if (fs.existsSync(venvWin)) return { type: 'venv_win', path: '.venv\\Scripts\\python.exe' };
    if (fs.existsSync(venvPosix)) return { type: 'venv_posix', path: '.venv/bin/python' };

    var altVenvWin = path.join(ws, 'venv', 'Scripts', 'python.exe');
    var altVenvPosix = path.join(ws, 'venv', 'bin', 'python');
    if (fs.existsSync(altVenvWin)) return { type: 'venv_win', path: 'venv\\Scripts\\python.exe' };
    if (fs.existsSync(altVenvPosix)) return { type: 'venv_posix', path: 'venv/bin/python' };

    if (fs.existsSync(path.join(ws, 'uv.lock'))) return { type: 'uv' };
    if (fs.existsSync(path.join(ws, 'poetry.lock'))) return { type: 'poetry' };
    if (fs.existsSync(path.join(ws, 'Pipfile'))) return { type: 'pipenv' };
    if (fs.existsSync(path.join(ws, 'environment.yml')) || fs.existsSync(path.join(ws, 'environment.yaml')) || fs.existsSync(path.join(ws, '.conda'))) return { type: 'conda' };
    if (fs.existsSync(path.join(ws, 'pyproject.toml'))) return { type: 'pyproject' };
    if (fs.existsSync(path.join(ws, 'requirements.txt'))) return { type: 'requirements' };
  } catch (_) {
    // Intentionally ignored
  }
  return { type: 'system_python' };
}

function isIdempotentTool(toolName, err) {
  if (err.includes('ebusy') || err.includes('etxtbsy') || err.includes('resource busy') || err.includes('file is locked') || err.includes('econnreset') || err.includes('etimedout')) {
    return true;
  }
  var safeTools = ['read_file', 'search_files', 'list_directory', 'get_file_info', 'find_in_files', 'list_symbols'];
  return safeTools.indexOf(toolName) !== -1;
}

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

export async function diagnoseAndRecover(toolName, errorMsg, context) {
  context = context || {};
  var err = String(errorMsg || '').toLowerCase();
  var recoveryKey = (context.sessionId ? context.sessionId + '_' : '') + toolName + '_' + (context.activeTaskId || 'general');

  // Record error in memory
  try {
    memoryManager.recordError(toolName + ' failed: ' + errorMsg, context.sessionId);
  } catch (_) {
    // Intentionally ignored
  }

  // Load and increment retries
  var retries = 0;
  try {
    memoryManager.recordRetry(recoveryKey, context.sessionId);
    var allRetries = memoryManager.getRetries(context.sessionId);
    retries = allRetries[recoveryKey] || 1;
  } catch (_) {
    retries = 1;
  }

  console.log('[RECOVERY ENGINE] Diagnosis run for ' + toolName + '. Retry #' + retries + '/' + MAX_RETRIES);

  if (retries > MAX_RETRIES) {
    return {
      action: 'ask_user',
      message: 'Max retry limit (' + MAX_RETRIES + ') reached for ' + toolName + '. Passing error to model.'
    };
  }

  // 1. Diagnose: Missing Node.js dependency -> Request LLM to verify package and execute run_terminal
  if (err.includes('cannot find module') || err.includes('module_not_found') || (err.includes('not found') && err.includes('require'))) {
    var nodeMatch = err.match(/cannot find module\s*['"]?([^'"\s\\]+)['"]?/i);
    var nodePkg = nodeMatch ? nodeMatch[1] : '';
    if (nodePkg && nodePkg.startsWith('@')) {
      var parts = nodePkg.split('/');
      nodePkg = parts.slice(0, 2).join('/');
    } else if (nodePkg && nodePkg.includes('/')) {
      nodePkg = nodePkg.split('/')[0];
    }

    return {
      action: 'llm_resolve_dependency',
      ecosystem: 'node',
      detectedModule: nodePkg,
      message: 'Diagnosed missing Node.js dependency: ' + (nodePkg || 'module') + '. Instructing LLM to identify the actual package name from project configuration and invoke run_terminal.'
    };
  }

  // 2. Diagnose: Missing Python dependency -> Request LLM to verify package and execute run_terminal
  if (err.includes('modulenotfounderror') || err.includes('no module named')) {
    var pyMatch = err.match(/no module named\s*['"]?([^'"\s\\]+)['"]?/i);
    var pyPkg = pyMatch ? pyMatch[1] : '';
    var pyEnv = detectPythonEnvironment(context.workspace);

    return {
      action: 'llm_resolve_dependency',
      ecosystem: 'python',
      detectedModule: pyPkg,
      environmentInfo: pyEnv,
      message: 'Diagnosed missing Python dependency: ' + (pyPkg || 'module') + '. Instructing LLM to identify the actual package name and invoke run_terminal within the detected environment (' + pyEnv.type + ').'
    };
  }

  // 3. Diagnose: File lock or resource busy (EBUSY / ETXTBSY)
  if (err.includes('ebusy') || err.includes('etxtbsy') || err.includes('resource busy') || err.includes('file is locked')) {
    await recoverySleep(1000 * retries);
    return {
      action: 'retry',
      message: 'Diagnosed resource lock. Retrying after backoff delay (' + (1000 * retries) + 'ms).'
    };
  }

  // 4. Diagnose: Git merge / rebase conflict
  var cmd = String(context.command || '').toLowerCase();
  if (err.includes('conflict') && (toolName.includes('git') || cmd.includes('git'))) {
    return {
      action: 'ask_user',
      message: 'Diagnosed Git merge conflicts. Requesting human conflict resolution.'
    };
  }

  // 5. Check if operation is safe / idempotent to retry
  if (!isIdempotentTool(toolName, err)) {
    return {
      action: 'ask_user',
      message: 'Non-idempotent tool failure detected for ' + toolName + ' (' + (errorMsg || 'failed') + '). Delegating to model for context-aware recovery.'
    };
  }

  // Default: Single retry policy for idempotent tool errors
  return {
    action: 'retry',
    message: 'Tool failure detected. Retrying tool call once (attempt ' + retries + '/' + MAX_RETRIES + ').'
  };
}
