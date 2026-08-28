// pathSecurity.js — Centralized Canonical Filesystem Path Security
// Validates paths for existing files and nonexistent child paths against workspace root.
// Prevents directory traversal, symlink escapes, and unauthorized external mutations.

import fs from 'fs';
import path from 'path';

function normalizeSeparators(p) {
  return String(p || '').replace(/\\/g, '/');
}

export function getCanonicalWorkspace(workspaceRoot) {
  if (!workspaceRoot) return '';
  var resolved = path.resolve(String(workspaceRoot));
  try {
    if (fs.existsSync(resolved)) {
      return fs.realpathSync(resolved);
    }
  } catch (_) {
    return '';
  }
  return resolved;
}

export function resolveSafePath(targetPath, workspaceRoot) {
  if (!targetPath) {
    return { safe: false, error: 'Target path is empty' };
  }
  if (!workspaceRoot) {
    return { safe: false, error: 'Workspace root is empty' };
  }

  var strTarget = String(targetPath).trim();
  var strWs = String(workspaceRoot).trim();

  // Strip file:// prefix if present
  if (strTarget.startsWith('file://')) {
    strTarget = strTarget.slice(7);
    if (/^\/[a-zA-Z]:/.test(strTarget)) {
      strTarget = strTarget.slice(1);
    }
  }

  var canonicalWs = getCanonicalWorkspace(strWs);
  if (!canonicalWs) {
    return { safe: false, error: 'Invalid workspace root' };
  }

  // Resolve target against workspace if relative
  var resolvedTarget = path.isAbsolute(strTarget) ? path.resolve(strTarget) : path.resolve(canonicalWs, strTarget);

  // 1. If target exists on disk, resolve its realpath directly
  if (fs.existsSync(resolvedTarget)) {
    try {
      var realTarget = fs.realpathSync(resolvedTarget);
      var normRealTarget = normalizeSeparators(realTarget);
      var normCanonicalWs = normalizeSeparators(canonicalWs);

      if (normRealTarget === normCanonicalWs || normRealTarget.startsWith(normCanonicalWs + '/')) {
        return { safe: true, canonicalPath: realTarget };
      }
      return { safe: false, error: 'Path escapes workspace via symlink or traversal: ' + realTarget };
    } catch (e) {
      return { safe: false, error: 'Failed to resolve realpath for target: ' + e.message };
    }
  }

  // 2. If target does NOT exist, traverse upwards to find the closest existing ancestor
  var current = path.dirname(resolvedTarget);
  var tailParts = [path.basename(resolvedTarget)];

  while (current && current !== path.dirname(current) && !fs.existsSync(current)) {
    tailParts.unshift(path.basename(current));
    current = path.dirname(current);
  }

  if (!fs.existsSync(current)) {
    return { safe: false, error: 'No valid existing ancestor found for path: ' + targetPath };
  }

  try {
    var realAncestor = fs.realpathSync(current);
    var normAncestor = normalizeSeparators(realAncestor);
    var normWs = normalizeSeparators(canonicalWs);

    if (normAncestor !== normWs && !normAncestor.startsWith(normWs + '/')) {
      return { safe: false, error: 'Parent ancestor escapes workspace via symlink: ' + realAncestor };
    }

    var reconstructed = path.join.apply(path, [realAncestor].concat(tailParts));
    return { safe: true, canonicalPath: reconstructed };
  } catch (e) {
    return { safe: false, error: 'Failed to verify ancestor realpath: ' + e.message };
  }
}

export function isSafePath(targetPath, workspaceRoot) {
  var res = resolveSafePath(targetPath, workspaceRoot);
  return res.safe === true;
}

export function assertSafePath(targetPath, workspaceRoot) {
  var res = resolveSafePath(targetPath, workspaceRoot);
  if (!res.safe) {
    throw new Error(res.error || ('Access denied: path outside workspace: ' + targetPath));
  }
  return res.canonicalPath;
}
