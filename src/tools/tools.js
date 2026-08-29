// tools.js — Tool implementations
// Each tool is an async generator that yields action + result events

import * as fs from 'fs/promises';
import { existsSync, realpathSync } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as dns from 'dns/promises';
import * as net from 'net';
import * as toolRegistry from './toolRegistry.js';
import * as terminalManager from './terminalManager.js';
import * as searchManager from '../context/searchManager.js';
import * as planningManager from '../context/planningManager.js';
import * as planningEngine from '../context/planningEngine.js';
import * as goalTracker from '../context/goalTracker.js';
import * as runtime from '../agents/runtime.js';
import * as multiAgentRuntime from '../execution/multiAgentRuntime.js';
import { parseSymbols } from '../context/symbolParser.js';
import * as projectKnowledge from '../context/projectKnowledge.js';
import * as pathSecurity from './pathSecurity.js';
import * as fileLockManager from './fileLockManager.js';
import * as checkpointManager from './checkpointManager.js';

var DEBUG = false;
function dbg() { if (DEBUG) console.log.apply(console, arguments); }

function computeSha256(content) {
  return crypto.createHash('sha256').update(content || '', 'utf8').digest('hex');
}

function escapeStringForRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createDeferredPromise() {
  var deferred = {};
  function deferredPromise(resolve) {
    deferred.resolve = resolve;
  }
  deferred.promise = new Promise(deferredPromise);
  return deferred;
}

function sleep(ms) {
  function sleepPromise(resolve) {
    setTimeout(resolve, ms);
  }
  return new Promise(sleepPromise);
}

// ═══════════════════════════════════════════════════════════
// TOOL INTERFACE
// Every tool is an async generator: async function*(args, context)
// context = { workspace, sendEvent?, signal? }
// ═══════════════════════════════════════════════════════════

// =====================================================
// HELPER: SAFE PATH
// =====================================================
function _safePath(workspace, relOrAbsPath) {
  return pathSecurity.assertSafePath(relOrAbsPath, workspace);
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

async function* write_file(args, context) {
  var workspace = (typeof context === 'string') ? context : (context && context.workspace) || '';
  var sessionId = (context && context.sessionId) || 'default';
  var filePath = args.file_path || '';
  var content = args.content || '';
  yield { type: 'action', action: 'write_file', message: 'Writing file: ' + filePath };
  try {
    var target = _safePath(workspace, filePath);
    var existed = existsSync(target);

    var originalContent = '';
    if (existed) {
      originalContent = await fs.readFile(target, 'utf-8');
    }
    var originalHash = computeSha256(originalContent);

    var deferred = createDeferredPromise();
    var diffId = 'diff_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    yield {
      type: 'request_diff',
      id: diffId,
      tool: 'write_file',
      file_path: filePath,
      original_content: originalContent,
      new_content: content,
      is_new_file: !existed,
      deferred: deferred,
      sessionId: sessionId
    };

    var diffResult = await deferred.promise;
    if (!diffResult || !diffResult.accepted) {
      var rejectMsg = diffResult && diffResult.message ? diffResult.message : 'Write rejected by user.';
      yield { type: 'tool_result', tool: 'write_file', success: false, file_path: filePath, message: rejectMsg, rejected: true };
      return;
    }

    async function performLockedWrite() {
      var currentDiskContent = '';
      var currentExisted = existsSync(target);
      if (currentExisted) {
        try {
          currentDiskContent = await fs.readFile(target, 'utf-8');
        } catch (readErr) {
          return { success: false, message: 'Failed to read file under lock: ' + readErr.message };
        }
      } else if (existed) {
        return { success: false, conflict: true, message: 'Conflict: ' + filePath + ' was deleted on disk before write.' };
      }

      var currentHash = computeSha256(currentDiskContent);
      if (currentHash !== originalHash) {
        return {
          success: false,
          conflict: true,
          message: 'Conflict: ' + filePath + ' has changed on disk since this diff was created. Please review the newest file content.'
        };
      }

      var cpLabel = (existed ? 'Edited: ' : 'Created: ') + filePath;
      var cpId = null;
      try {
        cpId = await checkpointManager.createCheckpoint(filePath, workspace, sessionId, cpLabel);
      } catch (cpErr) {
        return { success: false, message: 'Checkpoint creation error: ' + cpErr.message };
      }

      if (existed && !cpId) {
        return { success: false, message: 'Checkpoint creation failed for existing file: ' + filePath + '; write aborted for safety.' };
      }

      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf-8');

      try {
        await projectKnowledge.touchFile(filePath);
      } catch (_) {}

      return { success: true, checkpointId: cpId };
    }

    var writeResult = await fileLockManager.withFileLock(target, performLockedWrite);
    if (!writeResult || !writeResult.success) {
      var writeErrMsg = writeResult && writeResult.message ? writeResult.message : 'Write failed under file lock.';
      yield { type: 'tool_result', tool: 'write_file', success: false, file_path: filePath, message: writeErrMsg, conflict: writeResult && writeResult.conflict };
      return;
    }

    yield { type: 'tool_result', tool: 'write_file', success: true, file_path: filePath, message: 'File written: ' + filePath, checkpoint_id: writeResult.checkpointId };
  } catch (e) {
    yield { type: 'tool_result', tool: 'write_file', success: false, message: e.message };
  }
}

async function* edit_file(args, context) {
  var workspace = (typeof context === 'string') ? context : (context && context.workspace) || '';
  var sessionId = (context && context.sessionId) || 'default';
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
    var originalHash = computeSha256(content);
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
      deferred: deferred,
      sessionId: sessionId
    };

    var diffResult = await deferred.promise;
    if (!diffResult || !diffResult.accepted) {
      var editRejectMsg = diffResult && diffResult.message ? diffResult.message : 'Edit rejected by user.';
      yield { type: 'tool_result', tool: 'edit_file', success: false, file_path: filePath, message: editRejectMsg, rejected: true };
      return;
    }

    async function performLockedEdit() {
      if (!existsSync(target)) {
        return { success: false, conflict: true, message: 'Conflict: ' + filePath + ' was deleted on disk before edit.' };
      }
      var currentDiskContent = '';
      try {
        currentDiskContent = await fs.readFile(target, 'utf-8');
      } catch (readErr) {
        return { success: false, message: 'Failed to read file under lock: ' + readErr.message };
      }

      var currentHash = computeSha256(currentDiskContent);
      if (currentHash !== originalHash) {
        return {
          success: false,
          conflict: true,
          message: 'Conflict: ' + filePath + ' has changed on disk since this diff was created. Please review the newest file content.'
        };
      }

      var cpId = null;
      try {
        cpId = await checkpointManager.createCheckpoint(filePath, workspace, sessionId, 'Edited: ' + filePath);
      } catch (cpErr) {
        return { success: false, message: 'Checkpoint creation error: ' + cpErr.message };
      }

      if (!cpId) {
        return { success: false, message: 'Checkpoint creation failed for ' + filePath + '; edit aborted for safety.' };
      }

      await fs.writeFile(target, newContent, 'utf-8');

      try {
        await projectKnowledge.touchFile(filePath);
      } catch (_) {}

      return { success: true, checkpointId: cpId };
    }

    var editResult = await fileLockManager.withFileLock(target, performLockedEdit);
    if (!editResult || !editResult.success) {
      var editErrMsg = editResult && editResult.message ? editResult.message : 'Edit failed under file lock.';
      yield { type: 'tool_result', tool: 'edit_file', success: false, file_path: filePath, message: editErrMsg, conflict: editResult && editResult.conflict };
      return;
    }

    yield { type: 'tool_result', tool: 'edit_file', success: true, file_path: filePath, message: 'File edited: ' + filePath, checkpoint_id: editResult.checkpointId };
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

async function* delete_file(args, context) {
  var workspace = (typeof context === 'string') ? context : (context && context.workspace) || '';
  var sessionId = (context && context.sessionId) || 'default';
  var filePath = args.file_path || '';
  yield { type: 'action', action: 'delete_file', message: 'Deleting file: ' + filePath };
  try {
    var target = _safePath(workspace, filePath);
    if (!existsSync(target)) {
      yield { type: 'tool_result', tool: 'delete_file', success: false, message: 'File not found: ' + filePath };
      return;
    }

    async function performLockedDelete() {
      if (!existsSync(target)) {
        return { success: false, message: 'File already deleted or missing: ' + filePath };
      }
      var cpId = null;
      try {
        cpId = await checkpointManager.createCheckpoint(filePath, workspace, sessionId, 'Deleted: ' + filePath);
      } catch (cpErr) {
        return { success: false, message: 'Checkpoint creation error: ' + cpErr.message };
      }
      if (!cpId) {
        return { success: false, message: 'Checkpoint creation failed for ' + filePath + '; deletion aborted for safety.' };
      }
      await _safeUnlink(target);
      try {
        projectKnowledge.deleteFile(filePath);
      } catch (_) {}
      return { success: true, checkpointId: cpId };
    }

    var delResult = await fileLockManager.withFileLock(target, performLockedDelete);
    if (!delResult || !delResult.success) {
      var delErrMsg = delResult && delResult.message ? delResult.message : 'Delete failed under file lock.';
      yield { type: 'tool_result', tool: 'delete_file', success: false, file_path: filePath, message: delErrMsg };
      return;
    }

    yield { type: 'tool_result', tool: 'delete_file', success: true, file_path: filePath, message: 'File deleted: ' + filePath, checkpoint_id: delResult.checkpointId };
  } catch (e) {
    yield { type: 'tool_result', tool: 'delete_file', success: false, message: e.message };
  }
}

// =====================================================
// DIRECTORY TOOLS
// =====================================================

async function* create_folder(args, context) {
  var workspace = (typeof context === 'string') ? context : (context && context.workspace) || '';
  var sessionId = (context && context.sessionId) || 'default';
  var folderPath = args.folder_path || '';
  yield { type: 'action', action: 'create_folder', message: 'Creating folder: ' + folderPath };
  try {
    var target = _safePath(workspace, folderPath);
    var existed = existsSync(target);
    var cpId = null;

    async function performLockedCreateFolder() {
      if (!existed) {
        try {
          cpId = await checkpointManager.createFolderCheckpoint(folderPath, workspace, sessionId, 'Created: ' + folderPath, false);
        } catch (_) {}
      }
      await fs.mkdir(target, { recursive: true });
      return { success: true, checkpointId: cpId };
    }

    var cfResult = await fileLockManager.withFileLock(target, performLockedCreateFolder);
    yield {
      type: 'tool_result',
      tool: 'create_folder',
      success: true,
      folder_path: folderPath,
      message: 'Folder created: ' + folderPath,
      checkpoint_id: cfResult ? cfResult.checkpointId : null,
      is_directory: true,
      existed: existed
    };
  } catch (e) {
    yield { type: 'tool_result', tool: 'create_folder', success: false, message: e.message };
  }
}

async function* delete_folder(args, context) {
  var workspace = (typeof context === 'string') ? context : (context && context.workspace) || '';
  var sessionId = (context && context.sessionId) || 'default';
  var folderPath = args.folder_path || '';
  yield { type: 'action', action: 'delete_folder', message: 'Deleting folder: ' + folderPath };
  try {
    var target = _safePath(workspace, folderPath);
    if (!existsSync(target)) {
      yield { type: 'tool_result', tool: 'delete_folder', success: true, folder_path: folderPath, message: 'Folder deleted: ' + folderPath };
      return;
    }

    var cpId = null;
    async function performLockedDeleteFolder() {
      try {
        cpId = await checkpointManager.createFolderDeleteCheckpoint(folderPath, workspace, sessionId, 'Deleted: ' + folderPath);
      } catch (_) {}
      await _safeRmDir(target);
      return { success: true, checkpointId: cpId };
    }

    var dfResult = await fileLockManager.withFileLock(target, performLockedDeleteFolder);
    yield {
      type: 'tool_result',
      tool: 'delete_folder',
      success: true,
      folder_path: folderPath,
      message: 'Folder deleted: ' + folderPath,
      checkpoint_id: dfResult ? dfResult.checkpointId : null,
      is_directory: true
    };
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
    var searchError = null;

    try {
      var results = await searchManager.searchFiles(pattern, workspace, folderPath === '.' ? '' : folderPath);
      matches = results || [];
    } catch (err) {
      searchError = err ? (err.message || String(err)) : 'Search execution failed';
    }

    if (searchError) {
      yield { type: 'tool_result', tool: 'search_files', success: false, pattern: pattern, folder_path: folderPath, message: searchError, matches: [] };
    } else {
      yield { type: 'tool_result', tool: 'search_files', success: true, pattern: pattern, folder_path: folderPath, matches: matches };
    }
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

async function* run_terminal(args, context) {
  var workspace = (typeof context === 'string') ? context : (context && context.workspace) || '';
  var sessionId = (context && context.sessionId) || (args && args._sessionId) || 'default';
  var command = args.command || '';
  var timeout = args.timeout || 30;
  var background = args.background || false;
  var isInteractive = args.is_interactive === true || args.interactive === true;

  if (!command) {
    yield { type: 'action', action: 'run_terminal', message: 'Checking terminal output...' };
    var checkResult = await terminalManager.checkTerminalOutput(sessionId);
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
      shell: checkResult.shell || terminalManager.getShellName(sessionId),
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
    var result = await terminalManager.executeCommand(command, timeout, background, isInteractive, sessionId, workspace);
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

async function* terminal_input(args, context) {
  var text = args.text || '';
  var sessionId = (context && context.sessionId) || (args && args._sessionId) || 'default';
  yield { type: 'action', action: 'terminal_input', message: 'Sending input to terminal: ' + text };
  try {
    var result = await terminalManager.sendTerminalInput(text, sessionId);
    yield {
      type: 'tool_result',
      tool: 'terminal_input',
      success: result.success !== false,
      stdout: result.stdout || '',
      output: result.output || '',
      interactive: result.interactive === true,
      message: result.message
    };
  } catch (e) {
    yield { type: 'tool_result', tool: 'terminal_input', success: false, message: e.message };
  }
}

async function* stop_terminal(args, context) {
  var sessionId = (context && context.sessionId) || (args && args._sessionId) || 'default';
  yield { type: 'action', action: 'stop_terminal', message: 'Stopping terminal process (Ctrl+C)' };
  try {
    var result = await terminalManager.stopTerminal(sessionId);
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

async function* patch_file(args, context) {
  var workspace = (typeof context === 'string') ? context : (context && context.workspace) || '';
  var sessionId = (context && context.sessionId) || 'default';
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
    var originalHash = computeSha256(content);
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
      deferred: deferred,
      sessionId: sessionId
    };

    var diffResult = await deferred.promise;
    if (!diffResult || !diffResult.accepted) {
      var patchRejectMsg = diffResult && diffResult.message ? diffResult.message : 'Patch rejected by user.';
      yield { type: 'tool_result', tool: 'patch_file', success: false, file_path: filePath, message: patchRejectMsg, rejected: true };
      return;
    }

    async function performLockedPatch() {
      if (!existsSync(target)) {
        return { success: false, conflict: true, message: 'Conflict: ' + filePath + ' was deleted on disk before patch.' };
      }
      var currentDiskContent = '';
      try {
        currentDiskContent = await fs.readFile(target, 'utf-8');
      } catch (readErr) {
        return { success: false, message: 'Failed to read file under lock: ' + readErr.message };
      }

      var currentHash = computeSha256(currentDiskContent);
      if (currentHash !== originalHash) {
        return {
          success: false,
          conflict: true,
          message: 'Conflict: ' + filePath + ' has changed on disk since this diff was created. Please review the newest file content.'
        };
      }

      var cpId = null;
      try {
        cpId = await checkpointManager.createCheckpoint(filePath, workspace, sessionId, 'Patches: ' + filePath);
      } catch (cpErr) {
        return { success: false, message: 'Checkpoint creation error: ' + cpErr.message };
      }

      if (!cpId) {
        return { success: false, message: 'Checkpoint creation failed for ' + filePath + '; patch aborted for safety.' };
      }

      await fs.writeFile(target, newContent, 'utf-8');

      try {
        await projectKnowledge.touchFile(filePath);
      } catch (_) {}

      return { success: true, checkpointId: cpId };
    }

    var patchResult = await fileLockManager.withFileLock(target, performLockedPatch);
    if (!patchResult || !patchResult.success) {
      var patchErrMsg = patchResult && patchResult.message ? patchResult.message : 'Patch failed under file lock.';
      yield { type: 'tool_result', tool: 'patch_file', success: false, file_path: filePath, message: patchErrMsg, conflict: patchResult && patchResult.conflict };
      return;
    }

    yield { type: 'tool_result', tool: 'patch_file', success: true, file_path: filePath, message: 'File patched successfully: ' + filePath, checkpoint_id: patchResult.checkpointId };
  } catch (e) {
    yield { type: 'tool_result', tool: 'patch_file', success: false, message: e.message };
  }
}

function isPrivateIpAddress(ip) {
  if (!ip) return true;
  var cleanIp = ip.toLowerCase().replace(/^::ffff:/, '');

  if (net.isIPv4(cleanIp)) {
    var rawParts = cleanIp.split('.');
    var parts = [];
    for (var p = 0; p < rawParts.length; p++) {
      parts.push(Number(rawParts[p]));
    }
    // 0.0.0.0/8
    if (parts[0] === 0) return true;
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (link-local & cloud metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12 (private)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (private)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 100.64.0.0/10 (CGNAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // Broadcast
    if (parts[0] === 255 && parts[1] === 255 && parts[2] === 255 && parts[3] === 255) return true;
    return false;
  }

  if (net.isIPv6(cleanIp)) {
    // ::1 loopback, :: unspecified
    if (cleanIp === '::1' || cleanIp === '::') return true;
    // fe80::/10 link-local
    if (cleanIp.startsWith('fe8') || cleanIp.startsWith('fe9') || cleanIp.startsWith('fea') || cleanIp.startsWith('feb')) return true;
    // fc00::/7 unique local (ULA)
    if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) return true;
    return false;
  }

  return true;
}

async function isSsrfBlockedUrl(urlString) {
  try {
    var parsed = new URL(urlString);
    var protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return { blocked: true, reason: 'Invalid protocol: ' + protocol };
    }

    var hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '0.0.0.0') {
      return { blocked: true, reason: 'Localhost is blocked' };
    }

    // If hostname is directly an IP
    if (net.isIP(hostname)) {
      if (isPrivateIpAddress(hostname)) {
        return { blocked: true, reason: 'Private IP (' + hostname + ') is blocked' };
      }
      return { blocked: false };
    }

    // Resolve DNS records to verify resolved destination IPs
    var lookupRes = await dns.lookup(hostname, { all: true });
    if (!lookupRes || lookupRes.length === 0) {
      return { blocked: true, reason: 'DNS resolution failed for ' + hostname };
    }

    for (var i = 0; i < lookupRes.length; i++) {
      var addr = lookupRes[i].address;
      if (isPrivateIpAddress(addr)) {
        return { blocked: true, reason: 'Resolved to private IP (' + addr + ')' };
      }
    }

    return { blocked: false };
  } catch (err) {
    return { blocked: true, reason: 'URL/DNS validation error: ' + err.message };
  }
}

async function* web_request(args, context) {
  var url = args.url || '';
  var method = (args.method || 'GET').toUpperCase();
  var headers = args.headers || {};
  var body = args.body || null;

  yield { type: 'action', action: 'web_request', message: 'HTTP Request: ' + method + ' ' + url };

  var ssrfCheck = await isSsrfBlockedUrl(url);
  if (ssrfCheck.blocked) {
    yield { type: 'tool_result', tool: 'web_request', success: false, message: 'SSRF Protection: Access blocked (' + ssrfCheck.reason + ').' };
    return;
  }

  var abortCtrl = new AbortController();
  var timeoutTimer = setTimeout(function onNetTimeout() {
    abortCtrl.abort();
  }, 15000); // 15s bounded timeout

  var sessionSignal = (context && context.signal) || null;
  function handleSessionAbort() {
    abortCtrl.abort();
  }
  if (sessionSignal) {
    if (sessionSignal.aborted || sessionSignal.stopped) {
      abortCtrl.abort();
    } else if (sessionSignal.addEventListener) {
      sessionSignal.addEventListener('abort', handleSessionAbort);
    }
  }

  try {
    var options = {
      method: method,
      headers: headers,
      redirect: 'manual',
      signal: abortCtrl.signal
    };
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = typeof body === 'object' ? JSON.stringify(body) : String(body);
      if (!headers['Content-Type'] && !headers['content-type']) {
        options.headers['Content-Type'] = 'application/json';
      }
    }

    var currentUrl = url;
    var res = null;
    var hops = 0;
    var maxHops = 5;

    while (hops <= maxHops) {
      res = await fetch(currentUrl, options);

      // Handle redirects manually to revalidate destination URL against SSRF
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        hops++;
        var location = res.headers.get('location');
        var redirectUrl = new URL(location, currentUrl).toString();

        var redirectCheck = await isSsrfBlockedUrl(redirectUrl);
        if (redirectCheck.blocked) {
          yield { type: 'tool_result', tool: 'web_request', success: false, message: 'SSRF Protection: Redirect destination blocked (' + redirectCheck.reason + ').' };
          return;
        }

        currentUrl = redirectUrl;
        if (res.status === 307 || res.status === 308) {
          // Preserve original method and body for 307 and 308 redirects
        } else if (res.status === 303 || ((res.status === 301 || res.status === 302) && options.method === 'POST')) {
          options.method = 'GET';
          delete options.body;
        }
        continue;
      }
      break;
    }

    if (hops > maxHops) {
      yield { type: 'tool_result', tool: 'web_request', success: false, message: 'Too many redirects (exceeded limit of ' + maxHops + ').' };
      return;
    }

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
      url: currentUrl,
      status: res.status,
      status_text: res.statusText,
      headers: resHeaders,
      content: resText + (truncated ? '\n\n[Response body truncated for brevity]' : '')
    };
  } catch (e) {
    yield { type: 'tool_result', tool: 'web_request', success: false, message: 'HTTP Request failed: ' + e.message };
  } finally {
    clearTimeout(timeoutTimer);
    if (sessionSignal && sessionSignal.removeEventListener) {
      sessionSignal.removeEventListener('abort', handleSessionAbort);
    }
  }
}

async function* update_plan(args, context) {
  yield { type: 'action', action: 'update_plan', message: 'Updating execution plan' };

  var planText = args.plan || '';
  if (!planText) {
    yield { type: 'tool_result', tool: 'update_plan', success: false, message: 'Missing required parameter: plan' };
    return;
  }

  var workspace = (typeof context === 'string') ? context : (context && context.workspace) || '';
  var sessionId = (context && context.sessionId) || 'default';

  try {
    var activePlan = runtime.getCurrentPlan(sessionId);
    if (activePlan) {
      var lines = planText.split('\n');
      for (var l = 0; l < lines.length; l++) {
        var line = lines[l].trim();
        var doneMatch = line.match(/^[-*]\s*\[([ xX!→])\]\s*(?:#?([0-9a-zA-Z_-]+)\s*:?)?\s*(.*)$/);
        if (doneMatch) {
          var mark = doneMatch[1];
          var taskId = doneMatch[2];
          var desc = doneMatch[3];
          var status = (mark === 'x' || mark === 'X') ? 'completed' : (mark === '!' ? 'failed' : ((mark === '→' || mark === '>' || mark === '/') ? 'active' : 'pending'));
          if (taskId) {
            planningManager.updateTaskStatus(activePlan.id, taskId, status, desc, sessionId);
            goalTracker.updateGoalStatus(taskId, status, sessionId);
          }
        }
      }
      activePlan.rawPlan = planText;
      runtime.updatePlan(activePlan);
    } else {
      var analysis = planningEngine.analyzeRequest(planText, { workspace: workspace }, workspace);
      var planObj = planningEngine.buildPlan(analysis, sessionId);
      planObj.rawPlan = planText;
      runtime.registerPlan(planObj);
      runtime.setCurrentPlan(planObj, sessionId);
      goalTracker.syncWithPlan(planObj, sessionId);
    }

    yield {
      type: 'tool_result',
      tool: 'update_plan',
      success: true,
      plan: planText,
      message: 'Plan updated and synced with planning engine.'
    };
  } catch (e) {
    yield {
      type: 'tool_result',
      tool: 'update_plan',
      success: false,
      message: 'Plan update failed: ' + e.message
    };
  }
}

async function* create_plan(args, context) {
  yield { type: 'action', action: 'create_plan', message: 'Creating execution plan' };

  var planText = args.plan || '';
  if (!planText) {
    yield { type: 'tool_result', tool: 'create_plan', success: false, message: 'Missing required parameter: plan' };
    return;
  }

  var workspace = (typeof context === 'string') ? context : (context && context.workspace) || '';
  var sessionId = (context && context.sessionId) || 'default';

  try {
    var analysis = planningEngine.analyzeRequest(planText, { workspace: workspace }, workspace);
    var planObj = planningEngine.buildPlan(analysis, sessionId);
    planObj.rawPlan = planText;
    runtime.registerPlan(planObj);
    runtime.setCurrentPlan(planObj, sessionId);
    goalTracker.syncWithPlan(planObj, sessionId);

    yield {
      type: 'tool_result',
      tool: 'create_plan',
      success: true,
      plan: planText,
      planObject: planObj,
      message: 'Plan created and registered in planning engine successfully.'
    };
  } catch (err) {
    yield {
      type: 'tool_result',
      tool: 'create_plan',
      success: false,
      message: 'Plan creation failed: ' + err.message
    };
  }
}


// ── query_project_db — Execute a SELECT query on the SQLite project database ─────
async function* query_project_db(args, workspace) {
  var sqlQuery = String(args.sql_query || '').trim();
  yield { type: 'action', action: 'query_project_db', message: 'Querying project database: ' + sqlQuery };

  var upper = sqlQuery.toUpperCase();
  if (!upper.startsWith('SELECT') || upper.includes('INSERT ') || upper.includes('UPDATE ') || upper.includes('DELETE ') || upper.includes('DROP ') || upper.includes('ALTER ') || upper.includes('ATTACH ') || upper.includes('PRAGMA ')) {
    yield { type: 'tool_result', tool: 'query_project_db', success: false, message: 'Only SELECT queries are permitted on the project database.' };
    return;
  }

  try {
    var results = projectKnowledge.queryProjectDb(sqlQuery);
    yield {
      type: 'tool_result',
      tool: 'query_project_db',
      success: true,
      results: results,
      message: 'Executed SQL query successfully. Returned ' + results.length + ' rows.'
    };
  } catch (e) {
    yield { type: 'tool_result', tool: 'query_project_db', success: false, message: e.message };
  }
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
    hidden: opts.hidden || false,
    metadata: {
      dangerous: opts.dangerous || false,
      needsPermission: opts.needsPermission || opts.dangerous || false,
      hidden: opts.hidden || false,
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
    parameters: {
      command: { type: 'string', description: 'The command to execute' },
      is_interactive: { type: 'boolean', description: 'Set true ONLY if the command is interactive and expects prompt/user input (e.g. Read-Host, npm init, prompts). Set false (default) for self-executing commands (e.g. builds, tests, scripts, git commands) that run to completion.' },
      timeout: { type: 'integer', description: 'Max seconds (default 30)' },
      background: { type: 'boolean', description: 'Run without waiting' }
    },
    required: [],
    dangerous: true,
    needsPermission: true,
    timeout: 60000
  });
  reg('terminal_input', terminal_input, {
    category: 'terminal',
    description: 'Send text input to the active terminal command.',
    parameters: { text: { type: 'string', description: 'The text to send' } },
    required: ['text'],
    dangerous: true,
    needsPermission: true
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
    required: ['url'],
    dangerous: true,
    needsPermission: true
  });

  // ── Planning ───────────────────────────────────────
  reg('create_plan', create_plan, {
    category: 'planning',
    description: "Sets up and initializes the initial checklist goals plan card string. The plan MUST contain a bulleted list of tasks, where each task starts with '- [ ]' (or '- [/]' or '- [x]') followed by a unique numeric ID (e.g. '1', '2', '3') and description, so that the tasks can be referenced and updated later using their IDs.",
    parameters: { plan: { type: 'string', description: 'Checklist card contents description' } },
    required: ['plan']
  });
  reg('update_plan', update_plan, {
    category: 'planning',
    description: "Modifies and updates the active checklist goals plan card string status. Provide the complete updated plan containing the task checklist items with sequential numeric IDs (e.g. '1', '2', '3') and status boxes updated as necessary (e.g. changing '[ ]' to '[/]' or '[x]').",
    parameters: { plan: { type: 'string', description: 'Checklist card contents description' } },
    required: ['plan']
  });

  // ── Database Queries ───────────────────────────────
  reg('query_project_db', query_project_db, {
    category: 'database',
    hidden: true,
    description: 'Query the SQLite project knowledge database containing file index, text chunks, and code symbols (functions, classes, logic structure) of the project workspace. Use SELECT read-only SQL queries.',
    parameters: {
      sql_query: { type: 'string', description: 'Read-only SELECT query to run (e.g. SELECT * FROM symbols WHERE type = \'function\')' }
    },
    required: ['sql_query']
  });

  console.log('[TOOLS] Registered ' + toolRegistry.count() + ' tools in ' + toolRegistry.listCategories().length + ' categories');
}
