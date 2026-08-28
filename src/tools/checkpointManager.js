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
  var relFilePath = path.relative(canonicalWs, fullPath);
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

// Undo the most recent checkpoint for a specific file.
// Restores the file content from the checkpoint.
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
  var relFilePath = path.relative(canonicalWs, fullPath);

  var checkpoints = projectKnowledge.getCheckpoints(relFilePath, sessionId);
  if (!checkpoints || !checkpoints.length) {
    // Fallback: try raw filePath or fullPath
    checkpoints = projectKnowledge.getCheckpoints(filePath, sessionId) || projectKnowledge.getCheckpoints(fullPath, sessionId);
  }

  if (!checkpoints || !checkpoints.length) {
    return { success: false, message: 'No checkpoints found for: ' + filePath };
  }

  // Most recent checkpoint
  var cp = checkpoints[0];

  async function performLockedUndo() {
    var fileExistedBefore = cp.existed !== undefined ? (Number(cp.existed) === 1 || cp.existed === true) : !!cp.content;
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

    // Remove this checkpoint (consumed)
    projectKnowledge.deleteCheckpoint(cp.id);

    return {
      success: true,
      message: 'Undid: ' + (cp.label || 'edit to ' + relFilePath),
      restoredContent: cp.content
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
  var relFilePath = filePath;
  if (workspace) {
    var canonicalWs = pathSecurity.getCanonicalWorkspace(workspace);
    if (canonicalWs && path.isAbsolute(filePath)) {
      relFilePath = path.relative(canonicalWs, filePath);
    }
  }
  var cps = projectKnowledge.getCheckpoints(relFilePath, sessionId);
  if (!cps || !cps.length) {
    cps = projectKnowledge.getCheckpoints(filePath, sessionId);
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
