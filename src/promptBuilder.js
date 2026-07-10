// promptBuilder.js — Assembles the final prompt from all context pieces
// No concatenation inside agent.js — everything happens here.

import { SYSTEM_PROMPT } from './constants.js';

export function buildMessages(userPrompt, options) {
  options = options || {};
  var history = options.history || [];
  var workspace = options.workspace || '';
  var toolResults = options.toolResults || [];
  var skills = options.skills || [];
  var memory = options.memory || [];
  var mcpContext = options.mcpContext || '';

  var messages = [];

  // 1. System prompt
  var systemContent = SYSTEM_PROMPT;
  if (workspace) {
    systemContent += '\n\n## CURRENT WORKSPACE\nThe active workspace directory is: ' + workspace;
    systemContent += '\nYou are running inside this folder. Use relative paths (e.g., \'src/main.py\' or \'.\').';
  }
  if (skills.length) {
    systemContent += '\n\n## SKILLS\n' + skills.join('\n');
  }
  if (memory.length) {
    systemContent += '\n\n## MEMORY\n' + memory.map(function(m) { return '- ' + m; }).join('\n');
  }
  if (mcpContext) {
    systemContent += '\n\n## MCP CONTEXT\n' + mcpContext;
  }
  messages.push({ role: 'system', content: systemContent });

  // 2. History (skip system messages)
  for (var i = 0; i < history.length; i++) {
    var msg = history[i];
    if (msg.role === 'system') continue;
    var historyMsg = {
      role: msg.role,
      content: msg.content || ''
    };
    if (msg.thinking) {
      historyMsg.content = '\ue000' + msg.thinking + '\ue001\n' + historyMsg.content;
    }
    if (msg.tool_calls) historyMsg.tool_calls = msg.tool_calls;
    if (msg.tool_call_id) historyMsg.tool_call_id = msg.tool_call_id;
    messages.push(historyMsg);
  }

  // 3. Tool results (if any from previous iteration)
  for (var j = 0; j < toolResults.length; j++) {
    var tr = toolResults[j];
    messages.push({
      role: 'tool',
      tool_call_id: tr.tool_call_id,
      content: tr.formattedResult
    });
  }

  // 4. Current user prompt
  messages.push({ role: 'user', content: userPrompt });

  return messages;
}

export function buildSystemPromptOnly(workspace, skills, memory, mcpContext) {
  var content = SYSTEM_PROMPT;
  if (workspace) {
    content += '\n\n## CURRENT WORKSPACE\nThe active workspace directory is: ' + workspace;
    content += '\nYou are running inside this folder. Use relative paths (e.g., \'src/main.py\' or \'.\').';
  }
  if (skills && skills.length) {
    content += '\n\n## SKILLS\n' + skills.join('\n');
  }
  if (memory && memory.length) {
    content += '\n\n## MEMORY\n' + memory.map(function(m) { return '- ' + m; }).join('\n');
  }
  if (mcpContext) {
    content += '\n\n## MCP CONTEXT\n' + mcpContext;
  }
  return { role: 'system', content: content };
}