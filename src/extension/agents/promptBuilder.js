// promptBuilder.js — Assembles the final prompt from all context pieces
// No concatenation inside agent.js — everything happens here.

import { SYSTEM_PROMPT } from './constants.js';
import { loadRules } from '../context/rulesLoader.js';
import { compactToolResult } from '../context/compactionManager.js';
import * as pathSecurity from '../tools/pathSecurity.js';

function formatMemoryItem(m) {
  return '- ' + m;
}

function isMutationTool(toolName) {
  var name = String(toolName || '').toLowerCase();
  return name === 'write_file' ||
    name === 'edit_file' ||
    name === 'patch_file' ||
    name === 'delete_file' ||
    name === 'create_folder' ||
    name === 'delete_folder' ||
    name === 'create_plan' ||
    name === 'update_plan';
}

function isToolResultFailed(toolMsg) {
  if (!toolMsg) return false;
  if (toolMsg.result && toolMsg.result.success === false) return true;
  if (toolMsg.result && toolMsg.result.exit_code !== undefined && toolMsg.result.exit_code !== null && toolMsg.result.exit_code !== 0) return true;
  if (toolMsg.error) return true;
  var content = String(toolMsg.content || '');
  if (content.indexOf('Success: false') !== -1) return true;
  if (content.indexOf('Command failed with exit code') !== -1) return true;
  if (content.indexOf('File not found:') !== -1) return true;
  if (content.indexOf('Execution error:') !== -1) return true;
  return false;
}

function optimizeHistoricalToolMessage(msg, toolCallMap) {
  if (!msg || msg.role !== 'tool') return msg;

  var callId = msg.tool_call_id || '';
  var callInfo = (callId && toolCallMap && toolCallMap[callId]) || {};
  var toolName = msg.tool_name || callInfo.name || '';
  if (!toolName && msg.content) {
    var toolMatch = String(msg.content).match(/^Tool:\s*(\S+)/);
    if (toolMatch) {
      toolName = toolMatch[1];
    }
  }

  // 1. If tool failed, preserve full output so LLM understands the error
  if (isToolResultFailed(msg)) {
    return msg;
  }

  // 2. If tool is a mutation tool (write, edit, patch), preserve full output
  if (isMutationTool(toolName)) {
    return msg;
  }

  // 3. For read, search, terminal, and inspection tools that succeeded:
  var mergedResult = Object.assign({}, callInfo.args || {}, msg.result || {});
  var syntheticMsg = {
    result: mergedResult,
    content: msg.content || ''
  };

  var compactedContent = compactToolResult(toolName, syntheticMsg);

  var optimized = Object.assign({}, msg);
  optimized.content = compactedContent;
  return optimized;
}

function sanitizeMessageSequence(messages) {
  if (!messages || !messages.length) return messages;

  var answeredToolCallIds = {};
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (m && m.role === 'tool' && m.tool_call_id) {
      answeredToolCallIds[m.tool_call_id] = true;
    }
  }

  var sanitized = [];
  for (var j = 0; j < messages.length; j++) {
    var msg = messages[j];
    if (!msg) continue;

    if (msg.role === 'assistant') {
      var cleanedMsg = Object.assign({}, msg);
      if (cleanedMsg.tool_calls && Array.isArray(cleanedMsg.tool_calls)) {
        var validToolCalls = [];
        for (var tci = 0; tci < cleanedMsg.tool_calls.length; tci++) {
          var tc = cleanedMsg.tool_calls[tci];
          if (tc && tc.id && answeredToolCallIds[tc.id]) {
            validToolCalls.push(tc);
          }
        }
        if (validToolCalls.length > 0) {
          cleanedMsg.tool_calls = validToolCalls;
        } else {
          delete cleanedMsg.tool_calls;
          if (!cleanedMsg.content || !String(cleanedMsg.content).trim()) {
            cleanedMsg.content = '(Request stopped before tool execution)';
          }
        }
      } else if (!cleanedMsg.content || !String(cleanedMsg.content).trim()) {
        cleanedMsg.content = '(No response)';
      }
      sanitized.push(cleanedMsg);
      continue;
    }

    if (msg.role === 'tool') {
      if (!msg.content || !String(msg.content).trim()) {
        var fixedTool = Object.assign({}, msg);
        fixedTool.content = '(empty tool output)';
        sanitized.push(fixedTool);
      } else {
        sanitized.push(msg);
      }
      continue;
    }

    if (msg.role === 'user') {
      if (!msg.content && (!msg.images || !msg.images.length)) {
        var fixedUser = Object.assign({}, msg);
        fixedUser.content = '(empty message)';
        sanitized.push(fixedUser);
      } else {
        sanitized.push(msg);
      }
      continue;
    }

    sanitized.push(msg);
  }

  return sanitized;
}

export async function buildMessages(userPrompt, options) {
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
  var canonicalSandbox = pathSecurity.getCanonicalSandboxRoot();
  if (canonicalSandbox) {
    systemContent += '\n\n## USER SANDBOX DIRECTORY\nThe dedicated user sandbox directory is: ' + canonicalSandbox;
    systemContent += '\nYou can safely use this folder for scratch work, experimentation, temporary files, or isolated scripts.';
    systemContent += '\n- To read, write, edit, or delete sandbox files, use relative alias `~/.coderun/sandbox/<file>` or `.coderun/sandbox/<file>`.';
    systemContent += '\n- In `run_terminal`, you can set cwd: \'~/.coderun/sandbox\' or run commands referencing sandbox files. The terminal automatically switches to the sandbox when running sandbox commands, and automatically switches back to the workspace root for workspace commands.';
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

  // Load and inject user rules
  var rulesContent = await loadRules(workspace);
  if (rulesContent) {
    systemContent += '\n\n## USER RULES\n' +
      'The following rules MUST be followed without exception. ' +
      'These are user-defined project conventions:\n\n' +
      rulesContent;
  }

  systemContent += '\n\n## TERMINAL & DEV SERVER RULES:\n' +
    '- The user sees the live terminal execution output directly in a dedicated console box.\n' +
    '- DO NOT duplicate, repeat, or list the full command output in your text response. Summarize or explain the outcome briefly if needed.\n' +
    '- For long-running servers, dev watchers, or persistent daemons (e.g. `npm run dev`, `vite`, `python -m http.server`, `flask run`), ALWAYS pass `background: true` in `run_terminal`. The system routes background commands to a dedicated visible terminal (`CodeRun Background`) in VS Code, detects the listening port/URL, and allows you to proceed immediately without hanging.';

  systemContent += '\n\n## CLARIFICATION AND USER QUESTIONS:\n' +
    'When a user request is underspecified, ambiguous, or involves architectural/framework decisions (e.g. "build a website", "setup auth", "choose a database"), DO NOT guess or hallucinate.\n' +
    'Call the `ask_question` tool with a concise question and 2-4 concrete options.\n' +
    'Each option should ideally have a `label` (title) and a brief `description` (details/context) explaining the option, e.g.:\n' +
    'options: [\n' +
    '  { "label": "Vanilla HTML/CSS/JS", "description": "No framework dependencies, runs directly in browser" },\n' +
    '  { "label": "React + Tailwind", "description": "Component-based architecture with utility CSS" }\n' +
    ']\n' +
    'The user will be presented with a modern card with selectable choices and descriptions in the UI, and their choice will be returned to you so you can execute accurately.';

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
    '### STRICT PLAN UPDATE RULES:\n' +
    '1. NEVER skip calling `update_plan` during a multi-step task.\n' +
    '2. When you start working on a task, call `update_plan` marking it as `[/]` (in progress).\n' +
    '3. As soon as you complete the action(s) for a task, call `update_plan` immediately to mark it `[x]` (completed) and mark the next task `[/]` before proceeding.\n' +
    '4. DO NOT batch all actions together and only update the plan at the end. The user monitors the live Todos checklist in real time as each step executes.';
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
  var toolCallMap = {};
  for (var hi = historyStartIndex; hi < history.length; hi++) {
    var hMsg = history[hi];
    if (hMsg && hMsg.tool_calls && Array.isArray(hMsg.tool_calls)) {
      for (var tci = 0; tci < hMsg.tool_calls.length; tci++) {
        var tc = hMsg.tool_calls[tci];
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
          toolCallMap[tc.id] = {
            name: tcName,
            args: tcArgs
          };
        }
      }
    }
  }

  for (var i = historyStartIndex; i < history.length; i++) {
    var msg = history[i];
    if (msg.role === 'system') continue;

    var targetMsg = msg;
    if (msg.role === 'tool') {
      targetMsg = optimizeHistoricalToolMessage(msg, toolCallMap);
    }

    var historyMsg = {
      role: targetMsg.role,
      content: targetMsg.content || '',
      model: targetMsg.model || '',
      provider: targetMsg.provider || ''
    };
    if (targetMsg.thinking) historyMsg.thinking = targetMsg.thinking;
    if (targetMsg.error) historyMsg.error = targetMsg.error;
    if (targetMsg.tool_calls) historyMsg.tool_calls = targetMsg.tool_calls;
    if (targetMsg.tool_call_id) historyMsg.tool_call_id = targetMsg.tool_call_id;
    if (targetMsg.images) historyMsg.images = targetMsg.images;
    if (targetMsg.image && !historyMsg.images) historyMsg.images = [targetMsg.image];
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

  return sanitizeMessageSequence(messages);
}

export async function buildSystemPromptOnly(workspace, skills, memory, mcpContext) {
  var content = SYSTEM_PROMPT;
  if (workspace) {
    content += '\n\n## CURRENT WORKSPACE\nThe active workspace directory is: ' + workspace;
    content += '\nYou are running inside this folder. Use relative paths (e.g., \'src/main.py\' or \'.\').';
  }
  var rulesContent = await loadRules(workspace);
  if (rulesContent) {
    content += '\n\n## USER RULES\n' +
      'The following rules MUST be followed without exception. ' +
      'These are user-defined project conventions:\n\n' +
      rulesContent;
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

function getSubagentSystemPrompt() {
  var prompt = SYSTEM_PROMPT;
  var subIdx = prompt.indexOf('## SUBAGENTS AND DELEGATION RULES');
  if (subIdx !== -1) {
    var nextSecIdx = prompt.indexOf('\n## ', subIdx + 10);
    if (nextSecIdx !== -1) {
      prompt = prompt.slice(0, subIdx) + prompt.slice(nextSecIdx + 1);
    } else {
      prompt = prompt.slice(0, subIdx);
    }
  }
  return prompt;
}

export async function buildSubagentMessages(task, subContext, workspace, agentIdentity) {
  var ident = agentIdentity || {};
  var content = getSubagentSystemPrompt();

  var wsStr = typeof workspace === 'string' ? workspace : (workspace && (workspace.fsPath || workspace.workspace || workspace.path || '')) || '';
  if (wsStr) {
    content += '\n\n## CURRENT WORKSPACE\nThe active workspace directory is: ' + wsStr;
    content += '\nYou are running inside this folder. Use relative paths (e.g., \'src/main.py\' or \'.\').';
  }

  var sandboxDir = (typeof pathSecurity.getCanonicalSandboxRoot === 'function') ? pathSecurity.getCanonicalSandboxRoot() : '';
  if (sandboxDir) {
    content += '\n\n## USER SANDBOX DIRECTORY\nThe dedicated user sandbox directory is: ' + sandboxDir;
  }

  var rulesContent = await loadRules(wsStr);
  if (rulesContent) {
    content += '\n\n## USER RULES\nThe following rules MUST be followed without exception:\n\n' + rulesContent;
  }

  content += '\n\n## SUBAGENT EXECUTION IDENTITY\n' +
    'You are a specialized subagent running as: ' + (ident.name || ident.role || 'Subagent') + ' (ID: ' + (ident.id || '') + ').\n' +
    'You were created and delegated this objective by the main agent.\n' +
    'Focus strictly and thoroughly on your assigned task. Once your objective is achieved, provide a comprehensive final response summarizing your findings and any modifications made.\n' +
    'You do not have access to subagent tools and cannot spawn or control other subagents. You have direct access to reading, writing, editing, searching, and terminal tools to complete your work.';

  var userContent = '## ASSIGNED TASK\n' + (task || '');
  if (subContext) {
    userContent += '\n\n## ADDITIONAL CONTEXT FROM MAIN AGENT\n' + subContext;
  }

  return [
    { role: 'system', content: content },
    { role: 'user', content: userContent }
  ];
}

export { optimizeHistoricalToolMessage };

