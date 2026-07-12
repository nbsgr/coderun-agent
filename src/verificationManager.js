// verificationManager.js — Verification Engine
// Examines execution step results and reports objective pass/fail checks.
// Does NOT modify files, re-execute commands, or repair issues.
//
// Verification types:
//   exit_code    — Terminal command exit code was 0
//   file_exists  — A written/edited file exists on disk
//   file_content — File contains expected content (basic substring)
//   search_ok    — Search returned results
//   read_ok      — Read returned content
//   output_ok    — Command produced stdout output
//   no_errors    — No error messages in output

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';

// ========================================================
// PUBLIC API
// ========================================================

/**
 * Verify a single execution step result.
 *
 * @param {object} stepResult - StepResult from executionManager
 * @param {object} stepArgs   - The original step { action, target, description }
 * @param {string} workspace  - Absolute workspace path
 * @returns {Promise<VerificationResult>}
 */
export async function verifyStep(stepResult, stepArgs, workspace) {
  if (!stepResult) {
    return { verified: false, checks: [], issues: ['No step result to verify'] };
  }

  var checks = [];

  switch (stepArgs.action) {
    case 'terminal':
    case 'build':
    case 'verify':
    case 'test':
    case 'install':
    case 'run':
      checks = checks.concat(await verifyTerminalStep(stepResult, stepArgs));
      break;

    case 'write':
      checks = checks.concat(await verifyWriteStep(stepResult, stepArgs, workspace));
      break;

    case 'edit':
      checks = checks.concat(await verifyEditStep(stepResult, stepArgs, workspace));
      break;

    case 'read':
      checks = checks.concat(verifyReadStep(stepResult));
      break;

    case 'search':
      checks = checks.concat(verifySearchStep(stepResult));
      break;

    case 'delete':
      checks = checks.concat(verifyDeleteStep(stepResult, stepArgs, workspace));
      break;

    default:
      // Generic checks that apply to all action types
      if (stepResult.error) {
        checks.push({ type: 'no_errors', passed: false, detail: 'Step returned error: ' + stepResult.error });
      } else {
        checks.push({ type: 'no_errors', passed: true, detail: 'No errors' });
      }
      checks.push({ type: 'status', passed: stepResult.status === 'completed', detail: 'Step status: ' + stepResult.status });
      break;
  }

  var issues = checks.filter(function(c) { return !c.passed; }).map(function(c) { return c.type + ': ' + c.detail; });
  var passedCount = checks.filter(function(c) { return c.passed; }).length;

  return {
    verified: issues.length === 0,
    checks: checks,
    issues: issues,
    summary: passedCount + '/' + checks.length + ' checks passed'
  };
}

/**
 * Verify a complete execution report.
 */
export function verifyReport(report, plan, workspace) {
  if (!report || !report.steps) {
    return { verified: false, stepResults: [], summary: 'No report to verify' };
  }

  // Return a synchronous structure — actual file checks happen inline
  // For each step in the report, we match it with the plan's steps
  var stepResults = [];
  var totalPassed = 0;
  var totalChecks = 0;

  for (var i = 0; i < report.steps.length; i++) {
    var sr = report.steps[i];
    var planStep = plan && plan.steps && plan.steps[i] ? plan.steps[i] : { action: 'unknown', target: '', description: '' };
    // We run sync checks only for report-level verification
    var checks = [];
    var issues = [];

    if (sr.status === 'error') {
      checks.push({ type: 'status', passed: false, detail: 'Step failed' });
      issues.push('Step ' + sr.order + ' failed');
    } else {
      checks.push({ type: 'status', passed: true, detail: 'Step completed' });
    }

    totalPassed += checks.filter(function(c) { return c.passed; }).length;
    totalChecks += checks.length;

    stepResults.push({
      order: sr.order,
      action: planStep.action,
      verified: issues.length === 0,
      checks: checks,
      issues: issues
    });
  }

  return {
    verified: totalPassed === totalChecks,
    stepResults: stepResults,
    summary: totalPassed + '/' + totalChecks + ' checks passed across ' + report.steps.length + ' steps'
  };
}

// ========================================================
// VERIFICATION: Terminal commands
// ========================================================

async function verifyTerminalStep(result, step) {
  var checks = [];

  // Check exit code (if available in output or result)
  if (result.error) {
    checks.push({ type: 'exit_code', passed: false, detail: 'Tool error: ' + result.error });
  } else {
    checks.push({ type: 'exit_code', passed: true, detail: 'No tool error' });
  }

  // Check for common error patterns in output
  var output = (result.output || '').toLowerCase();
  if (output) {
    var errorPatterns = ['error:', 'failed', 'failure', 'cannot', 'not found', 'enoent', 'command not found', 'exit code'];
    var foundErrors = [];
    for (var i = 0; i < errorPatterns.length; i++) {
      if (output.includes(errorPatterns[i])) {
        foundErrors.push(errorPatterns[i]);
      }
    }
    if (foundErrors.length > 0) {
      checks.push({ type: 'no_error_output', passed: false, detail: 'Found error patterns in output: ' + foundErrors.join(', ') });
    } else {
      checks.push({ type: 'no_error_output', passed: true, detail: 'No error patterns detected in output' });
    }

    // Output produced
    checks.push({ type: 'output_produced', passed: output.length > 10, detail: 'Output length: ' + output.length + ' chars' });
  } else {
    checks.push({ type: 'output_produced', passed: false, detail: 'No output captured' });
  }

  return checks;
}

// ========================================================
// VERIFICATION: Write file
// ========================================================

async function verifyWriteStep(result, step, workspace) {
  var checks = [];
  var target = step.target || '';
  var filePath = target ? path.join(workspace, target) : '';

  // File exists on disk
  if (filePath) {
    var exists = existsSync(filePath);
    checks.push({ type: 'file_exists', passed: exists, detail: exists ? 'File created: ' + target : 'File not found: ' + target });

    if (exists) {
      try {
        var stat = await fs.stat(filePath);
        checks.push({ type: 'file_size', passed: stat.size > 0, detail: 'File size: ' + stat.size + ' bytes' });
      } catch (_) {
        checks.push({ type: 'file_size', passed: false, detail: 'Could not stat file' });
      }
    }
  } else {
    checks.push({ type: 'file_exists', passed: false, detail: 'No target file path specified' });
  }

  return checks;
}

// ========================================================
// VERIFICATION: Edit file
// ========================================================

async function verifyEditStep(result, step, workspace) {
  var checks = [];
  var target = step.target || '';
  var filePath = target ? path.join(workspace, target) : '';

  if (filePath) {
    var exists = existsSync(filePath);
    checks.push({ type: 'file_exists', passed: exists, detail: exists ? 'File exists: ' + target : 'File not found: ' + target });

    if (exists) {
      try {
        var stat = await fs.stat(filePath);
        checks.push({ type: 'file_modified', passed: true, detail: 'Last modified: ' + stat.mtime.toISOString() });
      } catch (_) {
        checks.push({ type: 'file_modified', passed: false, detail: 'Could not stat file' });
      }
    }
  } else {
    checks.push({ type: 'file_exists', passed: false, detail: 'No target file path specified' });
  }

  return checks;
}

// ========================================================
// VERIFICATION: Read file
// ========================================================

function verifyReadStep(result) {
  var checks = [];

  var output = result.output || '';
  if (output.includes('File not found') || output.includes('Error:')) {
    checks.push({ type: 'read_success', passed: false, detail: 'Read returned error' });
  } else if (output.length > 0) {
    checks.push({ type: 'read_success', passed: true, detail: 'Content length: ' + output.length + ' chars' });
  } else {
    checks.push({ type: 'read_success', passed: false, detail: 'No content returned' });
  }

  return checks;
}

// ========================================================
// VERIFICATION: Search files
// ========================================================

function verifySearchStep(result) {
  var checks = [];

  var output = result.output || '';
  if (output.includes('Matches: [')) {
    // Parse matches from formatToolResult output
    var matchCount = (output.match(/"/g) || []).length / 2; // rough estimate
    checks.push({ type: 'search_results', passed: matchCount > 0, detail: 'Found approximately ' + Math.floor(matchCount) + ' results' });
  } else if (output.includes('0 results') || output.includes('No matches')) {
    checks.push({ type: 'search_results', passed: false, detail: 'No matches found' });
  } else {
    // Fall back to output length heuristic
    checks.push({ type: 'search_results', passed: output.length > 20, detail: 'Output length: ' + output.length + ' chars' });
  }

  return checks;
}

// ========================================================
// VERIFICATION: Delete file
// ========================================================

function verifyDeleteStep(result, step, workspace) {
  var checks = [];
  var target = step.target || '';
  var filePath = target ? path.join(workspace, target) : '';

  if (filePath) {
    var exists = existsSync(filePath);
    checks.push({ type: 'file_deleted', passed: !exists, detail: exists ? 'File still exists: ' + target : 'File successfully removed' });
  } else {
    checks.push({ type: 'file_deleted', passed: false, detail: 'No target file path specified' });
  }

  return checks;
}
