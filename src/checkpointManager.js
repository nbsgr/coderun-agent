// checkpointManager.js — Checkpoints & Undo Engine
// Before every file write/edit, captures the original content into SQLite.
// Undo restores the original content from the most recent checkpoint.
// Integrates with existing toolExecutor.js (results) and tools.js (hooks).

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as projectKnowledge from './projectKnowledge.js';

var MAX_CHECKPOINTS = 100;

// ========================================================
// PUBLIC API
// ========================================================

/**
 * Create a checkpoint before modifying a file.
 * Captures the file's current content in SQLite.
 *
 * @param {string} filePath   - Relative workspace path
 * @param {string} workspace  - Absolute workspace root
 * @param {string} sessionId  - Chat session ID for grouping
 * @param {string} label      - Human-readable label (e.g. "Write: src/app.js")
 * @returns {Promise<string|null>} Checkpoint ID or null
 */
export async function createCheckpoint(filePath, workspace, sessionId, label) {
  if (!filePath || !workspace) return null;

  var fullPath = path.join(workspace, filePath);
  var content = '';

  // Read current file content (may not exist for new files)
  if (existsSync(fullPath)) {
    try {
      content = await fs.readFile(fullPath, 'utf-8');
    } catch (_) {
      content = '';
    }
  }

  var id = 'cp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  projectKnowledge.addCheckpoint({
    id: id,
    file_path: filePath,
    content: content,
    created_at: Date.now(),
    session_id: sessionId || 'session_unknown',
    label: label || 'Edit: ' + filePath
  });

  // Trim old checkpoints
  trimCheckpoints();

  return id;
}

/**
 * Undo the most recent checkpoint for a specific file.
 * Restores the file content from the checkpoint.
 *
 * @param {string} filePath   - Relative workspace path
 * @param {string} workspace  - Absolute workspace root
 * @param {string} sessionId  - Optional session filter
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function undoFile(filePath, workspace, sessionId) {
  if (!filePath || !workspace) {
    return { success: false, message: 'No file path or workspace specified' };
  }

  var checkpoints = projectKnowledge.getCheckpoints(filePath, sessionId);
  if (!checkpoints || !checkpoints.length) {
    return { success: false, message: 'No checkpoints found for: ' + filePath };
  }

  // Most recent checkpoint
  var cp = checkpoints[0];
  var fullPath = path.join(workspace, filePath);

  try {
    if (cp.content) {
      // Restore original content
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, cp.content, 'utf-8');
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
      message: 'Undid: ' + (cp.label || 'edit to ' + filePath),
      restoredContent: cp.content
    };
  } catch (e) {
    return { success: false, message: 'Failed to undo: ' + e.message };
  }
}

/**
 * Undo the most recent checkpoint across any file (global undo).
 */
export async function undoLast(workspace, sessionId) {
  var all = projectKnowledge.getRecentCheckpoints(sessionId, 1);
  if (!all || !all.length) {
    return { success: false, message: 'No checkpoints to undo' };
  }

  return await undoFile(all[0].file_path, workspace, sessionId);
}

/**
 * Get checkpoint count for a file.
 */
export function getCheckpointCount(filePath, sessionId) {
  var cps = projectKnowledge.getCheckpoints(filePath, sessionId);
  return cps ? cps.length : 0;
}

/**
 * Get recent checkpoint labels for prompt context.
 */
export function getCheckpointContext(limit) {
  limit = limit || 3;
  var all = projectKnowledge.getRecentCheckpoints(null, limit);
  if (!all || !all.length) return '';

  var lines = ['## RECENT CHECKPOINTS'];
  for (var i = 0; i < all.length; i++) {
    var cp = all[i];
    var time = new Date(cp.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    lines.push('  [' + time + '] ' + (cp.label || cp.file_path));
  }
  return lines.join('\n');
}

/**
 * Clear all checkpoints for a session.
 */
export function clearSession(sessionId) {
  projectKnowledge.deleteCheckpointsBySession(sessionId);
}

// ========================================================
// INTERNAL
// ========================================================

function trimCheckpoints() {
  // Count total checkpoints and trim oldest if over limit
  try {
    var stats = projectKnowledge.getCheckpointStats();
    if (stats && stats.total > MAX_CHECKPOINTS) {
      var excess = stats.total - MAX_CHECKPOINTS;
      projectKnowledge.trimOldestCheckpoints(excess);
    }
  } catch (_) {}
}
