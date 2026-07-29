// toolExecutor.js — Formats tool results for LLM context
// Re-exports from the unified toolRegistry.
// Kept for backward compatibility — agentLoop.js imports from here.
// formatExecutionReport is kept here as it's not in the registry.

export { formatResult as formatToolResult, formatToolCallsForHistory } from './toolRegistry.js';

/**
 * Format an execution report into a readable string for the LLM.
 */
export function formatExecutionReport(report) {
  if (!report) return 'No execution report.';

  var lines = ['## EXECUTION REPORT'];
  lines.push('Plan: ' + (report.planId || 'unknown'));
  lines.push('Status: ' + report.status);
  lines.push('Total duration: ' + report.totalDuration + 'ms');

  if (report.error) {
    lines.push('Error: ' + report.error);
  }

  if (report.steps && report.steps.length) {
    lines.push('');
    lines.push('Steps:');
    for (var i = 0; i < report.steps.length; i++) {
      var s = report.steps[i];
      var icon = s.status === 'completed' ? '✓' : s.status === 'error' ? '✗' : '→';
      lines.push('  ' + icon + ' Step ' + s.order + ' (' + s.action + '): ' + s.status + ' [' + s.duration + 'ms]');
      if (s.error) lines.push('    Error: ' + s.error);
    }
  }

  return lines.join('\n');
}