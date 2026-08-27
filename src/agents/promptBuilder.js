// promptBuilder.js — Assembles the final prompt from all context pieces
// No concatenation inside agent.js — everything happens here.

import { SYSTEM_PROMPT } from './constants.js';

function formatMemoryItem(m) {
  return '- ' + m;
}

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
  // Shell/platform awareness for terminal command syntax
  var shellName = options.shellName || '';
  var platformName = options.platformName || '';
  if (shellName) {
    systemContent += '\nDetected Shell: ' + shellName;
    if (shellName.toLowerCase().includes('powershell') || shellName.toLowerCase().includes('pwsh')) {
      systemContent += '\nPOWERSHELL RULES:\n- DO NOT use `&&` to chain commands (it is invalid in Windows PowerShell and will fail with a ParserError).\n- To chain commands, use `;` (semicolon) instead, e.g. `cd folder; npm run dev`.\n- Make sure commands are compatible with PowerShell syntax.';
    } else if (shellName.toLowerCase().includes('cmd')) {
      systemContent += '\nCMD RULES: Use `cd dir && command` for sequential commands.';
    } else {
      systemContent += '\nUse `cd dir && command` for sequential commands.';
    }
  }
  if (platformName) {
    systemContent += '\nPlatform: ' + platformName;
  }

  systemContent += '\n\n## TERMINAL OUTPUT RULES:\n- The user sees the live terminal execution output directly in a dedicated console box.\n- DO NOT duplicate, repeat, or list the full command output in your text response. Summarize or explain the outcome briefly if needed, but do not print raw output blocks or listings (like folder contents or file outputs) that are already visible in the console.';

  systemContent += '\n\n## PLANNING AND PROGRESS TRACKING\n' +
    'You may use `create_plan` and `update_plan` when the user request genuinely benefits from structured tracking. ' +
    'Decide yourself whether planning is useful; do not create plans for simple answers or short single-step tasks.\n' +
    '\n' +
    '### Creating a plan:\n' +
    'Call `create_plan` with a `plan` string containing a bulleted checklist. Each task MUST start with ' +
    '\'- [ ]\' followed by a unique sequential numeric ID and description.\n' +
    'Example:\n' +
    '```\n' +
    '- [ ] 1 Analyze the project structure\n' +
    '- [ ] 2 Create the component files\n' +
    '- [ ] 3 Write unit tests\n' +
    '- [ ] 4 Update documentation\n' +
    '```\n' +
    '\n' +
    '### Updating a plan:\n' +
    'Call `update_plan` with the complete updated `plan` string. Change status boxes as you progress:\n' +
    '- `[ ]` = pending (not started)\n' +
    '- `[/]` = in progress (currently working on)\n' +
    '- `[x]` = completed (done)\n' +
    'You MUST include ALL tasks in the updated plan (not just the changed ones).\n' +
    'Example after completing task 1 and starting task 2:\n' +
    '```\n' +
    '- [x] 1 Analyze the project structure\n' +
    '- [/] 2 Create the component files\n' +
    '- [ ] 3 Write unit tests\n' +
    '- [ ] 4 Update documentation\n' +
    '```\n' +
    '\n' +
    '**Important:** After completing a tool call that fulfills a task, call `update_plan` immediately to mark progress. ' +
    'The current plan is automatically appended to tool results so you always see fresh progress.';
  if (skills.length) {
    systemContent += '\n\n## SKILLS\n' + skills.join('\n');
  }
  if (memory.length) {
    systemContent += '\n\n## MEMORY\n' + memory.map(formatMemoryItem).join('\n');
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

  // Workspace Intelligence (from Workspace Intelligence Engine)
  if (knowledge.workspaceIntelligence) {
    systemContent += '\n\n' + knowledge.workspaceIntelligence;
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

  // 2. Compact checkpoint (if present, inject summary and skip compacted messages)
  var compactCheckpoint = options.compactCheckpoint || null;
  var historyStartIndex = 0;

  if (compactCheckpoint && compactCheckpoint.content && compactCheckpoint.compactedUpTo >= 0) {
    messages.push({ role: 'user', content: compactCheckpoint.content });
    historyStartIndex = compactCheckpoint.compactedUpTo + 1;
  }

  // 3. History (skip system messages, start after checkpoint boundary)
  for (var i = historyStartIndex; i < history.length; i++) {
    var msg = history[i];
    if (msg.role === 'system') continue;
    var historyMsg = {
      role: msg.role,
      content: msg.content || '',
      model: msg.model || '',
      provider: msg.provider || ''
    };
    if (msg.tool_calls) historyMsg.tool_calls = msg.tool_calls;
    if (msg.tool_call_id) historyMsg.tool_call_id = msg.tool_call_id;
    if (msg.images) historyMsg.images = msg.images;
    if (msg.image && !historyMsg.images) historyMsg.images = [msg.image];
    messages.push(historyMsg);
  }

  // 4. Tool results (if any from previous iteration)
  for (var j = 0; j < toolResults.length; j++) {
    var tr = toolResults[j];
    messages.push({
      role: 'tool',
      tool_call_id: tr.tool_call_id,
      content: tr.formattedResult
    });
  }

  // 5. Current user prompt
  if (userPrompt) {
    var userMsg = { 
      role: 'user', 
      content: userPrompt,
      model: options.model || '',
      provider: options.provider || ''
    };
    var currentImages = options.images || [];
    if (currentImages && currentImages.length) {
      userMsg.images = currentImages;
    }
    messages.push(userMsg);
  }

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
    content += '\n\n## MEMORY\n' + memory.map(formatMemoryItem).join('\n');
  }
  if (mcpContext) {
    content += '\n\n## MCP CONTEXT\n' + mcpContext;
  }
  return { role: 'system', content: content };
}
