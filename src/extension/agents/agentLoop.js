// agentLoop.js — Core agent loop: Think → Plan → Act → Verify
// User Request → Prompt Builder → Provider → Model → Tool Calls? → Execute → Loop

import { MAX_ITERATIONS, EVENT_TYPES } from './constants.js';
import { buildMessages } from './promptBuilder.js';
import { createProvider } from '../providers/providerManager.js';
import { getDefinitions } from '../tools/toolDefinitions.js';
import * as toolRegistry from '../tools/toolRegistry.js';
import { formatToolResult, formatExecutionReport, executeSingleToolCall, robustParseToolArguments } from '../tools/toolExecutor.js';
import { requestPermission } from '../tools/permissions.js';
import * as verificationManager from '../execution/verificationManager.js';
import * as learningManager from '../context/learningManager.js';
import * as checkpointManager from '../tools/checkpointManager.js';
import * as terminalManager from '../tools/terminalManager.js';
import * as events from './events.js';
import * as agentState from './agentState.js';
import * as runtime from './runtime.js';
import * as observationEngine from '../execution/observationEngine.js';
import * as approvalSystem from '../tools/approvalSystem.js';
import * as recoveryEngine from '../execution/recoveryEngine.js';
import * as reviewEngine from '../execution/reviewEngine.js';
import * as executionTrace from '../execution/executionTrace.js';
import * as memoryManager from '../context/memoryManager.js';
import * as planningManager from '../context/planningManager.js';
import * as diffManager from '../tools/diffManager.js';
import * as mediaManager from '../media/mediaManager.js';
import { extractModelModality } from '../providers/modelClassifier.js';
// Phase 1 engines — extracted from agentLoop
import * as contextEngine from './contextEngine.js';
import * as mediaRuntime from './mediaRuntime.js';
import * as delegationEngine from './delegationEngine.js';
import * as decisionEngine from './decisionEngine.js';
import {
  buildToolContext,
  isReadOnlyTool,
  isMutationTool,
  cleanToolArgs,
  normalizeToolOutput,
  checkLoopHygiene,
  checkToolFailureRepetition
} from './toolContextBuilder.js';


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

function formatReviewIssueItem(iss) {
  return '- ' + iss;
}

function getEffectiveSessionUsage(sessionUsage, activeTrace) {
  var inT = (sessionUsage && sessionUsage.prompt_tokens) || 0;
  var outT = (sessionUsage && sessionUsage.completion_tokens) || 0;
  var totT = (sessionUsage && sessionUsage.total_tokens) || (inT + outT);
  if (totT === 0 && activeTrace && activeTrace.metrics && activeTrace.metrics.totalTokens) {
    inT = activeTrace.metrics.totalTokens.input || 0;
    outT = activeTrace.metrics.totalTokens.output || 0;
    totT = activeTrace.metrics.totalTokens.total || (inT + outT);
  }
  var res = { prompt_tokens: inT, completion_tokens: outT, total_tokens: totT, input: inT, output: outT, total: totT };
  if (sessionUsage && sessionUsage.reasoning_tokens) {
    res.reasoning_tokens = sessionUsage.reasoning_tokens;
  }
  return res;
}

function hasPriorThinkingInTurn(msgList) {
  if (!msgList || !msgList.length) return false;
  for (var i = msgList.length - 1; i >= 0; i--) {
    var m = msgList[i];
    if (m && m.role === 'user') break;
    if (m && m.role === 'assistant' && (m.thinking || m.reasoning_content || m.thought || m.reasoning)) {
      return true;
    }
  }
  return false;
}

function handleStopRequest(sessionId, sendEvent, fullContent, fullThinking) {
  var currentState = agentState.getState(sessionId);
  if (agentState.isTerminal(sessionId)) {
    return {
      content: fullContent,
      thinking: fullThinking,
      done: currentState === 'completed',
      stopped: false
    };
  }

  agentState.transitionWithTrace('stopped', sessionId, executionTrace);
  events.emit('state_changed', { state: 'stopped', sessionId: sessionId });
  var stoppedTrace = executionTrace.finishRun(sessionId, 'stopped');
  if (stoppedTrace) {
    sendEvent({ type: 'trace_updated', sessionId: sessionId, trace: stoppedTrace });
  }
  sendEvent({
    type: EVENT_TYPES.AGENT_DONE,
    reason: 'stopped',
    content: fullContent,
    thinking: fullThinking
  });
  return { content: fullContent, thinking: fullThinking, done: false, stopped: true };
}

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

function advancePlanChecklist(rawPlanStr, markAllComplete) {
  if (typeof rawPlanStr !== 'string' || !rawPlanStr.trim()) return null;
  var lines = rawPlanStr.split('\n');
  var updated = false;
  var foundIncomplete = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var m = line.match(/^([-*]\s*\[)([ \/xX!→>✓])(\]\s*(?:#?[0-9a-zA-Z_.-]+\s*:?|\b\d+[.)]\s*)?\s*.*)$/);
    if (m) {
      var prefix = m[1];
      var mark = m[2];
      var rest = m[3];
      var isDone = (mark === 'x' || mark === 'X' || mark === '✓');

      if (markAllComplete) {
        if (!isDone) {
          lines[i] = prefix + 'x' + rest;
          updated = true;
        }
      } else {
        if (!isDone) {
          if (!foundIncomplete) {
            lines[i] = prefix + 'x' + rest;
            updated = true;
            foundIncomplete = true;
          } else {
            if (mark === ' ') {
              lines[i] = prefix + '/' + rest;
            }
            break;
          }
        }
      }
    }
  }

  return updated ? lines.join('\n') : null;
}

function extractFallbackToolCalls(content, activeDefs, iteration) {
  if (!content || typeof content !== 'string') return null;
  var trimmed = content.trim();
  if (trimmed.indexOf('{') === -1) return null;

  var validNames = {};
  if (activeDefs && activeDefs.length) {
    for (var d = 0; d < activeDefs.length; d++) {
      var def = activeDefs[d];
      var name = (def.function && def.function.name) || def.name;
      if (name) validNames[name] = true;
    }
  }

  var targetStr = trimmed;
  var fenceMatch = targetStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    targetStr = fenceMatch[1].trim();
  }

  var parsedObj = null;
  try {
    parsedObj = JSON.parse(targetStr);
  } catch (_) {
    var firstBrace = targetStr.indexOf('{');
    var lastBrace = targetStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        parsedObj = JSON.parse(targetStr.substring(firstBrace, lastBrace + 1));
      } catch (catchErr) { console.debug('[CODERUN] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }
    }
  }

  if (!parsedObj || typeof parsedObj !== 'object') return null;

  var extracted = [];
  if (Array.isArray(parsedObj.tool_calls) && parsedObj.tool_calls.length) {
    for (var i = 0; i < parsedObj.tool_calls.length; i++) {
      var tc = parsedObj.tool_calls[i];
      var tcName = (tc.function && tc.function.name) || tc.name;
      if (tcName && (!validNames || Object.keys(validNames).length === 0 || validNames[tcName])) {
        var tcArgs = (tc.function && tc.function.arguments) || tc.arguments || {};
        extracted.push({
          id: tc.id || ('call_' + iteration + '_' + i),
          type: 'function',
          function: {
            name: tcName,
            arguments: typeof tcArgs === 'string' ? tcArgs : JSON.stringify(tcArgs)
          }
        });
      }
    }
  } else if (parsedObj.name && (parsedObj.arguments || parsedObj.parameters)) {
    var singleName = parsedObj.name;
    if (!validNames || Object.keys(validNames).length === 0 || validNames[singleName]) {
      var sArgs = parsedObj.arguments || parsedObj.parameters || {};
      extracted.push({
        id: parsedObj.id || ('call_' + iteration + '_0'),
        type: 'function',
        function: {
          name: singleName,
          arguments: typeof sArgs === 'string' ? sArgs : JSON.stringify(sArgs)
        }
      });
    }
  }

  if (extracted.length > 0) {
    return {
      toolCalls: extracted,
      cleanedContent: fenceMatch ? content.replace(fenceMatch[0], '').trim() : ''
    };
  }
  return null;
}

function syncPlanStringWithRuntime(newPlanStr, sessionId, markAllComplete) {
  try {
    var activePlan = runtime.getCurrentPlan(sessionId);
    if (activePlan) {
      activePlan.rawPlan = newPlanStr;
      var hasIncomplete = /[-*]\s*\[[ \/]\]/.test(newPlanStr);
      if (markAllComplete || !hasIncomplete) {
        activePlan.status = 'completed';
        try {
          planningManager.updatePlanStatus(activePlan.id, 'completed');
        } catch (catchErr) { console.debug('[CODERUN] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }
      }
      runtime.updatePlan(activePlan);
    }
  } catch (catchErr) { console.debug('[CODERUN] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }
}

function autoUpdatePlanOnToolSuccess(sessionCtx, sessionId, results, sendEvent) {
  if (!sessionCtx || !results || !results.length || typeof sendEvent !== 'function') return;

  var hadExplicitPlanTool = false;
  var hadRelevantSuccess = false;
  for (var i = 0; i < results.length; i++) {
    var tName = results[i].tool_name;
    if (tName === 'create_plan' || tName === 'update_plan') {
      hadExplicitPlanTool = true;
      break;
    }
    var res = results[i].result;
    if (res && res.success !== false) {
      if (tName === 'spawn_subagent' || tName === 'wait_for_subagent' || (tName === 'subagent_status' && res.progress === 'completed')) {
        hadRelevantSuccess = true;
      }
    }
  }

  if (hadExplicitPlanTool || !hadRelevantSuccess) return;

  var planSource = sessionCtx.plan;
  if (!planSource) {
    var rtPlan = runtime.getCurrentPlan(sessionId);
    if (rtPlan && rtPlan.rawPlan) {
      planSource = rtPlan.rawPlan;
    }
  }

  var rawStr = '';
  if (typeof planSource === 'string') {
    rawStr = planSource;
  } else if (planSource && typeof planSource.rawPlan === 'string') {
    rawStr = planSource.rawPlan;
  }

  if (!rawStr) return;

  var updatedStr = advancePlanChecklist(rawStr, false);
  if (updatedStr) {
    if (typeof sessionCtx.plan === 'string') {
      sessionCtx.plan = updatedStr;
    } else if (sessionCtx.plan && typeof sessionCtx.plan === 'object') {
      sessionCtx.plan.rawPlan = updatedStr;
    } else {
      sessionCtx.plan = updatedStr;
    }
    syncPlanStringWithRuntime(updatedStr, sessionId, false);
    sendEvent({ type: 'plan_updated', plan: updatedStr });
  }
}

function autoCompletePlanOnDone(sessionCtx, sessionId, sendEvent) {
  if (!sessionCtx || typeof sendEvent !== 'function') return;

  var planSource = sessionCtx.plan;
  if (!planSource) {
    var rtPlan = runtime.getCurrentPlan(sessionId);
    if (rtPlan && rtPlan.rawPlan) {
      planSource = rtPlan.rawPlan;
    }
  }

  var rawStr = '';
  if (typeof planSource === 'string') {
    rawStr = planSource;
  } else if (planSource && typeof planSource.rawPlan === 'string') {
    rawStr = planSource.rawPlan;
  }

  if (!rawStr) return;

  var updatedStr = advancePlanChecklist(rawStr, true);
  if (updatedStr) {
    if (typeof sessionCtx.plan === 'string') {
      sessionCtx.plan = updatedStr;
    } else if (sessionCtx.plan && typeof sessionCtx.plan === 'object') {
      sessionCtx.plan.rawPlan = updatedStr;
      sessionCtx.plan.status = 'completed';
    } else {
      sessionCtx.plan = updatedStr;
    }
    syncPlanStringWithRuntime(updatedStr, sessionId, true);
    sendEvent({ type: 'plan_updated', plan: updatedStr });
  }
}

function isVerificationToolOrCommand(toolName, args) {
  var name = String(toolName || '').toLowerCase();
  if (name === 'verify' || name === 'test' || name === 'run_tests') {
    return true;
  }
  if (name === 'run_command' || name === 'run_terminal_command' || name === 'run_terminal' || name === 'terminal') {
    var rawCmd = '';
    if (typeof args === 'string') {
      rawCmd = args;
    } else if (args && typeof args === 'object') {
      rawCmd = args.command || args.cmd || args.action || '';
    }
    var cmd = String(rawCmd).toLowerCase();
    if (cmd.indexOf('test') !== -1 ||
        cmd.indexOf('pytest') !== -1 ||
        cmd.indexOf('jest') !== -1 ||
        cmd.indexOf('vitest') !== -1 ||
        cmd.indexOf('mocha') !== -1 ||
        cmd.indexOf('check') !== -1 ||
        cmd.indexOf('cargo test') !== -1 ||
        cmd.indexOf('go test') !== -1) {
      return true;
    }
  }
  return false;
}

export async function runAgentLoop(userPrompt, config, options) {
  var rawWs = options.workspace || '';
  var workspace = typeof rawWs === 'string' ? rawWs : (rawWs && (rawWs.fsPath || rawWs.workspace || rawWs.path || '')) || '';
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

  var agentIdentity = options.agentIdentity || {
    agentId: 'agent_root_' + sessionId,
    id: 'root',
    name: 'Main Agent',
    role: 'Root Agent',
    task: effectivePrompt,
    context: '',
    execution: 'root',
    parentAgentId: null,
    parentSessionId: null,
    rootSessionId: sessionId,
    sessionId: sessionId,
    depth: 0,
    agentType: 'root'
  };

  // Initialize Runtime execution context
  if (isContinuation) {
    if (!runtime.getGoal(sessionId)) {
      runtime.setGoal(effectivePrompt, sessionId);
    }
  } else {
    runtime.initSession(userPrompt, sessionId);
  }
  runtime.initAgentIdentity(agentIdentity, sessionId);

  // Wrap sendEvent to also emit through the events.js bus.
  var _sendEventCallback = options.sendEvent || noop;
  function sendEvent(evt) {
    if (evt && typeof evt === 'object') {
      if (!evt.sessionId) {
        evt.sessionId = sessionId;
      }
      if (!evt.agentId) evt.agentId = agentIdentity.agentId;
      if (!evt.agentType) evt.agentType = agentIdentity.agentType;
      if (evt.parentAgentId === undefined) evt.parentAgentId = agentIdentity.parentAgentId || null;
      if (evt.parentSessionId === undefined) evt.parentSessionId = agentIdentity.parentSessionId || null;
      if (!evt.rootSessionId) evt.rootSessionId = agentIdentity.rootSessionId || sessionId;
    }
    emitAndForwardEvent(_sendEventCallback, evt);
  }
  var askPermission = options.askPermission || requestPermission;
  var signal = options.signal || null;
  var pauseSignal = options.pauseSignal || null;
  var maxIterations = config.maxIterations || MAX_ITERATIONS;

  var provider = createProvider(config);


  // ── Startup Context (knowledge, trace, goals, plan, MCP) ─────
  var startupCtx = await contextEngine.gatherStartupContext(
    effectivePrompt, userPrompt, workspace, sessionId,
    isContinuation, config, agentIdentity, options.images || [], sendEvent
  );
  var knowledge = startupCtx.knowledge;
  var currentPlan = startupCtx.currentPlan;
  var mcpCtx = startupCtx.mcpCtx;
  var activeTrace = startupCtx.activeTrace;


  var messages = await buildMessages(userPrompt, {
    workspace: workspace,
    history: history,
    compactCheckpoint: options.compactCheckpoint || null,
    knowledge: knowledge,
    images: options.images || [],
    model: config.model,
    provider: config.provider,
    mcpContext: mcpCtx,
    shellName: terminalManager.getShellName(),
    platformName: terminalManager.getPlatformName()
  });

  var initialLength = messages.length;
  var sessionCtx = {
    plan: currentPlan,
    config: config,
    agentIdentity: agentIdentity,
    agentRunner: options.agentRunner || null,
    images: options.images || [],
    failedMutations: [],
    rootSessionId: options.rootSessionId || (agentIdentity && agentIdentity.rootSessionId) || (agentIdentity && agentIdentity.parentSessionId) || sessionId
  };
  function sendHistoryUpdate() {
    forwardHistoryUpdate(messages, initialLength, sendEvent, sessionCtx, config);
  }
  var baseStepOffset = (isContinuation && activeTrace && activeTrace.steps) ? activeTrace.steps.length : 0;

  var iteration = 0;
  var fullThinking = '';
  var fullContent = '';
  var sessionUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  var pendingSyncSubagents = [];

  var selectedModality = extractModelModality(config.model);


  // ── Direct Image / Video Generation (shortcircuit for non-chat models) ─
  // Note: mediaRuntime.handleDirectGeneration handles messages.push(assistantMediaMsg); and sendHistoryUpdate();
  if (selectedModality === 'image') {
    console.log('[AGENT LOOP] Direct Image Generation triggered for model: ' + config.model);
  } else if (selectedModality === 'video') {
    console.log('[AGENT LOOP] Direct Video Generation triggered for model: ' + config.model);
  }
  var directMediaResult = await mediaRuntime.handleDirectGeneration(
    selectedModality, provider, config, effectivePrompt,
    sessionId, agentIdentity, sendEvent, messages, sendHistoryUpdate
  );
  if (directMediaResult) return directMediaResult;



  try {
    while (iteration < maxIterations) {
      if (signal && (signal.stopped || signal.aborted)) {
        console.log('[AGENT LOOP] Stop requested at iteration ' + iteration);
        return handleStopRequest(sessionId, sendEvent, fullContent, fullThinking);
      }

      if (pauseSignal && pauseSignal.paused) {
        console.log('[AGENT LOOP] Subagent paused at iteration ' + iteration);
        agentState.transitionWithTrace('paused', sessionId, executionTrace);
        events.emit('state_changed', { state: 'paused', sessionId: sessionId });
        sendEvent({ type: EVENT_TYPES.AGENT_STATUS, status: 'paused', sessionId: sessionId, iteration: iteration });
        await pauseSignal.resumePromise;
        if (signal && (signal.stopped || signal.aborted)) {
          return handleStopRequest(sessionId, sendEvent, fullContent, fullThinking);
        }
        agentState.transitionWithTrace('thinking', sessionId, executionTrace);
        events.emit('state_changed', { state: 'thinking', sessionId: sessionId });
        sendEvent({ type: EVENT_TYPES.AGENT_STATUS, status: 'thinking', sessionId: sessionId, iteration: iteration });
      }

      iteration++;
      sendEvent({
        type: EVENT_TYPES.AGENT_ITERATION,
        iteration: iteration,
        model: (config && config.model) || ''
      });

      agentState.transitionWithTrace('thinking', sessionId, executionTrace);
      events.emit('state_changed', { state: 'thinking', sessionId: sessionId });

      // ── Refresh iteration context (role, plan, goals, git, memory) ──
      await contextEngine.refreshIterationContext(messages, 'thinking', sessionCtx, sessionId, workspace);

      sendEvent({
        type: EVENT_TYPES.AGENT_STATUS,
        status: 'calling_api',
        model: (config && config.model) || '',
        provider: (config && config.provider) || '',
        sessionId: sessionId,
        iteration: iteration
      });

      var iterationStartInput = sessionUsage.prompt_tokens;
      var iterationStartOutput = sessionUsage.completion_tokens;

      var streamBuffer = '';
      var inThinkTag = false;
      var iterationThinking = '';
      var iterationContent = '';
      var toolCalls = [];
      var bufferedJsonContent = '';
      var isBufferingPotentialToolCall = false;

      var iterationThinkingKey = null;

      // Stream from provider
      try {
        var chatSignal = (signal && signal.signal) ? signal.signal : signal;
        var activeToolDefinitions = (config && config.enableTools === false) ? [] : getDefinitions({ agentType: (agentIdentity ? agentIdentity.agentType : 'root'), modelModality: extractModelModality(config && config.model) });
        var stream = provider.chat(config, messages, activeToolDefinitions, { signal: chatSignal });
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
            if (chunk.usage.reasoning_tokens) {
              sessionUsage.reasoning_tokens = (sessionUsage.reasoning_tokens || 0) + chunk.usage.reasoning_tokens;
            }
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
            sendEvent({ message: { role: 'assistant', thinking: chunk.thinking, thinkingKey: chunk.thinkingKey || iterationThinkingKey || 'reasoning_content' } });
          }
          // Handle content with inline think tags (DeepSeek style)
          if (chunk.content) {
            var parsed = processThinkTags(chunk.content, inThinkTag, streamBuffer);
            inThinkTag = parsed.inThinkTag;
            streamBuffer = parsed.buffer;
            if (parsed.thinking) {
              iterationThinking += parsed.thinking;
              fullThinking += parsed.thinking;
              sendEvent({ message: { role: 'assistant', thinking: parsed.thinking, thinkingKey: iterationThinkingKey || 'reasoning_content' } });
            }
            if (parsed.content) {
              iterationContent += parsed.content;
              fullContent += parsed.content;
              dbg('[AGENT LOOP] sendEvent content:', parsed.content.substring(0, 100));
              var trimmedCurrent = iterationContent.trimStart();
              if (!isBufferingPotentialToolCall && (trimmedCurrent.startsWith('{') || trimmedCurrent.startsWith('```json') || trimmedCurrent.startsWith('```\n{'))) {
                isBufferingPotentialToolCall = true;
              }
              if (isBufferingPotentialToolCall) {
                bufferedJsonContent += parsed.content;
              } else {
                sendEvent({ message: { role: 'assistant', content: parsed.content } });
              }
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
        var errMsg = (err && err.message) ? err.message : String(err);
        // Self-healing: if error states it is an image model, fallback to provider.images
        if (errMsg.indexOf('is an image model') !== -1 || errMsg.indexOf('/v1/images/generations') !== -1) {
          console.log('[AGENT LOOP] 400 error caught: model is an image model. Auto-recovering via provider.images...');
          try {
            var recImg = await provider.images(config, effectivePrompt);
            if (recImg) {
              var recSaved = await mediaManager.saveMediaFromDataOrUrl(null, sessionId, recImg, 'png');
              var recPath = recSaved ? recSaved.filePath : (typeof recImg === 'string' ? recImg : 'image.png');
              var recMd = '![Generated Image](' + recPath + ')\n\n*Auto-routed to /v1/images/generations for ' + config.model + '*';
              sendEvent({
                message: {
                  role: 'assistant',
                  content: recMd,
                  media: { type: 'image', filePath: recPath, filename: recSaved ? recSaved.filename : 'image.png' }
                }
              });
              agentState.transitionWithTrace('completed', sessionId, executionTrace);
              executionTrace.finishRun(sessionId, 'completed');
              sendEvent({ type: EVENT_TYPES.AGENT_DONE, reason: 'completed', content: recMd, thinking: '' });
              return { content: recMd, thinking: '', done: true, stopped: false };
            }
          } catch (recErr) {
            console.warn('[AGENT LOOP] Image auto-recovery failed:', recErr.message);
          }
        }
        // Self-healing: if error states it is a video model, fallback to provider.videos
        if (errMsg.indexOf('is a video model') !== -1 || errMsg.indexOf('/v1/videos') !== -1) {
          console.log('[AGENT LOOP] 400 error caught: model is a video model. Auto-recovering via provider.videos...');
          try {
            var recVid = await provider.videos(config, effectivePrompt);
            if (recVid) {
              var recVidSaved = await mediaManager.saveMediaFromDataOrUrl(null, sessionId, recVid, 'mp4');
              var recVidPath = recVidSaved ? recVidSaved.filePath : (typeof recVid === 'string' ? recVid : 'video.mp4');
              var recVidMd = '![Generated Video](' + recVidPath + ')\n\n*Generated with ' + config.model + ' (Auto-routed to /v1/videos)*';
              sendEvent({
                message: {
                  role: 'assistant',
                  content: recVidMd,
                  media: { type: 'video', filePath: recVidPath, filename: recVidSaved ? recVidSaved.filename : 'video.mp4' }
                }
              });
              agentState.transitionWithTrace('completed', sessionId, executionTrace);
              executionTrace.finishRun(sessionId, 'completed');
              sendEvent({ type: EVENT_TYPES.AGENT_DONE, reason: 'completed', content: recVidMd, thinking: '' });
              return { content: recVidMd, thinking: '', done: true, stopped: false };
            }
          } catch (recVidErr) {
            console.warn('[AGENT LOOP] Video auto-recovery failed:', recVidErr.message);
          }
        }

        agentState.transitionWithTrace('failed', sessionId, executionTrace);
        events.emit('state_changed', { state: 'failed', sessionId: sessionId });
        events.emit('agent:' + EVENT_TYPES.AGENT_ERROR, { type: EVENT_TYPES.AGENT_ERROR, message: errMsg, sessionId: sessionId });
        throw err;
      }

      if (signal && (signal.stopped || signal.aborted)) {
        console.log('[AGENT LOOP] Stop requested after/during stream');
        return handleStopRequest(sessionId, sendEvent, fullContent, fullThinking);
      }

      // Flush remaining buffer
      if (streamBuffer.length > 0) {
        if (inThinkTag) {
          iterationThinking += streamBuffer;
          fullThinking += streamBuffer;
          sendEvent({ message: { role: 'assistant', thinking: streamBuffer, thinkingKey: iterationThinkingKey || 'reasoning_content' } });
        } else {
          iterationContent += streamBuffer;
          fullContent += streamBuffer;
          sendEvent({ message: { role: 'assistant', content: streamBuffer } });
        }
      }

      if (!iterationContent && !iterationThinking && toolCalls.length === 0 && (!signal || (!signal.stopped && !signal.aborted))) {
        var emptyMsg = 'The model returned an empty response. It may have closed the connection prematurely or does not support tool calling.';
        agentState.transitionWithTrace('failed', sessionId, executionTrace);
        events.emit('state_changed', { state: 'failed', sessionId: sessionId });
        events.emit('agent:' + EVENT_TYPES.AGENT_ERROR, { type: EVENT_TYPES.AGENT_ERROR, message: emptyMsg, sessionId: sessionId });
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

      if (completedToolCalls.length === 0 && iterationContent) {
        var fallbackTools = extractFallbackToolCalls(iterationContent, activeToolDefinitions, iteration);
        if (fallbackTools && fallbackTools.toolCalls && fallbackTools.toolCalls.length) {
          console.log('[AGENT LOOP] Recovered ' + fallbackTools.toolCalls.length + ' tool call(s) from JSON content fallback');
          iterationContent = fallbackTools.cleanedContent;
          for (var fbIdx = 0; fbIdx < fallbackTools.toolCalls.length; fbIdx++) {
            var fbT = fallbackTools.toolCalls[fbIdx];
            var fbArgsRes = robustParseToolArguments(fbT.function.arguments, fbT.function.name);
            for (var fbP = 0; fbP < fbArgsRes.argsList.length; fbP++) {
              completedToolCalls.push({
                id: fbT.id + (fbArgsRes.argsList.length > 1 ? ('_' + fbP) : ''),
                type: 'function',
                function: {
                  name: fbT.function.name,
                  arguments: fbArgsRes.argsList[fbP]
                }
              });
            }
          }
          if (fallbackTools.cleanedContent && fallbackTools.cleanedContent.trim()) {
            sendEvent({ message: { role: 'assistant', content: fallbackTools.cleanedContent } });
          }
        } else if (isBufferingPotentialToolCall && bufferedJsonContent) {
          sendEvent({ message: { role: 'assistant', content: bufferedJsonContent } });
        }
      } else if (isBufferingPotentialToolCall && bufferedJsonContent) {
        sendEvent({ message: { role: 'assistant', content: bufferedJsonContent } });
      }
      bufferedJsonContent = '';
      isBufferingPotentialToolCall = false;

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
            input: (sessionUsage.prompt_tokens - iterationStartInput) || Math.round(JSON.stringify(messages).length / 4),
            output: (sessionUsage.completion_tokens - iterationStartOutput) || Math.round(((iterationContent || '').length + (iterationThinking || '').length) / 4)
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
        // ── Wait for pending sync subagents before concluding ──────
        var subagentConsumed = await delegationEngine.waitForPendingSubagents(
          pendingSyncSubagents, sessionId, sendEvent, messages, sendHistoryUpdate
        );
        if (subagentConsumed) {
          iterationContent = '';
          fullContent = '';
          maxIterations = Math.max(maxIterations, iteration + 2);
          continue;
        }

        // ── Force a concluding response from LLM if last message was a tool ──
        if (messages.length > 0 && messages[messages.length - 1].role === 'tool' && (!iterationContent || !iterationContent.trim()) && (!iterationThinking || !iterationThinking.trim())) {
          var conclusion = await decisionEngine.forceConclusion(
            provider, config, messages, activeToolDefinitions, signal, sendEvent
          );
          if (conclusion && conclusion.content && conclusion.content.trim()) {
            iterationContent = conclusion.content;
            fullContent += conclusion.content;
            if (conclusion.thinking) {
              iterationThinking += conclusion.thinking;
              fullThinking += conclusion.thinking;
            }
          }
        }

        var hasReviewIssues = false;
        try {
          agentState.transitionWithTrace('reviewing', sessionId, executionTrace);
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
                source: 'runtime_feedback',
                feedbackType: 'verification_review',
                isSystemFeedback: true,
                content: '[SYSTEM RUNTIME NOTICE: CODE REVIEW FEEDBACK]\n## ⚠️ CODE REVIEW WARNING\nThe self-reflection check detected issues in your changes:\n' +
                         reviewReport.issues.map(formatReviewIssueItem).join('\n') +
                         '\n\nPlease address these issues (such as resolving compiler/diagnostic errors, fixing syntax, removing placeholders, resolving empty catch blocks, or correcting credential leaks) in the next iteration.'
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

        agentState.transitionWithTrace('completed', sessionId, executionTrace);
        events.emit('state_changed', { state: 'completed', sessionId: sessionId });

        var assistantMsg = { role: 'assistant', content: iterationContent || '' };
        if (iterationThinking) {
          assistantMsg.thinking = iterationThinking;
        } else if (fullThinking && !hasPriorThinkingInTurn(messages)) {
          assistantMsg.thinking = fullThinking;
        }
        if (iterationThinkingKey) {
          assistantMsg.thinkingKey = iterationThinkingKey;
        }
        messages.push(assistantMsg);
        sendHistoryUpdate();

        try {
          executionTrace.recordFinalResponse(sessionId, {
            text: fullContent,
            thinking: fullThinking,
            durationMs: 0
          });
          var effUsage = getEffectiveSessionUsage(sessionUsage, activeTrace);
          var finishedTrace = executionTrace.finishRun(sessionId, 'completed', {
            totalTokens: effUsage
          });
          executionTrace.saveTraceToDisk(null, sessionId);
          if (finishedTrace) {
            sendEvent({ type: 'trace_updated', sessionId: sessionId, trace: finishedTrace });
          }
        } catch (_) {
          // Intentionally ignored to allow safe execution fallback
        }

        try {
          autoCompletePlanOnDone(sessionCtx, sessionId, sendEvent);
        } catch (_) {
          // Intentionally ignored to allow safe execution fallback
        }

        var modifiedCount = modifiedFiles ? modifiedFiles.length : 0;
        var failedMutationsCount = (sessionCtx.failedMutations && sessionCtx.failedMutations.length) || 0;
        var verificationRan = Boolean(sessionCtx.verificationRan);
        var verificationPassed = Boolean(sessionCtx.verificationPassed);

        var isTrulyVerified = (!hasReviewIssues) && (failedMutationsCount === 0) &&
          (modifiedCount === 0 ? true : (verificationRan && verificationPassed));

        var completionEvidence = {
          modelCompleted: true,
          reviewPassed: !hasReviewIssues,
          modifiedFilesCount: modifiedCount,
          failedMutationsCount: failedMutationsCount,
          verification: {
            required: modifiedCount > 0,
            executed: verificationRan,
            passed: verificationPassed
          },
          unverifiedChanges: modifiedCount > 0 && !verificationRan,
          verified: isTrulyVerified
        };

        var executionReportText = formatExecutionReport();
        sendEvent({
          type: EVENT_TYPES.AGENT_DONE,
          reason: 'completed',
          content: fullContent,
          thinking: fullThinking,
          thinkingKey: iterationThinkingKey || 'reasoning_content',
          report: executionReportText,
          completionEvidence: completionEvidence
        });
        return {
          content: fullContent,
          thinking: fullThinking,
          done: true,
          verified: completionEvidence.verified,
          completionEvidence: completionEvidence,
          report: executionReportText,
          toolFailures: sessionCtx.failedMutations
        };
      }

      agentState.transitionWithTrace('executing', sessionId, executionTrace);
      events.emit('state_changed', { state: 'executing', sessionId: sessionId });
      sendEvent({ type: EVENT_TYPES.AGENT_STATUS, status: 'executing_tools', count: completedToolCalls.length });

      var traceStepIndex = baseStepOffset + iteration;
      var results = [];

      var allReadOnly = true;
      for (var tpiCheck = 0; tpiCheck < completedToolCalls.length; tpiCheck++) {
        var fnName = (completedToolCalls[tpiCheck].function && completedToolCalls[tpiCheck].function.name) || '';
        if (!isReadOnlyTool(fnName)) {
          allReadOnly = false;
          break;
        }
      }

      if (allReadOnly && completedToolCalls.length > 1) {
        var parallelExecPromises = [];
        for (var pIdx = 0; pIdx < completedToolCalls.length; pIdx++) {
          parallelExecPromises.push(
            executeSingleToolCall(
              workspace, sessionId, traceStepIndex, sendEvent, askPermission,
              userPrompt || effectivePrompt, history, sessionCtx,
              completedToolCalls[pIdx], pIdx, signal
            )
          );
        }
        results = await Promise.all(parallelExecPromises);
      } else {
        for (var tpi = 0; tpi < completedToolCalls.length; tpi++) {
          var singleResult = await executeSingleToolCall(
            workspace, sessionId, traceStepIndex, sendEvent, askPermission,
            userPrompt || effectivePrompt, history, sessionCtx,
            completedToolCalls[tpi], tpi, signal
          );
          results.push(singleResult);
        }
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

      for (var vrIdx = 0; vrIdx < results.length; vrIdx++) {
        var rItem = results[vrIdx];
        var tcItem = completedToolCalls[vrIdx];
        var parsedArgs = (tcItem && tcItem.function && tcItem.function.arguments) || {};
        if (isVerificationToolOrCommand(rItem.tool_name, parsedArgs)) {
          sessionCtx.verificationRan = true;
          if (rItem.result && rItem.result.success !== false && (rItem.result.exit_code === undefined || rItem.result.exit_code === 0)) {
            sessionCtx.verificationPassed = true;
          } else {
            sessionCtx.verificationPassed = false;
          }
        }
      }

      currentPlan = sessionCtx.plan;
      try {
        autoUpdatePlanOnToolSuccess(sessionCtx, sessionId, results, sendEvent);
      } catch (_) {
        // Intentionally ignored to allow safe execution fallback
      }
      currentPlan = sessionCtx.plan;

      var assistantToolCalls = [];
      for (var atIndex = 0; atIndex < completedToolCalls.length; atIndex++) {
        var tObj = completedToolCalls[atIndex];
        var toolArgs = (tObj.function && tObj.function.arguments) || {};
        var argsString = typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs);
        assistantToolCalls.push({
          id: tObj.id,
          type: tObj.type || 'function',
          function: {
            name: tObj.function && tObj.function.name,
            arguments: argsString
          }
        });
      }

      // ── Track spawned subagents + collect already-finished ones ──
      delegationEngine.trackSpawnedSubagents(completedToolCalls, pendingSyncSubagents);
      var finishedSubagents = delegationEngine.collectFinishedSubagents(pendingSyncSubagents, sessionId, sendEvent);
      for (var faIdx = 0; faIdx < finishedSubagents.additionalToolCalls.length; faIdx++) {
        assistantToolCalls.push(finishedSubagents.additionalToolCalls[faIdx]);
        toolResults.push(finishedSubagents.additionalToolResults[faIdx]);
      }

      if (!iterationContent) {
        var autoReason = delegationEngine.getDelegationReason(completedToolCalls);

        if (autoReason) {
          iterationContent = autoReason;
          sendEvent({ message: { role: 'assistant', content: autoReason } });
        }
      }

      var assistantMsg = { role: 'assistant', content: iterationContent || (assistantToolCalls.length ? null : '') };
      if (iterationThinking) assistantMsg.thinking = iterationThinking;
      if (iterationThinkingKey) assistantMsg.thinkingKey = iterationThinkingKey;
      if (assistantToolCalls.length) assistantMsg.tool_calls = assistantToolCalls;
      messages.push(assistantMsg);
      sendHistoryUpdate();

      dbg('[AGENT LOOP] Messages updated. Total messages:', messages.length, 'Tool results count:', toolResults.length);
      for (var j = 0; j < toolResults.length; j++) {
        var toolMsg = {
          role: 'tool',
          tool_call_id: toolResults[j].tool_call_id,
          content: toolResults[j].formattedResult,
          tool_name: toolResults[j].tool_name,
          result: toolResults[j].result
        };
        messages.push(toolMsg);
      }

      // Check repetitive failure circuit breaker and loop hygiene
      var repeatWarning = null;
      for (var chkIdx = 0; chkIdx < results.length; chkIdx++) {
        var resObj = results[chkIdx];
        var tcItem = completedToolCalls[chkIdx];
        var toolArgs = tcItem && tcItem.function ? tcItem.function.arguments : {};

        var hygieneMsg = checkLoopHygiene(
          sessionCtx,
          resObj.tool_name,
          toolArgs,
          resObj.result,
          resObj.formattedResult
        );
        if (hygieneMsg) {
          repeatWarning = hygieneMsg;
          break;
        }

        var failWarnMsg = checkToolFailureRepetition(
          sessionCtx,
          resObj.tool_name,
          toolArgs,
          resObj.result
        );
        if (failWarnMsg) {
          repeatWarning = failWarnMsg;
          break;
        }
      }

      if (repeatWarning) {
        messages.push({
          role: 'user',
          source: 'runtime_feedback',
          feedbackType: 'loop_hygiene',
          isSystemFeedback: true,
          content: '[SYSTEM RUNTIME NOTICE: EXECUTION GUARD]\n' + repeatWarning
        });
      }

      sendHistoryUpdate();
      dbg('[AGENT LOOP] End of iteration', iteration, '- next iteration starting...');
    }
  } catch (err) {
    console.error('[AGENT LOOP] Error in loop:', err);
    if (!agentState.isTerminal(sessionId)) {
      agentState.transitionWithTrace('failed', sessionId, executionTrace);
      events.emit('state_changed', { state: 'failed', sessionId: sessionId });
    }
    try {
      var errText = err ? (err.message || String(err)) : 'Unknown error';
      executionTrace.recordFinalResponse(sessionId, {
        text: errText,
        thinking: fullThinking,
        error: errText,
        durationMs: 0
      });
      var effFailedUsage = getEffectiveSessionUsage(sessionUsage, activeTrace);
      var failedTrace = executionTrace.finishRun(sessionId, 'failed', {
        error: errText,
        totalTokens: effFailedUsage
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
    sendHistoryUpdate();
  }

  if (!agentState.isTerminal(sessionId)) {
    agentState.transitionWithTrace('max_iterations', sessionId, executionTrace);
    events.emit('state_changed', { state: 'max_iterations', sessionId: sessionId });
  }

  try {
    executionTrace.recordFinalResponse(sessionId, {
      text: fullContent,
      thinking: fullThinking,
      durationMs: 0
    });
    var effMaxUsage = getEffectiveSessionUsage(sessionUsage, activeTrace);
    var maxTrace = executionTrace.finishRun(sessionId, 'max_iterations', {
      totalTokens: effMaxUsage
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
  return { content: fullContent, thinking: fullThinking, done: false, maxReached: true, toolFailures: sessionCtx.failedMutations };
}

var THINK_TAG_PAIRS = [
  { open: '\uE000', close: '\uE001' },
  { open: '<think>', close: '</think>' },
  { open: '<thought>', close: '</thought>' },
  { open: '<thinking>', close: '</thinking>' },
  { open: '<reasoning>', close: '</reasoning>' }
];

function processThinkTags(text, inThinkTag, buffer) {
  var contentPart = '';
  var thinkingPart = '';
  buffer += text;

  while (true) {
    if (!inThinkTag) {
      var startIdx = -1;
      var matchedPair = null;

      for (var pi = 0; pi < THINK_TAG_PAIRS.length; pi++) {
        var pair = THINK_TAG_PAIRS[pi];
        var idx = buffer.indexOf(pair.open);
        if (idx !== -1 && (startIdx === -1 || idx < startIdx)) {
          startIdx = idx;
          matchedPair = pair;
        }
      }

      if (startIdx !== -1 && matchedPair) {
        contentPart += buffer.substring(0, startIdx);
        inThinkTag = matchedPair.close;
        buffer = buffer.substring(startIdx + matchedPair.open.length);
      } else {
        var partialLen = 0;
        for (var i = 1; i <= Math.min(buffer.length, 11); i++) {
          var tail = buffer.slice(-i);
          var hasMatch = false;
          for (var p2 = 0; p2 < THINK_TAG_PAIRS.length; p2++) {
            if (THINK_TAG_PAIRS[p2].open.startsWith(tail)) {
              hasMatch = true;
              break;
            }
          }
          if (hasMatch) {
            partialLen = i;
            break;
          }
        }
        contentPart += buffer.substring(0, buffer.length - partialLen);
        buffer = buffer.substring(buffer.length - partialLen);
        break;
      }
    } else {
      var closeTag = (typeof inThinkTag === 'string') ? inThinkTag : '</think>';
      var endIdx = buffer.indexOf(closeTag);
      var closeLen = closeTag.length;

      if (endIdx === -1) {
        for (var cpi = 0; cpi < THINK_TAG_PAIRS.length; cpi++) {
          var cPair = THINK_TAG_PAIRS[cpi];
          var altIdx = buffer.indexOf(cPair.close);
          if (altIdx !== -1 && (endIdx === -1 || altIdx < endIdx)) {
            endIdx = altIdx;
            closeLen = cPair.close.length;
          }
        }
      }

      if (endIdx !== -1) {
        thinkingPart += buffer.substring(0, endIdx);
        inThinkTag = false;
        buffer = buffer.substring(endIdx + closeLen);
      } else {
        var partialLen2 = 0;
        for (var k = 1; k <= Math.min(buffer.length, 12); k++) {
          var tail2 = buffer.slice(-k);
          var hasCloseMatch = false;
          if (closeTag.startsWith(tail2)) {
            hasCloseMatch = true;
          } else {
            for (var cpi2 = 0; cpi2 < THINK_TAG_PAIRS.length; cpi2++) {
              if (THINK_TAG_PAIRS[cpi2].close.startsWith(tail2)) {
                hasCloseMatch = true;
                break;
              }
            }
          }
          if (hasCloseMatch) {
            partialLen2 = k;
            break;
          }
        }
        thinkingPart += buffer.substring(0, buffer.length - partialLen2);
        buffer = buffer.substring(buffer.length - partialLen2);
        break;
      }
    }
  }

  return { content: contentPart, thinking: thinkingPart, inThinkTag: inThinkTag, buffer: buffer };
}

export { checkLoopHygiene, normalizeToolOutput, cleanToolArgs };

