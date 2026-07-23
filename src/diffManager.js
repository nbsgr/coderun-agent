// diffManager.js — Inline Diff Review Manager
// Stores pending patches from write_file/edit_file requests.
// Applies or rejects patches on user command from the chat UI.
// No temp files, no vscode.diff editor unless explicitly requested.

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// ── Internal state ───────────────────────────────────────────
var _pendingPatches = {};    // { [diffId]: DiffPatch }

/**
 * @typedef {Object} DiffPatch
 * @property {string} id
 * @property {string} filePath
 * @property {string} originalText
 * @property {string} modifiedText
 * @property {boolean} isNewFile
 * @property {string} tool - 'write_file' or 'edit_file'
 * @property {string} status - 'pending' | 'accepted' | 'rejected'
 * @property {number} additions - count of added lines
 * @property {number} deletions - count of removed lines
 * @property {number} createdAt
 * @property {object} deferred - resolve/reject functions
 */

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

  var patch = {
    id: diffId,
    filePath: event.file_path || '',
    originalText: originalText,
    modifiedText: modifiedText,
    isNewFile: event.is_new_file || false,
    tool: event.tool || 'write_file',
    status: 'pending',
    additions: stats.additions,
    deletions: stats.deletions,
    createdAt: Date.now()
  };

  _pendingPatches[diffId] = patch;

  return patch;
}

/**
 * Apply a pending patch — write the modified content to disk.
 */
export async function applyPatch(diffId, workspace) {
  var patch = _pendingPatches[diffId];
  if (!patch) {
    return { success: false, message: 'Patch not found: ' + diffId };
  }
  if (patch.status !== 'pending') {
    return { success: false, message: 'Patch already ' + patch.status };
  }

  // Just mark as accepted — tools.js actually writes the file
  // after the deferred promise resolves.
  patch.status = 'accepted';
  if (patch.deferred && patch.deferred.resolve) {
    patch.deferred.resolve({ accepted: true });
  }
  delete _pendingPatches[diffId];
  return { success: true, message: 'Applied: ' + patch.filePath };
}

/**
 * Reject a pending patch — discard without writing.
 */
export function rejectPatch(diffId) {
  var patch = _pendingPatches[diffId];
  if (!patch) {
    return { success: false, message: 'Patch not found: ' + diffId };
  }
  patch.status = 'rejected';
  if (patch.deferred && patch.deferred.resolve) {
    patch.deferred.resolve({ accepted: false });
  }
  delete _pendingPatches[diffId];
  return { success: true, message: 'Rejected: ' + patch.filePath };
}

/**
 * Get a patch by ID (for sending to webview).
 */
export function getPatch(diffId) {
  return _pendingPatches[diffId] || null;
}

/**
 * Get all pending patches for batch operations.
 */
export function getPendingPatches() {
  var result = [];
  for (var id in _pendingPatches) {
    if (_pendingPatches[id].status === 'pending') {
      result.push(_pendingPatches[id]);
    }
  }
  return result;
}

/**
 * Accept all pending patches.
 */
export async function acceptAll(workspace) {
  var patches = getPendingPatches();
  var results = [];
  for (var i = 0; i < patches.length; i++) {
    var r = await applyPatch(patches[i].id, workspace);
    r.diffId = patches[i].id;
    results.push(r);
  }
  return results;
}

/**
 * Reject all pending patches.
 */
export function rejectAll() {
  var patches = getPendingPatches();
  var results = [];
  for (var i = 0; i < patches.length; i++) {
    var r = rejectPatch(patches[i].id);
    r.diffId = patches[i].id;
    results.push(r);
  }
  return results;
}

/**
 * Cancel all pending patches (used when chat is stopped).
 */
export function cancelAll() {
  for (var id in _pendingPatches) {
    var patch = _pendingPatches[id];
    if (patch && patch.deferred && patch.deferred.resolve) {
      patch.deferred.resolve({ accepted: false });
    }
  }
  _pendingPatches = {};
}

/**
 * Open the VS Code diff editor for a specific patch (optional explicit action).
 */
export async function openDiffEditor(diffId, workspace) {
  var patch = _pendingPatches[diffId] || getPatch(diffId);
  if (!patch) return;

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
