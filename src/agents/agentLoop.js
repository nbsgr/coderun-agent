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
import * as executionTrace from '../execution/executionTrace.js';
import * as multiAgentRuntime from '../execution/multiAgentRuntime.js';
import * as memoryManager from '../context/memoryManager.js';
import * as diffManager from '../tools/diffManager.js';

var DEBUG = false;
function dbg() {
  if (DEBUG) {
    console.log.apply(console, arguments);
  }
}

export async function resolveDiff(id, accepted, sessionId, workspace) {
  return await diffManager.resolveDiff(id, accepted, sessionId, workspace);
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

function robustParseToolArguments(rawArgs, toolName) {
  if (!rawArgs) return { argsList: [{}] };
  if (typeof rawArgs === 'object') return { argsList: [rawArgs] };

  var str = String(rawArgs).trim();
  if (!str) return { argsList: [{}] };

  // 1. Strip markdown code fences if present (e.g. ```json ... ```)
  if (str.startsWith('```json')) {
    str = str.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  } else if (str.startsWith('```')) {
    str = str.replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
  }

  // 2. Try direct standard JSON.parse
  try {
    var parsed = JSON.parse(str);
    if (parsed && typeof parsed === 'object') {
      return { argsList: [parsed] };
    }
    return { argsList: [{}] };
  } catch (err) {
    // 3. Scan and recover concatenated or trailing JSON objects
    var extractedList = [];
    var remaining = str;

    while (remaining.length > 0) {
      remaining = remaining.trim();
      if (!remaining.startsWith('{')) {
        var nextBrace = remaining.indexOf('{');
        if (nextBrace === -1) break;
        remaining = remaining.substring(nextBrace);
      }

      var parsedObj = null;
      var lastSuccessIdx = -1;
      var depth = 0;
      var inString = false;
      var escape = false;

      for (var i = 0; i < remaining.length; i++) {
        var ch = remaining[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) {
              var candidate = remaining.substring(0, i + 1);
              try {
                parsedObj = JSON.parse(candidate);
                lastSuccessIdx = i + 1;
                break;
              } catch (_) {}
            }
          }
        }
      }

      if (parsedObj && typeof parsedObj === 'object') {
        extractedList.push(parsedObj);
        remaining = remaining.substring(lastSuccessIdx);
      } else {
        break;
      }
    }

    if (extractedList.length > 0) {
      return { argsList: extractedList };
    }

    // 4. Return parse error if no JSON object could be extracted
    return { argsList: [{ _jsonParseError: err.message, _rawArgs: str }] };
  }
}

async function executeSingleToolCall(workspace, sessionId, iteration, sendEvent, askPermission, userPrompt, history, sessionCtx, tc, index) {
  var toolName = tc.function?.name;
  var args = tc.function?.arguments || {};
  var tcId = tc.id || 'call_' + iteration + '_' + index;

  args = args || {};
  args._sessionId = sessionId;

  if (args._jsonParseError) {
    var jsonErrText = 'Error: Malformed JSON arguments for tool "' + toolName + '": ' + args._jsonParseError + '. Please provide valid JSON parameters.';
    sendEvent({ type: EVENT_TYPES.TOOL_RESULT, tool: toolName, success: false, message: jsonErrText, toolCallId: tcId });
    return {
      tool_name: toolName,
      tool_call_id: tcId,
      formattedResult: jsonErrText,
      result: {
        success: false,
        error: jsonErrText,
        message: jsonErrText
      },
      checkpoints: []
    };
  }

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
      if (agentState.getState(sessionId) !== 'waiting') {
        var fromWait = agentState.getState(sessionId);
        agentState.transition('waiting', sessionId);
        executionTrace.recordTransition(sessionId, fromWait, 'waiting');
        events.emit('state_changed', { state: 'waiting', sessionId: sessionId });
      }
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }

    approved = await askPermission(toolName, args, tcId, sendEvent, sessionId);
    memoryManager.recordUserDecision(toolName, args.command || args.file_path || args.folder_path || '', approved, sessionId);
    executionTrace.recordDecision(sessionId, toolName, approved ? 'allow' : 'deny', 'User prompted approval');

    try {
      var fromExec2 = agentState.getState(sessionId);
      agentState.transition('executing', sessionId);
      executionTrace.recordTransition(sessionId, fromExec2, 'executing');
      events.emit('state_changed', { state: 'executing', sessionId: sessionId });
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

  // Track which diff IDs are created during this tool call
  var _createdDiffIds = [];
  try {
    dbg('[AGENT LOOP] Calling toolRegistry.execute for', toolName);
    var generator = toolRegistry.execute(toolName, args, { workspace: workspace, sessionId: sessionId });
    dbg('[AGENT LOOP] toolRegistry.execute returned generator');
    var eventCount = 0;
    for await (var event of generator) {
      eventCount++;
      dbg('[AGENT LOOP] Generator event #' + eventCount + ' for', toolName, 'type:', event.type, 'success:', event.success);
      // Attach tool call ID so the webview can link this event to the correct tool card
      event.toolCallId = tcId;
      if (!event.sessionId) {
        event.sessionId = sessionId;
      }

      // Capture deferred resolve for diff review requests in diffManager
      if (event.type === 'request_diff' && event.id) {
        event.sessionId = sessionId;
        diffManager.storePatch(event);
        _createdDiffIds.push(event.id);
      }

      if (event.type === 'tool_result' && event.checkpoint_id) {
        var targetPath = event.file_path || event.folder_path || args.file_path || args.folder_path || '';
        var actionLabel = '';
        if (toolName === 'create_folder') {
          actionLabel = 'Created: ' + targetPath;
        } else if (toolName === 'delete_folder') {
          actionLabel = 'Deleted: ' + targetPath;
        } else if (toolName === 'delete_file') {
          actionLabel = 'Deleted: ' + targetPath;
        } else if (toolName === 'write_file') {
          actionLabel = (event.is_new_file || !event.existed) ? ('Created: ' + targetPath) : ('Write: ' + targetPath);
        } else if (toolName === 'edit_file') {
          actionLabel = 'Edit: ' + targetPath;
        } else if (toolName === 'patch_file') {
          actionLabel = 'Patches: ' + targetPath;
        } else {
          actionLabel = 'Edit: ' + targetPath;
        }

        var cpObj = {
          id: event.checkpoint_id,
          filePath: targetPath,
          toolCallId: tcId,
          isDir: event.is_directory || toolName === 'create_folder' || toolName === 'delete_folder',
          label: actionLabel
        };
        checkpointsCreated.push(cpObj);
        // User Directive: Emit checkpoints_created immediately so UI displays Undo buttons in real time!
        sendEvent({ type: 'checkpoints_created', checkpoints: [cpObj] });
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
      diffManager.rejectPatch(diffId, sessionId);
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
    timelineManager.addToolEvent(toolName, args, tlSuccess, tlMsg, sessionId);
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
      var stepArgs = { action: toolName, target: args.file_path || args.folder_path || args.command || args.pattern || args.query || args.url || '', description: '' };
      var stepResult = {
        order: iteration,
        action: toolName,
        status: lastResult.success !== false ? 'completed' : 'failed',
        duration: Date.now() - startTime,
        output: lastResult.content || lastResult.message || (lastResult.results ? JSON.stringify(lastResult.results) : '') || '',
        error: lastResult.success === false ? (lastResult.message || lastResult.error || 'failed') : null
      };

      var verification = await verificationManager.verifyStep(stepResult, stepArgs, workspace);

      // Structured observation engine processing
      var obs = observationEngine.generateObservation(toolName, args, lastResult, Date.now() - startTime, sessionId);
      executionTrace.recordObservation(sessionId, obs);

      if (!verification.verified) {
        var actualErrorMsg = (verification.issues && verification.issues.length ? verification.issues.join('; ') : '') || (lastResult && (lastResult.error || lastResult.message)) || verification.summary || 'Verification failed';
        var recovery = await recoveryEngine.diagnoseAndRecover(toolName, actualErrorMsg, {
          workspace: workspace,
          command: args.command || '',
          file_path: args.file_path || '',
          sessionId: sessionId,
          activeTaskId: sessionCtx.plan ? sessionCtx.plan.activeTaskId : ''
        });

        events.emit('ToolFailed', { tool: toolName, error: actualErrorMsg, recovery: recovery.action });

        if (recovery.action === 'llm_resolve_dependency') {
          console.log('[AGENT LOOP] Recovery delegating dependency resolution to LLM:', recovery.detectedModule);
          var envNote = recovery.environmentInfo ? ' (Environment: ' + recovery.environmentInfo.type + ')' : '';
          lastResult.message = (lastResult.message || '') +
            '\n\n[RECOVERY ENGINE: DEPENDENCY REQUIRED]' +
            '\nDiagnosis: Missing ' + recovery.ecosystem + ' dependency detected: "' + (recovery.detectedModule || 'unknown') + '"' + envNote + '.' +
            '\nAction Required by Model: Please inspect project configuration files (e.g. package.json, requirements.txt, pyproject.toml) to determine the exact package name and execute the appropriate run_terminal command to install it.';
        } else if (recovery.action === 'retry') {
          console.log('[AGENT LOOP] Recovery executing deterministic single retry for ' + toolName);
          try {
            if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'patch_file' || toolName === 'delete_file') {
              var retryCpFile = args.file_path || '';
              if (retryCpFile) {
                var retryCpLabel = 'Retry ' + (toolName === 'delete_file' ? 'Deleted' : (toolName === 'write_file' ? 'Created' : 'Edited')) + ': ' + retryCpFile;
                try {
                  var retryCpId = await checkpointManager.createCheckpoint(retryCpFile, workspace, sessionId, retryCpLabel);
                  if (retryCpId) {
                    checkpointsCreated.push({ id: retryCpId, filePath: retryCpFile, label: retryCpLabel });
                  }
                } catch (_) {}
              }
            }

            var retryCallId = tcId + '_retry';
            sendEvent({
              type: EVENT_TYPES.TOOL_CALL,
              tool: toolName,
              args: args,
              id: retryCallId,
              index: index
            });

            var retryGen = toolRegistry.execute(toolName, args, { workspace: workspace, sessionId: sessionId });
            for await (var retryEvent of retryGen) {
              retryEvent.toolCallId = retryCallId;
              sendEvent(retryEvent);
              if (retryEvent.type === 'tool_result') {
                lastResult = retryEvent;
              }
            }
            if (lastResult && lastResult.success !== false) {
              lastResult.message = (lastResult.message || '') + '\n[RECOVERY ENGINE] Auto-retry succeeded.';
            } else {
              lastResult.message = (lastResult.message || '') + '\n[RECOVERY ENGINE] Auto-retry failed: ' + ((lastResult && (lastResult.error || lastResult.message)) || '');
            }

            // Rerun step verification and observation on retry result
            var retryStepResult = {
              order: iteration,
              action: toolName,
              status: lastResult && lastResult.success !== false ? 'completed' : 'failed',
              duration: Date.now() - startTime,
              output: lastResult ? (lastResult.content || lastResult.message || '') : '',
              error: lastResult && lastResult.success === false ? (lastResult.message || lastResult.error || 'failed') : null
            };
            var retryVerification = await verificationManager.verifyStep(retryStepResult, stepArgs, workspace);
            var retryObs = observationEngine.generateObservation(toolName, args, lastResult, Date.now() - startTime, sessionId);
            executionTrace.recordObservation(sessionId, retryObs);
          } catch (retryErr) {
            lastResult = { success: false, message: '[RECOVERY ENGINE] Auto-retry error: ' + retryErr.message };
          }
        } else if ((recovery.action === 'execute_tool' || recovery.action === 'fallback') && (recovery.tool || recovery.command)) {
          var recTool = recovery.tool || 'run_terminal';
          var recArgs = recovery.args || { command: recovery.command };
          console.log('[AGENT LOOP] Recovery proposed tool action: ' + recTool, recArgs);

          var recCallId = 'rec_' + Date.now();
          var recoveryApproved = await askPermission(recTool, recArgs, recCallId, sendEvent, sessionId);
          if (recoveryApproved) {
            try {
              sendEvent({
                type: EVENT_TYPES.TOOL_CALL,
                tool: recTool,
                args: recArgs,
                id: recCallId,
                index: index
              });

              var recGen = toolRegistry.execute(recTool, recArgs, { workspace: workspace, sessionId: sessionId });
              var recRes = null;
              for await (var recEv of recGen) {
                recEv.toolCallId = recCallId;
                sendEvent(recEv);
                if (recEv.type === 'tool_result') {
                  recRes = recEv;
                }
              }
              lastResult.message = (lastResult.message || '') + '\n[RECOVERY ENGINE] Executed ' + recTool + ' - ' + (recRes && recRes.success !== false ? 'success' : 'failed');
            } catch (e) {
              lastResult.message = (lastResult.message || '') + '\n[RECOVERY ENGINE] Recovery tool execution failed: ' + e.message;
            }
          } else {
            lastResult.message = (lastResult.message || '') + '\n[RECOVERY ENGINE] Proposed recovery action (' + (recArgs.command || recTool) + ') was denied by user.';
          }
        }
      } else {
        events.emit('ToolCompleted', { tool: toolName, result: lastResult });
        memoryManager.recordTaskExecution(toolName, args, obs.summary, sessionId);
        if (toolName === 'write_file') {
          memoryManager.recordFileCreated(args.file_path, sessionId);
        } else if (toolName === 'edit_file' || toolName === 'patch_file') {
          memoryManager.recordFileModified(args.file_path, sessionId);
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
  var sessionId = options.sessionId || (history.length > 0 ? String(history[0].session_id || '') : '') || ('session_' + Date.now());

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
      effectivePrompt = runtime.getGoal(sessionId) || 'Continue';
    } catch (_) {
      effectivePrompt = 'Continue';
    }
  }

  // Initialize Runtime execution context
  if (isContinuation) {
    if (!runtime.getGoal(sessionId)) {
      runtime.setGoal(effectivePrompt, sessionId);
    }
  } else {
    runtime.initSession(userPrompt, sessionId);
  }

  // Wrap sendEvent to also emit through the events.js bus.
  var _sendEventCallback = options.sendEvent || noop;
  function sendEvent(evt) {
    if (evt && typeof evt === 'object') {
      if (!evt.sessionId) {
        evt.sessionId = sessionId;
      }
    }
    emitAndForwardEvent(_sendEventCallback, evt);
  }
  var askPermission = options.askPermission || requestPermission;
  var signal = options.signal || null;
  var maxIterations = config.maxIterations || MAX_ITERATIONS;

  var provider = createProvider(config);

  // Gather context via ContextManager
  var contextResult = null;
  try {
    contextResult = await contextManager.gatherContext(effectivePrompt, workspace, sessionId);
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
    timelineManager.addEvent('session:start', sessionLabel, sessionId);
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
      goalTracker.initGoals(userPrompt, sessionId);
      memoryManager.clear(sessionId);
      memoryManager.setCurrentGoal(userPrompt, sessionId);
    } else {
      if (!goalTracker.getActiveTask(sessionId)) {
        goalTracker.initGoals(effectivePrompt, sessionId);
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
      if (currentPlan) runtime.setCurrentPlan(currentPlan, sessionId);
      if (currentPlan && !knowledge.activePlans) {
        try {
          knowledge.activePlans = planningManager.getActivePlansContext(sessionId);
        } catch (_) {
          // Intentionally ignored to allow safe execution fallback
        }
      }
    }
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }

  var messages = await buildMessages(userPrompt, {
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
  function sendHistoryUpdate() {
    forwardHistoryUpdate(messages, initialLength, sendEvent, sessionCtx, config);
  }
  var baseStepOffset = (isContinuation && activeTrace && activeTrace.steps) ? activeTrace.steps.length : 0;

  var iteration = 0;
  var fullThinking = '';
  var fullContent = '';
  var sessionUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  try {
    while (iteration < maxIterations) {
      if (signal && (signal.stopped || signal.aborted)) {
        console.log('[AGENT LOOP] Stop requested at iteration ' + iteration);
        agentState.transition('stopped', sessionId);
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

      var targetState = agentState.getState(sessionId) === 'idle' ? 'thinking' : agentState.getState(sessionId);

      try {
        if (agentState.getState(sessionId) !== targetState) {
          var fromState = agentState.getState(sessionId);
          agentState.transition(targetState, sessionId);
          executionTrace.recordTransition(sessionId, fromState, targetState);
        }
      } catch (_) {
        // Intentionally fallback to state reset if transition fails
        agentState.reset(sessionId);
        agentState.transition(targetState, sessionId);
      }

      events.emit('state_changed', { state: targetState, sessionId: sessionId });

      // Inject execution context
      try {
        var roleName = multiAgentRuntime.mapStateToRole(targetState, sessionCtx.plan ? sessionCtx.plan.activeTaskAction : '');
        var rolePrompt = multiAgentRuntime.getRolePrompt(roleName);
        var gitPrompt = await gitIntelligence.getGitPromptFragment(workspace);
        var memPrompt = memoryManager.getPromptFragment(sessionId);
        var goalPrompt = goalTracker.getStatusReport(sessionId);

        var activePlanCtx = planningManager.getActivePlansContext(sessionId);
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
        var chatSignal = (signal && signal.signal) ? signal.signal : signal;
        var stream = provider.chat(config, messages, getDefinitions(), { signal: chatSignal });
        for await (var chunk of stream) {
          if (signal && (signal.stopped || signal.aborted)) {
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

      if (signal && (signal.stopped || signal.aborted)) {
        console.log('[AGENT LOOP] Stop requested after/during stream');
        agentState.transition('stopped', sessionId);
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

      if (!iterationContent && !iterationThinking && toolCalls.length === 0 && (!signal || (!signal.stopped && !signal.aborted))) {
        var emptyMsg = 'The model returned an empty response. It may have closed the connection prematurely or does not support tool calling.';
        sendEvent({ type: EVENT_TYPES.AGENT_ERROR, message: emptyMsg });
        throw new Error(emptyMsg);
      }

      var completedToolCalls = [];
      for (var tcIndex = 0; tcIndex < toolCalls.length; tcIndex++) {
        var t = toolCalls[tcIndex];
        if (!t) continue;

        var rawArgs = t.function && t.function.arguments;
        var parsedRes = robustParseToolArguments(rawArgs, t.function && t.function.name);
        for (var pIdx = 0; pIdx < parsedRes.argsList.length; pIdx++) {
          var pArgs = parsedRes.argsList[pIdx];
          var callId = (parsedRes.argsList.length > 1) ? ((t.id || ('call_' + iteration + '_' + tcIndex)) + '_' + pIdx) : (t.id || ('call_' + iteration + '_' + tcIndex));
          completedToolCalls.push({
            id: callId,
            type: t.type,
            function: {
              name: t.function && t.function.name,
              arguments: pArgs
            }
          });
        }
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
            var concludingChatSignal = (signal && signal.signal) ? signal.signal : signal;
            var stream = provider.chat(config, concludingMessages, getDefinitions(), { signal: concludingChatSignal });
            var concludingThinking = '';
            var concludingContent = '';
            for await (var chunk of stream) {
              if (signal && (signal.stopped || signal.aborted)) {
                break;
              }
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
          var fromReview = agentState.getState(sessionId);
          agentState.transition('reviewing', sessionId);
          executionTrace.recordTransition(sessionId, fromReview, 'reviewing');
          events.emit('state_changed', { state: 'reviewing', sessionId: sessionId });

          var modifiedFiles = memoryManager.getAllChangedFiles(sessionId);
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
          var fromDone = agentState.getState(sessionId);
          agentState.transition('completed', sessionId);
          executionTrace.recordTransition(sessionId, fromDone, 'completed');
          events.emit('state_changed', { state: 'completed', sessionId: sessionId });
        } catch (_) {
          // Intentionally fallback to state reset if transition to completed fails
          agentState.reset(sessionId);
          agentState.transition('completed', sessionId);
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
        if (agentState.getState(sessionId) !== 'executing') {
          var fromExec = agentState.getState(sessionId);
          agentState.transition('executing', sessionId);
          executionTrace.recordTransition(sessionId, fromExec, 'executing');
        }
      } catch (_) {
        // Intentionally fallback to state reset if transition to executing fails
        agentState.reset(sessionId);
        agentState.transition('executing', sessionId);
      }
      events.emit('state_changed', { state: 'executing', sessionId: sessionId });
      sendEvent({ type: EVENT_TYPES.AGENT_STATUS, status: 'executing_tools', count: completedToolCalls.length });

      var traceStepIndex = baseStepOffset + iteration;
      var results = [];
      for (var tpi = 0; tpi < completedToolCalls.length; tpi++) {
        var singleResult = await executeSingleToolCall(
          workspace, sessionId, traceStepIndex, sendEvent, askPermission,
          userPrompt || effectivePrompt, history, sessionCtx,
          completedToolCalls[tpi], tpi
        );
        results.push(singleResult);
      }

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
    if (!agentState.isTerminal(sessionId)) {
      agentState.transition('failed', sessionId);
    }
    sendHistoryUpdate();
  }

  if (!agentState.isTerminal(sessionId)) {
    agentState.transition('completed', sessionId);
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
