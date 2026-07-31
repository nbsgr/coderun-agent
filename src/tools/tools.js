// tools.js — Tool implementations
// Each tool is an async generator that yields action + result events

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as toolRegistry from './toolRegistry.js';
import * as terminalManager from './terminalManager.js';
import * as searchManager from '../context/searchManager.js';
import * as planningManager from '../context/planningManager.js';
import * as runtime from '../agents/runtime.js';
import * as multiAgentRuntime from '../execution/multiAgentRuntime.js';
import { parseSymbols } from '../context/symbolParser.js';

var DEBUG = false;
function dbg() { if (DEBUG) console.log.apply(console, arguments); }

function escapeStringForRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function executeDeferredPromise(deferred, resolve) {
  deferred.resolve = resolve;
}

function createDeferredPromise() {
  var deferred = {};
  deferred.promise = new Promise(executeDeferredPromise.bind(null, deferred));
  return deferred;
}

function executeSleepPromise(ms, resolve) {
  setTimeout(resolve, ms);
}

function sleep(ms) {
  return new Promise(executeSleepPromise.bind(null, ms));
}

// ═══════════════════════════════════════════════════════════
// TOOL INTERFACE
// Every tool is an async generator: async function*(args, context)
// context = { workspace, sendEvent?, signal? }
// ═══════════════════════════════════════════════════════════

// =====================================================
// HELPER: SAFE PATH
// =====================================================
function _safePath(workspace, relPath) {
  var base = path.resolve(workspace);
  var target = path.resolve(path.join(base, relPath));
  if (!target.startsWith(base)) {
    throw new Error('Path traversal blocked: ' + relPath);
  }
  return target;
}

// =====================================================
// FILE TOOLS
// =====================================================

async function* read_file(args, workspace) {
  var filePath = args.file_path || '';
  yield { type: 'action', action: 'read_file', message: 'Reading file: ' + filePath };
  try {
    var target = _safePath(workspace, filePath);
    if (!existsSync(target)) {
      yield { type: 'tool_result', tool: 'read_file', success: false, message: 'File not found: ' + filePath };
      return;
    }
    var content = await fs.readFile(target, 'utf-8');
    yield { type: 'tool_result', tool: 'read_file', success: true, file_path: filePath, content: content };
  } catch (e) {
    yield { type: 'tool_result', tool: 'read_file', success: false, message: e.message };
  }
}

async function* write_file(args, workspace) {
  var filePath = args.file_path || '';
  var content = args.content || '';
  yield { type: 'action', action: 'write_file', message: 'Writing file: ' + filePath };
  try {
    var target = _safePath(workspace, filePath);

    var originalContent = '';
    if (existsSync(target)) {
      originalContent = await fs.readFile(target, 'utf-8');
    }

    var deferred = createDeferredPromise();
    var diffId = 'diff_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    yield {
      type: 'request_diff',
      id: diffId,
      tool: 'write_file',
      file_path: filePath,
      original_content: originalContent,
      new_content: content,
      is_new_file: !originalContent,
      deferred: deferred
    };

    var diffResult = await deferred.promise;
    if (!diffResult || !diffResult.accepted) {
      yield { type: 'tool_result', tool: 'write_file', success: false, file_path: filePath, message: 'Write rejected by user.', rejected: true };
      return;
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf-8');
    yield { type: 'tool_result', tool: 'write_file', success: true, file_path: filePath, message: 'File written: ' + filePath };
  } catch (e) {
    yield { type: 'tool_result', tool: 'write_file', success: false, message: e.message };
  }
}

async function* edit_file(args, workspace) {
  var filePath = args.file_path || '';
  var oldString = args.old_string || '';
  var newString = args.new_string || '';
  yield { type: 'action', action: 'edit_file', message: 'Editing file: ' + filePath };
  try {
    var target = _safePath(workspace, filePath);
    if (!existsSync(target)) {
      yield { type: 'tool_result', tool: 'edit_file', success: false, message: 'File not found: ' + filePath };
      return;
    }
    var content = await fs.readFile(target, 'utf-8');
    var newContent = '';

    var idx = content.indexOf(oldString);
    if (idx !== -1) {
      newContent = content.substring(0, idx) + newString + content.substring(idx + oldString.length);
    } else {
      var tokens = oldString.trim().split(/\s+/);
      if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === '')) {
        yield { type: 'tool_result', tool: 'edit_file', success: false, message: 'old_string is empty.' };
        return;
      }

      var regexParts = [];
      for (var ti = 0; ti < tokens.length; ti++) {
        regexParts.push(escapeStringForRegExp(tokens[ti]));
      }
      var pattern = regexParts.join('\\s+');
      var regex = new RegExp(pattern, 'g');

      var matches = [...content.matchAll(regex)];
      if (matches.length === 0) {
        yield { type: 'tool_result', tool: 'edit_file', success: false, message: 'old_string not found in file (tried exact and fuzzy whitespace matching).' };
        return;
      }
      if (matches.length > 1) {
        yield { type: 'tool_result', tool: 'edit_file', success: false, message: 'Multiple fuzzy matches for old_string found in file. Please provide more surrounding context.' };
        return;
      }

      var match = matches[0];
      var matchIdx = match.index;
      var matchLen = match[0].length;
      newContent = content.substring(0, matchIdx) + newString + content.substring(matchIdx + matchLen);
    }

    var deferred = createDeferredPromise();
    var diffId = 'diff_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    yield {
      type: 'request_diff',
      id: diffId,
      tool: 'edit_file',
      file_path: filePath,
      original_content: content,
      new_content: newContent,
      is_new_file: false,
      deferred: deferred
    };

    var diffResult = await deferred.promise;
    if (!diffResult || !diffResult.accepted) {
      yield { type: 'tool_result', tool: 'edit_file', success: false, file_path: filePath, message: 'Edit rejected by user.', rejected: true };
      return;
    }

    await fs.writeFile(target, newContent, 'utf-8');
    yield { type: 'tool_result', tool: 'edit_file', success: true, file_path: filePath, message: 'File edited: ' + filePath };
  } catch (e) {
    yield { type: 'tool_result', tool: 'edit_file', success: false, message: e.message };
  }
}

async function _safeUnlink(target) {
  try {
    try {
      await fs.chmod(target, 0o666);
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }
    await fs.unlink(target);
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      await sleep(150);
      await fs.rm(target, { force: true, maxRetries: 3, retryDelay: 100 });
    } else if (existsSync(target)) {
      throw err;
    }
  }
}

async function _safeRmDir(target) {
  try {
    await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  } catch (err) {
    if (existsSync(target)) throw err;
  }
}

async function* delete_file(args, workspace) {
  var filePath = args.file_path || '';
  yield { type: 'action', action: 'delete_file', message: 'Deleting file: ' + filePath };
  try {
    var target = _safePath(workspace, filePath);
    if (!existsSync(target)) {
      yield { type: 'tool_result', tool: 'delete_file', success: false, message: 'File not found: ' + filePath };
      return;
    }
    await _safeUnlink(target);
    yield { type: 'tool_result', tool: 'delete_file', success: true, file_path: filePath, message: 'File deleted: ' + filePath };
  } catch (e) {
    yield { type: 'tool_result', tool: 'delete_file', success: false, message: e.message };
  }
}

// =====================================================
// DIRECTORY TOOLS
// =====================================================

async function* create_folder(args, workspace) {
  var folderPath = args.folder_path || '';
  yield { type: 'action', action: 'create_folder', message: 'Creating folder: ' + folderPath };
  try {
    var target = _safePath(workspace, folderPath);
    await fs.mkdir(target, { recursive: true });
    yield { type: 'tool_result', tool: 'create_folder', success: true, folder_path: folderPath, message: 'Folder created: ' + folderPath };
  } catch (e) {
    yield { type: 'tool_result', tool: 'create_folder', success: false, message: e.message };
  }
}

async function* delete_folder(args, workspace) {
  var folderPath = args.folder_path || '';
  yield { type: 'action', action: 'delete_folder', message: 'Deleting folder: ' + folderPath };
  try {
    var target = _safePath(workspace, folderPath);
    if (!existsSync(target)) {
      yield { type: 'tool_result', tool: 'delete_folder', success: true, folder_path: folderPath, message: 'Folder deleted: ' + folderPath };
      return;
    }
    await _safeRmDir(target);
    yield { type: 'tool_result', tool: 'delete_folder', success: true, folder_path: folderPath, message: 'Folder deleted: ' + folderPath };
  } catch (e) {
    yield { type: 'tool_result', tool: 'delete_folder', success: false, message: e.message };
  }
}

async function* list_directory(args, workspace) {
  var folderPath = args.folder_path || '.';
  yield { type: 'action', action: 'list_directory', message: 'Listing directory: ' + folderPath };
  try {
    var target = _safePath(workspace, folderPath);
    var list = await fs.readdir(target, { withFileTypes: true });
    var entries = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      entries.push({ name: item.name, type: item.isDirectory() ? 'directory' : 'file' });
    }
    yield { type: 'tool_result', tool: 'list_directory', success: true, folder_path: folderPath, entries: entries };
  } catch (e) {
    yield { type: 'tool_result', tool: 'list_directory', success: false, message: e.message };
  }
}

async function* search_files(args, workspace) {
  var pattern = args.pattern || '*';
  var folderPath = args.folder_path || '.';
  yield { type: 'action', action: 'search_files', message: "Searching files: pattern='" + pattern + "' in '" + folderPath + "'" };
  try {
    var target = _safePath(workspace, folderPath);
    var matches = [];

    try {
      var results = await searchManager.searchFiles(pattern, workspace, folderPath === '.' ? '' : folderPath);
      matches = results || [];
    } catch (_) {
      // Intentionally fall back to empty list on search execution error
      matches = [];
    }

    yield { type: 'tool_result', tool: 'search_files', success: true, pattern: pattern, folder_path: folderPath, matches: matches };
  } catch (e) {
    yield { type: 'tool_result', tool: 'search_files', success: false, message: e.message };
  }
}

async function* get_file_info(args, workspace) {
  var filePath = args.file_path || '';
  yield { type: 'action', action: 'get_file_info', message: 'Getting file info: ' + filePath };
  try {
    var target = _safePath(workspace, filePath);
    if (!existsSync(target)) {
      yield { type: 'tool_result', tool: 'get_file_info', success: false, message: 'Path not found: ' + filePath };
      return;
    }
    var stat = await fs.stat(target);
    var info = {
      file_path: filePath,
      exists: true,
      is_file: stat.isFile(),
      is_directory: stat.isDirectory(),
      size: stat.size,
      modified: stat.mtime.toISOString(),
      created: stat.birthtime.toISOString()
    };
    yield { type: 'tool_result', tool: 'get_file_info', success: true, info: info };
  } catch (e) {
    yield { type: 'tool_result', tool: 'get_file_info', success: false, message: e.message };
  }
}

// =====================================================
// TERMINAL TOOLS — Uses VS Code Terminal Shell Integration
// =====================================================

async function* run_terminal(args, workspace) {
  var command = args.command || '';
  var timeout = args.timeout || 30;
  var background = args.background || false;

  if (!command) {
    yield { type: 'action', action: 'run_terminal', message: 'Checking terminal output...' };
    var checkResult = await terminalManager.checkTerminalOutput();
    yield {
      type: 'tool_result',
      tool: 'run_terminal',
      success: true,
      status: checkResult.status || 'checking',
      stdout: checkResult.stdout || '',
      stderr: checkResult.stderr || '',
      output: checkResult.stdout || '',
      interactive: checkResult.interactive === true,
      prompt_detected: checkResult.promptDetected === true,
      waiting_for_input: checkResult.waitingForInput === true,
      shell: checkResult.shell || terminalManager.getShellName(),
      platform: checkResult.platform || terminalManager.getPlatformName(),
      working_directory: workspace,
      exit_code: checkResult.exitCode,
      duration_ms: checkResult.durationMs || 0,
      message: 'Terminal session is active. Current output:\n' + (checkResult.stdout || '(no new output)')
    };
    return;
  }

  yield { type: 'action', action: 'run_terminal', message: 'Running command: ' + command };

  try {
    dbg('[TOOLS] run_terminal: calling terminalManager.executeCommand');
    var result = await terminalManager.executeCommand(command, timeout, background);
    dbg('[TOOLS] run_terminal: executeCommand RETURNED. exitCode:', result.exitCode, 'duration:', result.durationMs, 'success:', result.success);

    var toolSuccess = result.exitCode === 0 || (result.exitCode == null && result.success !== false);
    var toolExitCode = result.exitCode;
    var toolStderr = result.stderr || '';
    var toolStdout = result.stdout || '';
    var waitingForInput = result.waitingForInput === true;
    var interactive = result.interactive === true;
    var promptDetected = result.promptDetected === true;
    var status = result.status || (toolSuccess ? 'completed' : 'failed');
    dbg('[TOOLS] run_terminal: yielding tool_result. exitCode:', toolExitCode, 'success:', toolSuccess, 'waitingForInput:', waitingForInput, 'interactive:', interactive, 'promptDetected:', promptDetected, 'stdout length:', toolStdout.length);

    yield {
      type: 'tool_result',
      tool: 'run_terminal',
      success: toolSuccess,
      status: status,
      interactive: interactive,
      prompt_detected: promptDetected,
      shell: result.shell || terminalManager.getShellName(),
      platform: result.platform || terminalManager.getPlatformName(),
      command: command,
      stdout: toolStdout,
      stderr: toolStderr,
      exit_code: toolExitCode,
      duration_ms: result.durationMs || 0,
      working_directory: result.workingDirectory || workspace,
      waiting_for_input: waitingForInput,
      message: waitingForInput
        ? ('The command is waiting for your input:\n' + (toolStdout || '(no output yet)') + '\n\nStatus: ' + status +
           ' | Interactive: ' + interactive + ' | Prompt detected: ' + promptDetected +
           '\n\nUse `terminal_input` to respond to the prompt.')
        : (toolSuccess
            ? (toolStdout || toolStderr
                ? 'Command completed successfully.'
                : 'Command completed (no output).')
            : 'Command failed' +
              (toolExitCode != null ? ' with exit code ' + toolExitCode : '') +
              (toolStderr ? ': ' + toolStderr.trim().substring(0, 500) : '.')),
      output: toolStdout,
      exitCode: toolExitCode
    };
  } catch (e) {
    yield {
      type: 'tool_result',
      tool: 'run_terminal',
      success: false,
      command: command,
      stdout: '',
      stderr: e.message,
      exit_code: null,
      duration_ms: 0,
      shell: terminalManager.getShellName(),
      platform: terminalManager.getPlatformName(),
      working_directory: workspace,
      message: 'Execution error: ' + e.message,
      output: '',
      exitCode: null
    };
  }
}

// =====================================================
// UTILITY TOOLS
// =====================================================

async function* get_current_datetime(args, workspace) {
  yield { type: 'action', action: 'get_current_datetime', message: 'Getting current date and time' };
  try {
    var now = new Date().toISOString();
    yield { type: 'tool_result', tool: 'get_current_datetime', success: true, datetime: now };
  } catch (e) {
    yield { type: 'tool_result', tool: 'get_current_datetime', success: false, message: e.message };
  }
}

// =====================================================
// FIND IN FILES — content search
// =====================================================

async function* find_in_files(args, workspace) {
  var query = args.query || '';
  yield { type: 'action', action: 'find_in_files', message: "Searching file contents for: '" + query + "'" };
  if (!query) {
    yield { type: 'tool_result', tool: 'find_in_files', success: false, message: 'No query provided.' };
    return;
  }
  try {
    var results = await searchManager.searchContent(query, workspace);
    yield {
      type: 'tool_result',
      tool: 'find_in_files',
      success: true,
      query: query,
      results: results || [],
      message: results && results.length ? 'Found ' + results.length + ' file(s) with matches.' : 'No matches found.'
    };
  } catch (e) {
    yield { type: 'tool_result', tool: 'find_in_files', success: false, message: e.message };
  }
}

// =═══════════════════════════════════════════════════
// INTERACTIVE TERMINAL TOOLS
// =═══════════════════════════════════════════════════

async function* terminal_input(args, workspace) {
  var text = args.text || '';
  yield { type: 'action', action: 'terminal_input', message: 'Sending input to terminal: ' + text };
  try {
    var result = terminalManager.sendTerminalInput(text);
    yield { type: 'tool_result', tool: 'terminal_input', success: true, message: result.message };
  } catch (e) {
    yield { type: 'tool_result', tool: 'terminal_input', success: false, message: e.message };
  }
}

async function* stop_terminal(args, workspace) {
  yield { type: 'action', action: 'stop_terminal', message: 'Stopping terminal process (Ctrl+C)' };
  try {
    var result = await terminalManager.stopTerminal();
    yield { type: 'tool_result', tool: 'stop_terminal', success: true, message: result.message };
  } catch (e) {
    yield { type: 'tool_result', tool: 'stop_terminal', success: false, message: e.message };
  }
}

// =═══════════════════════════════════════════════════
// CODE NAVIGATION, DIFF PATCHING, & HTTP TOOLS
// =═══════════════════════════════════════════════════

async function* list_symbols(args, workspace) {
  var filePath = args.file_path || '';
  yield { type: 'action', action: 'list_symbols', message: 'Getting code outline for: ' + filePath };
  try {
    var target = _safePath(workspace, filePath);
    if (!existsSync(target)) {
      yield { type: 'tool_result', tool: 'list_symbols', success: false, message: 'File not found: ' + filePath };
      return;
    }
    var content = await fs.readFile(target, 'utf-8');
    var symbols = parseSymbols(content, filePath);
    yield { type: 'tool_result', tool: 'list_symbols', success: true, file_path: filePath, entries: symbols };
  } catch (e) {
    yield { type: 'tool_result', tool: 'list_symbols', success: false, message: e.message };
  }
}

async function* patch_file(args, workspace) {
  var filePath = args.file_path || '';
  var patches = args.patches || [];
  yield { type: 'action', action: 'patch_file', message: 'Patching file: ' + filePath + ' (' + patches.length + ' blocks)' };
  try {
    var target = _safePath(workspace, filePath);
    if (!existsSync(target)) {
      yield { type: 'tool_result', tool: 'patch_file', success: false, message: 'File not found: ' + filePath };
      return;
    }
    var content = await fs.readFile(target, 'utf-8');
    var newContent = content;

    for (var i = 0; i < patches.length; i++) {
      var p = patches[i];
      var findStr = p.find || '';
      var replaceStr = p.replace || '';
      if (!findStr) continue;

      var idx = newContent.indexOf(findStr);
      if (idx !== -1) {
        newContent = newContent.substring(0, idx) + replaceStr + newContent.substring(idx + findStr.length);
      } else {
        var tokens = findStr.trim().split(/\s+/);
        if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === '')) {
          yield { type: 'tool_result', tool: 'patch_file', success: false, message: 'Patch #' + (i + 1) + ' search block is empty.' };
          return;
        }

        var regexParts = [];
        for (var ti = 0; ti < tokens.length; ti++) {
          regexParts.push(escapeStringForRegExp(tokens[ti]));
        }
        var pattern = regexParts.join('\\s+');
        var regex = new RegExp(pattern, 'g');

        var matches = [...newContent.matchAll(regex)];
        if (matches.length === 0) {
          yield { type: 'tool_result', tool: 'patch_file', success: false, message: 'Patch #' + (i + 1) + ' search block not found in file (tried exact and fuzzy matching).' };
          return;
        }
        if (matches.length > 1) {
          yield { type: 'tool_result', tool: 'patch_file', success: false, message: 'Patch #' + (i + 1) + ' search block is ambiguous (multiple matches found in file). Please add more context.' };
          return;
        }

        var match = matches[0];
        var matchIdx = match.index;
        var matchLen = match[0].length;
        newContent = newContent.substring(0, matchIdx) + replaceStr + newContent.substring(matchIdx + matchLen);
      }
    }

    var deferred = createDeferredPromise();
    var diffId = 'diff_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    yield {
      type: 'request_diff',
      id: diffId,
      tool: 'patch_file',
      file_path: filePath,
      original_content: content,
      new_content: newContent,
      is_new_file: false,
      deferred: deferred
    };

    var diffResult = await deferred.promise;
    if (!diffResult || !diffResult.accepted) {
      yield { type: 'tool_result', tool: 'patch_file', success: false, file_path: filePath, message: 'Patch rejected by user.', rejected: true };
      return;
    }

    await fs.writeFile(target, newContent, 'utf-8');
    yield { type: 'tool_result', tool: 'patch_file', success: true, file_path: filePath, message: 'File patched successfully: ' + filePath };
  } catch (e) {
    yield { type: 'tool_result', tool: 'patch_file', success: false, message: e.message };
  }
}

async function* web_request(args, workspace) {
  var url = args.url || '';
  var method = args.method || 'GET';
  var headers = args.headers || {};
  var body = args.body || null;

  yield { type: 'action', action: 'web_request', message: 'HTTP Request: ' + method + ' ' + url };
  try {
    var options = {
      method: method,
      headers: headers
    };
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = typeof body === 'object' ? JSON.stringify(body) : String(body);
      if (!headers['Content-Type'] && !headers['content-type']) {
        options.headers['Content-Type'] = 'application/json';
      }
    }

    var res = await fetch(url, options);
    var resText = await res.text();
    var maxBodyLen = 8000;
    var truncated = false;
    if (resText.length > maxBodyLen) {
      resText = resText.substring(0, maxBodyLen);
      truncated = true;
    }

    var resHeaders = {};
    var headerEntries = res.headers.entries();
    for (var entry of headerEntries) {
      resHeaders[entry[0]] = entry[1];
    }

    yield {
      type: 'tool_result',
      tool: 'web_request',
      success: true,
      url: url,
      status: res.status,
      status_text: res.statusText,
      headers: resHeaders,
      content: resText + (truncated ? '\n\n[Response body truncated for brevity]' : '')
    };
  } catch (e) {
    yield { type: 'tool_result', tool: 'web_request', success: false, message: e.message };
  }
}

async function* update_plan(args, workspace) {
  yield { type: 'action', action: 'update_plan', message: 'Updating execution plan' };

  var planId = args.plan_id || args.planId || '';
  var taskId = args.task_id != null ? args.task_id : (args.taskId != null ? args.taskId : (args.step_id != null ? args.step_id : (args.stepId != null ? args.stepId : (args.step != null ? args.step : (args.order != null ? args.order : (args.task != null ? args.task : ''))))));
  var status = args.status || args.new_status || args.newStatus || args.task_status || '';
  var tasks = args.tasks || args.steps || [];

  if (!planId) {
    planId = discoverCurrentPlanId();
  }

  if (planId && taskId && status) {
    var observation = args.observation ? {
      type: status === 'completed' ? 'success' : status === 'failed' ? 'failure' : 'info',
      detail: args.observation || '',
      source: 'update_plan_tool',
      output: args.output || ''
    } : null;

    var result = planningManager.updateTaskStatus(planId, taskId, status, observation);
    var enginePlan = result.plan || planningManager.getPlan(planId);

    if (enginePlan) runtime.updatePlan(enginePlan);

    var completedCount = 0, pendingCount = 0, failedCount = 0, skippedCount = 0;
    if (enginePlan && enginePlan.phases) {
      for (var pi = 0; pi < enginePlan.phases.length; pi++) {
        var ph = enginePlan.phases[pi];
        if (ph.tasks) {
          for (var ti = 0; ti < ph.tasks.length; ti++) {
            var st = ph.tasks[ti].status;
            if (st === 'completed') completedCount++;
            else if (st === 'pending' || st === 'blocked') pendingCount++;
            else if (st === 'failed') failedCount++;
            else if (st === 'skipped') skippedCount++;
          }
        }
      }
    }

    var success = result.success !== false;
    yield {
      type: 'tool_result',
      tool: 'update_plan',
      success: success,
      planId: planId,
      taskId: taskId,
      newStatus: status,
      completedCount: completedCount,
      pendingCount: pendingCount,
      failedCount: failedCount,
      skippedCount: skippedCount,
      totalTasks: completedCount + pendingCount + failedCount + skippedCount,
      message: success ? ('Task ' + taskId + ' updated to ' + status + ' (plan: ' + planId + '). Progress: ' + completedCount + '/' + (completedCount + pendingCount + failedCount + skippedCount) + ' done.') : 'Failed to update task ' + taskId + ' in plan ' + planId,
      plan: enginePlan ? enginePlan : null,
      readyTasks: result.readyTasks || [],
      blockedTasks: result.blockedTasks || []
    };
    return;
  }

  if (planId && !taskId) {
    var enginePlan = planningManager.getPlan(planId);
    if (enginePlan) {
      var planSummary = 'Plan ' + planId + ': ' + (enginePlan.summary || enginePlan.goal || '') + ' [' + enginePlan.status + ']';
      yield {
        type: 'tool_result',
        tool: 'update_plan',
        success: true,
        plan: enginePlan,
        message: planSummary + '\nUse update_plan with task_id to update individual tasks.'
      };
      return;
    }
  }

  if (tasks && !Array.isArray(tasks)) tasks = [tasks];
  yield {
    type: 'tool_result',
    tool: 'update_plan',
    success: true,
    message: 'Plan updated successfully.' + (planId ? ' (plan: ' + planId + ')' : ''),
    steps: tasks
  };
}

function discoverCurrentPlanId() {
  try {
    var activePlanId = runtime.getActivePlanId();
    if (activePlanId) return activePlanId;

    var activePlan = runtime.getCurrentPlan();
    if (activePlan && activePlan.id) return activePlan.id;
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }

  try {
    var allPlans = runtime.getAllPlans();
    if (allPlans && allPlans.length) {
      var best = allPlans[0];
      for (var i = 1; i < allPlans.length; i++) {
        if (allPlans[i].updatedAt > best.updatedAt) best = allPlans[i];
      }
      if (best && best.status !== 'completed' && best.status !== 'failed' && best.status !== 'cancelled') {
        return best.id;
      }
      return best.id;
    }
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }

  return '';
}

async function* create_plan(args, workspace) {
  yield { type: 'action', action: 'create_plan', message: 'Creating execution plan' };

  var goal = args.goal || args.description || '';
  var steps = args.steps || args.tasks || [];

  if (goal && workspace) {
    var analysis = planningManager.analyzeRequest(goal, null, workspace);
    var sessionId = args.session_id || 'session_' + Date.now();
    var plan = planningManager.buildPlan(analysis, sessionId);

    runtime.registerPlan(plan);
    runtime.setActivePlanId(plan.id);

    var taskIds = [];
    var totalTasks = 0;
    var pendingTasks = 0;
    if (plan.phases) {
      for (var pi = 0; pi < plan.phases.length; pi++) {
        var ph = plan.phases[pi];
        if (ph.tasks) {
          for (var ti = 0; ti < ph.tasks.length; ti++) {
            var t = ph.tasks[ti];
            taskIds.push(t.id);
            totalTasks++;
            if (t.status === 'pending') pendingTasks++;
          }
        }
      }
    }

    var serializedPhases = [];
    for (var pi = 0; pi < plan.phases.length; pi++) {
      var ph = plan.phases[pi];
      var serializedTasks = [];
      for (var ti = 0; ti < ph.tasks.length; ti++) {
        var t = ph.tasks[ti];
        serializedTasks.push({
          id: t.id,
          description: t.description,
          status: t.status,
          complexity: t.complexity,
          action: t.action,
          dependsOn: t.dependsOn,
          parallelWith: t.parallelWith
        });
      }
      serializedPhases.push({
        id: ph.id,
        name: ph.name,
        description: ph.description,
        order: ph.order,
        status: ph.status,
        tasks: serializedTasks,
        parallelGroups: ph.parallelGroups
      });
    }

    yield {
      type: 'tool_result',
      tool: 'create_plan',
      success: true,
      message: 'Structured plan created with ' + plan.phases.length + ' phases and ' +
               totalTasks + ' tasks. Complexity: ' + plan.complexity.label +
               '. Estimated ~' + plan.estimatedIterations + ' iterations.',
      planId: plan.id,
      taskIds: taskIds,
      totalTasks: totalTasks,
      pendingTasks: pendingTasks,
      plan: {
        id: plan.id,
        goal: plan.goal,
        summary: plan.summary,
        phases: serializedPhases,
        status: plan.status,
        complexity: plan.complexity,
        risks: plan.risks,
        estimatedIterations: plan.estimatedIterations,
        executionGraph: plan.executionGraph
      }
    };
    return;
  }

  if (steps && !Array.isArray(steps)) steps = [steps];
  var serializedSteps = [];
  for (var idx = 0; idx < steps.length; idx++) {
    var st = steps[idx];
    serializedSteps.push({
      id: String(idx + 1),
      order: idx + 1,
      description: typeof st === 'string' ? st : (st.description || st.step || ''),
      status: (typeof st === 'object' && st.status) ? st.status : 'pending'
    });
  }

  var fallbackPlan = {
    id: '1',
    goal: goal || 'Execution Plan',
    status: 'active',
    steps: serializedSteps
  };
  yield {
    type: 'tool_result',
    tool: 'create_plan',
    success: true,
    message: 'Plan created successfully with ' + steps.length + ' steps.',
    plan: fallbackPlan,
    steps: steps
  };
}

// ── get_plan — Query current plan status ─────────────
async function* get_plan(args, workspace) {
  yield { type: 'action', action: 'get_plan', message: 'Getting plan status' };
  try {
    var planId = args.plan_id || args.planId || '';

    if (!planId) {
      var activePlan = runtime.getCurrentPlan();
      if (activePlan) planId = activePlan.id;
    }

    var result = planId ? (runtime.getPlan(planId) || planningManager.getPlan(planId))
                        : runtime.getCurrentPlan();

    if (!result) {
      var allPlans = planningManager.getActivePlansContext();
      var activeId = runtime.getActivePlanId();
      var activeInfo = activeId ? (' Active plan: ' + activeId) : '';
      yield {
        type: 'tool_result', tool: 'get_plan', success: true,
        message: (allPlans || 'No active plans found.') + activeInfo,
        plan: null
      };
      return;
    }

    var completedCount = 0, pendingCount = 0, failedCount = 0, skippedCount = 0;
    if (result.phases) {
      for (var pi = 0; pi < result.phases.length; pi++) {
        var ph = result.phases[pi];
        if (ph.tasks) {
          for (var ti = 0; ti < ph.tasks.length; ti++) {
            var st = ph.tasks[ti].status;
            if (st === 'completed') completedCount++;
            else if (st === 'pending' || st === 'blocked') pendingCount++;
            else if (st === 'failed') failedCount++;
            else if (st === 'skipped') skippedCount++;
          }
        }
      }
    }

    var serializedPhases = [];
    if (result.phases) {
      for (var pi = 0; pi < result.phases.length; pi++) {
        var ph = result.phases[pi];
        var serializedTasks = [];
        for (var ti = 0; ti < ph.tasks.length; ti++) {
          var t = ph.tasks[ti];
          serializedTasks.push({
            id: t.id,
            description: t.description,
            status: t.status,
            complexity: t.complexity,
            action: t.action,
            dependsOn: t.dependsOn,
            parallelWith: t.parallelWith
          });
        }
        serializedPhases.push({
          id: ph.id,
          name: ph.name,
          order: ph.order,
          status: ph.status,
          tasks: serializedTasks
        });
      }
    }

    yield {
      type: 'tool_result', tool: 'get_plan', success: true,
      planId: result.id,
      status: result.status,
      completedCount: completedCount,
      pendingCount: pendingCount,
      failedCount: failedCount,
      skippedCount: skippedCount,
      totalTasks: completedCount + pendingCount + failedCount + skippedCount,
      plan: {
        id: result.id, goal: result.goal, summary: result.summary,
        status: result.status,
        phases: serializedPhases,
        complexity: result.complexity,
        estimatedIterations: result.estimatedIterations,
        executionGraph: result.executionGraph
      },
      message: 'Plan ' + result.id + ': ' + result.status + ' | ' +
               completedCount + '/' + (completedCount + pendingCount + failedCount + skippedCount) +
               ' done | ' + result.summary
    };
  } catch (e) {
    yield { type: 'tool_result', tool: 'get_plan', success: false, message: e.message };
  }
}

// ── invoke_subagent — Delegate to specialized sub-agent role ─────
async function* invoke_subagent(args, workspace) {
  var role = args.role || 'coding';
  var task = args.task || args.prompt || args.goal || '';

  yield { type: 'action', action: 'invoke_subagent', message: 'Delegating task to sub-agent [' + role + ']: ' + task };

  if (!task) {
    yield {
      type: 'tool_result',
      tool: 'invoke_subagent',
      success: false,
      message: 'Sub-agent task description is required.'
    };
    return;
  }

  var rolePrompt = multiAgentRuntime.getRolePrompt(role);

  yield {
    type: 'tool_result',
    tool: 'invoke_subagent',
    success: true,
    role: role,
    task: task,
    message: 'Sub-agent [' + role + '] delegated task: "' + task + '". Role instructions:\n' + rolePrompt
  };
}

// =====================================================
// REGISTER ALL TOOLS — using descriptor-based toolRegistry
// =====================================================

function reg(name, handler, opts) {
  opts = opts || {};
  toolRegistry.register({
    name: name,
    handler: handler,
    aliases: opts.aliases || [],
    category: opts.category || 'utility',
    description: opts.description || '',
    parameters: opts.parameters || {},
    required: opts.required || [],
    metadata: {
      dangerous: opts.dangerous || false,
      needsPermission: opts.needsPermission || opts.dangerous || false,
      category: opts.category || 'utility',
      timeout: opts.timeout || 30000
    }
  });
}

export function registerAllTools() {
  // ── Filesystem ─────────────────────────────────────
  reg('read_file', read_file, {
    aliases: ['read'],
    category: 'filesystem',
    description: 'Read the full contents of a file at the given relative path inside the workspace.',
    parameters: { file_path: { type: 'string', description: "Relative path e.g. 'src/main.py'" } },
    required: ['file_path']
  });
  reg('write_file', write_file, {
    aliases: ['write'],
    category: 'filesystem',
    description: 'Create a new file or completely overwrite an existing file.',
    parameters: { file_path: { type: 'string', description: "Relative path e.g. 'src/app.js'" }, content: { type: 'string', description: 'The complete file content' } },
    required: ['file_path', 'content'],
    dangerous: true
  });
  reg('edit_file', edit_file, {
    aliases: ['edit'],
    category: 'filesystem',
    description: 'Replace the first occurrence of an exact string in a file with a new string.',
    parameters: { file_path: { type: 'string', description: 'Relative path' }, old_string: { type: 'string', description: 'The exact string to find' }, new_string: { type: 'string', description: 'The replacement string' } },
    required: ['file_path', 'old_string', 'new_string'],
    dangerous: true
  });
  reg('delete_file', delete_file, {
    category: 'filesystem',
    description: 'Permanently delete a file from the workspace.',
    parameters: { file_path: { type: 'string', description: 'Relative path' } },
    required: ['file_path'],
    dangerous: true
  });
  reg('create_folder', create_folder, {
    category: 'filesystem',
    description: 'Create a directory (and any parent directories) in the workspace.',
    parameters: { folder_path: { type: 'string', description: "Relative path e.g. 'src/components'" } },
    required: ['folder_path']
  });
  reg('delete_folder', delete_folder, {
    category: 'filesystem',
    description: 'Delete a folder and ALL its contents recursively.',
    parameters: { folder_path: { type: 'string', description: 'Relative path to delete' } },
    required: ['folder_path'],
    dangerous: true
  });
  reg('list_directory', list_directory, {
    category: 'filesystem',
    description: 'List all files and folders in a directory.',
    parameters: { folder_path: { type: 'string', description: "Relative path. Use '.' for root." } },
    required: []
  });
  reg('get_file_info', get_file_info, {
    category: 'filesystem',
    description: 'Get metadata about a file or folder (size, modified, type).',
    parameters: { file_path: { type: 'string', description: 'Relative path' } },
    required: ['file_path']
  });
  reg('patch_file', patch_file, {
    category: 'filesystem',
    description: 'Apply multiple search-and-replace blocks to a single file at once.',
    parameters: {
      file_path: { type: 'string', description: 'Relative path' },
      patches: { type: 'array', description: 'Search-replace blocks.', items: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' } }, required: ['find', 'replace'] } }
    },
    required: ['file_path', 'patches'],
    dangerous: true
  });

  // ── Search ─────────────────────────────────────────
  reg('search_files', search_files, {
    category: 'search',
    description: 'Recursively search for files matching a glob pattern.',
    parameters: { pattern: { type: 'string', description: "Glob pattern e.g. '*.py'" }, folder_path: { type: 'string', description: 'Relative path to search in' } },
    required: ['pattern']
  });
  reg('find_in_files', find_in_files, {
    category: 'search',
    description: 'Search file contents for a text query. Returns matching files with snippets.',
    parameters: { query: { type: 'string', description: 'Text to search for' } },
    required: ['query']
  });
  reg('list_symbols', list_symbols, {
    category: 'search',
    description: 'Extract code symbols (classes, functions) defined in a file.',
    parameters: { file_path: { type: 'string', description: "Relative path e.g. 'src/app.js'" } },
    required: ['file_path']
  });

  // ── Terminal ───────────────────────────────────────
  reg('run_terminal', run_terminal, {
    aliases: ['bash', 'execute_command'],
    category: 'terminal',
    description: 'Execute a shell command. Pass empty command to check terminal output.',
    parameters: { command: { type: 'string', description: 'The command to execute' }, timeout: { type: 'integer', description: 'Max seconds (default 30)' }, background: { type: 'boolean', description: 'Run without waiting' } },
    required: [],
    dangerous: true,
    needsPermission: true,
    timeout: 60000
  });
  reg('terminal_input', terminal_input, {
    category: 'terminal',
    description: 'Send text input to the active terminal command.',
    parameters: { text: { type: 'string', description: 'The text to send' } },
    required: ['text']
  });
  reg('stop_terminal', stop_terminal, {
    category: 'terminal',
    description: 'Send Ctrl+C to stop the running terminal command.',
    parameters: {},
    required: []
  });

  // ── Utility ────────────────────────────────────────
  reg('get_current_datetime', get_current_datetime, {
    category: 'utility',
    description: 'Get the current date and time in ISO format.',
    parameters: {},
    required: []
  });
  reg('web_request', web_request, {
    category: 'utility',
    description: 'Perform an HTTP request.',
    parameters: { url: { type: 'string', description: 'The URL' }, method: { type: 'string', description: "GET/POST/PUT/DELETE" }, headers: { type: 'object', description: 'HTTP headers' }, body: { type: 'string', description: 'Request body' } },
    required: ['url']
  });

  // ── Planning ───────────────────────────────────────
  reg('create_plan', create_plan, {
    category: 'planning',
    description: 'Create a structured execution plan. Provide goal for auto-analysis, or manual steps.',
    parameters: { goal: { type: 'string' }, session_id: { type: 'string' }, steps: { type: 'array' } },
    required: []
  });
  reg('update_plan', update_plan, {
    category: 'planning',
    description: 'Update individual task statuses in an execution plan. Call this after completing a task to mark it done and advance. Provide observation with what you accomplished.',
    parameters: { plan_id: { type: 'string', description: 'The plan ID (e.g., plan_xxx). Required.' }, task_id: { type: 'string', description: 'The task ID to update (e.g., t1_1). Required.' }, status: { type: 'string', description: 'New status: pending, active, completed, failed, skipped.' }, observation: { type: 'string', description: 'Brief note about what was done or why it failed.' }, output: { type: 'string', description: 'Summary of the output/results.' } },
    required: ['plan_id', 'task_id', 'status']
  });
  reg('get_plan', get_plan, {
    category: 'planning',
    description: 'Get the current execution plan status. Use without plan_id to list all plans. Use with plan_id to get a specific plan with full task details.',
    parameters: { plan_id: { type: 'string', description: 'Optional plan ID. Omit to list all plans.' } },
    required: []
  });

  // ── Multi-Agent ────────────────────────────────────
  reg('invoke_subagent', invoke_subagent, {
    category: 'multiagent',
    description: 'Delegate a specialized task to a sub-agent role (research, coding, testing, review, planner, documentation). Uses the configured LLM model instance with specialized role prompts.',
    parameters: {
      role: { type: 'string', description: 'Sub-agent role: research, coding, testing, review, planner, documentation' },
      task: { type: 'string', description: 'Clear, specific description of what the sub-agent should accomplish' }
    },
    required: ['role', 'task']
  });

  console.log('[TOOLS] Registered ' + toolRegistry.count() + ' tools in ' + toolRegistry.listCategories().length + ' categories');
}
