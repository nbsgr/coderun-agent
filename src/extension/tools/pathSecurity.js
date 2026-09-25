// pathSecurity.js — Centralized Canonical Filesystem Path Security
// Validates paths for existing files and nonexistent child paths against workspace root and user sandbox root.
// Prevents directory traversal, symlink escapes, and unauthorized external mutations.

import fs from 'fs';
import path from 'path';
import os from 'os';

var customSandboxRoot = null;

export function normalizeSeparators(p) {
  return String(p || '').replace(/\\/g, '/');
}

function compareCanonicalPaths(childPath, parentPath) {
  var normChild = normalizeSeparators(childPath);
  var normParent = normalizeSeparators(parentPath);
  if (process.platform === 'win32') {
    normChild = normChild.toLowerCase();
    normParent = normParent.toLowerCase();
  }
  return normChild === normParent || normChild.startsWith(normParent + '/');
}

export function setCustomSandboxRoot(dir) {
  customSandboxRoot = dir ? path.resolve(String(dir)) : null;
}

export function getCanonicalSandboxRoot() {
  var target = customSandboxRoot || path.join(os.homedir(), '.coderun', 'sandbox');
  var resolved = path.resolve(target);
  try {
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    return fs.realpathSync(resolved);
  } catch (_) {
    return resolved;
  }
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

  var canonicalSandbox = getCanonicalSandboxRoot();

  // If path refers to user home via ~, expand it directly
  if (strTarget.startsWith('~/') || strTarget === '~' || strTarget.startsWith('~\\')) {
    strTarget = path.join(os.homedir(), strTarget.slice(1));
  }

  // If path specifically references .coderun/sandbox (e.g. '.coderun/sandbox/x' or '../.coderun/sandbox/x')
  var normTarget = normalizeSeparators(strTarget);
  var sandboxMatch = normTarget.match(/(?:^|[\/])\.coderun\/sandbox(?:\/(.*))?$/i);
  var resolvedTarget = '';

  if (sandboxMatch && canonicalSandbox) {
    var subPath = sandboxMatch[1] || '';
    resolvedTarget = path.resolve(canonicalSandbox, subPath);
  } else {
    // Standard resolution: absolute path as-is, relative resolved against workspace root
    resolvedTarget = path.isAbsolute(strTarget) ? path.resolve(strTarget) : path.resolve(canonicalWs, strTarget);
  }

  // 1. If target exists on disk, resolve its realpath directly
  if (fs.existsSync(resolvedTarget)) {
    try {
      var realTarget = fs.realpathSync(resolvedTarget);

      if (compareCanonicalPaths(realTarget, canonicalWs) || (canonicalSandbox && compareCanonicalPaths(realTarget, canonicalSandbox))) {
        return { safe: true, canonicalPath: realTarget };
      }
      return { safe: false, error: 'Path escapes workspace and sandbox via symlink or traversal: ' + realTarget };
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

    var isUnderWs = compareCanonicalPaths(realAncestor, canonicalWs);
    var isUnderSandbox = canonicalSandbox ? compareCanonicalPaths(realAncestor, canonicalSandbox) : false;

    if (!isUnderWs && !isUnderSandbox) {
      return { safe: false, error: 'Parent ancestor escapes workspace and sandbox via symlink: ' + realAncestor };
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
