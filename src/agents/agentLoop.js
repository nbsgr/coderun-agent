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
import * as memoryManager from '../context/memoryManager.js';

// Debug flag — set to true for verbose logging
var DEBUG = false;
function dbg() { if (DEBUG) console.log.apply(console, arguments); }

// ── Deferred diff tracking ─────────────────────────────────
// Maps diff IDs to their resolve functions so extension.js can
// resolve them when the user accepts/rejects a proposed edit.
var _pendingDiffs = {};

/**
 * Resolve a pending diff request. Called by extension.js when the
 * user accepts or rejects a proposed file edit.
 * @param {string} id - The diff request ID
 * @param {boolean} accepted - Whether the user accepted the changes
 */
export function resolveDiff(id, accepted) {
  if (_pendingDiffs[id]) {
    _pendingDiffs[id]({ accepted: !!accepted });
    delete _pendingDiffs[id];
  }
}

/**
 * The maximum number of times a tool execution will be retried
 * after failing verification. Configurable via config.
 */
var MAX_RETRIES = 3;

export async function runAgentLoop(userPrompt, config, options) {
  // Reset state machine for clean session
  agentState.reset();

  options = options || {};
  var workspace = options.workspace || '';
  var history = options.history || [];

  // Initialize Runtime execution context
  var sessionId = history.length > 0 ? String(history[0].session_id || 'session_' + Date.now())
                                      : 'session_' + Date.now();
  runtime.initSession(userPrompt, sessionId);

  // Wrap sendEvent to also emit through the events.js bus.
  // This lets any module listen to agent events without being in the
  // direct call chain, unifying the two event systems.
  var _sendEventCallback = options.sendEvent || function() {};
  var sendEvent = function(event) {
    // Emit to the event bus first (allows middleware/interceptors)
    events.emit('agent:' + (event.type || 'event'), event);
    // Then forward to the webview callback
    _sendEventCallback(event);
  };
  var askPermission = options.askPermission || requestPermission;
  var signal = options.signal || null;
  var maxIterations = config.maxIterations || MAX_ITERATIONS;

  var provider = createProvider(config);

  // Gather context via ContextManager
  var contextResult = null;
  try {
    contextResult = await contextManager.gatherContext(userPrompt, workspace);
  } catch (_) {}
  var knowledge = contextResult ? contextResult.knowledge : {};

  // Ensure knowledge has the minimum structure promptBuilder expects
  if (!knowledge.projectMetadata) {
    // Fallback: inline gathering if ContextManager fails
    try {
      if (projectKnowledge.getStats().ready) {
        knowledge.projectMetadata = projectKnowledge.getProjectMetadata();
        var stats2 = projectKnowledge.getStats();
        knowledge.fileCount = stats2.tables && stats2.tables.files ? stats2.tables.files : 0;
        knowledge.fileContext = true;
      }
    } catch (_) {}
    if (!knowledge.projectMemory) knowledge.projectMemory = '';
    if (!knowledge.dependencyGraph) knowledge.dependencyGraph = '';
    if (!knowledge.timeline) knowledge.timeline = '';
  }

  // Record session start in timeline
  try {
    var sessionLabel = String(userPrompt || '').substring(0, 60);
    timelineManager.addEvent('session:start', sessionLabel);
  } catch (_) {}

  // ── Session Startup ──────────────────────────────────────────
  try {
    events.emit('TaskStarted', { goal: userPrompt, sessionId: sessionId });
    executionTrace.startTrace(sessionId, userPrompt);
    goalTracker.initGoals(userPrompt);
    memoryManager.clear();
    memoryManager.setCurrentGoal(userPrompt);
  } catch (e) {
    console.error('[AGENT LOOP] Failed to initialize trace/goals:', e);
  }

  // Retrieve existing plan for this request session if any (Planning Engine — Phase 4)
  var currentPlan = null;
  try {
    var sessionPlans = planningManager.getSessionPlans(sessionId);
    if (sessionPlans && sessionPlans.length) {
      currentPlan = sessionPlans[sessionPlans.length - 1];
      if (currentPlan) runtime.setCurrentPlan(currentPlan);
      if (currentPlan && !knowledge.activePlans) {
        try {
          knowledge.activePlans = planningManager.getActivePlansContext();
        } catch (_) {}
      }
    }
  } catch (_) {}

  var messages = buildMessages(userPrompt, {
    workspace: workspace,
    history: history,
    knowledge: knowledge,
    images: options.images || [],
    shellName: terminalManager.getShellName(),
    platformName: terminalManager.getPlatformName()
  });

  var initialLength = messages.length;
  var sendHistoryUpdate = function() {
    try {
      var newMsgs = messages.slice(initialLength);
      sendEvent({
        type: 'chat_history_update',
        messages: newMsgs,
        plan: currentPlan
      });
    } catch (_) {}
  };

  var iteration = 0;
  var fullThinking = '';
  var fullContent = '';

  try {
    while (iteration < maxIterations) {
    // Cooperative stop: the webview sets signal.stopped = true to halt the
    // agent between iterations. The current LLM stream / tool call is
    // allowed to finish naturally so we don't leave the workspace in a
    // half-modified state.
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
      agentState.reset();
      agentState.transition(targetState);
    }

    events.emit('state_changed', { state: targetState });

    // Inject execution context without forcing a specialized role. The LLM
    // decides whether planning/review/testing behavior is needed.
    try {
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

    // Stream from provider
    try {
      var stream = provider.chat(config, messages, getDefinitions());
      for await (var chunk of stream) {
        console.log('[AGENT LOOP] Iteration ' + iteration + '/' + maxIterations);
        dbg('[AGENT LOOP] AGENT RECEIVED =', JSON.stringify(chunk).substring(0, 500));
        // Handle thinking tokens
        if (chunk.thinking) {
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
        // Handle tool calls
        // ──────────────────────────────────────────────────────────────
        // OpenAI-style streaming tool calls come as DELTAS, not complete
        // objects. Each chunk has `tool_calls: [{ index: 0, id?: "fc_xx",
        // function: { name?: "...", arguments: "<partial json>" } }, ...]`
        // The `arguments` field is a STRING that arrives in pieces and
        // must be accumulated + JSON.parsed at the end.
        //
        // Previous code pushed raw chunks into `toolCalls` and used the
        // FIRST chunk's `arguments` directly, which is always a partial
        // JSON like "{" — causing all tools to receive empty/wrong args.
        if (chunk.tool_calls && chunk.tool_calls.length) {
          for (var tc of chunk.tool_calls) {
            var tcIndex = (typeof tc.index === 'number') ? tc.index : toolCalls.length;
            if (!toolCalls[tcIndex]) {
              // First chunk for this tool call index — bootstrap the slot.
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
                // Already parsed (some providers) — re-serialize for the
                // final JSON.parse round-trip below.
                try {
                  slot.function.arguments += JSON.stringify(tc.function.arguments);
                } catch (_) {
                  slot.function.arguments += String(tc.function.arguments);
                }
              }
            } else if (tc.name) {
              // Non-OpenAI shape: { name, arguments }
              slot.function.name = slot.function.name || tc.name;
              if (typeof tc.arguments === 'string') {
                slot.function.arguments += tc.arguments;
              } else if (tc.arguments != null) {
                try { slot.function.arguments += JSON.stringify(tc.arguments); }
                catch (_) { slot.function.arguments += String(tc.arguments); }
              }
            }
          }
          // Forward a synthesized view of tool_calls so the UI still sees
          // them as they stream. We emit a copy with the *current* partial
          // arguments so the chat can show the tool name + args as they
          // arrive.
          var streamingView = toolCalls.map(function(t) {
            return {
              index: t.index,
              id: t.id,
              type: t.type,
              function: { name: t.function.name, arguments: t.function.arguments }
            };
          });
          sendEvent({ message: { role: 'assistant', tool_calls: streamingView } });
        }
      }
    } catch (err) {
      sendEvent({ type: EVENT_TYPES.AGENT_ERROR, message: err.message });
      throw err;
    }

    // Flush remaining buffer
    if (streamBuffer.length > 0) {
      if (inThinkTag) {
        fullThinking += streamBuffer;
        sendEvent({ message: { role: 'assistant', thinking: streamBuffer } });
      } else {
        fullContent += streamBuffer;
        sendEvent({ message: { role: 'assistant', content: streamBuffer } });
      }
    }

    // Compact the sparse `toolCalls` array (we may have indexed slots that
    // are not contiguous if the model did not emit `index: 0` first).
    // We also JSON.parse the accumulated `arguments` string here.
    var completedToolCalls = toolCalls
      .filter(function(t) { return !!t; })
      .map(function(t) {
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
        return {
          id: t.id,
          type: t.type,
          function: {
            name: t.function && t.function.name,
            arguments: parsedArgs
          }
        };
      });

    // No tool calls = complete. Review is advisory only; it must not re-prompt
    // the LLM because that duplicates final responses after cleanup/deletes.
    if (completedToolCalls.length === 0) {
      try {
        var fromReview = agentState.getState();
        agentState.transition('reviewing');
        executionTrace.recordTransition(fromReview, 'reviewing');
        events.emit('state_changed', { state: 'reviewing' });

        var modifiedFiles = memoryManager.getFilesModified();
        var reviewReport = await reviewEngine.reviewChanges(workspace, modifiedFiles);

        if (!reviewReport.passed) {
          console.log('[AGENT LOOP] Reflection failed: ' + reviewReport.issues.join('; '));
          sendEvent({
            type: EVENT_TYPES.AGENT_STATUS,
            status: 'review_warning',
            message: reviewReport.issues.join('\n')
          });
        } else {
          console.log('[AGENT LOOP] Reflection passed successfully!');
        }
      } catch (e) {
        console.error('[AGENT LOOP] Review Engine crashed:', e);
      }

      var fromComplete = agentState.getState();
      agentState.transition('completed');
      executionTrace.recordTransition(fromComplete, 'completed');
      events.emit('TaskCompleted', { sessionId: sessionId, success: true });
      await executionTrace.saveTrace(workspace);

      var assistantMsg = { role: 'assistant', content: iterationContent || '' };
      if (iterationThinking || fullThinking) {
        assistantMsg.thinking = iterationThinking || fullThinking;
      }
      messages.push(assistantMsg);
      sendHistoryUpdate();
      sendEvent({ type: EVENT_TYPES.AGENT_DONE, reason: 'direct_answer', content: fullContent, thinking: fullThinking });
      return { content: fullContent, thinking: fullThinking, done: true };
    }

    // Execute tools
    try {
      if (agentState.getState() !== 'executing') {
        var fromExec = agentState.getState();
        agentState.transition('executing');
        executionTrace.recordTransition(fromExec, 'executing');
      }
    } catch (_) {
      agentState.reset();
      agentState.transition('executing');
    }
    events.emit('state_changed', { state: 'executing' });
    sendEvent({ type: EVENT_TYPES.AGENT_STATUS, status: 'executing_tools', count: completedToolCalls.length });
    
    var toolPromises = completedToolCalls.map(async function(tc, index) {
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
        } catch (_) {}

        approved = await askPermission(toolName, args, tcId, sendEvent);
        memoryManager.recordUserDecision(toolName, args.command || args.file_path || args.folder_path || '', approved);
        executionTrace.recordDecision(toolName, approved ? 'allow' : 'deny', 'User prompted approval');

        try {
          var fromExec2 = agentState.getState();
          agentState.transition('executing');
          executionTrace.recordTransition(fromExec2, 'executing');
          events.emit('state_changed', { state: 'executing' });
        } catch (_) {}
      }
      if (!approved) {
        sendEvent({ type: EVENT_TYPES.TOOL_RESULT, tool: toolName, success: false, message: 'Permission denied by user.', toolCallId: tcId });
        return {
          tool_name: toolName,
          tool_call_id: tcId,
          formattedResult: 'Permission denied.',
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
      } catch (_) {}

      // Track which diff IDs are created during this tool call so we can
      // clean them up properly in the finally block (diff IDs use a different
      // format than tcId, so the old tcId-based matching never matched).
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
      } catch (_) {}

      // Record timeline event
      try {
        var tlSuccess = lastResult ? lastResult.success : undefined;
        var tlMsg = lastResult ? (lastResult.message || lastResult.error || '') : '';
        timelineManager.addToolEvent(toolName, args, tlSuccess, tlMsg);
      } catch (_) {}

      if (lastResult) {
        // Verify tool result (Phase 8 — Agentic Loop)
        if (toolName === 'create_plan' && (lastResult.plan || lastResult.steps)) {
          try {
            if (lastResult.plan) {
              currentPlan = lastResult.plan;
              runtime.setCurrentPlan(currentPlan);
              goalTracker.syncWithPlan(currentPlan);
              sendEvent({ type: 'plan_created', plan: currentPlan });
            } else if (lastResult.steps) {
              var analysis = planningManager.analyzeRequest(userPrompt, null, workspace);
              var newPlan = planningManager.buildPlan(analysis, sessionId);
              currentPlan = newPlan;
              runtime.setCurrentPlan(currentPlan);
              goalTracker.syncWithPlan(currentPlan);
              sendEvent({ type: 'plan_created', plan: currentPlan });
            }
          } catch (_) {}
        } else if (toolName === 'update_plan' && lastResult.plan) {
          try {
            currentPlan = lastResult.plan;
            var totalT = 0, compT = 0;
            if (currentPlan.phases) {
              for (var cpi = 0; cpi < currentPlan.phases.length; cpi++) {
                if (currentPlan.phases[cpi].tasks) {
                  totalT += currentPlan.phases[cpi].tasks.length;
                  compT += currentPlan.phases[cpi].tasks.filter(function(t) { return t.status === 'completed'; }).length;
                }
              }
            } else if (currentPlan.steps) {
              totalT = currentPlan.steps.length;
              compT = currentPlan.steps.filter(function(s) { return s.status === 'completed'; }).length;
            }
            if (totalT > 0 && compT === totalT) {
              currentPlan.status = 'completed';
            }
            runtime.setCurrentPlan(currentPlan);
            goalTracker.syncWithPlan(currentPlan);
            sendEvent({ type: 'plan_updated', plan: currentPlan });
          } catch (_) {}
        } else if (toolName === 'update_plan' && lastResult.steps) {
          try {
            if (!currentPlan) {
              currentPlan = {
                id: 'plan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
                session_id: history.length > 0 ? String(history[0].session_id || 'session_' + Date.now())
                                                : 'session_' + Date.now(),
                goal: userPrompt,
                steps: [],
                status: 'draft',
                created_at: Date.now()
              };
              runtime.setCurrentPlan(currentPlan);
            }
            if (currentPlan && currentPlan.steps) {
              lastResult.steps.forEach(function(upd) {
                var step = currentPlan.steps.find(function(s) { return s.order === upd.order; });
                if (step) {
                  if (upd.status) step.status = upd.status;
                  if (upd.description) step.description = upd.description;
                } else {
                  currentPlan.steps.push(upd);
                }
              });
              goalTracker.syncWithPlan(currentPlan);
              sendEvent({ type: 'plan_updated', plan: currentPlan });
              try { planningManager.storePlan(currentPlan); } catch (_) {}
            }
          } catch (_) {}
        } else if (toolName === 'get_plan') {
          try {
            currentPlan = lastResult.plan || null;
            runtime.setCurrentPlan(currentPlan);
            goalTracker.syncWithPlan(currentPlan);
            sendEvent({ type: 'plan_updated', plan: currentPlan });
          } catch (_) {}
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
              activeTaskId: currentPlan ? currentPlan.activeTaskId : ''
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
        } catch (_) {}
      }

      return {
        tool_name: toolName,
        tool_call_id: tcId,
        formattedResult: formatToolResult(toolName, lastResult),
        checkpoints: checkpointsCreated,
        result: lastResult
      };
    });

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

    // Emit any checkpoints created during this iteration
    if (allCheckpoints.length) {
      sendEvent({
        type: 'checkpoints_created',
        checkpoints: allCheckpoints
      });
    }

    sendEvent({ type: EVENT_TYPES.AGENT_ITERATION, iteration: iteration, phase: 'tools_executed' });

    // Build assistant message with tool calls.
    // ──────────────────────────────────────────────────────────────
    // Different providers expect `arguments` in different formats when we
    // echo an assistant message back into the history:
    //
    //   • Ollama:   arguments must be a JSON OBJECT (not a string)
    //   • OpenAI / Anthropic / Gemini / OpenRouter / Groq / xAI:
    //               arguments must be a JSON STRING
    //
    // Sending the wrong format makes Ollama throw HTTP 400 with
    // "Value looks like object, but can't find closing '}' symbol"
    // because it tries to parse a stringified object as JSON.
    var isOllama = (config.provider === 'ollama');
    var assistantToolCalls = completedToolCalls.map(function(t) {
      var args = (t.function && t.function.arguments) || {};
      return {
        id: t.id,
        type: t.type || 'function',
        function: {
          name: t.function && t.function.name,
          arguments: isOllama ? args : JSON.stringify(args)
        }
      };
    });
    var assistantMsg = { role: 'assistant', content: iterationContent || '' };
    if (iterationThinking) assistantMsg.thinking = iterationThinking;
    if (assistantToolCalls.length) assistantMsg.tool_calls = assistantToolCalls;
    messages.push(assistantMsg);
    sendHistoryUpdate();

    // Add tool results to messages for next iteration.
    // Ollama expects `tool_name` in addition to `tool_call_id` on the
    // tool result message; OpenAI-style providers only need tool_call_id.
    // We include both so it works for every provider.
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
    sendHistoryUpdate();

    // End of iteration
    dbg('[AGENT LOOP] End of iteration', iteration, '- next iteration starting...');
  }
  } finally {
    console.log('[AGENT LOOP] While loop exited. finally block.');
    // If the loop exited without completing (error propagated), mark as failed
    if (!agentState.isTerminal()) {
      agentState.transition('failed');
    }
    sendHistoryUpdate();
  }

  // Max iterations reached
  if (!agentState.isTerminal()) {
    agentState.transition('completed');
  }
  sendEvent({
    type: EVENT_TYPES.AGENT_DONE,
    reason: 'max_iterations',
    content: fullContent + '\n\nMaximum agent iterations reached (' + maxIterations + '). The task may not be complete. Do you want me to continue?',
    thinking: fullThinking
  });
  return { content: fullContent, thinking: fullThinking, done: false, maxReached: true };
}

// Parse DeepSeek-style \uE000...\uE001 AND <think>...</think> tags from streaming content
function processThinkTags(text, inThinkTag, buffer) {
  var contentPart = '';
  var thinkingPart = '';
  buffer += text;

  // Two possible open/close tag pairs
  var OPEN_UNICODE = '\uE000';
  var CLOSE_UNICODE = '\uE001';
  var OPEN_HTML = '<think>';
  var CLOSE_HTML = '</think>';

  while (true) {
    if (!inThinkTag) {
      // Look for whichever open tag comes first
      var uIdx = buffer.indexOf(OPEN_UNICODE);
      var hIdx = buffer.indexOf(OPEN_HTML);
      var startIdx = -1;
      var tagLen = 0;

      if (uIdx !== -1 && (hIdx === -1 || uIdx <= hIdx)) {
        startIdx = uIdx;
        tagLen = OPEN_UNICODE.length; // 1
      } else if (hIdx !== -1) {
        startIdx = hIdx;
        tagLen = OPEN_HTML.length; // 7
      }

      if (startIdx !== -1) {
        contentPart += buffer.substring(0, startIdx);
        inThinkTag = true;
        buffer = buffer.substring(startIdx + tagLen);
      } else {
        // Check for partial tag at end of buffer
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
      // Look for whichever close tag comes first
      var uEndIdx = buffer.indexOf(CLOSE_UNICODE);
      var hEndIdx = buffer.indexOf(CLOSE_HTML);
      var endIdx = -1;
      var closeLen = 0;

      if (uEndIdx !== -1 && (hEndIdx === -1 || uEndIdx <= hEndIdx)) {
        endIdx = uEndIdx;
        closeLen = CLOSE_UNICODE.length; // 1
      } else if (hEndIdx !== -1) {
        endIdx = hEndIdx;
        closeLen = CLOSE_HTML.length; // 8
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

function runRecoveryCommand(command, cwd) {
  return new Promise(function(resolve) {
    exec(command, { cwd: cwd, timeout: 15000, windowsHide: true }, function(error, stdout, stderr) {
      if (error) {
        resolve({ success: false, output: stderr || error.message });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
}
