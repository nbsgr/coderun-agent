// diffManager.js — Inline Diff Review Manager with Optimistic Concurrency Protection
// Stores pending patches from write_file/edit_file requests.
// Applies or rejects patches on user command from the chat UI.
// Verifies SHA-256 hash before applying to prevent silent overwrites of parallel edits.

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as pathSecurity from './pathSecurity.js';
import * as fileLockManager from './fileLockManager.js';

// ── Internal state ───────────────────────────────────────────
var _pendingPatches = {};    // { [diffId]: DiffPatch }

function computeHash(content) {
  return crypto.createHash('sha256').update(content || '', 'utf8').digest('hex');
}

// ========================================================
// PUBLIC API
// ========================================================

/**
 * Store a pending patch and return it.
 * Called from extension.js when a request_diff event arrives.
 */
export function storePatch(event) {
  var diffId = event.id;

  // Compute diff stats
  var originalText = event.original_content || '';
  var modifiedText = event.new_content || '';
  var stats = computeDiffStats(originalText, modifiedText);
  var originalHash = computeHash(originalText);

  var patch = {
    id: diffId,
    filePath: event.file_path || '',
    originalText: originalText,
    originalHash: originalHash,
    modifiedText: modifiedText,
    isNewFile: event.is_new_file || false,
    tool: event.tool || 'write_file',
    status: 'pending',
    additions: stats.additions,
    deletions: stats.deletions,
    createdAt: Date.now(),
    deferred: event.deferred || null,
    sessionId: event.sessionId || 'default'
  };

  _pendingPatches[diffId] = patch;

  return patch;
}

/**
 * Apply a pending patch — verifies optimistic concurrency hash and resolves promise.
 */
export async function applyPatch(diffId, workspace, sessionId) {
  var patch = _pendingPatches[diffId];
  if (!patch) {
    return { success: false, message: 'Patch not found: ' + diffId };
  }
  if (patch.status !== 'pending') {
    return { success: false, message: 'Patch already ' + patch.status };
  }

  // Session ownership check
  if (sessionId && patch.sessionId && patch.sessionId !== 'default' && patch.sessionId !== sessionId) {
    return { success: false, message: 'Unauthorized: patch belongs to another session (' + patch.sessionId + ')' };
  }

  // Canonical workspace safety validation
  var safeCheck = pathSecurity.resolveSafePath(patch.filePath, workspace);
  if (!safeCheck.safe) {
    patch.status = 'rejected';
    if (patch.deferred && patch.deferred.resolve) {
      patch.deferred.resolve({ accepted: false, error: safeCheck.error });
    }
    delete _pendingPatches[diffId];
    return { success: false, message: 'Security violation: ' + safeCheck.error };
  }

  var targetPath = safeCheck.canonicalPath;

  // Optimistic concurrency check: verify current disk content
  var currentDiskContent = '';
  if (fsSync.existsSync(targetPath)) {
    try {
      currentDiskContent = await fs.readFile(targetPath, 'utf8');
    } catch (err) {
      return { success: false, message: 'Failed to read current file: ' + err.message };
    }
  } else if (!patch.isNewFile) {
    patch.status = 'conflict';
    if (patch.deferred && patch.deferred.resolve) {
      patch.deferred.resolve({ accepted: false, conflict: true, message: 'File was deleted on disk before applying diff.' });
    }
    delete _pendingPatches[diffId];
    return { success: false, conflict: true, message: 'Conflict: ' + patch.filePath + ' was deleted on disk before applying diff.' };
  }

  var currentDiskHash = computeHash(currentDiskContent);
  if (currentDiskHash !== patch.originalHash) {
    patch.status = 'conflict';
    if (patch.deferred && patch.deferred.resolve) {
      patch.deferred.resolve({ accepted: false, conflict: true, message: 'File was modified on disk by another operation since diff was generated.' });
    }
    delete _pendingPatches[diffId];
    return {
      success: false,
      conflict: true,
      message: 'Conflict: ' + patch.filePath + ' has changed since this diff was created. Please review the newest file content.'
    };
  }

  patch.status = 'accepted';
  if (patch.deferred && patch.deferred.resolve) {
    patch.deferred.resolve({ accepted: true, originalHash: patch.originalHash, expectedContent: patch.originalText });
  }
  delete _pendingPatches[diffId];
  return { success: true, message: 'Applied: ' + patch.filePath };
}

export function rejectPatch(diffId, sessionId) {
  var patch = _pendingPatches[diffId];
  if (!patch) {
    return { success: false, message: 'Patch not found: ' + diffId };
  }
  if (sessionId && patch.sessionId && patch.sessionId !== 'default' && patch.sessionId !== sessionId) {
    return { success: false, message: 'Unauthorized: patch belongs to another session (' + patch.sessionId + ')' };
  }
  patch.status = 'rejected';
  if (patch.deferred && patch.deferred.resolve) {
    patch.deferred.resolve({ accepted: false });
  }
  delete _pendingPatches[diffId];
  return { success: true, message: 'Rejected: ' + patch.filePath };
}

export function getPatch(diffId, sessionId) {
  var patch = _pendingPatches[diffId] || null;
  if (patch && sessionId && patch.sessionId && patch.sessionId !== 'default' && patch.sessionId !== sessionId) {
    return null;
  }
  return patch;
}

export function getPendingPatches(sessionId) {
  var result = [];
  for (var id in _pendingPatches) {
    var p = _pendingPatches[id];
    if (p.status === 'pending') {
      if (!sessionId || p.sessionId === sessionId) {
        result.push(p);
      }
    }
  }
  return result;
}

export async function acceptAll(workspace, sessionId) {
  var patches = getPendingPatches(sessionId);
  var results = [];
  for (var i = 0; i < patches.length; i++) {
    var r = await applyPatch(patches[i].id, workspace, sessionId);
    r.diffId = patches[i].id;
    results.push(r);
  }
  return results;
}

export function rejectAll(sessionId) {
  var patches = getPendingPatches(sessionId);
  var results = [];
  for (var i = 0; i < patches.length; i++) {
    var r = rejectPatch(patches[i].id, sessionId);
    r.diffId = patches[i].id;
    results.push(r);
  }
  return results;
}

export function cancelSession(sessionId) {
  if (!sessionId) return;
  for (var id in _pendingPatches) {
    var patch = _pendingPatches[id];
    if (patch && patch.sessionId === sessionId) {
      if (patch.deferred && patch.deferred.resolve) {
        patch.deferred.resolve({ accepted: false });
      }
      delete _pendingPatches[id];
    }
  }
}

export function cancelAll() {
  for (var id in _pendingPatches) {
    var patch = _pendingPatches[id];
    if (patch && patch.deferred && patch.deferred.resolve) {
      patch.deferred.resolve({ accepted: false });
    }
  }
  _pendingPatches = {};
}

export async function openDiffEditor(diffId, workspace, sessionId) {
  var patch = _pendingPatches[diffId] || getPatch(diffId, sessionId);
  if (!patch) return;
  if (sessionId && patch.sessionId && patch.sessionId !== 'default' && patch.sessionId !== sessionId) {
    return;
  }

  try {
    var tmpDir = path.join(os.tmpdir(), 'coderun-diff');
    await fs.mkdir(tmpDir, { recursive: true });

    var originalName = patch.isNewFile ? '(new) ' + patch.filePath : patch.filePath;
    var originalUri = vscode.Uri.file(path.join(tmpDir, originalName.replace(/[\\/:*?"<>|]/g, '_') + '.original'));
    var proposedUri = vscode.Uri.file(path.join(tmpDir, patch.filePath.replace(/[\\/:*?"<>|]/g, '_') + '.proposed'));

    await fs.writeFile(originalUri.fsPath, patch.originalText, 'utf-8');
    await fs.writeFile(proposedUri.fsPath, patch.modifiedText, 'utf-8');

    var title = patch.isNewFile ? 'Create: ' + patch.filePath : 'Edit: ' + patch.filePath;
    await vscode.commands.executeCommand('vscode.diff', originalUri, proposedUri, title);
  } catch (err) {
    console.error('[CODERUN] Error opening diff editor:', err);
  }
}

// ========================================================
// INTERNAL
// ========================================================

function computeDiffStats(originalText, modifiedText) {
  var originalLines = originalText ? originalText.split('\n') : [];
  var modifiedLines = modifiedText ? modifiedText.split('\n') : [];

  // Simple line-based diff: count differing lines
  var additions = 0;
  var deletions = 0;
  var maxLen = Math.max(originalLines.length, modifiedLines.length);

  for (var i = 0; i < maxLen; i++) {
    var orig = originalLines[i] || '';
    var mod = modifiedLines[i] || '';
    if (orig !== mod) {
      if (!orig && mod) additions++;
      else if (orig && !mod) deletions++;
      else {
        additions++;
        deletions++;
      }
    }
  }

  return { additions: additions, deletions: deletions };
}
