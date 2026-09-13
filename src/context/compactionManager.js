// compactionManager.js — Conversation compaction engine
// 100% local, deterministic compaction of conversation turns.
// No LLM API calls, no provider dependencies, executes instantly (0ms).

import { COMPACT_TURN_THRESHOLD } from '../agents/constants.js';

// Compact a single tool result into a one-liner status string
function compactToolResult(toolName, toolMsg) {
  var result = (toolMsg && toolMsg.result) || {};
  var content = (toolMsg && toolMsg.content) || '';
  var success = result.success !== undefined ? result.success : !content.toLowerCase().includes('success: false');

  var filePath = result.file_path || result.folder_path || '';
  if (!filePath && (toolName === 'list_directory' || toolName === 'create_folder' || toolName === 'delete_folder')) {
    filePath = result.path || (toolName === 'list_directory' ? '.' : '');
  }
  var statusWord = success ? 'successfully' : 'failed';

  switch (toolName) {
    case 'read_file':
      return (success ? '✅' : '❌') + " Read file '" + (filePath || 'file') + "' " + statusWord;

    case 'write_file':
      return (success ? '✅' : '❌') + " Wrote file '" + (filePath || 'file') + "' " + statusWord;

    case 'edit_file':
    case 'patch_file':
      return (success ? '✅' : '❌') + " Patched file '" + (filePath || 'file') + "' " + statusWord;

    case 'delete_file':
      return (success ? '✅' : '❌') + " Deleted file '" + (filePath || 'file') + "' " + statusWord;

    case 'create_folder':
      return (success ? '✅' : '❌') + " Created folder '" + (filePath || 'folder') + "' " + statusWord;

    case 'delete_folder':
      return (success ? '✅' : '❌') + " Deleted folder '" + (filePath || 'folder') + "' " + statusWord;

    case 'list_directory':
      return (success ? '✅' : '❌') + " Listed directory '" + (filePath || '.') + "' " + statusWord;

    case 'search_files':
      var pattern = result.pattern || result.glob_pattern || '';
      return (success ? '✅' : '❌') + " Searched files for '" + pattern + "' " + statusWord;

    case 'find_in_files':
      var query = result.query || '';
      return (success ? '✅' : '❌') + " Found matches for '" + query + "' " + statusWord;

    case 'list_symbols':
      return (success ? '✅' : '❌') + " Listed symbols in '" + (filePath || 'file') + "' " + statusWord;

    case 'get_file_info':
      return (success ? '✅' : '❌') + " Got file info for '" + (result.info ? result.info.file_path : (filePath || 'file')) + "' " + statusWord;

    case 'run_terminal':
    case 'bash':
    case 'execute_command':
      var command = result.command || '';
      var exitCode = result.exit_code !== undefined ? result.exit_code : result.exitCode;
      if (success) {
        return "✅ Command '" + (command || 'command') + "' executed successfully (exit code " + (exitCode !== undefined ? exitCode : 0) + ")";
      }
      var errorOutput = String(result.stderr || result.output || result.message || '');
      return "❌ Command '" + (command || 'command') + "' failed with exit code " + (exitCode !== undefined ? exitCode : '?') + ": " + errorOutput;

    case 'terminal_input':
      return (success ? '✅' : '❌') + ' Sent terminal input ' + statusWord;

    case 'stop_terminal':
      return (success ? '✅' : '❌') + ' Stopped terminal ' + statusWord;

    case 'create_plan':
      return (success ? '✅' : '❌') + ' Created plan successfully';

    case 'update_plan':
      return (success ? '✅' : '❌') + ' Updated plan executed successfully';

    case 'get_current_datetime':
      return '🕐 ' + (result.datetime || content || 'Checked date/time');

    case 'web_request':
      return success ? '✅ Fetched webpage content successfully' : '❌ Failed to fetch webpage content';

    case 'query_project_db':
      return (success ? '✅' : '❌') + ' Queried project database ' + statusWord;

    default:
      var actionTarget = filePath || result.command || result.query || result.pattern || '';
      var label = toolName ? toolName : (actionTarget ? actionTarget : 'action');
      return (success ? '✅' : '❌') + ' ' + label + (actionTarget && toolName ? " '" + actionTarget + "'" : '') + ' ' + statusWord;
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
  var assistantResponses = [];

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (msg.role !== 'assistant') continue;

    // Check reasoning_content / thinking keys
    var thinking = msg.reasoning_content || msg.thinking || msg.reasoning || '';
    if (thinking && String(thinking).trim()) {
      thinkingParts.push(String(thinking).trim());
    }

    var content = String(msg.content || '').trim();
    // Remove thinking tags if embedded in content
    var thinkTagStart = content.indexOf('<think>');
    var thinkTagEnd = content.indexOf('</think>');
    if (thinkTagStart !== -1 && thinkTagEnd !== -1 && thinkTagEnd > thinkTagStart) {
      var embeddedThink = content.substring(thinkTagStart + 7, thinkTagEnd).trim();
      if (embeddedThink && !thinking) {
        thinkingParts.push(embeddedThink);
      }
      content = (content.substring(0, thinkTagStart) + content.substring(thinkTagEnd + 8)).trim();
    }

    if (content) {
      // If a single turn's response is very long, truncate at a clean sentence or word boundary (never mid-word)
      if (content.length > 500) {
        var cleanCut = content.substring(0, 500);
        var lastPunct = Math.max(cleanCut.lastIndexOf('. '), cleanCut.lastIndexOf('.\n'), cleanCut.lastIndexOf('!\n'), cleanCut.lastIndexOf('? '));
        if (lastPunct > 250) {
          content = cleanCut.substring(0, lastPunct + 1);
        } else {
          var lastSpace = cleanCut.lastIndexOf(' ');
          if (lastSpace > 350) {
            cleanCut = cleanCut.substring(0, lastSpace);
          }
          content = cleanCut + '...';
        }
      }
      assistantResponses.push(content);
    }
  }

  var thinkingSummary = thinkingParts.length ? thinkingParts.join('\n---\n') : 'No thinking content recorded.';
  var responseSummary = assistantResponses.length ? assistantResponses.join('\n\n') : 'Completed requested actions.';

  return {
    thinkingSummary: thinkingSummary,
    responseSummary: responseSummary,
    assistantResponses: assistantResponses
  };
}

// Build map of tool calls from assistant messages to resolve tool names and args
function extractToolCallMap(messages) {
  var map = {};
  if (!Array.isArray(messages)) return map;
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (msg && msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (var k = 0; k < msg.tool_calls.length; k++) {
        var tc = msg.tool_calls[k];
        if (tc && tc.id) {
          var tcName = (tc.function && tc.function.name) || tc.name || '';
          var tcArgs = (tc.function && tc.function.arguments) || tc.arguments || {};
          if (typeof tcArgs === 'string') {
            try {
              tcArgs = JSON.parse(tcArgs);
            } catch (_) {
              tcArgs = {};
            }
          }
          map[tc.id] = {
            name: tcName,
            args: tcArgs
          };
        }
      }
    }
  }
  return map;
}

// Extract and compact all tool results
function extractToolLog(messages) {
  var log = [];
  var toolCallMap = extractToolCallMap(messages);

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (msg.role !== 'tool') continue;

    var contentStr = String(msg.content || '').trim();

    // If already compacted into a clean emoji status string, keep it directly!
    if (contentStr.startsWith('✅') || contentStr.startsWith('❌') || contentStr.startsWith('🕐')) {
      if (contentStr !== '✅ tool successfully' && contentStr !== '❌ tool failed') {
        log.push(contentStr);
        continue;
      }
    }

    var callId = msg.tool_call_id || '';
    var callInfo = (callId && toolCallMap[callId]) || {};
    var toolName = msg.tool_name || callInfo.name || '';

    if (!toolName && contentStr) {
      var toolMatch = contentStr.match(/Tool:\s*([a-zA-Z0-9_-]+)/i);
      if (toolMatch) {
        toolName = toolMatch[1];
      }
    }

    var callArgs = callInfo.args || {};
    var rawResult = msg.result || {};
    var mergedResult = Object.assign({}, callArgs, rawResult);

    if (!mergedResult.file_path && callArgs.file_path) {
      mergedResult.file_path = callArgs.file_path;
    }
    if (!mergedResult.folder_path && (callArgs.folder_path || callArgs.path)) {
      mergedResult.folder_path = callArgs.folder_path || callArgs.path;
    }
    if (!mergedResult.command && callArgs.command) {
      mergedResult.command = callArgs.command;
    }
    if (!mergedResult.pattern && (callArgs.glob_pattern || callArgs.pattern)) {
      mergedResult.pattern = callArgs.glob_pattern || callArgs.pattern;
    }
    if (!mergedResult.query && callArgs.query) {
      mergedResult.query = callArgs.query;
    }

    var syntheticMsg = {
      result: mergedResult,
      content: contentStr
    };

    log.push(compactToolResult(toolName, syntheticMsg));
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
  if (checkpoint.assistantResponses && checkpoint.assistantResponses.length) {
    for (var a = 0; a < checkpoint.assistantResponses.length; a++) {
      lines.push('- ' + checkpoint.assistantResponses[a]);
    }
  } else {
    lines.push('- ' + (checkpoint.responseSummary || checkpoint.assistantSummary || 'Completed requested actions.'));
  }
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
    assistantResponses: assistantData.assistantResponses || [],
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
