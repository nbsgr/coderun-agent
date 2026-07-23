// tools.js — Tool implementations
// Each tool is an async generator that yields action + result events

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as toolRegistry from './toolRegistry.js';
import * as terminalManager from './terminalManager.js';
import * as searchManager from './searchManager.js';
import { parseSymbols } from './symbolParser.js';

var DEBUG = false;
function dbg() { if (DEBUG) console.log.apply(console, arguments); }

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

    // Read original content if file exists (for diff preview)
    var originalContent = '';
    if (existsSync(target)) {
      originalContent = await fs.readFile(target, 'utf-8');
    }

    // Create a deferred promise for diff review
    // The agent loop captures deferred.resolve and extension.js calls
    // agentLoop.resolveDiff(id, accepted) to resolve it.
    var diffId = 'diff_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    var deferred = {};
    deferred.promise = new Promise(function(resolve) {
      deferred.resolve = resolve;
    });

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

    // Wait for user to accept or reject in the diff editor
    var diffResult = await deferred.promise;
    if (!diffResult || !diffResult.accepted) {
      yield { type: 'tool_result', tool: 'write_file', success: false, file_path: filePath, message: 'Write rejected by user.', rejected: true };
      return;
    }

    // User accepted — write the file
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

    // First try an exact match (simplest, safest, preserves original behavior)
    var idx = content.indexOf(oldString);
    if (idx !== -1) {
      newContent = content.substring(0, idx) + newString + content.substring(idx + oldString.length);
    } else {
      // Fuzzy match: ignore differences in carriage returns, spaces, tabs, and newlines
      var escapeRegExp = function(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      };

      var tokens = oldString.trim().split(/\s+/);
      if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === '')) {
        yield { type: 'tool_result', tool: 'edit_file', success: false, message: 'old_string is empty.' };
        return;
      }

      var regexParts = tokens.map(function(t) { return escapeRegExp(t); });
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

    // Create a deferred promise for diff review
    var diffId = 'diff_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    var deferred = {};
    deferred.promise = new Promise(function(resolve) {
      deferred.resolve = resolve;
    });

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

    // Wait for user to accept or reject
    var diffResult = await deferred.promise;
    if (!diffResult || !diffResult.accepted) {
      yield { type: 'tool_result', tool: 'edit_file', success: false, file_path: filePath, message: 'Edit rejected by user.', rejected: true };
      return;
    }

    // User accepted — write the file
    await fs.writeFile(target, newContent, 'utf-8');
    yield { type: 'tool_result', tool: 'edit_file', success: true, file_path: filePath, message: 'File edited: ' + filePath };
  } catch (e) {
    yield { type: 'tool_result', tool: 'edit_file', success: false, message: e.message };
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
    await fs.unlink(target);
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
      yield { type: 'tool_result', tool: 'delete_folder', success: false, message: 'Folder not found: ' + folderPath };
      return;
    }
    await fs.rm(target, { recursive: true, force: true });
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
    var entries = list.map(function(item) {
      return { name: item.name, type: item.isDirectory() ? 'directory' : 'file' };
    });
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

    // Use SearchManager which delegates to SQLite index or falls back to fs walk
    try {
      var results = await searchManager.searchFiles(pattern, workspace, folderPath === '.' ? '' : folderPath);
      matches = results || [];
    } catch (_) {
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

/**
 * Execute a command in the VS Code Integrated Terminal using shell integration.
 * Streams output live to the chat UI via terminal events.
 * The terminalManager handles the actual execution and event forwarding.
 * Returns a structured result with shell, command, stdout, stderr, exitCode, etc.
 */
async function* run_terminal(args, workspace) {
  var command = args.command || '';
  var timeout = args.timeout || 30;
  var background = args.background || false;

  if (!command) {
    // Empty command = check current terminal output (continuation after terminal_input).
    // Wait briefly for any new output, then return whatever the terminal has.
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
    // Execute via terminalManager which uses VS Code Terminal API + Shell Integration
    var result = await terminalManager.executeCommand(command, timeout, background);
    dbg('[TOOLS] run_terminal: executeCommand RETURNED. exitCode:', result.exitCode, 'duration:', result.durationMs, 'success:', result.success);

    // The terminalManager fires terminal_start, terminal_output, terminal_exit events
    // via its sendEventCallback. These are forwarded to the webview by extension.js.
    // We yield a result here for the agent loop, but the actual output streaming
    // happens through the event system.
    //
    // The result now includes structured fields: shell, platform, command,
    // stdout, stderr, exitCode, durationMs, success, workingDirectory

    // Determine success: exitCode === 0 → success.
    // If exitCode is null (fallback where it couldn't be determined),
    // use result.success if present, otherwise assume success if
    // stderr is empty and no error was thrown.
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
      // Structured terminal result for the LLM — accurate, no fabrication
      shell: result.shell || terminalManager.getShellName(),
      platform: result.platform || terminalManager.getPlatformName(),
      command: command,
      stdout: toolStdout,
      stderr: toolStderr,
      exit_code: toolExitCode,
      duration_ms: result.durationMs || 0,
      working_directory: result.workingDirectory || workspace,
      waiting_for_input: waitingForInput,
      // Human-readable message based on actual output
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
      // Backward-compat fields
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

    // Apply patches one by one
    for (var i = 0; i < patches.length; i++) {
      var p = patches[i];
      var findStr = p.find || '';
      var replaceStr = p.replace || '';
      if (!findStr) continue;

      var idx = newContent.indexOf(findStr);
      if (idx !== -1) {
        newContent = newContent.substring(0, idx) + replaceStr + newContent.substring(idx + findStr.length);
      } else {
        // Fuzzy whitespace match
        var escapeRegExp = function(str) {
          return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        };

        var tokens = findStr.trim().split(/\s+/);
        if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === '')) {
          yield { type: 'tool_result', tool: 'patch_file', success: false, message: 'Patch #' + (i + 1) + ' search block is empty.' };
          return;
        }

        var regexParts = tokens.map(function(t) { return escapeRegExp(t); });
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

    // Create a deferred promise for diff review
    var diffId = 'diff_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    var deferred = {};
    deferred.promise = new Promise(function(resolve) {
      deferred.resolve = resolve;
    });

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

    // Wait for user to accept or reject
    var diffResult = await deferred.promise;
    if (!diffResult || !diffResult.accepted) {
      yield { type: 'tool_result', tool: 'patch_file', success: false, file_path: filePath, message: 'Patch rejected by user.', rejected: true };
      return;
    }

    // User accepted — write the file
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
    res.headers.forEach(function(value, key) {
      resHeaders[key] = value;
    });

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
  var steps = args.steps;
  if (steps && !Array.isArray(steps)) steps = [steps];
  yield {
    type: 'tool_result',
    tool: 'update_plan',
    success: true,
    message: 'Plan updated successfully.',
    steps: steps
  };
}

async function* create_plan(args, workspace) {
  yield { type: 'action', action: 'create_plan', message: 'Creating execution plan' };
  var steps = args.steps;
  if (steps && !Array.isArray(steps)) steps = [steps];
  yield {
    type: 'tool_result',
    tool: 'create_plan',
    success: true,
    message: 'Plan created successfully.',
    steps: steps
  };
}

// =====================================================
// REGISTER ALL TOOLS
// =====================================================

export function registerAllTools() {
  toolRegistry.register('read_file', read_file);
  toolRegistry.register('read', read_file);
  toolRegistry.register('write_file', write_file);
  toolRegistry.register('write', write_file);
  toolRegistry.register('edit_file', edit_file);
  toolRegistry.register('edit', edit_file);
  toolRegistry.register('delete_file', delete_file);
  toolRegistry.register('create_folder', create_folder);
  toolRegistry.register('delete_folder', delete_folder);
  toolRegistry.register('list_directory', list_directory);
  toolRegistry.register('search_files', search_files);
  toolRegistry.register('get_file_info', get_file_info);
  toolRegistry.register('run_terminal', run_terminal);
  toolRegistry.register('bash', run_terminal);
  toolRegistry.register('execute_command', run_terminal);
  toolRegistry.register('terminal_input', terminal_input);
  toolRegistry.register('stop_terminal', stop_terminal);
  toolRegistry.register('list_symbols', list_symbols);
  toolRegistry.register('patch_file', patch_file);
  toolRegistry.register('web_request', web_request);
  toolRegistry.register('get_current_datetime', get_current_datetime);
  toolRegistry.register('find_in_files', find_in_files);
  toolRegistry.register('update_plan', update_plan);
  toolRegistry.register('create_plan', create_plan);
}
