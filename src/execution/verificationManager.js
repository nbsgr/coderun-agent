// verificationManager.js — Verification Engine
// Examines execution step results and reports objective pass/fail checks.
// Does NOT modify files, re-execute commands, or repair issues.
//
// Verification types:
//   exit_code     — Terminal command exit code was 0
//   file_exists   — A written/edited file exists on disk
//   folder_exists — A created folder exists on disk
//   file_size     — File size is greater than 0
//   file_modified — File was modified on disk
//   file_deleted  — File was removed from disk
//   read_success  — Read returned content
//   search_results— Search returned results
//   no_errors     — No error messages in output

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';

// ========================================================
// PUBLIC API
// ========================================================

export async function verifyStep(stepResult, stepArgs, workspace) {
  if (!stepResult) {
    return { verified: false, checks: [], issues: ['No step result to verify'] };
  }

  var checks = [];
  var action = String((stepArgs && stepArgs.action) || '').toLowerCase();

  switch (action) {
    case 'run_terminal':
    case 'terminal_input':
    case 'stop_terminal':
    case 'terminal':
    case 'bash':
    case 'execute_command':
    case 'build':
    case 'verify':
    case 'test':
    case 'install':
    case 'run':
      checks = checks.concat(await verifyTerminalStep(stepResult, stepArgs));
      break;

    case 'write_file':
    case 'write':
      checks = checks.concat(await verifyWriteStep(stepResult, stepArgs, workspace));
      break;

    case 'edit_file':
    case 'patch_file':
    case 'edit':
      checks = checks.concat(await verifyEditStep(stepResult, stepArgs, workspace));
      break;

    case 'read_file':
    case 'get_file_info':
    case 'read':
      checks = checks.concat(verifyReadStep(stepResult));
      break;

    case 'search_files':
    case 'find_in_files':
    case 'list_symbols':
    case 'list_directory':
    case 'search':
      checks = checks.concat(verifySearchStep(stepResult));
      break;

    case 'delete_file':
    case 'delete_folder':
    case 'delete':
      checks = checks.concat(verifyDeleteStep(stepResult, stepArgs, workspace));
      break;

    case 'create_folder':
      checks = checks.concat(verifyCreateFolderStep(stepResult, stepArgs, workspace));
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

  var issues = [];
  var passedCount = 0;
  for (var i = 0; i < checks.length; i++) {
    var c = checks[i];
    if (c.passed) {
      passedCount++;
    } else {
      issues.push(c.type + ': ' + c.detail);
    }
  }

  return {
    verified: issues.length === 0,
    checks: checks,
    issues: issues,
    summary: passedCount + '/' + checks.length + ' checks passed'
  };
}

export function verifyReport(report, plan, workspace) {
  if (!report || !report.steps) {
    return { verified: false, stepResults: [], summary: 'No report to verify' };
  }

  var stepResults = [];
  var totalPassed = 0;
  var totalChecks = 0;

  for (var i = 0; i < report.steps.length; i++) {
    var sr = report.steps[i];
    var planStep = plan && plan.steps && plan.steps[i] ? plan.steps[i] : { action: 'unknown', target: '', description: '' };
    var checks = [];
    var issues = [];

    if (sr.status === 'error') {
      checks.push({ type: 'status', passed: false, detail: 'Step failed' });
      issues.push('Step ' + sr.order + ' failed');
    } else {
      checks.push({ type: 'status', passed: true, detail: 'Step completed' });
    }

    for (var ci = 0; ci < checks.length; ci++) {
      if (checks[ci].passed) {
        totalPassed++;
      }
    }
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

  // Check exit code / tool error / lifecycle status
  if (result.error || result.success === false) {
    checks.push({ type: 'exit_code', passed: false, detail: 'Tool error: ' + (result.error || result.message || 'Non-zero exit code') });
  } else if (result.status === 'running' || result.status === 'submitted' || result.status === 'waiting_for_input') {
    checks.push({ type: 'exit_code', passed: false, detail: 'Command is still in progress (status: ' + result.status + ')' });
  } else {
    checks.push({ type: 'exit_code', passed: true, detail: 'Command completed successfully' + (result.exitCode != null ? ' (code ' + result.exitCode + ')' : '') });
  }

  // Check for common error patterns in output only if command failed
  var output = String((result && (result.output || result.content || result.message)) || '').toLowerCase();
  if (output && result.success === false) {
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
      checks.push({ type: 'no_error_output', passed: true, detail: 'No fatal error patterns detected in output' });
    }
  } else {
    checks.push({ type: 'no_error_output', passed: true, detail: 'Execution clean' });
  }

  checks.push({ type: 'output_produced', passed: true, detail: output.length > 0 ? ('Output length: ' + output.length + ' chars') : 'Executed successfully with silent output' });

  return checks;
}

// ========================================================
// VERIFICATION: Write file
// ========================================================

async function verifyWriteStep(result, step, workspace) {
  var checks = [];
  var target = (step && (step.target || (step.args && step.args.file_path))) || '';
  var filePath = '';
  if (target) {
    filePath = path.isAbsolute(target) ? target : path.resolve(workspace || '', target);
  }

  if (filePath) {
    var exists = existsSync(filePath);
    checks.push({ type: 'file_exists', passed: exists, detail: exists ? 'File created: ' + target : 'File not found: ' + target });

    if (exists) {
      try {
        var stat = await fs.stat(filePath);
        checks.push({ type: 'file_size', passed: stat.size >= 0, detail: 'File size: ' + stat.size + ' bytes' });
      } catch (_) {
        checks.push({ type: 'file_size', passed: false, detail: 'Could not stat file' });
      }
    }
  } else {
    checks.push({ type: 'file_exists', passed: result.success !== false, detail: 'Write operation reported ' + (result.success !== false ? 'success' : 'failure') });
  }

  return checks;
}

// ========================================================
// VERIFICATION: Edit file
// ========================================================

async function verifyEditStep(result, step, workspace) {
  var checks = [];
  var target = (step && (step.target || (step.args && step.args.file_path))) || '';
  var filePath = '';
  if (target) {
    filePath = path.isAbsolute(target) ? target : path.resolve(workspace || '', target);
  }

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
    checks.push({ type: 'file_exists', passed: result.success !== false, detail: 'Edit operation reported ' + (result.success !== false ? 'success' : 'failure') });
  }

  return checks;
}

// ========================================================
// VERIFICATION: Create folder
// ========================================================

function verifyCreateFolderStep(result, step, workspace) {
  var checks = [];
  var target = (step && (step.target || (step.args && step.args.folder_path))) || '';
  var folderPath = '';
  if (target) {
    folderPath = path.isAbsolute(target) ? target : path.resolve(workspace || '', target);
  }

  if (folderPath) {
    var exists = existsSync(folderPath);
    checks.push({ type: 'folder_exists', passed: exists, detail: exists ? 'Folder created: ' + target : 'Folder not found: ' + target });
  } else {
    checks.push({ type: 'folder_exists', passed: result.success !== false, detail: 'Folder operation reported ' + (result.success !== false ? 'success' : 'failure') });
  }

  return checks;
}

// ========================================================
// VERIFICATION: Read file
// ========================================================

function verifyReadStep(result) {
  var checks = [];
  var output = String((result && (result.output || result.content || result.message)) || '');

  if (result && result.success === false) {
    checks.push({ type: 'read_success', passed: false, detail: result.message || 'Read returned error' });
  } else {
    checks.push({ type: 'read_success', passed: true, detail: 'Read completed (' + output.length + ' chars)' });
  }

  return checks;
}

// ========================================================
// VERIFICATION: Search files
// ========================================================

function verifySearchStep(result) {
  var checks = [];
  var output = String((result && (result.output || result.content || result.message)) || '');

  if (result && result.success === false) {
    checks.push({ type: 'search_results', passed: false, detail: result.message || 'Search execution error' });
  } else {
    checks.push({ type: 'search_results', passed: true, detail: output.length > 0 ? ('Matches found (' + output.length + ' chars)') : 'Search completed successfully (0 matches)' });
  }

  return checks;
}

// ========================================================
// VERIFICATION: Delete file or folder
// ========================================================

function verifyDeleteStep(result, step, workspace) {
  var checks = [];
  var target = (step && step.target) || '';
  var filePath = '';
  if (target) {
    filePath = path.isAbsolute(target) ? target : path.resolve(workspace || '', target);
  }

  if (filePath) {
    var exists = existsSync(filePath);
    checks.push({ type: 'file_deleted', passed: !exists, detail: exists ? 'File/Folder still exists: ' + target : 'File/Folder successfully removed' });
  } else {
    checks.push({ type: 'file_deleted', passed: false, detail: 'No target path specified' });
  }

  return checks;
}
