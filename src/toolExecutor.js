// toolExecutor.js — Formats tool results for LLM context

export function formatToolResult(toolName, result) {
  var res = result || {};
  var parts = ['Tool: ' + toolName];
  parts.push('Success: ' + (res.success !== false));

  if (res.content !== undefined) parts.push('Content:' + res.content);
  else if (res.output !== undefined) parts.push('Output:' + res.output);
  else if (res.message !== undefined) parts.push('Message: ' + res.message);
  else if (res.entries !== undefined) parts.push('Entries: ' + JSON.stringify(res.entries));
  else if (res.matches !== undefined) parts.push('Matches: ' + JSON.stringify(res.matches));
  else if (res.info !== undefined) parts.push('Info: ' + JSON.stringify(res.info));
  else if (res.datetime !== undefined) parts.push('Datetime: ' + res.datetime);
  else parts.push('Raw result: ' + JSON.stringify(res));

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