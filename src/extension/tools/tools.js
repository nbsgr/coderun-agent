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
import * as questionManager from './questionManager.js';
import * as subagentTools from './subagentTools.js';
import * as mediaManager from '../media/mediaManager.js';
import * as providerManager from '../providers/providerManager.js';

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

export function normalizeLineBreaks(str) {
  return String(str || '').replace(/\r\n/g, '\n');
}

export function findFuzzyLineMatch(content, targetSnippet, minThreshold) {
  if (!content || !targetSnippet) return null;
  var threshold = minThreshold || 0.85;

  var normContent = normalizeLineBreaks(content);
  var normTarget = normalizeLineBreaks(targetSnippet);

  var exactIdx = normContent.indexOf(normTarget);
  if (exactIdx !== -1) {
    var nextIdx = normContent.indexOf(normTarget, exactIdx + 1);
    if (nextIdx === -1) {
      return {
        matchedText: normContent.substring(exactIdx, exactIdx + normTarget.length),
        score: 1.0,
        startIndex: exactIdx,
        endIndex: exactIdx + normTarget.length
      };
    }
  }

  var fileLines = normContent.split('\n');
  var targetLines = normTarget.split('\n');

  if (targetLines.length > 1 && targetLines[targetLines.length - 1].trim() === '') {
    targetLines.pop();
  }

  var targetLen = targetLines.length;
  if (targetLen === 0 || fileLines.length < targetLen) return null;

  var bestScore = 0;
  var bestStart = -1;
  var ties = 0;

  for (var i = 0; i <= fileLines.length - targetLen; i++) {
    var matches = 0;
    for (var j = 0; j < targetLen; j++) {
      var fLine = fileLines[i + j].trim();
      var tLine = targetLines[j].trim();
      if (fLine === tLine) {
        matches++;
      } else if (fLine.replace(/['"]/g, '"').replace(/[;,]$/, '') === tLine.replace(/['"]/g, '"').replace(/[;,]$/, '')) {
        matches += 0.9;
      }
    }
    var score = matches / targetLen;
    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
      ties = 0;
    } else if (score === bestScore && score >= threshold) {
      ties++;
    }
  }

  if (bestScore >= threshold && ties === 0 && bestStart !== -1) {
    var lineStartIdx = 0;
    for (var k = 0; k < bestStart; k++) {
      lineStartIdx += fileLines[k].length + 1;
    }
    var matchedLength = 0;
    for (var m = 0; m < targetLen; m++) {
      matchedLength += fileLines[bestStart + m].length;
      if (m < targetLen - 1) matchedLength += 1;
    }

    return {
      matchedText: normContent.substring(lineStartIdx, lineStartIdx + matchedLength),
      score: bestScore,
      startIndex: lineStartIdx,
      endIndex: lineStartIdx + matchedLength
    };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════
// TOOL INTERFACE
// Every tool is an async generator: async function*(args, context)
// context = { workspace, sendEvent?, signal? }
// ═══════════════════════════════════════════════════════════

// =====================================================
// HELPER: SAFE PATH
// =====================================================
function extractWorkspace(context) {
  if (typeof context === 'string') return context;
  if (!context) return '';
  var ws = context.workspace !== undefined ? context.workspace : context;
  if (typeof ws === 'string') return ws;
  if (ws && typeof ws === 'object') {
    return ws.fsPath || ws.workspace || ws.path || '';
  }
  return '';
}

function _safePath(workspace, relOrAbsPath) {
  var ws = extractWorkspace(workspace);
  return pathSecurity.assertSafePath(relOrAbsPath, ws);
}

// =====================================================
// FILE TOOLS
// =====================================================

async function* read_file(args, context) {
  var workspace = extractWorkspace(context);
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
  var workspace = extractWorkspace(context);
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
        cpId = await checkpointManager.createCheckpoint(filePath, workspace, sessionId, cpLabel, context && context.agentId);
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
      } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }

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
  var workspace = extractWorkspace(context);
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
    var normContent = normalizeLineBreaks(content);
    var normOldString = normalizeLineBreaks(oldString);
    var normNewString = normalizeLineBreaks(newString);
    var newContent = '';

    var idx = normContent.indexOf(normOldString);
    if (idx !== -1) {
      newContent = normContent.substring(0, idx) + normNewString + normContent.substring(idx + normOldString.length);
      if (content.indexOf('\r\n') !== -1) {
        newContent = newContent.replace(/\n/g, '\r\n');
      }
    } else {
      var fuzzyMatch = findFuzzyLineMatch(normContent, normOldString, 0.85);
      if (fuzzyMatch) {
        newContent = normContent.substring(0, fuzzyMatch.startIndex) + normNewString + normContent.substring(fuzzyMatch.endIndex);
        if (content.indexOf('\r\n') !== -1) {
          newContent = newContent.replace(/\n/g, '\r\n');
        }
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

        var matches = [];
        var matchObj;
        while ((matchObj = regex.exec(content)) !== null) {
          matches.push(matchObj);
        }
        if (matches.length === 0) {
          yield { type: 'tool_result', tool: 'edit_file', success: false, message: 'old_string not found in file (tried exact, fuzzy line, and whitespace matching).' };
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
      sessionId: sessionId,
      agentId: context && context.agentId,
      parentAgentId: context && context.parentAgentId,
      parentSessionId: context && context.parentSessionId,
      rootSessionId: context && context.rootSessionId
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
        cpId = await checkpointManager.createCheckpoint(filePath, workspace, sessionId, 'Edited: ' + filePath, context && context.agentId);
      } catch (cpErr) {
        return { success: false, message: 'Checkpoint creation error: ' + cpErr.message };
      }

      if (!cpId) {
        return { success: false, message: 'Checkpoint creation failed for ' + filePath + '; edit aborted for safety.' };
      }

      await fs.writeFile(target, newContent, 'utf-8');

      try {
        await projectKnowledge.touchFile(filePath);
      } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }

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
  var workspace = extractWorkspace(context);
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
        cpId = await checkpointManager.createCheckpoint(filePath, workspace, sessionId, 'Deleted: ' + filePath, context && context.agentId);
      } catch (cpErr) {
        return { success: false, message: 'Checkpoint creation error: ' + cpErr.message };
      }
      if (!cpId) {
        return { success: false, message: 'Checkpoint creation failed for ' + filePath + '; deletion aborted for safety.' };
      }
      await _safeUnlink(target);
      try {
        projectKnowledge.deleteFile(filePath);
      } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }
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
  var workspace = extractWorkspace(context);
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
        } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }
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
  var workspace = extractWorkspace(context);
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
      } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }
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

async function* list_directory(args, context) {
  var workspace = extractWorkspace(context);
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

async function* search_files(args, context) {
  var workspace = extractWorkspace(context);
  var pattern = args.glob_pattern || args.pattern || '*';
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
      yield { type: 'tool_result', tool: 'search_files', success: false, glob_pattern: pattern, pattern: pattern, folder_path: folderPath, message: searchError, matches: [] };
    } else {
      yield { type: 'tool_result', tool: 'search_files', success: true, glob_pattern: pattern, pattern: pattern, folder_path: folderPath, matches: matches };
    }
  } catch (e) {
    yield { type: 'tool_result', tool: 'search_files', success: false, message: e.message };
  }
}

async function* get_file_info(args, context) {
  var workspace = extractWorkspace(context);
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
// USER SANDBOX TOOLS — Transparent Scratch Workspace
// =====================================================

async function* sandbox(args, context) {
  var action = (args && args.action) || 'status';
  var subpath = (args && args.subpath) || '';
  var canonicalSandbox = pathSecurity.getCanonicalSandboxRoot();

  yield { type: 'action', action: 'sandbox', message: 'Sandbox action: ' + action };

  try {
    if (action === 'status') {
      var exists = existsSync(canonicalSandbox);
      var count = 0;
      var totalBytes = 0;
      var fileNames = [];
      if (exists) {
        var entries = await fs.readdir(canonicalSandbox, { withFileTypes: true });
        for (var i = 0; i < entries.length; i++) {
          count++;
          var full = path.join(canonicalSandbox, entries[i].name);
          try {
            var st = await fs.stat(full);
            totalBytes += st.size;
            fileNames.push((entries[i].isDirectory() ? '[DIR] ' : '') + entries[i].name);
          } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }
        }
      }
      yield {
        type: 'tool_result',
        tool: 'sandbox',
        success: true,
        action: 'status',
        sandbox_path: canonicalSandbox,
        exists: exists,
        item_count: count,
        total_bytes: totalBytes,
        items: fileNames,
        message: 'Sandbox directory is ready at ' + canonicalSandbox + ' (' + count + ' items, ' + totalBytes + ' bytes)'
      };
      return;
    }

    if (action === 'list') {
      var targetDir = subpath ? path.resolve(canonicalSandbox, subpath) : canonicalSandbox;
      var secCheck = pathSecurity.resolveSafePath(targetDir, canonicalSandbox);
      if (!secCheck.safe) {
        yield { type: 'tool_result', tool: 'sandbox', success: false, message: 'Invalid sandbox subpath: ' + subpath };
        return;
      }
      if (!existsSync(targetDir)) {
        yield { type: 'tool_result', tool: 'sandbox', success: true, items: [], message: 'Sandbox path does not exist yet.' };
        return;
      }
      var listEntries = await fs.readdir(targetDir, { withFileTypes: true });
      var itemList = [];
      for (var j = 0; j < listEntries.length; j++) {
        var ent = listEntries[j];
        itemList.push({
          name: ent.name,
          type: ent.isDirectory() ? 'directory' : 'file',
          path: path.join(subpath || '', ent.name).replace(/\\/g, '/')
        });
      }
      yield {
        type: 'tool_result',
        tool: 'sandbox',
        success: true,
        action: 'list',
        sandbox_path: targetDir,
        items: itemList,
        message: 'Listed ' + itemList.length + ' item(s) in sandbox' + (subpath ? ('/' + subpath) : '')
      };
      return;
    }

    if (action === 'clean') {
      var cleanTarget = subpath ? path.resolve(canonicalSandbox, subpath) : canonicalSandbox;
      var secCheckClean = pathSecurity.resolveSafePath(cleanTarget, canonicalSandbox);
      if (!secCheckClean.safe) {
        yield { type: 'tool_result', tool: 'sandbox', success: false, message: 'Invalid sandbox clean path: ' + subpath };
        return;
      }
      var cleanCount = 0;
      if (existsSync(cleanTarget)) {
        var toClean = await fs.readdir(cleanTarget);
        for (var c = 0; c < toClean.length; c++) {
          var itemPath = path.join(cleanTarget, toClean[c]);
          try {
            await fs.rm(itemPath, { recursive: true, force: true });
            cleanCount++;
          } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }
        }
      }
      yield {
        type: 'tool_result',
        tool: 'sandbox',
        success: true,
        action: 'clean',
        deleted_count: cleanCount,
        message: 'Cleaned ' + cleanCount + ' item(s) from sandbox.'
      };
      return;
    }

    yield {
      type: 'tool_result',
      tool: 'sandbox',
      success: false,
      message: 'Unknown sandbox action: ' + action + '. Valid actions are status, list, clean.'
    };
  } catch (err) {
    yield {
      type: 'tool_result',
      tool: 'sandbox',
      success: false,
      message: 'Sandbox error: ' + err.message
    };
  }
}

// =====================================================
// TERMINAL TOOLS — Uses VS Code Terminal Shell Integration
// =====================================================

async function* run_terminal(args, context) {
  var workspace = extractWorkspace(context);
  var sessionId = (context && context.sessionId) || (args && args._sessionId) || 'default';
  var command = (args.command || args.cmd || args.commandLine || '').trim();
  var timeout = args.timeout || 30;
  var background = (args.background != null) ? Boolean(args.background) :
                   (args.is_background != null ? Boolean(args.is_background) :
                   (args.isDaemon != null ? Boolean(args.isDaemon) :
                   (args.daemon != null ? Boolean(args.daemon) : undefined)));
  var isInteractive = (args.is_interactive != null) ? Boolean(args.is_interactive) :
                      (args.interactive != null ? Boolean(args.interactive) :
                      (args.isInteractive != null ? Boolean(args.isInteractive) : undefined));

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
      message: (checkResult.waitingForInput || checkResult.promptDetected)
        ? ('Terminal is waiting for user/prompt input:\n' + (checkResult.stdout || '(no new output)') +
           '\n\nStatus: ' + (checkResult.status || 'waiting_for_input') +
           '\n\nUse `terminal_input` with text to respond (e.g. "q" to exit a pager, or "y" to confirm), or `stop_terminal` to interrupt.')
        : (checkResult.status === 'active'
            ? ('Terminal command is still actively running. Current output:\n' + (checkResult.stdout || '(no new output)'))
            : ('Terminal session is active. Current output:\n' + (checkResult.stdout || '(no new output)')))
    };
    return;
  }

  var requestedCwd = args.cwd || null;
  if (requestedCwd) {
    if (requestedCwd === 'sandbox') {
      requestedCwd = '~/.coderun/sandbox';
    }
    var safeCwdCheck = pathSecurity.resolveSafePath(requestedCwd, workspace);
    if (!safeCwdCheck.safe) {
      yield {
        type: 'tool_result',
        tool: 'run_terminal',
        success: false,
        command: command,
        message: 'Security error: requested working directory is outside workspace and sandbox: ' + requestedCwd
      };
      return;
    }
    requestedCwd = safeCwdCheck.canonicalPath;
  }

  yield { type: 'action', action: 'run_terminal', message: 'Running command: ' + command };

  try {
    dbg('[TOOLS] run_terminal: calling terminalManager.executeCommand');
    var result = await terminalManager.executeCommand(command, timeout, background, isInteractive, sessionId, workspace, requestedCwd);
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

async function* find_in_files(args, context) {
  var workspace = extractWorkspace(context);
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
  var target = (args && args.target) || 'foreground';
  var targetLabel = target === 'all' ? 'all terminals' : (target === 'background' || target === 'bg' ? 'CodeRun(BG)' : 'CodeRun(main)');
  yield { type: 'action', action: 'stop_terminal', message: 'Stopping terminal process (Ctrl+C) on ' + targetLabel };
  try {
    var result = await terminalManager.stopTerminal(sessionId, target);
    yield { type: 'tool_result', tool: 'stop_terminal', success: result.success !== false, target: target, message: result.message };
  } catch (e) {
    yield { type: 'tool_result', tool: 'stop_terminal', success: false, message: e.message };
  }
}

async function* check_terminal_state(args, context) {
  var sessionId = (context && context.sessionId) || (args && args._sessionId) || 'default';
  var isBackground = false;
  if (args) {
    if (args.background === true || args.terminal === 'background' || args.terminal === 'bg') {
      isBackground = true;
    }
  }
  var termType = isBackground ? 'background' : 'main';
  yield {
    type: 'action',
    action: 'check_terminal_state',
    message: 'Checking state of ' + (isBackground ? 'background terminal (CodeRun(BG))' : 'main terminal (CodeRun(main))')
  };
  try {
    var state = await terminalManager.getTerminalState(sessionId, { background: isBackground });
    yield {
      type: 'tool_result',
      tool: 'check_terminal_state',
      success: true,
      terminal: state.terminal || termType,
      terminal_name: state.terminalName || (isBackground ? 'CodeRun(BG)' : 'CodeRun(main)'),
      command: state.command || '',
      last_command: state.command || '',
      has_executed_command: state.has_executed_command === true,
      stdout: state.stdout || '',
      stderr: state.stderr || '',
      output: state.output || state.stdout || '',
      exit_code: state.exit_code,
      exit_code_zero: state.exit_code_zero === true,
      status: state.status || 'idle',
      waiting_for_input: state.waiting_for_input === true,
      duration_ms: state.duration_ms || 0,
      working_directory: state.working_directory || '',
      cwd: state.working_directory || '',
      shell: state.shell || '',
      platform: state.platform || '',
      message: state.message || ''
    };
  } catch (e) {
    yield {
      type: 'tool_result',
      tool: 'check_terminal_state',
      success: false,
      terminal: termType,
      message: 'Failed to retrieve terminal state: ' + e.message
    };
  }
}

// =═══════════════════════════════════════════════════
// CODE NAVIGATION, DIFF PATCHING, & HTTP TOOLS
// =═══════════════════════════════════════════════════

async function getVsCodeModule() {
  try {
    var mod = await import('vscode');
    if (mod && (mod.commands || mod.default?.commands)) {
      return mod.default || mod;
    }
  } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }
  return null;
}

function getLineSnippet(lines, line1Based) {
  var idx = line1Based - 1;
  if (idx >= 0 && idx < lines.length) {
    return lines[idx].trim();
  }
  return '';
}

function formatSymbolKind(kindNumber) {
  var kinds = [
    'File', 'Module', 'Namespace', 'Package', 'Class', 'Method', 'Property',
    'Field', 'Constructor', 'Enum', 'Interface', 'Function', 'Variable',
    'Constant', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Key',
    'Null', 'EnumMember', 'Struct', 'Event', 'Operator', 'TypeParameter'
  ];
  if (typeof kindNumber === 'number' && kindNumber >= 0 && kindNumber < kinds.length) {
    return kinds[kindNumber];
  }
  return 'Symbol';
}

function flattenDocumentSymbols(docSymbols, targetFilePath) {
  var flat = [];
  function walk(items, parentName) {
    if (!items || !items.length) return;
    for (var i = 0; i < items.length; i++) {
      var s = items[i];
      var name = s.name || '';
      var kind = formatSymbolKind(s.kind);
      var line = s.range ? (s.range.start.line + 1) : 1;
      var endLine = s.range ? (s.range.end.line + 1) : line;
      flat.push({
        name: name,
        kind: kind,
        container: parentName || '',
        line: line,
        end_line: endLine,
        file_path: targetFilePath
      });
      if (s.children && s.children.length) {
        walk(s.children, name);
      }
    }
  }
  walk(docSymbols, '');
  return flat;
}

async function* get_definition(args, context) {
  var workspace = extractWorkspace(context);
  var filePath = args.file_path || '';
  var lineNum = Number(args.line) || 1;
  var charNum = Number(args.character) || 1;

  yield {
    type: 'action',
    action: 'get_definition',
    message: 'Finding definition in ' + filePath + ' at line ' + lineNum + ':' + charNum
  };

  try {
    var target = _safePath(workspace, filePath);
    if (!existsSync(target)) {
      yield { type: 'tool_result', tool: 'get_definition', success: false, message: 'File not found: ' + filePath };
      return;
    }

    var vs = await getVsCodeModule();
    var definitions = [];

    if (vs && vs.Uri && vs.commands && vs.commands.executeCommand) {
      var uri = vs.Uri.file(target);
      var position = new vs.Position(Math.max(0, lineNum - 1), Math.max(0, charNum - 1));
      var locResults = await vs.commands.executeCommand('vscode.executeDefinitionProvider', uri, position);

      if (locResults && locResults.length) {
        for (var i = 0; i < locResults.length; i++) {
          var item = locResults[i];
          var targetUri = item.uri || (item.targetUri ? item.targetUri : null);
          var range = item.range || (item.targetRange ? item.targetRange : null);
          if (!targetUri) continue;

          var defFsPath = targetUri.fsPath || targetUri.path || '';
          var relPath = workspace ? path.relative(workspace, defFsPath) : defFsPath;
          var defLine = range ? (range.start.line + 1) : 1;
          var defCol = range ? (range.start.character + 1) : 1;

          var preview = '';
          try {
            if (existsSync(defFsPath)) {
              var defContent = await fs.readFile(defFsPath, 'utf-8');
              preview = getLineSnippet(defContent.split('\n'), defLine);
            }
          } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }

          definitions.push({
            file_path: relPath.replace(/\\/g, '/'),
            line: defLine,
            character: defCol,
            preview: preview
          });
        }
      }
    }

    // Fallback if running outside VS Code or LSP returned nothing
    if (definitions.length === 0) {
      var sourceContent = await fs.readFile(target, 'utf-8');
      var sourceLines = sourceContent.split('\n');
      var lineIdx = lineNum - 1;
      var curLine = (lineIdx >= 0 && lineIdx < sourceLines.length) ? sourceLines[lineIdx] : '';
      var token = '';
      if (curLine) {
        var colIdx = Math.max(0, charNum - 1);
        var before = curLine.slice(0, colIdx);
        var after = curLine.slice(colIdx);
        var mBefore = before.match(/[a-zA-Z0-9_$]+$/);
        var mAfter = after.match(/^[a-zA-Z0-9_$]+/);
        token = (mBefore ? mBefore[0] : '') + (mAfter ? mAfter[0] : '');
      }

      if (token) {
        var localSymbols = parseSymbols(sourceContent, filePath);
        for (var si = 0; si < localSymbols.length; si++) {
          if (localSymbols[si].name === token) {
            definitions.push({
              file_path: filePath,
              line: localSymbols[si].line,
              character: 1,
              preview: getLineSnippet(sourceLines, localSymbols[si].line)
            });
            break;
          }
        }
      }
    }

    yield {
      type: 'tool_result',
      tool: 'get_definition',
      success: true,
      file_path: filePath,
      line: lineNum,
      character: charNum,
      definitions: definitions,
      found: definitions.length > 0,
      message: definitions.length > 0
        ? 'Found ' + definitions.length + ' definition(s).'
        : 'No definition found at specified position.'
    };
  } catch (e) {
    yield { type: 'tool_result', tool: 'get_definition', success: false, message: e.message };
  }
}

async function* find_references(args, context) {
  var workspace = extractWorkspace(context);
  var filePath = args.file_path || '';
  var lineNum = Number(args.line) || 1;
  var charNum = Number(args.character) || 1;

  yield {
    type: 'action',
    action: 'find_references',
    message: 'Finding references in ' + filePath + ' at line ' + lineNum + ':' + charNum
  };

  try {
    var target = _safePath(workspace, filePath);
    if (!existsSync(target)) {
      yield { type: 'tool_result', tool: 'find_references', success: false, message: 'File not found: ' + filePath };
      return;
    }

    var vs = await getVsCodeModule();
    var references = [];

    if (vs && vs.Uri && vs.commands && vs.commands.executeCommand) {
      var uri = vs.Uri.file(target);
      var position = new vs.Position(Math.max(0, lineNum - 1), Math.max(0, charNum - 1));
      var refResults = await vs.commands.executeCommand('vscode.executeReferenceProvider', uri, position);

      if (refResults && refResults.length) {
        var fileCache = {};
        for (var i = 0; i < Math.min(refResults.length, 50); i++) {
          var ref = refResults[i];
          var refFsPath = ref.uri ? (ref.uri.fsPath || ref.uri.path) : '';
          if (!refFsPath) continue;
          var relPath = workspace ? path.relative(workspace, refFsPath) : refFsPath;
          var rLine = ref.range ? (ref.range.start.line + 1) : 1;
          var rCol = ref.range ? (ref.range.start.character + 1) : 1;

          var preview = '';
          try {
            if (!fileCache[refFsPath] && existsSync(refFsPath)) {
              fileCache[refFsPath] = (await fs.readFile(refFsPath, 'utf-8')).split('\n');
            }
            if (fileCache[refFsPath]) {
              preview = getLineSnippet(fileCache[refFsPath], rLine);
            }
          } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }

          references.push({
            file_path: relPath.replace(/\\/g, '/'),
            line: rLine,
            character: rCol,
            preview: preview
          });
        }
      }
    }

    yield {
      type: 'tool_result',
      tool: 'find_references',
      success: true,
      file_path: filePath,
      line: lineNum,
      character: charNum,
      count: references.length,
      references: references,
      message: references.length > 0
        ? 'Found ' + references.length + ' reference(s).'
        : 'No references found at specified position.'
    };
  } catch (e) {
    yield { type: 'tool_result', tool: 'find_references', success: false, message: e.message };
  }
}

async function* document_symbols(args, context) {
  var workspace = extractWorkspace(context);
  var filePath = args.file_path || '';

  yield {
    type: 'action',
    action: 'document_symbols',
    message: 'Extracting symbols from: ' + filePath
  };

  try {
    var target = _safePath(workspace, filePath);
    if (!existsSync(target)) {
      yield { type: 'tool_result', tool: 'document_symbols', success: false, message: 'File not found: ' + filePath };
      return;
    }

    var vs = await getVsCodeModule();
    var symbols = [];

    if (vs && vs.Uri && vs.commands && vs.commands.executeCommand) {
      var uri = vs.Uri.file(target);
      var docSymbols = await vs.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
      if (docSymbols && docSymbols.length) {
        symbols = flattenDocumentSymbols(docSymbols, filePath);
      }
    }

    // Headless fallback using regex parser
    if (symbols.length === 0) {
      var content = await fs.readFile(target, 'utf-8');
      var parsed = parseSymbols(content, filePath);
      for (var i = 0; i < parsed.length; i++) {
        symbols.push({
          name: parsed[i].name,
          kind: parsed[i].type || 'symbol',
          container: '',
          line: parsed[i].line,
          end_line: parsed[i].line,
          file_path: filePath
        });
      }
    }

    yield {
      type: 'tool_result',
      tool: 'document_symbols',
      success: true,
      file_path: filePath,
      count: symbols.length,
      symbols: symbols,
      message: 'Found ' + symbols.length + ' symbol(s) in ' + filePath + '.'
    };
  } catch (e) {
    yield { type: 'tool_result', tool: 'document_symbols', success: false, message: e.message };
  }
}

async function* list_symbols(args, context) {
  var workspace = extractWorkspace(context);
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
  var workspace = extractWorkspace(context);
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

      var normBlockContent = normalizeLineBreaks(newContent);
      var normFindStr = normalizeLineBreaks(findStr);
      var normReplaceStr = normalizeLineBreaks(replaceStr);

      var idx = normBlockContent.indexOf(normFindStr);
      if (idx !== -1) {
        newContent = normBlockContent.substring(0, idx) + normReplaceStr + normBlockContent.substring(idx + normFindStr.length);
        if (content.indexOf('\r\n') !== -1) {
          newContent = newContent.replace(/\n/g, '\r\n');
        }
      } else {
        var fuzzyMatch = findFuzzyLineMatch(normBlockContent, normFindStr, 0.85);
        if (fuzzyMatch) {
          newContent = normBlockContent.substring(0, fuzzyMatch.startIndex) + normReplaceStr + normBlockContent.substring(fuzzyMatch.endIndex);
          if (content.indexOf('\r\n') !== -1) {
            newContent = newContent.replace(/\n/g, '\r\n');
          }
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

          var matches = [];
          var matchObj;
          while ((matchObj = regex.exec(newContent)) !== null) {
            matches.push(matchObj);
          }
          if (matches.length === 0) {
            yield { type: 'tool_result', tool: 'patch_file', success: false, message: 'Patch #' + (i + 1) + ' search block not found in file (tried exact, fuzzy line, and whitespace matching).' };
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
      sessionId: sessionId,
      agentId: context && context.agentId,
      parentAgentId: context && context.parentAgentId,
      parentSessionId: context && context.parentSessionId,
      rootSessionId: context && context.rootSessionId
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
        cpId = await checkpointManager.createCheckpoint(filePath, workspace, sessionId, 'Patches: ' + filePath, context && context.agentId);
      } catch (cpErr) {
        return { success: false, message: 'Checkpoint creation error: ' + cpErr.message };
      }

      if (!cpId) {
        return { success: false, message: 'Checkpoint creation failed for ' + filePath + '; patch aborted for safety.' };
      }

      await fs.writeFile(target, newContent, 'utf-8');

      try {
        await projectKnowledge.touchFile(filePath);
      } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }

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

  var sessionController = (context && context.signal) || null;
  var sessionSignal = sessionController && sessionController.signal ? sessionController.signal : sessionController;
  function handleSessionAbort() {
    abortCtrl.abort();
  }
  if (sessionSignal) {
    if (sessionSignal.aborted || (sessionController && sessionController.stopped)) {
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

function extractChecklistItems(text) {
  var rawLines = String(text || '').split('\n');
  var items = [];
  var currentItem = null;

  for (var i = 0; i < rawLines.length; i++) {
    var rawLine = rawLines[i];
    var trimmed = rawLine.trim();
    if (!trimmed) continue;

    var match = trimmed.match(/^[-*]\s*\[([ \/xX!→>✓])\]\s*(?:#?([0-9a-zA-Z_.-]+)\s*:?|\b(\d+)[.)]\s*)?\s*(.*)$/);
    if (match) {
      if (currentItem) {
        items.push(currentItem);
      }
      var mark = match[1];
      var rawId = match[2] || match[3] || null;
      var desc = match[4] || '';
      var status = (mark === 'x' || mark === 'X' || mark === '✓') ? 'completed' : (mark === '!' ? 'failed' : ((mark === '→' || mark === '>' || mark === '/') ? 'active' : 'pending'));
      currentItem = {
        mark: mark,
        explicitId: rawId,
        description: desc,
        status: status
      };
    } else if (currentItem && (rawLine.startsWith('  ') || rawLine.startsWith('\t'))) {
      // Indented continuation line of previous task description
      currentItem.description += ' ' + trimmed;
    }
  }

  if (currentItem) {
    items.push(currentItem);
  }

  // Fallback: If no checkbox items found, match standard numbered list items
  if (items.length === 0) {
    var numAutoId = 0;
    var numCurrent = null;

    for (var j = 0; j < rawLines.length; j++) {
      var nLine = rawLines[j];
      var nTrimmed = nLine.trim();
      if (!nTrimmed) continue;

      var numMatch = nTrimmed.match(/^(?:#?(\d+)[.):]\s+|\b(\d+)[.)]\s+)(.*)$/);
      if (numMatch) {
        if (numCurrent) {
          items.push(numCurrent);
        }
        numAutoId++;
        var numRawId = numMatch[1] || numMatch[2] || String(numAutoId);
        var cleanNumId = String(numRawId).replace(/[.:)]+$/, '');
        var numDesc = numMatch[3] || nTrimmed;
        numCurrent = {
          mark: ' ',
          explicitId: cleanNumId,
          description: numDesc,
          status: 'pending'
        };
      } else if (numCurrent && (nLine.startsWith('  ') || nLine.startsWith('\t'))) {
        numCurrent.description += ' ' + nTrimmed;
      }
    }

    if (numCurrent) {
      items.push(numCurrent);
    }
  }

  return items;
}

function getExistingPlanTasks(activePlan) {
  var list = [];
  if (!activePlan) return list;
  if (activePlan.phases && Array.isArray(activePlan.phases)) {
    for (var p = 0; p < activePlan.phases.length; p++) {
      var phase = activePlan.phases[p];
      if (phase.tasks && Array.isArray(phase.tasks)) {
        for (var t = 0; t < phase.tasks.length; t++) {
          list.push(phase.tasks[t]);
        }
      }
    }
  } else if (activePlan.steps && Array.isArray(activePlan.steps)) {
    for (var s = 0; s < activePlan.steps.length; s++) {
      list.push(activePlan.steps[s]);
    }
  }
  return list;
}

function resolveMatchingTaskId(explicitId, desc, existingTasks, usedTaskIds, fallbackOrder) {
  if (explicitId) {
    var expStr = String(explicitId).trim();
    usedTaskIds[expStr] = true;
    return expStr;
  }

  var lowerDesc = String(desc || '').toLowerCase().trim();
  if (lowerDesc && existingTasks && existingTasks.length) {
    // 1. Exact description match
    for (var i = 0; i < existingTasks.length; i++) {
      var exId = String(existingTasks[i].id).trim();
      if (usedTaskIds[exId]) continue;
      var exDesc = String(existingTasks[i].description || '').toLowerCase().trim();
      if (exDesc === lowerDesc) {
        usedTaskIds[exId] = true;
        return exId;
      }
    }

    // 2. Substring match
    for (var j = 0; j < existingTasks.length; j++) {
      var exIdSub = String(existingTasks[j].id).trim();
      if (usedTaskIds[exIdSub]) continue;
      var exDescSub = String(existingTasks[j].description || '').toLowerCase().trim();
      if (exDescSub && (exDescSub.includes(lowerDesc) || lowerDesc.includes(exDescSub))) {
        usedTaskIds[exIdSub] = true;
        return exIdSub;
      }
    }
  }

  var fallbackId = String(fallbackOrder);
  usedTaskIds[fallbackId] = true;
  return fallbackId;
}

async function* update_plan(args, context) {
  yield { type: 'action', action: 'update_plan', message: 'Updating execution plan' };

  var planText = args.plan || '';
  if (!planText) {
    yield { type: 'tool_result', tool: 'update_plan', success: false, message: 'Missing required parameter: plan' };
    return;
  }

  var workspace = extractWorkspace(context);
  var sessionId = (context && context.sessionId) || 'default';

  try {
    var activePlan = runtime.getCurrentPlan(sessionId);
    var existingTasks = getExistingPlanTasks(activePlan);
    var parsedItems = extractChecklistItems(planText);
    var usedTaskIds = {};

    var totalTasks = parsedItems.length;
    var completedTasks = 0;

    for (var itemIdx = 0; itemIdx < parsedItems.length; itemIdx++) {
      var item = parsedItems[itemIdx];
      var resolvedId = resolveMatchingTaskId(item.explicitId, item.description, existingTasks, usedTaskIds, itemIdx + 1);

      if (item.status === 'completed') {
        completedTasks++;
      }

      if (activePlan) {
        planningManager.updateTaskStatus(activePlan.id, resolvedId, item.status, item.description, sessionId);
        goalTracker.updateGoalStatus(resolvedId, item.status, sessionId, item.description);
      }
    }

    var allDone = (totalTasks > 0 && completedTasks === totalTasks) || (args.status === 'completed');

    if (activePlan) {
      activePlan.rawPlan = planText;
      if (allDone) {
        activePlan.status = 'completed';
        planningManager.updatePlanStatus(activePlan.id, 'completed');
      }
      runtime.updatePlan(activePlan);
    } else {
      var planObj = planningEngine.buildPlanFromChecklist(planText, sessionId);
      if (!planObj) {
        var analysis = planningEngine.analyzeRequest(planText, { workspace: workspace }, workspace);
        planObj = planningEngine.buildPlan(analysis, sessionId);
      }
      planObj.rawPlan = planText;
      if (allDone) {
        planObj.status = 'completed';
      }
      runtime.registerPlan(planObj);
      runtime.setCurrentPlan(planObj, sessionId);
      goalTracker.syncWithPlan(planObj, sessionId);
    }

    yield {
      type: 'tool_result',
      tool: 'update_plan',
      success: true,
      plan: planText,
      status: allDone ? 'completed' : 'active',
      all_tasks_completed: allDone,
      completed_tasks: completedTasks,
      total_tasks: totalTasks,
      message: allDone
        ? 'Plan updated successfully. All ' + completedTasks + '/' + totalTasks + ' tasks are completed — plan is marked as finished.'
        : 'Plan updated: ' + completedTasks + '/' + totalTasks + ' tasks completed.'
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

  var workspace = extractWorkspace(context);
  var sessionId = (context && context.sessionId) || 'default';

  try {
    var planObj = planningEngine.buildPlanFromChecklist(planText, sessionId);
    if (!planObj) {
      var analysis = planningEngine.analyzeRequest(planText, { workspace: workspace }, workspace);
      planObj = planningEngine.buildPlan(analysis, sessionId);
    }
    planObj.rawPlan = planText;
    runtime.registerPlan(planObj);
    runtime.setCurrentPlan(planObj, sessionId);
    goalTracker.syncWithPlan(planObj, sessionId);

    yield {
      type: 'tool_result',
      tool: 'create_plan',
      success: true,
      plan: planText,
      plan_id: planObj.id,
      status: planObj.status || 'active',
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

async function* ask_question(args, context) {
  var question = (args && args.question) || '';
  var options = (args && args.options) || [];
  var sessionId = (context && context.sessionId) || 'default';
  var parentSessionId = (context && context.parentSessionId) || null;
  var rootSessionId = (context && context.rootSessionId) || null;
  var agentName = (context && context.agentName) || null;
  var agentType = (context && context.agentType) || null;
  var subagentName = (agentType === 'subagent' ? agentName : null);

  if (!question) {
    yield {
      type: 'tool_result',
      tool: 'ask_question',
      success: false,
      message: 'Missing required question parameter.'
    };
    return;
  }

  yield {
    type: 'action',
    action: 'ask_question',
    message: 'Asking user: ' + question
  };

  var qRecord = questionManager.createQuestion(
    question,
    options,
    sessionId,
    null,
    parentSessionId,
    rootSessionId,
    agentName,
    agentType
  );

  yield {
    type: 'ask_question',
    id: qRecord.id,
    question: question,
    options: options,
    sessionId: sessionId,
    parentSessionId: parentSessionId,
    rootSessionId: rootSessionId,
    agentName: agentName,
    agentType: agentType,
    subagentName: subagentName
  };

  try {
    var outcome = await qRecord.promise;
    if (outcome && outcome.answered) {
      yield {
        type: 'tool_result',
        tool: 'ask_question',
        success: true,
        question: question,
        answer: outcome.answer,
        message: 'User answered: ' + outcome.answer
      };
    } else {
      yield {
        type: 'tool_result',
        tool: 'ask_question',
        success: false,
        question: question,
        message: (outcome && outcome.message) || 'Question was not answered.'
      };
    }
  } catch (err) {
    yield {
      type: 'tool_result',
      tool: 'ask_question',
      success: false,
      message: err.message
    };
  }
}

// =====================================================
// REGISTER ALL TOOLS — using descriptor-based toolRegistry
// =====================================================

function reg(name, handler, opts) {
  opts = opts || {};
  var isReadOnly = opts.readOnly || false;
  var isMutation = opts.mutation || false;
  var sideEffect = opts.sideEffect || (isReadOnly ? 'none' : (isMutation ? 'mutation' : 'unknown'));
  toolRegistry.register({
    name: name,
    handler: handler,
    aliases: opts.aliases || [],
    category: opts.category || 'utility',
    description: opts.description || '',
    parameters: opts.parameters || {},
    required: opts.required || [],
    hidden: opts.hidden || false,
    readOnly: isReadOnly,
    mutation: isMutation,
    sideEffect: sideEffect,
    metadata: {
      dangerous: opts.dangerous || false,
      needsPermission: opts.needsPermission || opts.dangerous || false,
      hidden: opts.hidden || false,
      category: opts.category || 'utility',
      timeout: opts.timeout || 30000,
      rootOnly: opts.rootOnly || false,
      readOnly: isReadOnly,
      mutation: isMutation,
      sideEffect: sideEffect
    }
  });
}

export function registerAllTools() {
  // ── Filesystem ─────────────────────────────────────
  reg('read_file', read_file, {
    aliases: ['read'],
    category: 'filesystem',
    readOnly: true,
    description: 'Read the full contents of a file at the given relative path inside the workspace.',
    parameters: { file_path: { type: 'string', description: "Relative path e.g. 'src/main.py'" } },
    required: ['file_path'],
    dangerous: true
  });
  reg('write_file', write_file, {
    aliases: ['write'],
    category: 'filesystem',
    mutation: true,
    description: 'Create a new file or completely overwrite an existing file.',
    parameters: { file_path: { type: 'string', description: "Relative path e.g. 'src/app.js'" }, content: { type: 'string', description: 'The complete file content' } },
    required: ['file_path', 'content'],
    dangerous: true
  });
  reg('edit_file', edit_file, {
    aliases: ['edit'],
    category: 'filesystem',
    mutation: true,
    description: 'Replace the first occurrence of an exact string in a file with a new string.',
    parameters: { file_path: { type: 'string', description: 'Relative path' }, old_string: { type: 'string', description: 'The exact string to find' }, new_string: { type: 'string', description: 'The replacement string' } },
    required: ['file_path', 'old_string', 'new_string'],
    dangerous: true
  });
  reg('delete_file', delete_file, {
    category: 'filesystem',
    mutation: true,
    description: 'Permanently delete a file from the workspace.',
    parameters: { file_path: { type: 'string', description: 'Relative path' } },
    required: ['file_path'],
    dangerous: true
  });
  reg('create_folder', create_folder, {
    category: 'filesystem',
    mutation: true,
    description: 'Create a directory (and any parent directories) in the workspace.',
    parameters: { folder_path: { type: 'string', description: "Relative path e.g. 'src/components'" } },
    required: ['folder_path'],
    dangerous: true
  });
  reg('delete_folder', delete_folder, {
    category: 'filesystem',
    mutation: true,
    description: 'Delete a folder and ALL its contents recursively.',
    parameters: { folder_path: { type: 'string', description: 'Relative path to delete' } },
    required: ['folder_path'],
    dangerous: true
  });
  reg('list_directory', list_directory, {
    category: 'filesystem',
    readOnly: true,
    description: 'List all files and folders in a directory.',
    parameters: { folder_path: { type: 'string', description: "Relative path. Use '.' for root." } },
    required: []
  });
  reg('get_file_info', get_file_info, {
    category: 'filesystem',
    readOnly: true,
    description: 'Get metadata about a file or folder (size, modified, type).',
    parameters: { file_path: { type: 'string', description: 'Relative path' } },
    required: ['file_path']
  });
  reg('patch_file', patch_file, {
    category: 'filesystem',
    mutation: true,
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
    readOnly: true,
    description: 'Recursively search for files matching a glob pattern.',
    parameters: {
      glob_pattern: { type: 'string', description: "Glob pattern e.g. '*.py' or '**/*.js'" },
      folder_path: { type: 'string', description: 'Relative path to search in' }
    },
    required: ['glob_pattern']
  });
  reg('find_in_files', find_in_files, {
    category: 'search',
    readOnly: true,
    description: 'Search file contents for a text query. Returns matching files with snippets.',
    parameters: { query: { type: 'string', description: 'Text to search for' } },
    required: ['query']
  });
  reg('list_symbols', list_symbols, {
    category: 'search',
    readOnly: true,
    description: 'Extract code symbols (classes, functions) defined in a file.',
    parameters: { file_path: { type: 'string', description: "Relative path e.g. 'src/app.js'" } },
    required: ['file_path']
  });
  reg('get_definition', get_definition, {
    aliases: ['goto_definition', 'go_to_definition'],
    category: 'search',
    readOnly: true,
    description: 'Jump directly to the definition of a symbol at the given file position using VS Code language intelligence (LSP).',
    parameters: {
      file_path: { type: 'string', description: 'Relative path to the source file' },
      line: { type: 'integer', description: '1-based line number' },
      character: { type: 'integer', description: '1-based column/character number' }
    },
    required: ['file_path', 'line']
  });
  reg('find_references', find_references, {
    aliases: ['find_usages'],
    category: 'search',
    readOnly: true,
    description: 'Find all references, usages, and call-sites of a symbol across the workspace using VS Code language intelligence (LSP).',
    parameters: {
      file_path: { type: 'string', description: 'Relative path to the source file' },
      line: { type: 'integer', description: '1-based line number' },
      character: { type: 'integer', description: '1-based column/character number' }
    },
    required: ['file_path', 'line']
  });
  reg('document_symbols', document_symbols, {
    aliases: ['outline', 'get_symbols'],
    category: 'search',
    readOnly: true,
    description: 'Retrieve the hierarchical symbol tree (functions, classes, methods, variables) and line ranges for an entire file.',
    parameters: { file_path: { type: 'string', description: "Relative path e.g. 'src/app.js'" } },
    required: ['file_path']
  });

  // ── Terminal ───────────────────────────────────────
  reg('run_terminal', run_terminal, {
    aliases: ['bash', 'execute_command'],
    category: 'terminal',
    description: 'Execute a shell command. Pass empty command (command: "") to check current terminal state (waiting_for_input, active, completed) and latest output without executing a new command.',
    parameters: {
      command: { type: 'string', description: 'The command to execute' },
      cwd: { type: 'string', description: 'Optional working directory. Defaults to workspace root, or can be set to sandbox ~/.coderun/sandbox' },
      is_interactive: { type: 'boolean', description: 'Explicitly specify whether the command is interactive and expects user prompt/input (e.g. Read-Host, prompts, interactive CLI questionnaires). Set false for commands that run to completion and return output.' },
      timeout: { type: 'integer', description: 'Max seconds before timeout (default 30)' },
      background: { type: 'boolean', description: 'Explicitly specify whether the command should run in the background without waiting for it to finish (e.g. dev servers, watchers, long-running services). Set false for normal commands that finish.' }
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
    description: 'Send Ctrl+C to stop a running terminal command. Specify target as "foreground" (default, stops active command in CodeRun(main) without killing background servers), "background" (stops background server in CodeRun(BG)), or "all" (stops both).',
    parameters: {
      target: {
        type: 'string',
        enum: ['foreground', 'background', 'all'],
        description: 'Which terminal to stop: "foreground" (default, stops active command in CodeRun(main)), "background" (stops dev server in CodeRun(BG)), or "all" (stops both).'
      }
    },
    required: []
  });
  reg('check_terminal_state', check_terminal_state, {
    aliases: ['get_terminal_state'],
    category: 'terminal',
    readOnly: true,
    description: 'Check the current state and execution details of the terminal session. Returns the last executed terminal command, its stdout/stderr output, whether it exited with exit code 0 or not, execution status (active, completed, waiting_for_input, failed, idle), working directory, and whether the terminal is currently waiting for input. The model decides whether to check the main/direct terminal or the background (BG) terminal.',
    parameters: {
      background: {
        type: 'boolean',
        description: 'Set to true to check the background terminal (CodeRun(BG), e.g. dev servers, background processes). Set to false (default) to check the direct/main foreground terminal (CodeRun(main)).'
      },
      terminal: {
        type: 'string',
        enum: ['main', 'background'],
        description: 'Alternative selector: "main" (default) for foreground terminal or "background" for background terminal.'
      }
    },
    required: []
  });

  // ── Utility ────────────────────────────────────────
  reg('get_current_datetime', get_current_datetime, {
    category: 'utility',
    readOnly: true,
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
  reg('sandbox', sandbox, {
    aliases: ['sandbox_tools', 'user_sandbox', 'manage_sandbox'],
    category: 'utility',
    description: 'Inspect, list, clean, or manage the transparent user sandbox directory (~/.coderun/sandbox/) used for scratch work and safe experimentation.',
    parameters: {
      action: { type: 'string', description: 'Action to perform: status (default), list, clean' },
      subpath: { type: 'string', description: 'Optional subpath inside the sandbox' }
    },
    required: []
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
    readOnly: true,
    hidden: true,
    description: 'Query the SQLite project knowledge database containing file index, text chunks, and code symbols (functions, classes, logic structure) of the project workspace. Use SELECT read-only SQL queries.',
    parameters: {
      sql_query: { type: 'string', description: 'Read-only SELECT query to run (e.g. SELECT * FROM symbols WHERE type = \'function\')' }
    },
    required: ['sql_query']
  });

  // ── Interaction ────────────────────────────────────
  reg('ask_question', ask_question, {
    aliases: ['ask_user_question', 'ask_user'],
    category: 'interaction',
    description: 'Ask the user a structured clarification question with selectable choices and descriptions when requirements or decisions are ambiguous. Pauses the agent turn until the user responds.',
    parameters: {
      question: { type: 'string', description: 'The question to ask the user' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'The short display title of the option' },
            description: { type: 'string', description: 'Optional explanation of what this option does' }
          }
        },
        description: 'List of 2-4 concrete choices (can be objects with label and description, or plain strings)'
      }
    },
    required: ['question']
  });

  // ── Subagents (Root Only) ───────────────────────────
  reg('spawn_subagent', subagentTools.spawn_subagent, {
    category: 'subagent',
    rootOnly: true,
    dangerous: true,
    description: 'Create and start a subagent — another AI agent running the same execution loop independently. Use "sync" (or "parallel"/"async") to launch in background and return immediately with confirmation, or "wait" to block until completion.',
    parameters: {
      id: { type: 'string', description: 'Unique machine identifier for this subagent within current run' },
      name: { type: 'string', description: 'Human-readable role name (e.g. Authentication Researcher)' },
      task: { type: 'string', description: 'The objective to delegate' },
      role: { type: 'string', description: 'Role specialization for the subagent (e.g. coder, architect, reviewer, debugger, researcher)' },
      context: { type: 'string', description: 'Additional instructions or context for the subagent' },
      execution: { type: 'string', enum: ['sync', 'wait', 'parallel', 'async'], description: 'sync = run in background, returns immediately confirming subagent started; wait = block until completion and return final response; parallel or async = run in background parallel to main agent' }
    },
    required: ['id', 'name', 'task']
  });

  reg('subagent_response', subagentTools.subagent_response, {
    category: 'subagent',
    rootOnly: true,
    description: 'Received subagent execution response and results.',
    parameters: {
      id: { type: 'string', description: 'The subagent ID' },
      name: { type: 'string', description: 'The subagent name' },
      task: { type: 'string', description: 'The delegated subagent task' },
      role: { type: 'string', description: 'Subagent role' },
      execution: { type: 'string', description: 'Execution mode' }
    }
  });

  reg('subagent_status', subagentTools.subagent_status, {
    category: 'subagent',
    readOnly: true,
    rootOnly: true,
    description: "Inspect a child subagent's current state, progress, activity, files read/modified, and partial results.",
    parameters: {
      subagent_id: { type: 'string', description: 'The subagent id' }
    },
    required: ['subagent_id']
  });

  reg('subagents_list', subagentTools.subagents_list, {
    category: 'subagent',
    readOnly: true,
    rootOnly: true,
    description: 'List all child subagents created in this session with their current lifecycle and granular state.',
    parameters: {}
  });

  reg('stop_subagent', subagentTools.stop_subagent, {
    category: 'subagent',
    rootOnly: true,
    description: 'Permanently stop a running or paused child subagent. Partial results are preserved.',
    parameters: {
      subagent_id: { type: 'string', description: 'The subagent id to stop' }
    },
    required: ['subagent_id']
  });

  reg('wait_for_subagent', subagentTools.wait_for_subagent, {
    category: 'subagent',
    rootOnly: true,
    description: 'Block until an async child subagent reaches a terminal state and return its full result.',
    parameters: {
      subagent_id: { type: 'string', description: 'The subagent id to await' }
    },
    required: ['subagent_id']
  });

  reg('pause_subagent', subagentTools.pause_subagent, {
    category: 'subagent',
    rootOnly: true,
    description: 'Temporarily suspend a running child subagent at the next iteration boundary. Can be resumed later.',
    parameters: {
      subagent_id: { type: 'string', description: 'The subagent id to pause' }
    },
    required: ['subagent_id']
  });

  reg('resume_subagent', subagentTools.resume_subagent, {
    category: 'subagent',
    rootOnly: true,
    description: 'Continue a paused child subagent from where it was suspended.',
    parameters: {
      subagent_id: { type: 'string', description: 'The subagent id to resume' }
    },
    required: ['subagent_id']
  });

  reg('generate_image', generate_image, {
    category: 'media',
    description: 'Generate an image from a descriptive text prompt using OpenAI-compatible image endpoints (/v1/images/generations). Saves the resulting image to persistent globalStorage and returns its file path.',
    parameters: {
      prompt: { type: 'string', description: 'Detailed prompt describing the image to generate' },
      model: { type: 'string', description: 'Optional image generation model name (e.g. dall-e-3, agnes-image-2.5-flash)' },
      size: { type: 'string', description: 'Optional image resolution (e.g. 1024x1024)' }
    },
    required: ['prompt']
  });

  reg('generate_video', generate_video, {
    category: 'media',
    description: 'Generate a video from a descriptive text prompt using OpenAI-compatible video endpoints (/v1/videos). Saves the resulting video to persistent globalStorage and returns its file path.',
    parameters: {
      prompt: { type: 'string', description: 'Detailed prompt describing the video to generate' },
      model: { type: 'string', description: 'Optional video generation model name (e.g. sora, agnes-video-2.5)' }
    },
    required: ['prompt']
  });

  console.log('[TOOLS] Registered ' + toolRegistry.count() + ' tools in ' + toolRegistry.listCategories().length + ' categories');
}

export async function* generate_image(args, context) {
  var prompt = args && args.prompt;
  if (!prompt) {
    yield { type: 'error', error: 'Missing required parameter: prompt' };
    return;
  }
  yield { type: 'action', action: 'Generating image: ' + String(prompt).substring(0, 60) + '...' };
  try {
    var cfg = (context && context.config) || {};
    var pCfg = Object.assign({}, cfg);
    if (args.model) pCfg.model = args.model;
    var provider = providerManager.createProvider(pCfg);
    var imgResult = await provider.images(pCfg, prompt);
    if (!imgResult) throw new Error('No image returned from provider endpoint');
    var sId = (context && context.sessionId) || 'default';
    var saved = await mediaManager.saveMediaFromDataOrUrl(null, sId, imgResult, 'png');
    var resPath = saved ? saved.filePath : (typeof imgResult === 'string' ? imgResult : 'Image generated');
    yield {
      type: 'result',
      result: 'Image generated successfully.\nFile: ' + resPath + '\nMarkdown: ![Generated Image](' + resPath + ')',
      media: {
        type: 'image',
        filePath: saved ? saved.filePath : null,
        filename: saved ? saved.filename : null,
        url: typeof imgResult === 'string' ? imgResult : null
      }
    };
  } catch (err) {
    yield { type: 'error', error: 'Failed to generate image: ' + err.message };
  }
}

export async function* generate_video(args, context) {
  var prompt = args && args.prompt;
  if (!prompt) {
    yield { type: 'error', error: 'Missing required parameter: prompt' };
    return;
  }
  yield { type: 'action', action: 'Generating video: ' + String(prompt).substring(0, 60) + '...' };
  try {
    var cfg = (context && context.config) || {};
    var pCfg = Object.assign({}, cfg);
    if (args.model) pCfg.model = args.model;
    var provider = providerManager.createProvider(pCfg);
    var vidResult = await provider.videos(pCfg, prompt);
    if (!vidResult) throw new Error('No video returned from provider endpoint');
    var sId = (context && context.sessionId) || 'default';
    var saved = await mediaManager.saveMediaFromDataOrUrl(null, sId, vidResult, 'mp4');
    var resPath = saved ? saved.filePath : (typeof vidResult === 'string' ? vidResult : 'Video generated');
    yield {
      type: 'result',
      result: 'Video generated successfully.\nFile: ' + resPath + '\nMarkdown: ![Generated Video](' + resPath + ')',
      media: {
        type: 'video',
        filePath: saved ? saved.filePath : null,
        filename: saved ? saved.filename : null,
        url: typeof vidResult === 'string' ? vidResult : null
      }
    };
  } catch (err) {
    yield { type: 'error', error: 'Failed to generate video: ' + err.message };
  }
}
