// toolExecutor.js — Tool execution engine and result formatting
// Responsible for argument parsing, permission verification, generator-based execution,
// step verification, recovery actions, and trace recording.

import { EVENT_TYPES } from '../agents/constants.js';
import * as toolRegistry from './toolRegistry.js';
import { formatResult as formatToolResult } from './toolRegistry.js';
import { buildToolContext, isMutationTool } from '../agents/toolContextBuilder.js';
import * as approvalSystem from './approvalSystem.js';
import * as memoryManager from '../context/memoryManager.js';
import * as learningManager from '../context/learningManager.js';
import * as timelineManager from '../execution/timelineManager.js';
import * as verificationManager from '../execution/verificationManager.js';
import * as recoveryEngine from '../execution/recoveryEngine.js';
import * as observationEngine from '../execution/observationEngine.js';
import * as executionTrace from '../execution/executionTrace.js';
import * as diffManager from './diffManager.js';
import * as checkpointManager from './checkpointManager.js';
import * as agentState from '../agents/agentState.js';
import * as events from '../agents/events.js';

export { formatResult as formatToolResult, formatToolCallsForHistory } from './toolRegistry.js';

var DEBUG = false;
function dbg() {
  if (DEBUG) {
    console.log.apply(console, arguments);
  }
}

/**
 * Format an execution report into a readable string for the LLM.
 */
export function formatExecutionReport(report) {
  if (!report) return 'No execution report.';

  var lines = ['## EXECUTION REPORT'];
  lines.push('Plan: ' + (report.planId || 'unknown'));
  lines.push('Status: ' + report.status);
  lines.push('Total duration: ' + report.totalDuration + 'ms');

  if (report.error) {
    lines.push('Error: ' + report.error);
  }

  if (report.steps && report.steps.length) {
    lines.push('');
    lines.push('Steps:');
    for (var i = 0; i < report.steps.length; i++) {
      var s = report.steps[i];
      var icon = s.status === 'completed' ? '✓' : s.status === 'error' ? '✗' : '→';
      lines.push('  ' + icon + ' Step ' + s.order + ' (' + s.action + '): ' + s.status + ' [' + s.duration + 'ms]');
      if (s.error) lines.push('    Error: ' + s.error);
    }
  }

  return lines.join('\n');
}

/**
 * Robust JSON arguments parsing with markdown fence stripping and concatenated JSON object recovery.
 */
export function robustParseToolArguments(rawArgs, toolName) {
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
              } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }
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

/**
 * Executes a single tool call with permission gating, event streaming, verification, recovery, and tracing.
 */
export async function executeSingleToolCall(workspace, sessionId, iteration, sendEvent, askPermission, userPrompt, history, sessionCtx, tc, index, signal) {
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
  if (approvalSystem.requiresApproval(toolName, args, sessionCtx ? sessionCtx.config : null)) {
    try {
      if (agentState.getState(sessionId) !== 'waiting') {
        agentState.transitionWithTrace('waiting', sessionId, executionTrace);
        events.emit('state_changed', { state: 'waiting', sessionId: sessionId });
      }
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }

    approved = await askPermission(toolName, args, tcId, sendEvent, sessionId);
    memoryManager.recordUserDecision(toolName, args.command || args.file_path || args.folder_path || '', approved, sessionId);
    executionTrace.recordDecision(sessionId, toolName, approved ? 'allow' : 'deny', 'User prompted approval');

    try {
      agentState.transitionWithTrace('executing', sessionId, executionTrace);
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
    var toolContext = buildToolContext(workspace, sessionId, signal, sessionCtx, sendEvent, askPermission);
    var generator = toolRegistry.execute(toolName, args, toolContext);
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
      if (!event.tool) {
        event.tool = toolName;
      }
      if (!event.tool_name) {
        event.tool_name = toolName;
      }
      if (!event.args && args) {
        event.args = args;
      }

      // Capture deferred resolve for diff review requests in diffManager
      if (event.type === 'request_diff' && event.id) {
        event.sessionId = sessionId;
        if (!event.parentSessionId && toolContext && toolContext.parentSessionId) {
          event.parentSessionId = toolContext.parentSessionId;
        }
        if (!event.rootSessionId && toolContext && toolContext.rootSessionId) {
          event.rootSessionId = toolContext.rootSessionId;
        }
        if (!event.subagentName && toolContext && toolContext.agentName && toolContext.agentType === 'subagent') {
          event.subagentName = toolContext.agentName;
        }
        diffManager.storePatch(event);
        _createdDiffIds.push(event.id);
      }

      // Propagate subagent metadata for interactive user question events
      if (event.type === 'ask_question' && event.id) {
        event.sessionId = sessionId;
        if (!event.parentSessionId && toolContext && toolContext.parentSessionId) {
          event.parentSessionId = toolContext.parentSessionId;
        }
        if (!event.rootSessionId && toolContext && toolContext.rootSessionId) {
          event.rootSessionId = toolContext.rootSessionId;
        }
        if (!event.subagentName && toolContext && toolContext.agentName && toolContext.agentType === 'subagent') {
          event.subagentName = toolContext.agentName;
        }
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
          agentId: (sessionCtx && sessionCtx.agentIdentity && sessionCtx.agentIdentity.agentId) || 'root',
          parentAgentId: (sessionCtx && sessionCtx.agentIdentity && sessionCtx.agentIdentity.parentAgentId) || null,
          parentSessionId: (sessionCtx && sessionCtx.agentIdentity && sessionCtx.agentIdentity.parentSessionId) || null,
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
    sendEvent({ type: EVENT_TYPES.TOOL_RESULT, tool: toolName, tool_name: toolName, args: args, success: false, message: err.message, toolCallId: tcId });
    lastResult = { success: false, message: err.message };
  } finally {
    dbg('[AGENT LOOP] Generator finally block for', toolName, 'eventCount:', eventCount, 'lastResult:', lastResult ? (lastResult.success !== false ? 'success' : 'fail') : 'null');
    // Clean up diffs only if the operation was explicitly aborted/stopped
    if (signal && (signal.stopped || signal.aborted)) {
      for (var di = 0; di < _createdDiffIds.length; di++) {
        var diffId = _createdDiffIds[di];
        diffManager.rejectPatch(diffId, sessionId);
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
                } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }
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

            var retryApproved = true;
            if (approvalSystem.requiresApproval(toolName, args, sessionCtx ? sessionCtx.config : null)) {
              try {
                if (agentState.getState(sessionId) !== 'waiting') {
                  agentState.transitionWithTrace('waiting', sessionId, executionTrace);
                  events.emit('state_changed', { state: 'waiting', sessionId: sessionId });
                }
              } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }

              retryApproved = await askPermission(toolName, args, retryCallId, sendEvent, sessionId);
              memoryManager.recordUserDecision(toolName, args.command || args.file_path || args.folder_path || '', retryApproved, sessionId);
              executionTrace.recordDecision(sessionId, toolName, retryApproved ? 'allow' : 'deny', 'User prompted approval on retry');

              try {
                agentState.transitionWithTrace('executing', sessionId, executionTrace);
                events.emit('state_changed', { state: 'executing', sessionId: sessionId });
              } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }
            }

            if (!retryApproved) {
              sendEvent({
                type: EVENT_TYPES.TOOL_RESULT,
                tool: toolName,
                success: false,
                message: 'Permission denied by user on retry.',
                toolCallId: retryCallId
              });
              lastResult = { success: false, message: '[RECOVERY ENGINE] Auto-retry permission denied by user.' };
            } else if (signal && (signal.stopped || signal.aborted)) {
              lastResult = { success: false, message: '[RECOVERY ENGINE] Auto-retry cancelled by user.' };
            } else {
              var retryGen = toolRegistry.execute(toolName, args, buildToolContext(workspace, sessionId, signal, sessionCtx, sendEvent, askPermission));
              for await (var retryEvent of retryGen) {
                if (signal && (signal.stopped || signal.aborted)) {
                  break;
                }
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

          // 1. Emit TOOL_CALL first so the tool dropdown / terminal card is displayed in the UI
          sendEvent({
            type: EVENT_TYPES.TOOL_CALL,
            tool: recTool,
            args: recArgs,
            id: recCallId,
            index: index
          });

          // 2. Check permission if the tool requires approval
          var recoveryApproved = true;
          if (approvalSystem.requiresApproval(recTool, recArgs, sessionCtx ? sessionCtx.config : null)) {
            try {
              if (agentState.getState(sessionId) !== 'waiting') {
                agentState.transitionWithTrace('waiting', sessionId, executionTrace);
                events.emit('state_changed', { state: 'waiting', sessionId: sessionId });
              }
            } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }

            recoveryApproved = await askPermission(recTool, recArgs, recCallId, sendEvent, sessionId);
            memoryManager.recordUserDecision(recTool, recArgs.command || recArgs.file_path || recArgs.folder_path || '', recoveryApproved, sessionId);
            executionTrace.recordDecision(sessionId, recTool, recoveryApproved ? 'allow' : 'deny', 'User prompted approval on recovery action');

            try {
              agentState.transitionWithTrace('executing', sessionId, executionTrace);
              events.emit('state_changed', { state: 'executing', sessionId: sessionId });
            } catch (catchErr) { console.debug('[TOOLS] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }
          }

          if (recoveryApproved) {
            if (signal && (signal.stopped || signal.aborted)) {
              lastResult.message = (lastResult.message || '') + '\n[RECOVERY ENGINE] Recovery cancelled by user.';
            } else {
              try {
                var recGen = toolRegistry.execute(recTool, recArgs, buildToolContext(workspace, sessionId, signal, sessionCtx, sendEvent, askPermission));
                var recRes = null;
                for await (var recEv of recGen) {
                  if (signal && (signal.stopped || signal.aborted)) {
                    break;
                  }
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
            }
          } else {
            sendEvent({
              type: EVENT_TYPES.TOOL_RESULT,
              tool: recTool,
              success: false,
              message: 'Permission denied by user for recovery action.',
              toolCallId: recCallId
            });
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
      durationMs: toolDuration,
      checkpointId: lastResult && (lastResult.checkpoint_id || lastResult.checkpointId),
      filePath: args.file_path || args.folder_path || ''
    });
    if (updatedToolTrace) {
      sendEvent({ type: 'trace_updated', sessionId: sessionId, trace: updatedToolTrace });
    }
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }

  if (lastResult && lastResult.success === false && isMutationTool(toolName)) {
    if (!sessionCtx.failedMutations) sessionCtx.failedMutations = [];
    sessionCtx.failedMutations.push({
      tool: toolName,
      filePath: args.file_path || args.folder_path || '',
      message: lastResult.message || lastResult.error || 'Mutation failed'
    });
  }

  return {
    tool_name: toolName,
    tool_call_id: tcId,
    formattedResult: formatToolResult(toolName, lastResult),
    checkpoints: checkpointsCreated,
    result: lastResult
  };
}