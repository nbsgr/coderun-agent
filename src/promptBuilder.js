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
  var knowledge = options.knowledge || {};  // projectKnowledge context

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

  // Inject project knowledge context if available
  if (knowledge.projectMetadata) {
    systemContent += '\n\n## PROJECT METADATA\n';
    systemContent += '- Project: ' + (knowledge.projectMetadata.name || 'unknown') + '\n';
    systemContent += '- Files: ' + (knowledge.projectMetadata.fileCount || 0) + '\n';
  }
  if (knowledge.projectMemory) {
    systemContent += '\n\n' + knowledge.projectMemory;
  }
  if (knowledge.dependencyGraph) {
    systemContent += '\n\n' + knowledge.dependencyGraph;
  }
  if (knowledge.timeline) {
    systemContent += '\n\n' + knowledge.timeline;
  }
  if (knowledge.fileContext) {
    systemContent += '\n\n## INDEXED FILE CONTEXT\nUse searchFiles(query) to find relevant files. The index contains ' +
      (knowledge.fileCount || 0) + ' files.';
  }

  // Editor context (from ContextManager)
  if (knowledge.editorContext) {
    systemContent += '\n\n' + knowledge.editorContext;
  }

  // Existing plans (from Planning Engine)
  if (knowledge.activePlans) {
    systemContent += '\n\n' + knowledge.activePlans;
  }

  // Project learning (from Learning Engine)
  if (knowledge.learningContext) {
    systemContent += '\n\n' + knowledge.learningContext;
  }

  // Checkpoint / undo context (from Checkpoint Engine)
  if (knowledge.checkpointContext) {
    systemContent += '\n\n' + knowledge.checkpointContext;
  }

  // Intent context (from ContextManager)
  if (knowledge.intentContext) {
    systemContent += '\n\n' + knowledge.intentContext;
  }

  // Suggested tools (from ContextManager)
  if (knowledge.suggestedTools) {
    systemContent += '\n\n' + knowledge.suggestedTools;
  }

  // Relevant files (from ContextManager)
  if (knowledge.relevantFiles && knowledge.relevantFiles.length) {
    systemContent += '\n\n## RELEVANT FILES\n';
    for (var rf = 0; rf < knowledge.relevantFiles.length; rf++) {
      systemContent += '- ' + knowledge.relevantFiles[rf] + '\n';
    }
    systemContent += '\nThese files may be relevant to the user\'s request. Read them if needed.';
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