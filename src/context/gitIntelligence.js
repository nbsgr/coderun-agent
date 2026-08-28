// gitIntelligence.js — Production-grade Git Intelligence Engine
// Queries background Git processes to gather repository intelligence and prevent accidental overwrites.

import { exec } from 'child_process';
import * as path from 'path';

function runGit(args, cwd) {
  function gitPromise(resolve) {
    function onExecDone(error, stdout, stderr) {
      if (error) {
        resolve({ success: false, stdout: '', stderr: stderr || error.message });
      } else {
        resolve({ success: true, stdout: stdout.trim(), stderr: '' });
      }
    }
    exec('git ' + args, { cwd: cwd, timeout: 5000, windowsHide: true }, onExecDone);
  }
  return new Promise(gitPromise);
}

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

// Get current Git branch name.
export async function getGitBranch(cwd) {
  var res = await runGit('rev-parse --abbrev-ref HEAD', cwd);
  return res.success ? res.stdout : 'detached';
}

// Get detailed repository status listing new, modified, and deleted files.
export async function getGitStatus(cwd) {
  var res = await runGit('status --porcelain', cwd);
  if (!res.success) {
    return { modified: [], new: [], deleted: [], dirty: false };
  }

  var modified = [];
  var added = [];
  var deleted = [];

  var lines = res.stdout.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var status = line.substring(0, 2);
    var file = line.substring(3).trim();

    if (status.includes('M')) {
      modified.push(file);
    } else if (status.includes('?') || status.includes('A')) {
      added.push(file);
    } else if (status.includes('D')) {
      deleted.push(file);
    }
  }

  return {
    modified: modified,
    new: added,
    deleted: deleted,
    dirty: (modified.length + added.length + deleted.length) > 0
  };
}

// Get git diff for the workspace or a specific file.
export async function getDiff(cwd, filePath) {
  var fileArg = filePath ? ' -- "' + filePath + '"' : '';
  var res = await runGit('diff' + fileArg, cwd);
  return res.success ? res.stdout : '';
}

// Check if the workspace has merge conflicts.
export async function checkMergeConflicts(cwd) {
  var res = await runGit('diff --name-only --diff-filter=U', cwd);
  if (res.success && res.stdout) {
    return true;
  }
  return false;
}

// Check if a specific file has uncommitted changes.
export async function isDirty(cwd, filePath) {
  var relPath = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath;
  var status = await getGitStatus(cwd);
  return status.modified.indexOf(relPath) !== -1 || status.deleted.indexOf(relPath) !== -1;
}

// Expose formatted Git context string for LLM prompt context injection.
export async function getGitPromptFragment(cwd) {
  try {
    var branch = await getGitBranch(cwd);
    var status = await getGitStatus(cwd);
    var conflicts = await checkMergeConflicts(cwd);

    var lines = ['### GIT REPOSITORY INTELLIGENCE'];
    lines.push('  - Branch: ' + branch);
    if (conflicts) {
      lines.push('  - [WARNING] Merge conflicts detected!');
    }
    if (status.dirty) {
      lines.push('  - Status: Dirty (Uncommitted changes exist)');
      if (status.modified.length) lines.push('    - Modified: ' + status.modified.slice(0, 5).join(', ') + (status.modified.length > 5 ? '...' : ''));
      if (status.new.length) lines.push('    - New: ' + status.new.slice(0, 5).join(', ') + (status.new.length > 5 ? '...' : ''));
      if (status.deleted.length) lines.push('    - Deleted: ' + status.deleted.slice(0, 5).join(', ') + (status.deleted.length > 5 ? '...' : ''));
    } else {
      lines.push('  - Status: Clean (No uncommitted changes)');
    }
    return lines.join('\n');
  } catch (_) {
    return '';
  }
}
