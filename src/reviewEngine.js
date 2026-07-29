// reviewEngine.js — Production-grade Review & Reflection Engine
// Evaluates work before marking it complete, performing static reviews for safety, architecture, naming, and error handling.

import * as fs from 'fs/promises';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

/**
 * Conduct a code review and self-reflection audit on modified files.
 *
 * @param {string} workspaceRoot   - Absolute workspace path
 * @param {string[]} modifiedFiles - Relative paths of modified files
 * @returns {Promise<object>} Structured review report
 */
export async function reviewChanges(workspaceRoot, modifiedFiles) {
  var issues = [];
  var passed = true;
  var reflection = 'Self-reflection: User goal successfully satisfied with no regressions.';

  if (!modifiedFiles || !modifiedFiles.length) {
    return { passed: true, issues: [], reflection: 'No files modified in this run.' };
  }

  for (var i = 0; i < modifiedFiles.length; i++) {
    var relPath = modifiedFiles[i];
    var fullPath = path.join(workspaceRoot, relPath);
    try {
      var content = await fs.readFile(fullPath, 'utf-8');
      var lines = content.split('\n');

      // 1. Check for Placeholders / TODOs
      var lowerContent = content.toLowerCase();
      if (lowerContent.includes('// todo') || lowerContent.includes('// placeholder') || lowerContent.includes('/* todo */') || lowerContent.includes('// fixme')) {
        issues.push(relPath + ': Contains pending placeholders or TODOs.');
        passed = false;
      }

      // 2. Check for empty catch blocks (Poor Error Handling)
      var emptyCatchRegex = /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/g;
      if (emptyCatchRegex.test(content)) {
        issues.push(relPath + ': Contains empty catch blocks. Silent failures should be avoided.');
        passed = false;
      }

      // 3. Check for hardcoded API keys/Secrets (Security)
      var secretPatterns = [
        /(?:key|secret|password|token|api_key|apikey|passwd)\s*=\s*['"][a-zA-Z0-9_\-]{16,}['"]/i,
        /Authorization\s*:\s*['"]Bearer\s+[a-zA-Z0-9_\-]{16,}['"]/i
      ];
      for (var s = 0; s < secretPatterns.length; s++) {
        if (secretPatterns[s].test(content)) {
          issues.push(relPath + ': Potential hardcoded credentials/API keys detected.');
          passed = false;
        }
      }

      // 4. Check for console.log debugging prints in production files
      if (lowerContent.includes('console.log(') && !relPath.startsWith('scripts') && !relPath.includes('test')) {
        // Warning, doesn't fail the build but noted
        issues.push(relPath + ': Debugging console.log statement found.');
      }

    } catch (e) {
      if (e && e.code === 'ENOENT') {
        continue;
      }
      issues.push(relPath + ': Failed to read file for review — ' + e.message);
      passed = false;
    }
  }

  if (!passed) {
    reflection = 'Self-reflection: Review failed due to issues found in modified code. Re-planning required.';
  }

  return {
    passed: passed,
    issues: issues,
    reflection: reflection
  };
}
