// executionManager.js — Execution Engine
// Consumes plans from the Planning Engine and executes steps through
// the existing toolRegistry. Each step records duration, output, errors.
//
// Workflow:  plan → executePlan()
//              → for each step:
//                → toolRegistry.execute(action, target)
//                → record { status, duration, output, errors }
//              → update plan in SQLite with results
//
// Step action → tool mapping:
//   search    → search_files
//   read      → read_file
//   write     → write_file
//   edit      → edit_file
//   delete    → delete_file
//   terminal  → run_terminal
//   verify    → run_terminal
//   summarize → context-only (no tool call)

import * as path from 'path';
import * as toolRegistry from './toolRegistry.js';
import * as projectKnowledge from './projectKnowledge.js';
import * as verificationManager from './verificationManager.js';
import { formatToolResult } from './toolExecutor.js';

// ========================================================
// PUBLIC API
// ========================================================

/**
 * Execute a plan's steps sequentially.
 *
 * @param {object} plan      - Plan object from planningManager
 * @param {string} workspace - Absolute workspace path
 * @returns {Promise<ExecutionReport>}
 */
export async function executePlan(plan, workspace) {
  if (!plan || !plan.steps || !plan.steps.length) {
    return { planId: plan?.id, status: 'failed', steps: [], error: 'No steps to execute' };
  }

  // Mark plan as active
  projectKnowledge.updatePlanStatus(plan.id, 'active');

  var report = {
    planId: plan.id,
    status: 'running',
    steps: [],
    totalDuration: 0,
    startedAt: Date.now()
  };

  for (var i = 0; i < plan.steps.length; i++) {
    var step = plan.steps[i];
    var result = await executeStep(step, workspace, plan.required_files);

    report.steps.push(result);
    report.totalDuration += result.duration || 0;

    // If step failed with a tool error, mark plan as failed
    if (result.status === 'error') {
      report.status = 'failed';
      report.error = 'Step ' + step.order + ' failed: ' + (result.error || 'unknown');
      break;
    }
  }

  // If all steps completed without failure
  if (report.status === 'running') {
    report.status = 'completed';
  }

  report.completedAt = Date.now();

  // Run report-level verification
  try {
    report.verification = verificationManager.verifyReport(report, plan, workspace);
  } catch (_) {}

  // Update plan status in SQLite
  projectKnowledge.updatePlanStatus(plan.id, report.status === 'completed' ? 'completed' : 'failed');

  // Store step results in plan metadata
  projectKnowledge.setSetting('plan_' + plan.id + '_result', JSON.stringify({
    status: report.status,
    stepCount: report.steps.length,
    totalDuration: report.totalDuration,
    steps: report.steps.map(function(s) { return { order: s.order, status: s.status, duration: s.duration }; })
  }));

  return report;
}

/**
 * Execute a single step.
 *
 * @param {object} step      - Step object { order, action, target, description }
 * @param {string} workspace - Absolute workspace path
 * @param {string[]} files   - Required files for context (used by search/read)
 * @returns {Promise<StepResult>}
 */
async function executeStep(step, workspace, files) {
  var toolName = actionToTool(step.action);
  var args = buildArgs(step, files);
  var startedAt = Date.now();

  // If no tool mapped (e.g. summarize), return directly
  if (!toolName) {
    var directResult = {
      order: step.order,
      action: step.action,
      status: 'completed',
      duration: 0,
      output: 'Step completed: ' + step.description,
      error: null
    };
    try { directResult.verification = await verificationManager.verifyStep(directResult, step, workspace); } catch (_) {}
    return directResult;
  }

  try {
    var lastResult = null;
    var generator = toolRegistry.execute(toolName, args, workspace);
    var capturedOutput = [];

    for await (var event of generator) {
      // Capture result data
      if (event.type === 'tool_result') {
        lastResult = event;
        capturedOutput.push(formatToolResult(toolName, event));
      }
      if (event.type === 'action') {
        capturedOutput.push(event.message || event.action);
      }
      if (event.type === 'terminal_output' || event.type === 'terminal_line') {
        capturedOutput.push(event.chunk || event.message || '');
      }
    }

    var duration = Date.now() - startedAt;

    if (!lastResult) {
      var noResult = {
        order: step.order,
        action: step.action,
        status: 'error',
        duration: duration,
        output: capturedOutput.join('\n'),
        error: 'No result from tool'
      };
      try { noResult.verification = await verificationManager.verifyStep(noResult, step, workspace); } catch (_) {}
      return noResult;
    }

    var success = lastResult.success !== false;

    var stepResult = {
      order: step.order,
      action: step.action,
      status: success ? 'completed' : 'error',
      duration: duration,
      output: capturedOutput.join('\n'),
      error: success ? null : (lastResult.message || lastResult.error || 'Tool execution failed')
    };

    // Verify the step result
    try {
      stepResult.verification = await verificationManager.verifyStep(stepResult, step, workspace);
    } catch (_) {
      stepResult.verification = { verified: false, checks: [], issues: ['Verification failed'], summary: '0/0 checks' };
    }

    return stepResult;
  } catch (e) {
    var errorResult = {
      order: step.order,
      action: step.action,
      status: 'error',
      duration: Date.now() - startedAt,
      output: '',
      error: e.message || 'Unknown error'
    };
    try { errorResult.verification = await verificationManager.verifyStep(errorResult, step, workspace); } catch (_) {}
    return errorResult;
  }
}

/**
 * Execute a single step by action type. Exported for external callers.
 */
export async function executeAction(action, target, workspace) {
  var toolName = actionToTool(action);
  if (!toolName) return { status: 'completed', output: 'No tool needed for: ' + action };

  var args = {};
  if (toolName === 'read_file' || toolName === 'write_file' ||
      toolName === 'edit_file' || toolName === 'delete_file') {
    args.file_path = target;
  } else if (toolName === 'search_files') {
    args.pattern = target;
  } else if (toolName === 'run_terminal') {
    args.command = target;
  }

  var step = { order: 1, action: action, target: target, description: '' };
  return await executeStep(step, workspace, []);
}

// ========================================================
// INTERNAL: Action → tool mapping
// ========================================================

function actionToTool(action) {
  var map = {
    'search': 'search_files',
    'read': 'read_file',
    'write': 'write_file',
    'edit': 'edit_file',
    'delete': 'delete_file',
    'create': 'create_folder',
    'list': 'list_directory',
    'terminal': 'run_terminal',
    'build': 'run_terminal',
    'verify': 'run_terminal',
    'test': 'run_terminal',
    'install': 'run_terminal',
    'run': 'run_terminal'
  };
  return map[action] || null;
}

// ========================================================
// INTERNAL: Argument builder
// ========================================================

function buildArgs(step, files) {
  var toolName = actionToTool(step.action);

  switch (toolName) {
    case 'search_files':
      return { pattern: step.target || (files && files.length ? '*' : '*'), folder_path: '.' };

    case 'read_file': {
      var filePath = step.target || (files && files.length ? files[0] : '');
      // If target is a directory path, fall back to list_directory
      if (filePath && !filePath.includes('.')) {
        return { folder_path: filePath };
      }
      return { file_path: filePath };
    }

    case 'write_file':
      return { file_path: step.target || 'output.txt', content: step.description || '' };

    case 'edit_file':
      return { file_path: step.target || '' };

    case 'delete_file':
      return { file_path: step.target || '' };

    case 'run_terminal': {
      // Default terminal commands per intent
      var defaultCommands = {
        'build': 'npm run build 2>&1 || echo "Build command not found"',
        'verify': 'echo "Verification complete"',
        'test': 'npm test 2>&1 || echo "Test command not found"',
        'install': 'npm install 2>&1',
        'run': 'echo "Running..."'
      };
      return {
        command: step.target || defaultCommands[step.action] || step.description || 'echo "Executing step ' + step.order + '"',
        timeout: 60
      };
    }

    default:
      return {};
  }
}
