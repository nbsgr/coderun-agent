// compactionManager.js — Conversation compaction engine
// 100% local, deterministic compaction of conversation turns.
// No LLM API calls, no provider dependencies, executes instantly (0ms).

import { COMPACT_TURN_THRESHOLD } from '../agents/constants.js';

// Compact a single tool result into a one-liner status string
function compactToolResult(toolName, toolMsg) {
  var result = toolMsg.result || {};
  var content = toolMsg.content || '';
  var success = result.success !== undefined ? result.success : !content.toLowerCase().includes('success: false');

  var filePath = result.file_path || result.folder_path || '';
  var statusWord = success ? 'successfully' : 'failed';

  switch (toolName) {
    case 'read_file':
      return (success ? '✅' : '❌') + " Read file '" + filePath + "' " + statusWord;

    case 'write_file':
      return (success ? '✅' : '❌') + " Wrote file '" + filePath + "' " + statusWord;

    case 'edit_file':
    case 'patch_file':
      return (success ? '✅' : '❌') + " Patched file '" + filePath + "' " + statusWord;

    case 'delete_file':
      return (success ? '✅' : '❌') + " Deleted file '" + filePath + "' " + statusWord;

    case 'create_folder':
      return (success ? '✅' : '❌') + " Created folder '" + filePath + "' " + statusWord;

    case 'delete_folder':
      return (success ? '✅' : '❌') + " Deleted folder '" + filePath + "' " + statusWord;

    case 'list_directory':
      return (success ? '✅' : '❌') + " Listed directory '" + filePath + "' " + statusWord;

    case 'search_files':
      var pattern = result.pattern || '';
      return (success ? '✅' : '❌') + " Searched files for '" + pattern + "' " + statusWord;

    case 'find_in_files':
      var query = result.query || '';
      return (success ? '✅' : '❌') + " Found matches for '" + query + "' " + statusWord;

    case 'list_symbols':
      return (success ? '✅' : '❌') + " Listed symbols in '" + filePath + "' " + statusWord;

    case 'get_file_info':
      return (success ? '✅' : '❌') + " Got file info for '" + (result.info ? result.info.file_path : filePath) + "' " + statusWord;

    case 'run_terminal':
    case 'bash':
    case 'execute_command':
      var command = result.command || '';
      var exitCode = result.exit_code !== undefined ? result.exit_code : result.exitCode;
      if (success) {
        return "✅ Command '" + command + "' executed successfully (exit code " + (exitCode !== undefined ? exitCode : 0) + ")";
      }
      var errorOutput = String(result.stderr || result.output || result.message || '');
      return "❌ Command '" + command + "' failed with exit code " + (exitCode !== undefined ? exitCode : '?') + ": " + errorOutput;

    case 'terminal_input':
      return (success ? '✅' : '❌') + ' Sent terminal input ' + statusWord;

    case 'stop_terminal':
      return (success ? '✅' : '❌') + ' Stopped terminal ' + statusWord;

    case 'create_plan':
      return (success ? '✅' : '❌') + ' Created plan successfully';

    case 'update_plan':
      return (success ? '✅' : '❌') + ' Updated plan executed successfully';

    case 'get_current_datetime':
      return '🕐 ' + (result.datetime || content);

    case 'web_request':
      return success ? '✅ Fetched webpage content successfully' : '❌ Failed to fetch webpage content';

    case 'query_project_db':
      return (success ? '✅' : '❌') + ' Queried project database ' + statusWord;

    default:
      return (success ? '✅' : '❌') + ' ' + (toolName || 'tool') + ' ' + statusWord;
  }
}

// Extract user prompts from messages
function extractUserPrompts(messages) {
  var prompts = [];
  var promptIndex = 0;
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') {
      promptIndex++;
      var text = String(messages[i].content || '').trim();
      if (text.length > 200) {
        text = text.substring(0, 200) + '...';
      }
      prompts.push('Prompt ' + promptIndex + ': "' + text.replace(/\n/g, ' ') + '"');
    }
  }
  return prompts;
}

// Extract assistant thinking/reasoning and response tokens locally
function extractAssistantContent(messages) {
  var thinkingParts = [];
  var contentParts = [];

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (msg.role !== 'assistant') continue;

    // Check reasoning_content / thinking keys
    var thinking = msg.reasoning_content || msg.thinking || msg.reasoning || '';
    if (thinking && String(thinking).trim()) {
      thinkingParts.push(String(thinking).trim());
    }

    var content = msg.content || '';
    if (content && String(content).trim()) {
      contentParts.push(String(content).trim());
    }
  }

  var thinkingSummary = thinkingParts.length ? thinkingParts.join('\n---\n') : 'No thinking content recorded.';
  var responseSummary = contentParts.length ? contentParts.join(' ') : 'Completed requested actions.';

  // Shorten response summary to clean concise sentences if very long
  if (responseSummary.length > 300) {
    responseSummary = responseSummary.substring(0, 300) + '...';
  }

  return {
    thinkingSummary: thinkingSummary,
    responseSummary: responseSummary
  };
}

// Extract and compact all tool results
function extractToolLog(messages) {
  var log = [];
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (msg.role !== 'tool') continue;

    var toolName = msg.tool_name || '';
    if (!toolName && msg.content) {
      var toolMatch = String(msg.content).match(/^Tool:\s*(\S+)/);
      if (toolMatch) {
        toolName = toolMatch[1];
      }
    }
    log.push(compactToolResult(toolName, msg));
  }
  return log;
}

// Format checkpoint into markdown content string
function formatCheckpointContent(checkpoint) {
  var lines = [];
  lines.push('## COMPACTED CONTEXT CHECKPOINT (' + checkpoint.turnRange + ')');
  lines.push('');
  lines.push('### User Intent History');
  for (var i = 0; i < checkpoint.userPrompts.length; i++) {
    lines.push('- ' + checkpoint.userPrompts[i]);
  }
  lines.push('');
  lines.push('### Assistant Summary & Reasoning');
  lines.push('- ' + checkpoint.assistantSummary);
  lines.push('');
  lines.push('### Tool Executions Log');
  for (var j = 0; j < checkpoint.toolLog.length; j++) {
    lines.push('- ' + checkpoint.toolLog[j]);
  }
  return lines.join('\n');
}

// Count user turns in messages
function countUserTurns(messages) {
  var count = 0;
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') {
      count++;
    }
  }
  return count;
}

// Check if auto-compaction should trigger
function shouldAutoCompact(messages, checkpoint) {
  var totalTurns = countUserTurns(messages);
  var compactedTurns = 0;

  if (checkpoint && checkpoint.compactedUpTo >= 0) {
    for (var i = 0; i <= checkpoint.compactedUpTo && i < messages.length; i++) {
      if (messages[i].role === 'user') {
        compactedTurns++;
      }
    }
  }

  var uncompactedTurns = totalTurns - compactedTurns;
  return uncompactedTurns > COMPACT_TURN_THRESHOLD;
}

// Build compact checkpoint 100% locally from original messages (0ms)
function buildCompactCheckpoint(messages, checkpointNumber) {
  messages = messages || [];
  checkpointNumber = checkpointNumber || 1;

  var userPrompts = extractUserPrompts(messages);
  var assistantData = extractAssistantContent(messages);
  var toolLog = extractToolLog(messages);

  var firstTurn = 1;
  var lastTurn = countUserTurns(messages);
  var turnRange = 'Turns ' + firstTurn + ' - ' + (lastTurn || 1);

  var assistantSummary = assistantData.responseSummary || 'Completed conversation turns.';

  var checkpoint = {
    id: 'cp' + checkpointNumber,
    turnRange: turnRange,
    userPrompts: userPrompts,
    thinkingSummary: assistantData.thinkingSummary,
    responseSummary: assistantData.responseSummary,
    assistantSummary: assistantSummary,
    toolLog: toolLog,
    compactedUpTo: messages.length - 1,
    content: '',
    createdAt: Date.now()
  };

  checkpoint.content = formatCheckpointContent(checkpoint);
  return checkpoint;
}

export {
  compactToolResult,
  extractUserPrompts,
  extractAssistantContent,
  extractToolLog,
  formatCheckpointContent,
  shouldAutoCompact,
  buildCompactCheckpoint,
  countUserTurns
};
