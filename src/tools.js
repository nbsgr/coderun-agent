// tools.js — Tool implementations
// Each tool is an async generator that yields action + result events

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as toolRegistry from './toolRegistry.js';
import * as terminalManager from './terminalManager.js';
import * as searchManager from './searchManager.js';

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
    if (!content.includes(oldString)) {
      yield { type: 'tool_result', tool: 'edit_file', success: false, message: 'old_string not found in file.' };
      return;
    }
    var idx = content.indexOf(oldString);
    var newContent = content.substring(0, idx) + newString + content.substring(idx + oldString.length);

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
 */
async function* run_terminal(args, workspace) {
  var command = args.command || '';
  var timeout = args.timeout || 30;

  if (!command) {
    yield { type: 'tool_result', tool: 'run_terminal', success: false, message: 'No command provided.' };
    return;
  }

  yield { type: 'action', action: 'run_terminal', message: 'Running command: ' + command };

  try {
    // Execute via terminalManager which uses VS Code Terminal API + Shell Integration
    var result = await terminalManager.executeCommand(command, timeout);

    // The terminalManager fires terminal_start, terminal_output, terminal_exit events
    // via its sendEventCallback. These are forwarded to the webview by extension.js.
    // We yield a result here for the agent loop, but the actual output streaming
    // happens through the event system.

    if (result.method === 'shell_integration') {
      // Shell integration is active — output streams via events
      yield {
        type: 'tool_result',
        tool: 'run_terminal',
        success: result.success !== false,
        command: command,
        exit_code: result.exitCode,
        output: result.output || '',
        message: 'Command completed in VS Code terminal.',
        shell_integration: true
      };
    } else {
      // Fallback mode
      yield {
        type: 'tool_result',
        tool: 'run_terminal',
        success: true,
        command: command,
        message: 'Command sent to VS Code terminal (shell integration unavailable). Check the terminal panel for output.',
        fallback: true
      };
    }
  } catch (e) {
    yield { type: 'tool_result', tool: 'run_terminal', success: false, command: command, message: e.message };
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

// =====================================================
// REGISTER ALL TOOLS
// =====================================================

export function registerAllTools() {
  toolRegistry.register('read_file', read_file);
  toolRegistry.register('write_file', write_file);
  toolRegistry.register('edit_file', edit_file);
  toolRegistry.register('delete_file', delete_file);
  toolRegistry.register('create_folder', create_folder);
  toolRegistry.register('delete_folder', delete_folder);
  toolRegistry.register('list_directory', list_directory);
  toolRegistry.register('search_files', search_files);
  toolRegistry.register('get_file_info', get_file_info);
  toolRegistry.register('run_terminal', run_terminal);
  toolRegistry.register('get_current_datetime', get_current_datetime);
  toolRegistry.register('find_in_files', find_in_files);
}
