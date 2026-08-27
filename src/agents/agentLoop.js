// agentLoop.js — Core agent loop: Think → Plan → Act → Verify
// User Request → Prompt Builder → Provider → Model → Tool Calls? → Execute → Loop

import { MAX_ITERATIONS, EVENT_TYPES } from './constants.js';
import { buildMessages } from './promptBuilder.js';
import { createProvider } from '../providers/providerManager.js';
import { getDefinitions } from '../tools/toolDefinitions.js';
import * as toolRegistry from '../tools/toolRegistry.js';
import { formatToolResult, formatExecutionReport } from '../tools/toolExecutor.js';
import { requestPermission } from '../tools/permissions.js';
import * as projectKnowledge from '../context/projectKnowledge.js';
import * as contextManager from '../context/contextManager.js';
import * as planningManager from '../context/planningManager.js';
import * as verificationManager from '../execution/verificationManager.js';
import * as learningManager from '../context/learningManager.js';
import * as timelineManager from '../execution/timelineManager.js';
import * as checkpointManager from '../tools/checkpointManager.js';
import * as terminalManager from '../tools/terminalManager.js';
import * as events from './events.js';
import * as agentState from './agentState.js';
import * as runtime from './runtime.js';
import { exec } from 'child_process';
import * as observationEngine from '../execution/observationEngine.js';
import * as goalTracker from '../context/goalTracker.js';
import * as gitIntelligence from '../context/gitIntelligence.js';
import * as approvalSystem from '../tools/approvalSystem.js';
import * as recoveryEngine from '../execution/recoveryEngine.js';
import * as reviewEngine from '../execution/reviewEngine.js';
import * as workflowEngine from '../execution/workflowEngine.js';
import * as executionTrace from '../execution/executionTrace.js';
import * as multiAgentRuntime from '../execution/multiAgentRuntime.js';
import * as memoryManager from '../context/memoryManager.js';

var DEBUG = false;
function dbg() {
  if (DEBUG) {
    console.log.apply(console, arguments);
  }
}

var _pendingDiffs = {};

export function resolveDiff(id, accepted) {
  if (_pendingDiffs[id]) {
    _pendingDiffs[id]({ accepted: accepted });
    delete _pendingDiffs[id];
  }
}

function noop() {}

function emitAndForwardEvent(sendEventCallback, event) {
  events.emit('agent:' + (event.type || 'event'), event);
  sendEventCallback(event);
}

function forwardHistoryUpdate(messages, initialLength, sendEvent, sessionCtx, config) {
  try {
    var convMsgs = [];
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].role !== 'system') {
        var m = Object.assign({}, messages[i]);
        if (!m.model && config && config.model) m.model = config.model;
        if (!m.provider && config && config.provider) m.provider = config.provider;
        convMsgs.push(m);
      }
    }
    sendEvent({
      type: 'chat_history_update',
      messages: convMsgs,
      plan: sessionCtx.plan
    });
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }
}

function formatReviewIssueItem(iss) {
  return '- ' + iss;
}

function handleExecResult(resolve, error, stdout, stderr) {
  if (error) {
    resolve({ success: false, output: stderr || error.message });
  } else {
    resolve({ success: true, output: stdout });
  }
}

function executeRecoveryPromise(command, cwd, resolve) {
  var execOptions = { cwd: cwd, timeout: 15000, windowsHide: true };
  exec(command, execOptions, handleExecResult.bind(null, resolve));
}

function runRecoveryCommand(command, cwd) {
  return new Promise(executeRecoveryPromise.bind(null, command, cwd));
}

async function executeSingleToolCall(workspace, sessionId, iteration, sendEvent, askPermission, userPrompt, history, _pendingDiffs, sessionCtx, tc, index) {
  var toolName = tc.function?.name;
  var args = tc.function?.arguments || {};
  var tcId = tc.id || 'call_' + iteration + '_' + index;

  sendEvent({
    type: EVENT_TYPES.TOOL_CALL,
    tool: toolName,
    args: args,
    id: tcId,
    index: index
  });

  // Permission check
  var approved = true;
  if (approvalSystem.requiresApproval(toolName, args)) {
    try {
      if (agentState.getState() !== 'waiting') {
        var fromWait = agentState.getState();
        agentState.transition('waiting');
        executionTrace.recordTransition(fromWait, 'waiting');
        events.emit('state_changed', { state: 'waiting' });
      }
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }

    approved = await askPermission(toolName, args, tcId, sendEvent);
    memoryManager.recordUserDecision(toolName, args.command || args.file_path || args.folder_path || '', approved);
    executionTrace.recordDecision(toolName, approved ? 'allow' : 'deny', 'User prompted approval');

    try {
      var fromExec2 = agentState.getState();
      agentState.transition('executing');
      executionTrace.recordTransition(fromExec2, 'executing');
      events.emit('state_changed', { state: 'executing' });
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }
  }
  if (!approved) {
    sendEvent({ type: EVENT_TYPES.TOOL_RESULT, tool: toolName, success: false, message: 'Permission denied by user.', toolCallId: tcId });
    return {
      tool_name: toolName,
      tool_call_id: tcId,
      formattedResult: 'Permission denied by user.',
      result: {
        success: false,
        message: 'Permission denied by user.',
        error: 'Permission denied by user.'
      },
      checkpoints: []
    };
  }

  // Execute tool
  console.log('[AGENT LOOP] Running tool: ' + toolName);
  var lastResult = null;
  var startTime = Date.now();
  var checkpointsCreated = [];

  // Create checkpoint BEFORE file modifications (captures original content)
  try {
    if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'delete_file') {
      var cpFile = args.file_path || '';
      if (cpFile) {
        var cpLabel = (toolName === 'delete_file' ? 'Deleted' : (toolName === 'write_file' ? 'Created' : 'Edited')) + ': ' + cpFile;
        var cpId = await checkpointManager.createCheckpoint(cpFile, workspace, sessionId, cpLabel);
        if (cpId) {
          checkpointsCreated.push({ id: cpId, filePath: cpFile, label: cpLabel });
        }
      }
    }
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }

  // Track which diff IDs are created during this tool call
  var _createdDiffIds = [];
  try {
    dbg('[AGENT LOOP] Calling toolRegistry.execute for', toolName);
    var generator = toolRegistry.execute(toolName, args, workspace);
    dbg('[AGENT LOOP] toolRegistry.execute returned generator');
    var eventCount = 0;
    for await (var event of generator) {
      eventCount++;
      dbg('[AGENT LOOP] Generator event #' + eventCount + ' for', toolName, 'type:', event.type, 'success:', event.success);
      // Attach tool call ID so the webview can link this event to the correct tool card
      event.toolCallId = tcId;

      // Capture deferred resolve for diff review requests
      if (event.type === 'request_diff' && event.id && event.deferred) {
        _pendingDiffs[event.id] = event.deferred.resolve;
        _createdDiffIds.push(event.id);
      }
      sendEvent(event);
      if (event.type === 'tool_result') {
        lastResult = event;
      }
    }
  } catch (err) {
    console.log('[AGENT LOOP] Generator threw for', toolName, ':', err.message);
    sendEvent({ type: EVENT_TYPES.TOOL_RESULT, tool: toolName, success: false, message: err.message, toolCallId: tcId });
    lastResult = { success: false, message: err.message };
  } finally {
    dbg('[AGENT LOOP] Generator finally block for', toolName, 'eventCount:', eventCount, 'lastResult:', lastResult ? (lastResult.success !== false ? 'success' : 'fail') : 'null');
    // Clean up only the diffs created during THIS tool call
    for (var di = 0; di < _createdDiffIds.length; di++) {
      var diffId = _createdDiffIds[di];
      if (_pendingDiffs[diffId]) {
        _pendingDiffs[diffId]({ accepted: false });
        delete _pendingDiffs[diffId];
      }
    }
  }

  // Record tool usage for learning engine
  try {
    learningManager.recordToolUsage(toolName, args.command || args.file_path || args.folder_path || args.pattern || '');
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }

  // Record timeline event
  try {
    var tlSuccess = lastResult ? lastResult.success : undefined;
    var tlMsg = lastResult ? (lastResult.message || lastResult.error || '') : '';
    timelineManager.addToolEvent(toolName, args, tlSuccess, tlMsg);
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }

  if (lastResult) {
    // Verify tool result
    if (toolName === 'create_plan' && lastResult.plan) {
      try {
        sessionCtx.plan = lastResult.plan;
        sendEvent({ type: 'plan_created', plan: sessionCtx.plan });
      } catch (_) {
        // Intentionally ignored to allow safe execution fallback
      }
    } else if (toolName === 'update_plan' && lastResult.plan) {
      try {
        sessionCtx.plan = lastResult.plan;
        sendEvent({ type: 'plan_updated', plan: sessionCtx.plan });
      } catch (_) {
        // Intentionally ignored to allow safe execution fallback
      }
    }

    try {
      var stepArgs = { action: toolName, target: args.file_path || args.folder_path || args.command || args.pattern || '', description: '' };
      var stepResult = {
        order: iteration,
        action: toolName,
        status: lastResult.success !== false ? 'completed' : 'failed',
        duration: Date.now() - startTime,
        output: lastResult.message || lastResult.content || '',
        error: lastResult.success === false ? (lastResult.message || 'failed') : null
      };

      var verification = await verificationManager.verifyStep(stepResult, stepArgs, workspace);

      // Structured observation engine processing
      var obs = observationEngine.generateObservation(toolName, args, lastResult, Date.now() - startTime);
      executionTrace.recordObservation(obs);

      if (!verification.verified) {
        var recovery = await recoveryEngine.diagnoseAndRecover(toolName, verification.summary || 'Verification failed', {
          workspace: workspace,
          activeTaskId: sessionCtx.plan ? sessionCtx.plan.activeTaskId : ''
        });

        events.emit('ToolFailed', { tool: toolName, error: verification.summary, recovery: recovery.action });

        if (recovery.action === 'retry') {
          lastResult.message = (lastResult.message || '') + '\n[RECOVERY ENGINE] ' + recovery.message;
        } else if (recovery.action === 'fallback' && recovery.command) {
          console.log('[AGENT LOOP] Executing recovery fallback command: ' + recovery.command);
          try {
            var recoveryRes = await runRecoveryCommand(recovery.command, workspace);
            lastResult.message = (lastResult.message || '') + '\n[RECOVERY ENGINE] Executed fallback: ' + recovery.command + ' - ' + (recoveryRes.success ? 'success' : 'failed');
          } catch (e) {
            lastResult.message = (lastResult.message || '') + '\n[RECOVERY ENGINE] Fallback failed: ' + e.message;
          }
        }
      } else {
        events.emit('ToolCompleted', { tool: toolName, result: lastResult });
        memoryManager.recordTaskExecution(toolName, args, obs.summary);
        if (toolName === 'write_file') {
          memoryManager.recordFileCreated(args.file_path);
        } else if (toolName === 'edit_file') {
          memoryManager.recordFileModified(args.file_path);
        }
      }
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }
  }

  try {
    var toolDuration = Date.now() - startTime;
    var isToolSuccess = lastResult ? lastResult.success !== false : false;
    var toolResText = lastResult ? (lastResult.message || lastResult.content || (isToolSuccess ? 'Success' : 'Failed')) : 'Completed';
    var updatedToolTrace = executionTrace.recordToolCall(sessionId, iteration, {
      id: tcId,
      toolName: toolName,
      command: args.command || args.file_path || args.folder_path || args.pattern || '',
      input: args,
      output: toolResText,
      success: isToolSuccess,
      durationMs: toolDuration
    });
    if (updatedToolTrace) {
      sendEvent({ type: 'trace_updated', sessionId: sessionId, trace: updatedToolTrace });
    }
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }

  return {
    tool_name: toolName,
    tool_call_id: tcId,
    formattedResult: formatToolResult(toolName, lastResult),
    checkpoints: checkpointsCreated,
    result: lastResult
  };
}

export async function runAgentLoop(userPrompt, config, options) {
  var workspace = options.workspace || '';
  var history = options.history || [];

  var isContinuation = options.isContinuation || !userPrompt || userPrompt === 'Continue';
  var effectivePrompt = userPrompt || '';
  if (!effectivePrompt && history && history.length) {
    for (var hi = history.length - 1; hi >= 0; hi--) {
      if (history[hi].role === 'user' && history[hi].content) {
        effectivePrompt = history[hi].content;
        break;
      }
    }
  }
  if (!effectivePrompt) {
    try {
      effectivePrompt = runtime.getGoal() || 'Continue';
    } catch (_) {
      effectivePrompt = 'Continue';
    }
  }

  // Initialize Runtime execution context
  var sessionId = options.sessionId || (history.length > 0 ? String(history[0].session_id || '') : '') || ('session_' + Date.now());
  if (isContinuation) {
    if (!runtime.getGoal()) {
      runtime.setGoal(effectivePrompt);
    }
  } else {
    runtime.initSession(userPrompt, sessionId);
  }

  // Wrap sendEvent to also emit through the events.js bus.
  var _sendEventCallback = options.sendEvent || noop;
  var sendEvent = emitAndForwardEvent.bind(null, _sendEventCallback);
  var askPermission = options.askPermission || requestPermission;
  var signal = options.signal || null;
  var maxIterations = config.maxIterations || MAX_ITERATIONS;

  var provider = createProvider(config);

  // Gather context via ContextManager
  var contextResult = null;
  try {
    contextResult = await contextManager.gatherContext(effectivePrompt, workspace);
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }
  var knowledge = contextResult ? contextResult.knowledge : {};

  // Ensure knowledge has the minimum structure promptBuilder expects
  if (!knowledge.projectMetadata) {
    try {
      if (projectKnowledge.getStats().ready) {
        knowledge.projectMetadata = projectKnowledge.getProjectMetadata();
        var stats2 = projectKnowledge.getStats();
        knowledge.fileCount = stats2.tables && stats2.tables.files ? stats2.tables.files : 0;
        knowledge.fileContext = true;
      }
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }
    if (!knowledge.projectMemory) knowledge.projectMemory = '';
    if (!knowledge.dependencyGraph) knowledge.dependencyGraph = '';
    if (!knowledge.timeline) knowledge.timeline = '';
  }

  // Record session start in timeline
  try {
    var sessionLabel = String(effectivePrompt || '').substring(0, 60);
    timelineManager.addEvent('session:start', sessionLabel);
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }

  // ── Session Startup ──────────────────────────────────────────
  var activeTrace = null;
  try {
    events.emit('TaskStarted', { goal: effectivePrompt, sessionId: sessionId });
    var runContext = {
      images: options.images || [],
      workspaceFolder: workspace || '',
      openFiles: (knowledge && knowledge.openFiles) || []
    };
    activeTrace = executionTrace.startRun(sessionId, null, userPrompt || effectivePrompt, runContext, config.model, config.provider, isContinuation);
    sendEvent({ type: 'trace_updated', sessionId: sessionId, trace: activeTrace });
    if (!isContinuation) {
      goalTracker.initGoals(userPrompt);
      memoryManager.clear();
      memoryManager.setCurrentGoal(userPrompt);
    } else {
      if (!goalTracker.getActiveTask()) {
        goalTracker.initGoals(effectivePrompt);
      }
    }
  } catch (e) {
    console.error('[AGENT LOOP] Failed to initialize trace/goals:', e);
  }

  // Retrieve existing plan for this request session if any
  var currentPlan = null;
  try {
    var sessionPlans = planningManager.getSessionPlans(sessionId);
    if (sessionPlans && sessionPlans.length) {
      currentPlan = sessionPlans[sessionPlans.length - 1];
      if (currentPlan) runtime.setCurrentPlan(currentPlan);
      if (currentPlan && !knowledge.activePlans) {
        try {
          knowledge.activePlans = planningManager.getActivePlansContext();
        } catch (_) {
          // Intentionally ignored to allow safe execution fallback
        }
      }
    }
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }

  var messages = buildMessages(userPrompt, {
    workspace: workspace,
    history: history,
    compactCheckpoint: options.compactCheckpoint || null,
    knowledge: knowledge,
    images: options.images || [],
    model: config.model,
    provider: config.provider,
    shellName: terminalManager.getShellName(),
    platformName: terminalManager.getPlatformName()
  });

  var initialLength = messages.length;
  var sessionCtx = { plan: currentPlan };
  var sendHistoryUpdate = forwardHistoryUpdate.bind(null, messages, initialLength, sendEvent, sessionCtx, config);
  var baseStepOffset = (isContinuation && activeTrace && activeTrace.steps) ? activeTrace.steps.length : 0;

  var iteration = 0;
  var fullThinking = '';
  var fullContent = '';
  var sessionUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  try {
    while (iteration < maxIterations) {
      if (signal && signal.stopped) {
        console.log('[AGENT LOOP] Stop requested at iteration ' + iteration);
        agentState.transition('stopped');
        sendEvent({
          type: EVENT_TYPES.AGENT_DONE,
          reason: 'stopped',
          content: fullContent,
          thinking: fullThinking
        });
        return { content: fullContent, thinking: fullThinking, done: false, stopped: true };
      }

      iteration++;
      console.log('[AGENT LOOP] Iteration ' + iteration + '/' + maxIterations);

      var targetState = agentState.getState() === 'idle' ? 'thinking' : agentState.getState();

      try {
        if (agentState.getState() !== targetState) {
          var fromState = agentState.getState();
          agentState.transition(targetState);
          executionTrace.recordTransition(fromState, targetState);
        }
      } catch (_) {
        // Intentionally fallback to state reset if transition fails
        agentState.reset();
        agentState.transition(targetState);
      }

      events.emit('state_changed', { state: targetState });

      // Inject execution context
      try {
        var roleName = multiAgentRuntime.mapStateToRole(targetState, sessionCtx.plan ? sessionCtx.plan.activeTaskAction : '');
        var rolePrompt = multiAgentRuntime.getRolePrompt(roleName);
        var gitPrompt = await gitIntelligence.getGitPromptFragment(workspace);
        var memPrompt = memoryManager.getPromptFragment();
        var goalPrompt = goalTracker.getStatusReport();

        var activePlanCtx = planningManager.getActivePlansContext();
        if (messages && messages.length > 0 && messages[0].role === 'system') {
          messages[0].content = messages[0].content.split('\n\n## ACTIVE EXECUTION CONTEXT')[0] +
            '\n\n## ACTIVE EXECUTION CONTEXT\n' +
            rolePrompt + '\n\n' +
            (activePlanCtx ? activePlanCtx + '\n\n' : '') +
            goalPrompt + '\n\n' +
            gitPrompt + '\n\n' +
            memPrompt;
        }
      } catch (e) {
        console.error('[AGENT LOOP] Failed to update prompt context:', e);
      }

      sendEvent({ type: EVENT_TYPES.AGENT_STATUS, status: targetState, iteration: iteration });

      var streamBuffer = '';
      var inThinkTag = false;
      var iterationThinking = '';
      var iterationContent = '';
      var toolCalls = [];

      var iterationThinkingKey = null;

      // Stream from provider
      try {
        var stream = provider.chat(config, messages, getDefinitions());
        for await (var chunk of stream) {
          if (signal && signal.stopped) {
            break;
          }
          console.log('[AGENT LOOP] Iteration ' + iteration + '/' + maxIterations);
          dbg('[AGENT LOOP] AGENT RECEIVED =', JSON.stringify(chunk).substring(0, 500));
          // Handle usage stats
          if (chunk.usage) {
            if (chunk.usage.prompt_tokens) sessionUsage.prompt_tokens += chunk.usage.prompt_tokens;
            if (chunk.usage.completion_tokens) sessionUsage.completion_tokens += chunk.usage.completion_tokens;
            if (chunk.usage.total_tokens) sessionUsage.total_tokens += chunk.usage.total_tokens;
            sendEvent({
              type: 'usage',
              usage: chunk.usage,
              totalUsage: sessionUsage
            });
          }
          // Handle thinking tokens
          if (chunk.thinking) {
            if (chunk.thinkingKey && !iterationThinkingKey) {
              iterationThinkingKey = chunk.thinkingKey;
            }
            iterationThinking += chunk.thinking;
            fullThinking += chunk.thinking;
            sendEvent({ message: { role: 'assistant', thinking: chunk.thinking } });
          }
          // Handle content with inline think tags (DeepSeek style)
          if (chunk.content) {
            var parsed = processThinkTags(chunk.content, inThinkTag, streamBuffer);
            inThinkTag = parsed.inThinkTag;
            streamBuffer = parsed.buffer;
            if (parsed.thinking) {
              iterationThinking += parsed.thinking;
              fullThinking += parsed.thinking;
              sendEvent({ message: { role: 'assistant', thinking: parsed.thinking } });
            }
            if (parsed.content) {
              iterationContent += parsed.content;
              fullContent += parsed.content;
              dbg('[AGENT LOOP] sendEvent content:', parsed.content.substring(0, 100));
              sendEvent({ message: { role: 'assistant', content: parsed.content } });
            }
          }

          if (chunk.tool_calls && chunk.tool_calls.length) {
            for (var tc of chunk.tool_calls) {
              var tcIndex = (typeof tc.index === 'number') ? tc.index : toolCalls.length;
              if (!toolCalls[tcIndex]) {
                toolCalls[tcIndex] = {
                  index: tcIndex,
                  id: tc.id,
                  type: tc.type || 'function',
                  function: {
                    name: (tc.function && tc.function.name) || tc.name || '',
                    arguments: ''
                  }
                };
              }
              var slot = toolCalls[tcIndex];
              if (tc.id) slot.id = tc.id;
              if (tc.type) slot.type = tc.type;
              if (tc.function) {
                if (tc.function.name) slot.function.name = tc.function.name;
                if (typeof tc.function.arguments === 'string') {
                  slot.function.arguments += tc.function.arguments;
                } else if (tc.function.arguments != null) {
                  try {
                    slot.function.arguments += JSON.stringify(tc.function.arguments);
                  } catch (_) {
                    // Intentionally fall back to string description if serialization fails
                    slot.function.arguments += String(tc.function.arguments);
                  }
                }
              } else if (tc.name) {
                slot.function.name = slot.function.name || tc.name;
                if (typeof tc.arguments === 'string') {
                  slot.function.arguments += tc.arguments;
                } else if (tc.arguments != null) {
                  try {
                    slot.function.arguments += JSON.stringify(tc.arguments);
                  } catch (_) {
                    // Intentionally fall back to string description if serialization fails
                    slot.function.arguments += String(tc.arguments);
                  }
                }
              }
            }

            var streamingView = [];
            for (var svIndex = 0; svIndex < toolCalls.length; svIndex++) {
              var tElement = toolCalls[svIndex];
              if (tElement) {
                streamingView.push({
                  index: tElement.index,
                  id: tElement.id,
                  type: tElement.type,
                  function: { name: tElement.function.name, arguments: tElement.function.arguments }
                });
              }
            }
            sendEvent({ message: { role: 'assistant', tool_calls: streamingView } });
          }
        }
      } catch (err) {
        sendEvent({ type: EVENT_TYPES.AGENT_ERROR, message: err.message });
        throw err;
      }

      if (signal && signal.stopped) {
        console.log('[AGENT LOOP] Stop requested after/during stream');
        agentState.transition('stopped');
        sendEvent({
          type: EVENT_TYPES.AGENT_DONE,
          reason: 'stopped',
          content: fullContent,
          thinking: fullThinking
        });
        return { content: fullContent, thinking: fullThinking, done: false, stopped: true };
      }

      // Flush remaining buffer
      if (streamBuffer.length > 0) {
        if (inThinkTag) {
          iterationThinking += streamBuffer;
          fullThinking += streamBuffer;
          sendEvent({ message: { role: 'assistant', thinking: streamBuffer } });
        } else {
          iterationContent += streamBuffer;
          fullContent += streamBuffer;
          sendEvent({ message: { role: 'assistant', content: streamBuffer } });
        }
      }

      if (!iterationContent && !iterationThinking && toolCalls.length === 0 && (!signal || !signal.stopped)) {
        var emptyMsg = 'The model returned an empty response. It may have closed the connection prematurely or does not support tool calling.';
        sendEvent({ type: EVENT_TYPES.AGENT_ERROR, message: emptyMsg });
        throw new Error(emptyMsg);
      }

      var completedToolCalls = [];
      for (var tcIndex = 0; tcIndex < toolCalls.length; tcIndex++) {
        var t = toolCalls[tcIndex];
        if (!t) continue;

        var rawArgs = t.function && t.function.arguments;
        var parsedArgs = {};
        if (typeof rawArgs === 'string') {
          var trimmed = rawArgs.trim();
          if (trimmed.length > 0) {
            try {
              parsedArgs = JSON.parse(trimmed);
              if (parsedArgs == null || typeof parsedArgs !== 'object') {
                parsedArgs = {};
              }
            } catch (e) {
              console.error('[AGENT LOOP] Failed to parse tool args for', t.function && t.function.name, ':', e.message, 'raw:', trimmed);
              parsedArgs = {};
            }
          }
        } else if (rawArgs && typeof rawArgs === 'object') {
          parsedArgs = rawArgs;
        }

        completedToolCalls.push({
          id: t.id,
          type: t.type,
          function: {
            name: t.function && t.function.name,
            arguments: parsedArgs
          }
        });
      }

      try {
        var sysMsg = '';
        var toolResMsg = '';
        for (var mIdx = 0; mIdx < messages.length; mIdx++) {
          if (messages[mIdx].role === 'system') sysMsg = messages[mIdx].content;
          if (messages[mIdx].role === 'tool') toolResMsg += messages[mIdx].content + '\n';
        }

        var decisionList = [];
        for (var dt = 0; dt < completedToolCalls.length; dt++) {
          var dtName = completedToolCalls[dt].function && completedToolCalls[dt].function.name;
          if (dtName) decisionList.push('Call ' + dtName);
        }
        var decisionText = decisionList.length ? decisionList.join(', ') : (iterationContent ? 'Generate response' : 'Thinking');

        var traceStepIndex = baseStepOffset + iteration;
        var updatedLlmTrace = executionTrace.recordLLMCall(sessionId, traceStepIndex, {
          model: config.model,
          provider: config.provider,
          messages: {
            system: sysMsg ? 'System instructions (' + Math.round(sysMsg.length / 4) + ' tokens)' : '',
            user: userPrompt || effectivePrompt,
            toolResults: toolResMsg ? toolResMsg.trim() : null
          },
          thinking: iterationThinking || fullThinking,
          decision: decisionText,
          tokens: {
            input: sessionUsage.prompt_tokens || Math.round(JSON.stringify(messages).length / 4),
            output: sessionUsage.completion_tokens || Math.round(((iterationContent || '').length + (iterationThinking || '').length) / 4)
          },
          durationMs: 0
        });
        if (updatedLlmTrace) {
          sendEvent({ type: 'trace_updated', sessionId: sessionId, trace: updatedLlmTrace });
        }
      } catch (_) {
        // Intentionally ignored to allow safe execution fallback
      }

      if (completedToolCalls.length === 0) {
        // If the last message was a tool message, let's force the LLM to write a final concluding message!
        if (messages.length > 0 && messages[messages.length - 1].role === 'tool' && (!iterationContent || !iterationContent.trim())) {
          console.log('[AGENT LOOP] Forcing a concluding response from LLM...');
          try {
            var concludingMessages = messages.slice();
            concludingMessages.push({
              role: 'user',
              content: 'The verification tool execution is completed. Please write a brief concluding response to the user confirming the final outcome of the task.'
            });
            var stream = provider.chat(config, concludingMessages, getDefinitions());
            var concludingThinking = '';
            var concludingContent = '';
            for await (var chunk of stream) {
              if (chunk.content) {
                concludingContent += chunk.content;
                sendEvent({ message: { role: 'assistant', content: chunk.content } });
              }
              if (chunk.thinking) {
                concludingThinking += chunk.thinking;
              }
            }
            if (concludingContent.trim()) {
              iterationContent = concludingContent;
              fullContent += concludingContent;
              if (concludingThinking) {
                iterationThinking += concludingThinking;
                fullThinking += concludingThinking;
              }
            }
          } catch (e) {
            console.error('[AGENT LOOP] Failed to generate concluding response:', e);
          }
        }

        var hasReviewIssues = false;
        try {
          var fromReview = agentState.getState();
          agentState.transition('reviewing');
          executionTrace.recordTransition(fromReview, 'reviewing');
          events.emit('state_changed', { state: 'reviewing' });

          var modifiedFiles = memoryManager.getFilesModified();
          var reviewReport = await reviewEngine.reviewChanges(workspace, modifiedFiles);
          if (reviewReport && !reviewReport.passed) {
            sendEvent({ type: EVENT_TYPES.AGENT_STATUS, status: 'reviewing' });

            // Fixation protection & refinement check
            var limitExceeded = false;
            var failedFiles = [];
            for (var fi = 0; fi < reviewReport.issues.length; fi++) {
              var issue = reviewReport.issues[fi];
              var filePath = issue.split(':')[0].trim();
              sessionCtx.reviewCounts = sessionCtx.reviewCounts || {};
              sessionCtx.reviewCounts[filePath] = (sessionCtx.reviewCounts[filePath] || 0) + 1;
              if (sessionCtx.reviewCounts[filePath] > 2) {
                limitExceeded = true;
                failedFiles.push(filePath);
              }
            }

            if (!limitExceeded) {
              hasReviewIssues = true;
              console.log('[AGENT LOOP] Review failed. Injecting feedback and repeating iteration.');
              var feedbackMsg = {
                role: 'user',
                content: '## ⚠️ CODE REVIEW WARNING\nThe self-reflection check detected issues in your changes:\n' +
                         reviewReport.issues.map(formatReviewIssueItem).join('\n') +
                         '\n\nPlease address these issues (such as removing placeholders, resolving empty catch blocks, fixing syntax, or correcting credential leaks) in the next iteration.'
              };
              messages.push(feedbackMsg);
              sendHistoryUpdate();
            } else {
              console.warn('[AGENT LOOP] Fixation protection triggered for files: ' + failedFiles.join(', ') + '. Skipping further refinement.');
            }
          }
        } catch (_) {
          // Intentionally ignored to allow safe execution fallback
        }

        if (hasReviewIssues) {
          continue;
        }

        try {
          var fromDone = agentState.getState();
          agentState.transition('completed');
          executionTrace.recordTransition(fromDone, 'completed');
          events.emit('state_changed', { state: 'completed' });
        } catch (_) {
          // Intentionally fallback to state reset if transition to completed fails
          agentState.reset();
          agentState.transition('completed');
        }

        var assistantMsg = { role: 'assistant', content: iterationContent || '' };
        if (iterationThinking || fullThinking) {
          assistantMsg.thinking = iterationThinking || fullThinking;
        }
        messages.push(assistantMsg);
        sendHistoryUpdate();

        try {
          executionTrace.recordFinalResponse(sessionId, {
            text: fullContent,
            thinking: fullThinking,
            durationMs: 0
          });
          var finishedTrace = executionTrace.finishRun(sessionId, 'completed', {
            totalTokens: sessionUsage
          });
          executionTrace.saveTraceToDisk(null, sessionId);
          if (finishedTrace) {
            sendEvent({ type: 'trace_updated', sessionId: sessionId, trace: finishedTrace });
          }
        } catch (_) {
          // Intentionally ignored to allow safe execution fallback
        }

        var executionReportText = formatExecutionReport();
        sendEvent({
          type: EVENT_TYPES.AGENT_DONE,
          reason: 'completed',
          content: fullContent,
          thinking: fullThinking,
          report: executionReportText
        });
        return { content: fullContent, thinking: fullThinking, done: true, report: executionReportText };
      }

      try {
        if (agentState.getState() !== 'executing') {
          var fromExec = agentState.getState();
          agentState.transition('executing');
          executionTrace.recordTransition(fromExec, 'executing');
        }
      } catch (_) {
        // Intentionally fallback to state reset if transition to executing fails
        agentState.reset();
        agentState.transition('executing');
      }
      events.emit('state_changed', { state: 'executing' });
      sendEvent({ type: EVENT_TYPES.AGENT_STATUS, status: 'executing_tools', count: completedToolCalls.length });

      var traceStepIndex = baseStepOffset + iteration;
      var executeToolBound = executeSingleToolCall.bind(null, workspace, sessionId, traceStepIndex, sendEvent, askPermission, userPrompt || effectivePrompt, history, _pendingDiffs, sessionCtx);
      var toolPromises = completedToolCalls.map(executeToolBound);

      dbg('[AGENT LOOP] Promise.all(toolPromises) RESOLVED. Count:', toolPromises.length);
      var results = await Promise.all(toolPromises);
      dbg('[AGENT LOOP] All tool promises completed. Results:', results.length);

      var toolResults = [];
      var allCheckpoints = [];
      for (var ri = 0; ri < results.length; ri++) {
        toolResults.push({
          tool_name: results[ri].tool_name,
          tool_call_id: results[ri].tool_call_id,
          formattedResult: results[ri].formattedResult,
          result: results[ri].result
        });
        if (results[ri].checkpoints && results[ri].checkpoints.length) {
          allCheckpoints = allCheckpoints.concat(results[ri].checkpoints);
        }
      }

      if (allCheckpoints.length) {
        sendEvent({ type: 'checkpoints_created', checkpoints: allCheckpoints });
      }

      currentPlan = sessionCtx.plan;

      var isOllama = (config.provider === 'ollama');
      var assistantToolCalls = [];
      for (var atIndex = 0; atIndex < completedToolCalls.length; atIndex++) {
        var tObj = completedToolCalls[atIndex];
        var toolArgs = (tObj.function && tObj.function.arguments) || {};
        assistantToolCalls.push({
          id: tObj.id,
          type: tObj.type || 'function',
          function: {
            name: tObj.function && tObj.function.name,
            arguments: isOllama ? toolArgs : JSON.stringify(toolArgs)
          }
        });
      }

      var assistantMsg = { role: 'assistant', content: iterationContent || '' };
      if (iterationThinking) assistantMsg.thinking = iterationThinking;
      if (iterationThinkingKey) assistantMsg.thinkingKey = iterationThinkingKey;
      if (assistantToolCalls.length) assistantMsg.tool_calls = assistantToolCalls;
      messages.push(assistantMsg);
      sendHistoryUpdate();

      dbg('[AGENT LOOP] Messages updated. Total messages:', messages.length, 'Tool results count:', toolResults.length);
      var isOllama2 = (config.provider === 'ollama');
      for (var j = 0; j < toolResults.length; j++) {
        var toolMsg = {
          role: 'tool',
          tool_call_id: toolResults[j].tool_call_id,
          content: toolResults[j].formattedResult,
          tool_name: toolResults[j].tool_name,
          result: toolResults[j].result
        };
        if (isOllama2 && toolResults[j].tool_name) {
          toolMsg.tool_name = toolResults[j].tool_name;
        }
        messages.push(toolMsg);
      }

      if (currentPlan) {
        try {
          var lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.role === 'tool') {
            lastMsg.content = (lastMsg.content || '') + '\n\n[CURRENT PLAN]\n' + currentPlan;
          }
        } catch (_) {
          // Intentionally ignored to allow safe execution fallback
        }
      }

      sendHistoryUpdate();
      dbg('[AGENT LOOP] End of iteration', iteration, '- next iteration starting...');
    }
  } catch (err) {
    console.error('[AGENT LOOP] Error in loop:', err);
    try {
      var errText = err ? (err.message || String(err)) : 'Unknown error';
      executionTrace.recordFinalResponse(sessionId, {
        text: errText,
        thinking: fullThinking,
        error: errText,
        durationMs: 0
      });
      var failedTrace = executionTrace.finishRun(sessionId, 'failed', {
        error: errText,
        totalTokens: sessionUsage
      });
      executionTrace.saveTraceToDisk(null, sessionId);
      if (failedTrace) {
        sendEvent({ type: 'trace_updated', sessionId: sessionId, trace: failedTrace });
      }
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }
    throw err;
  } finally {
    console.log('[AGENT LOOP] While loop exited. finally block.');
    if (!agentState.isTerminal()) {
      agentState.transition('failed');
    }
    sendHistoryUpdate();
  }

  if (!agentState.isTerminal()) {
    agentState.transition('completed');
  }

  try {
    executionTrace.recordFinalResponse(sessionId, {
      text: fullContent,
      thinking: fullThinking,
      durationMs: 0
    });
    var maxTrace = executionTrace.finishRun(sessionId, 'max_iterations', {
      totalTokens: sessionUsage
    });
    executionTrace.saveTraceToDisk(null, sessionId);
    if (maxTrace) {
      sendEvent({ type: 'trace_updated', sessionId: sessionId, trace: maxTrace });
    }
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }

  sendEvent({
    type: EVENT_TYPES.AGENT_DONE,
    reason: 'max_iterations',
    content: fullContent + '\n\nMaximum agent iterations reached (' + maxIterations + '). The task may not be complete. Do you want me to continue?',
    thinking: fullThinking
  });
  return { content: fullContent, thinking: fullThinking, done: false, maxReached: true };
}

function processThinkTags(text, inThinkTag, buffer) {
  var contentPart = '';
  var thinkingPart = '';
  buffer += text;

  var OPEN_UNICODE = '\uE000';
  var CLOSE_UNICODE = '\uE001';
  var OPEN_HTML = '<think>';
  var CLOSE_HTML = '</think>';

  while (true) {
    if (!inThinkTag) {
      var uIdx = buffer.indexOf(OPEN_UNICODE);
      var hIdx = buffer.indexOf(OPEN_HTML);
      var startIdx = -1;
      var tagLen = 0;

      if (uIdx !== -1 && (hIdx === -1 || uIdx <= hIdx)) {
        startIdx = uIdx;
        tagLen = OPEN_UNICODE.length;
      } else if (hIdx !== -1) {
        startIdx = hIdx;
        tagLen = OPEN_HTML.length;
      }

      if (startIdx !== -1) {
        contentPart += buffer.substring(0, startIdx);
        inThinkTag = true;
        buffer = buffer.substring(startIdx + tagLen);
      } else {
        var partialLen = 0;
        for (var i = 1; i <= Math.min(buffer.length, 7); i++) {
          var tail = buffer.slice(-i);
          if (OPEN_HTML.startsWith(tail) || OPEN_UNICODE.startsWith(tail)) {
            partialLen = i;
            break;
          }
        }
        contentPart += buffer.substring(0, buffer.length - partialLen);
        buffer = buffer.substring(buffer.length - partialLen);
        break;
      }
    } else {
      var uEndIdx = buffer.indexOf(CLOSE_UNICODE);
      var hEndIdx = buffer.indexOf(CLOSE_HTML);
      var endIdx = -1;
      var closeLen = 0;

      if (uEndIdx !== -1 && (hEndIdx === -1 || uEndIdx <= hEndIdx)) {
        endIdx = uEndIdx;
        closeLen = CLOSE_UNICODE.length;
      } else if (hEndIdx !== -1) {
        endIdx = hEndIdx;
        closeLen = CLOSE_HTML.length;
      }

      if (endIdx !== -1) {
        thinkingPart += buffer.substring(0, endIdx);
        inThinkTag = false;
        buffer = buffer.substring(endIdx + closeLen);
      } else {
        var partialLen = 0;
        for (var i = 1; i <= Math.min(buffer.length, 8); i++) {
          var tail = buffer.slice(-i);
          if (CLOSE_HTML.startsWith(tail) || CLOSE_UNICODE.startsWith(tail)) {
            partialLen = i;
            break;
          }
        }
        thinkingPart += buffer.substring(0, buffer.length - partialLen);
        buffer = buffer.substring(buffer.length - partialLen);
        break;
      }
    }
  }

  return { content: contentPart, thinking: thinkingPart, inThinkTag: inThinkTag, buffer: buffer };
}
