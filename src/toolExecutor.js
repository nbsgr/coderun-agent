// toolExecutor.js — Formats tool results for LLM context

export function formatToolResult(toolName, result) {
  var res = result || {};
  var parts = ['Tool: ' + toolName];
  parts.push('Success: ' + (res.success !== false));

  // Terminal-specific state: include status/interactive fields for the LLM
  if (res.status !== undefined && res.status !== 'completed' && res.status !== 'failed') {
    parts.push('Status: ' + res.status);
  }
  if (res.waiting_for_input === true || res.interactive === true) {
    parts.push('Interactive: ' + (res.interactive === true));
    parts.push('Waiting For Input: ' + (res.waiting_for_input === true));
    if (res.prompt_detected === true) parts.push('Prompt Detected: true');
  }

  if (res.content !== undefined) parts.push('Content:' + res.content);
  if (res.stdout !== undefined && res.stdout) parts.push('Stdout:\n' + res.stdout);
  if (res.output !== undefined) parts.push('Output:' + res.output);
  if (res.message !== undefined) parts.push('Message: ' + res.message);
  if (res.entries !== undefined) parts.push('Entries: ' + JSON.stringify(res.entries));
  if (res.matches !== undefined) parts.push('Matches: ' + JSON.stringify(res.matches));
  if (res.info !== undefined) parts.push('Info: ' + JSON.stringify(res.info));
  if (res.datetime !== undefined) parts.push('Datetime: ' + res.datetime);
  return parts.join('');
}

export function formatToolCallsForHistory(toolCalls) {
  return toolCalls.map(function(tc) {
    return {
      id: tc.id || tc.function?.name || 'call_' + Date.now(),
      type: 'function',
      function: {
        name: tc.function?.name || tc.name,
        arguments: tc.function?.arguments || tc.arguments || {}
      }
    };
  });
}

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