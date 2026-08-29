// checkpointManager.js — Checkpoints & Undo Engine
// Before every file write/edit, captures the original content into SQLite.
// Undo restores the original content from the most recent checkpoint.
// Integrates with pathSecurity.js for complete workspace canonicalization.

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as projectKnowledge from '../context/projectKnowledge.js';
import * as pathSecurity from './pathSecurity.js';
import * as fileLockManager from './fileLockManager.js';

var MAX_CHECKPOINTS = 100;

// ========================================================
// PUBLIC API
// ========================================================

function normalizePathSlashes(p) {
  return String(p || '').replace(/\\/g, '/');
}

// Create a checkpoint before modifying a file.
// Captures the file's current content in SQLite.
export async function createCheckpoint(filePath, workspace, sessionId, label) {
  if (!filePath || !workspace) return null;

  var safeCheck = pathSecurity.resolveSafePath(filePath, workspace);
  if (!safeCheck.safe) {
    console.warn('[CHECKPOINT] Blocked unsafe checkpoint path:', filePath, safeCheck.error);
    return null;
  }

  var fullPath = safeCheck.canonicalPath;
  var canonicalWs = pathSecurity.getCanonicalWorkspace(workspace);
  var relFilePath = normalizePathSlashes(path.relative(canonicalWs, fullPath));
  var content = '';
  var existed = false;

  // Read current file content (may not exist for new files)
  if (existsSync(fullPath)) {
    existed = true;
    try {
      content = await fs.readFile(fullPath, 'utf-8');
    } catch (readErr) {
      console.error('[CHECKPOINT] Failed to read existing file for checkpoint:', fullPath, readErr.message);
      return null;
    }
  }

  var id = 'cp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  projectKnowledge.addCheckpoint({
    id: id,
    file_path: relFilePath,
    content: content,
    created_at: Date.now(),
    session_id: sessionId || 'session_unknown',
    label: label || 'Edit: ' + relFilePath,
    existed: existed
  });

  // Trim old checkpoints for this session
  trimCheckpoints(sessionId);

  return id;
}

export function deleteCheckpoint(id) {
  if (id) {
    projectKnowledge.deleteCheckpoint(id);
  }
}

async function snapshotDirectoryTree(dirPath, rootDir) {
  var filesMap = {};
  async function walk(currentDir) {
    var entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var entryFull = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryFull);
      } else if (entry.isFile()) {
        var rel = normalizePathSlashes(path.relative(rootDir, entryFull));
        try {
          var fileContent = await fs.readFile(entryFull, 'utf-8');
          filesMap[rel] = fileContent;
        } catch (_) {}
      }
    }
  }
  if (existsSync(dirPath)) {
    await walk(dirPath);
  }
  return filesMap;
}

// Create a checkpoint before creating a folder.
export async function createFolderCheckpoint(folderPath, workspace, sessionId, label, existed) {
  if (!folderPath || !workspace) return null;

  var safeCheck = pathSecurity.resolveSafePath(folderPath, workspace);
  if (!safeCheck.safe) {
    console.warn('[CHECKPOINT] Blocked unsafe checkpoint path:', folderPath, safeCheck.error);
    return null;
  }

  var fullPath = safeCheck.canonicalPath;
  var canonicalWs = pathSecurity.getCanonicalWorkspace(workspace);
  var relFolderPath = normalizePathSlashes(path.relative(canonicalWs, fullPath));

  var id = 'cp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  projectKnowledge.addCheckpoint({
    id: id,
    file_path: relFolderPath,
    content: '',
    created_at: Date.now(),
    session_id: sessionId || 'session_unknown',
    label: label || 'Created: ' + relFolderPath,
    existed: existed ? 1 : 0,
    is_dir: 1,
    extra_data: ''
  });

  trimCheckpoints(sessionId);
  return id;
}

// Create a checkpoint before deleting a folder, capturing all contained files.
export async function createFolderDeleteCheckpoint(folderPath, workspace, sessionId, label) {
  if (!folderPath || !workspace) return null;

  var safeCheck = pathSecurity.resolveSafePath(folderPath, workspace);
  if (!safeCheck.safe) {
    console.warn('[CHECKPOINT] Blocked unsafe checkpoint path:', folderPath, safeCheck.error);
    return null;
  }

  var fullPath = safeCheck.canonicalPath;
  var canonicalWs = pathSecurity.getCanonicalWorkspace(workspace);
  var relFolderPath = normalizePathSlashes(path.relative(canonicalWs, fullPath));

  var snapshot = {};
  try {
    snapshot = await snapshotDirectoryTree(fullPath, fullPath);
  } catch (err) {
    console.error('[CHECKPOINT] Failed to snapshot directory before deletion:', fullPath, err.message);
  }

  var id = 'cp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  projectKnowledge.addCheckpoint({
    id: id,
    file_path: relFolderPath,
    content: '',
    created_at: Date.now(),
    session_id: sessionId || 'session_unknown',
    label: label || 'Deleted: ' + relFolderPath,
    existed: 1,
    is_dir: 1,
    extra_data: JSON.stringify(snapshot)
  });

  trimCheckpoints(sessionId);
  return id;
}

// Undo the most recent checkpoint for a specific file or folder.
// Restores the file/folder content from the checkpoint.
export async function undoFile(filePath, workspace, sessionId) {
  if (!filePath || !workspace) {
    return { success: false, message: 'No file path or workspace specified' };
  }

  var safeCheck = pathSecurity.resolveSafePath(filePath, workspace);
  if (!safeCheck.safe) {
    return { success: false, message: 'Security violation in undoFile: ' + safeCheck.error };
  }

  var fullPath = safeCheck.canonicalPath;
  var canonicalWs = pathSecurity.getCanonicalWorkspace(workspace);
  var relFilePath = normalizePathSlashes(path.relative(canonicalWs, fullPath));

  var checkpoints = projectKnowledge.getCheckpoints(relFilePath, sessionId);
  if (!checkpoints || !checkpoints.length) {
    return { success: false, message: 'No checkpoints found for: ' + filePath };
  }

  // Most recent checkpoint
  var cp = checkpoints[0];

  async function performLockedUndo() {
    var isDir = cp.is_dir !== undefined ? (Number(cp.is_dir) === 1 || cp.is_dir === true) : false;
    var fileExistedBefore = cp.existed !== undefined ? (Number(cp.existed) === 1 || cp.existed === true) : !!cp.content;

    if (isDir) {
      if (!fileExistedBefore) {
        if (existsSync(fullPath)) {
          await fs.rm(fullPath, { recursive: true, force: true });
        }
      } else {
        await fs.mkdir(fullPath, { recursive: true });
        if (cp.extra_data) {
          try {
            var filesObj = JSON.parse(cp.extra_data);
            for (var subRel in filesObj) {
              var subFull = path.join(fullPath, subRel);
              await fs.mkdir(path.dirname(subFull), { recursive: true });
              await fs.writeFile(subFull, filesObj[subRel] || '', 'utf-8');
            }
          } catch (_) {}
        }
      }
    } else {
      if (fileExistedBefore) {
        // Restore original content (even if empty file)
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, cp.content || '', 'utf-8');
      } else {
        // File didn't exist before — delete it
        if (existsSync(fullPath)) {
          await fs.unlink(fullPath);
        }
      }
    }

    // Remove this checkpoint (consumed)
    projectKnowledge.deleteCheckpoint(cp.id);

    return {
      success: true,
      message: 'Undid: ' + (cp.label || (isDir ? (fileExistedBefore ? 'Deleted: ' : 'Created: ') : 'Edit: ') + relFilePath),
      restoredContent: cp.content,
      filePath: relFilePath
    };
  }

  try {
    return await fileLockManager.withFileLock(fullPath, performLockedUndo);
  } catch (e) {
    return { success: false, message: 'Failed to undo: ' + e.message };
  }
}

// Undo a specific checkpoint by ID directly.
export async function undoCheckpointById(checkpointId, workspace, sessionId) {
  if (!checkpointId || !workspace) {
    return { success: false, message: 'No checkpoint ID or workspace specified' };
  }
  var cp = projectKnowledge.getCheckpointById(checkpointId);
  if (!cp) {
    return { success: false, message: 'Checkpoint not found: ' + checkpointId };
  }
  if (sessionId && cp.session_id && cp.session_id !== 'session_unknown' && cp.session_id !== sessionId) {
    return { success: false, message: 'Checkpoint does not belong to session: ' + sessionId };
  }

  var safeCheck = pathSecurity.resolveSafePath(cp.file_path, workspace);
  if (!safeCheck.safe) {
    return { success: false, message: 'Security violation in undoCheckpointById: ' + safeCheck.error };
  }
  var fullPath = safeCheck.canonicalPath;

  async function performLockedUndo() {
    var isDir = cp.is_dir !== undefined ? (Number(cp.is_dir) === 1 || cp.is_dir === true) : false;
    var fileExistedBefore = cp.existed !== undefined ? (Number(cp.existed) === 1 || cp.existed === true) : !!cp.content;

    if (isDir) {
      if (!fileExistedBefore) {
        if (existsSync(fullPath)) {
          await fs.rm(fullPath, { recursive: true, force: true });
        }
      } else {
        await fs.mkdir(fullPath, { recursive: true });
        if (cp.extra_data) {
          try {
            var filesObj = JSON.parse(cp.extra_data);
            for (var subRel in filesObj) {
              var subFull = path.join(fullPath, subRel);
              await fs.mkdir(path.dirname(subFull), { recursive: true });
              await fs.writeFile(subFull, filesObj[subRel] || '', 'utf-8');
            }
          } catch (_) {}
        }
      }
    } else {
      if (fileExistedBefore) {
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, cp.content || '', 'utf-8');
      } else {
        if (existsSync(fullPath)) {
          await fs.unlink(fullPath);
        }
      }
    }

    projectKnowledge.deleteCheckpoint(cp.id);

    return {
      success: true,
      message: 'Undid: ' + (cp.label || (isDir ? (fileExistedBefore ? 'Deleted: ' : 'Created: ') : 'Edit: ') + cp.file_path),
      restoredContent: cp.content,
      filePath: cp.file_path
    };
  }

  try {
    return await fileLockManager.withFileLock(fullPath, performLockedUndo);
  } catch (e) {
    return { success: false, message: 'Failed to undo: ' + e.message };
  }
}

// Undo the most recent checkpoint across any file (global undo).
export async function undoLast(workspace, sessionId) {
  var all = projectKnowledge.getRecentCheckpoints(sessionId, 1);
  if (!all || !all.length) {
    return { success: false, message: 'No checkpoints to undo' };
  }

  return await undoFile(all[0].file_path, workspace, sessionId);
}

// Get checkpoint count for a file.
export function getCheckpointCount(filePath, sessionId, workspace) {
  var relFilePath = normalizePathSlashes(filePath);
  if (workspace) {
    var canonicalWs = pathSecurity.getCanonicalWorkspace(workspace);
    if (canonicalWs && path.isAbsolute(filePath)) {
      relFilePath = normalizePathSlashes(path.relative(canonicalWs, filePath));
    }
  }
  var cps = projectKnowledge.getCheckpoints(relFilePath, sessionId);
  if ((!cps || !cps.length) && relFilePath !== filePath) {
    cps = projectKnowledge.getCheckpoints(filePath, sessionId);
  }
  if ((!cps || !cps.length) && path.basename(filePath)) {
    cps = projectKnowledge.getCheckpoints(path.basename(filePath), sessionId);
  }
  return cps ? cps.length : 0;
}

// Get recent checkpoint labels for prompt context.
export function getCheckpointContext(limit, sessionId) {
  limit = limit || 3;
  var all = projectKnowledge.getRecentCheckpoints(sessionId || null, limit);
  if (!all || !all.length) return '';

  var lines = ['## RECENT CHECKPOINTS'];
  for (var i = 0; i < all.length; i++) {
    var cp = all[i];
    var time = new Date(cp.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    lines.push('  [' + time + '] ' + (cp.label || cp.file_path));
  }
  return lines.join('\n');
}

// ========================================================
// INTERNAL
// ========================================================

function trimCheckpoints(sessionId) {
  var all = projectKnowledge.getRecentCheckpoints(sessionId || null, MAX_CHECKPOINTS + 10);
  if (all && all.length > MAX_CHECKPOINTS) {
    // Keep most recent MAX_CHECKPOINTS, delete older ones
    for (var i = MAX_CHECKPOINTS; i < all.length; i++) {
      projectKnowledge.deleteCheckpoint(all[i].id);
    }
  }
}
