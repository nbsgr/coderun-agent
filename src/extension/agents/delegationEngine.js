// delegationEngine.js — Subagent lifecycle coordination for the agent loop
// Extracted from agentLoop.js. Handles tracking spawned subagents, collecting results
// from finished background subagents, and blocking until sync subagents complete.
// getDelegationReason also lives here — it is delegation-domain logic.

import * as subagentManager from './subagentManager.js';
import { EVENT_TYPES } from './constants.js';

/**
 * Generate a human-readable delegation reason message from tool calls.
 * Used to inject an assistant message when the model only spawned subagents
 * and produced no natural-language content of its own.
 * Returns an empty string if no delegation tool was found.
 */
export function getDelegationReason(toolCalls) {
  if (!toolCalls || !toolCalls.length) return '';
  for (var i = 0; i < toolCalls.length; i++) {
    var fn = toolCalls[i].function;
    if (fn && (fn.name === 'spawn_subagent' || fn.name === 'wait_for_subagent')) {
      var sArgs = fn.arguments || {};
      if (typeof sArgs === 'string') {
        try { sArgs = JSON.parse(sArgs); } catch (catchErr) { console.debug('[CODERUN] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }
      }
      var sName = (sArgs && (sArgs.name || sArgs.id)) || 'subagent';
      var sTask = (sArgs && sArgs.task) || '';
      var sExec = String((sArgs && sArgs.execution) || 'sync').toLowerCase();
      if (fn.name === 'spawn_subagent') {
        if (sExec === 'wait') {
          return "I am delegating this task to the specialized '" + sName + "' subagent (" + (sTask || 'to execute the delegated objective') + ") and waiting for it to complete.";
        }
        return "I am launching the '" + sName + "' subagent in the background to handle: " + (sTask || 'the delegated objective') + ".";
      }
      if (fn.name === 'wait_for_subagent') {
        return "Waiting for subagent '" + sName + "' to complete its execution and return results.";
      }
    }
  }
  return '';
}

/**
 * Scan completedToolCalls for spawn_subagent calls in sync/parallel/async modes
 * and append new entries to pendingSyncSubagents (in-place mutation).
 * Skips entries already present to avoid duplicates.
 */
export function trackSpawnedSubagents(completedToolCalls, pendingSyncSubagents) {
  for (var i = 0; i < completedToolCalls.length; i++) {
    var cCall = completedToolCalls[i];
    var cName = (cCall.function && cCall.function.name) || '';
    if (cName !== 'spawn_subagent') continue;

    var cArgs = (cCall.function && cCall.function.arguments) || {};
    if (typeof cArgs === 'string') {
      try { cArgs = JSON.parse(cArgs); } catch (_) { cArgs = {}; }
    }
    var cExec = (cArgs.execution || 'sync').toLowerCase();
    if (cExec !== 'sync' && cExec !== 'parallel' && cExec !== 'async') continue;

    var cSubId = cArgs.id || cArgs.agentId || cArgs.subagent_id;
    if (!cSubId) continue;

    var alreadyTracked = false;
    for (var j = 0; j < pendingSyncSubagents.length; j++) {
      if (pendingSyncSubagents[j].id === cSubId) {
        alreadyTracked = true;
        break;
      }
    }
    if (!alreadyTracked) {
      pendingSyncSubagents.push({
        id: cSubId,
        name: cArgs.name || cSubId,
        role: cArgs.role || 'coder',
        task: cArgs.task || '',
        execution: cExec
      });
    }
  }
}

/**
 * Check pendingSyncSubagents for any that already finished in the background.
 * For each finished subagent: emits tool_call + tool_result events, removes the entry
 * from pendingSyncSubagents, and returns its data for pushing into messages.
 *
 * Returns { additionalToolCalls, additionalToolResults }
 * Mutates pendingSyncSubagents in-place (removes finished entries).
 */
export function collectFinishedSubagents(pendingSyncSubagents, sessionId, sendEvent) {
  var additionalToolCalls = [];
  var additionalToolResults = [];

  for (var i = pendingSyncSubagents.length - 1; i >= 0; i--) {
    var pSub = pendingSyncSubagents[i];
    var subRec = subagentManager.getSubagent(pSub.id, sessionId);
    if (!subRec) continue;
    var isFinished = subRec.status === 'completed' || subRec.status === 'failed' ||
      subRec.status === 'stopped' || subRec.result;
    if (!isFinished) continue;

    var subRes = subRec.result || subRec;
    var sOutput = (subRes.summary || subRes.output || subRes.content) || '';
    if (!sOutput && subRes.finalResponse) {
      sOutput = typeof subRes.finalResponse === 'string'
        ? subRes.finalResponse
        : (subRes.finalResponse.text || '');
    }
    var sName = subRes.name || pSub.name || pSub.id;
    var sRole = subRes.role || pSub.role || 'coder';
    var sStatus = subRes.status || (subRes.success !== false ? 'completed' : 'failed');
    var sCallId = 'call_resp_' + pSub.id;

    var respArgs = {
      id: pSub.id,
      name: sName,
      role: sRole,
      task: pSub.task || subRes.task || '',
      execution: 'sync'
    };

    var formattedSubResult = '✓ Subagent [' + String(sRole).toUpperCase() + '] ' +
      sName + ' finished (' + sStatus + ').\n\n' + sOutput;

    additionalToolCalls.push({
      id: sCallId,
      type: 'function',
      function: {
        name: 'subagent_response',
        arguments: JSON.stringify(respArgs)
      }
    });

    var subRespObj = {
      agentId: pSub.id,
      subagent_id: pSub.id,
      name: sName,
      role: sRole,
      status: sStatus,
      output: sOutput,
      summary: sOutput,
      result: subRes,
      args: respArgs
    };

    additionalToolResults.push({
      tool_name: 'subagent_response',
      tool_call_id: sCallId,
      formattedResult: formattedSubResult,
      result: subRespObj
    });

    sendEvent({ type: 'tool_call', tool: 'subagent_response', id: sCallId, args: respArgs });
    sendEvent({
      type: 'tool_result',
      tool: 'subagent_response',
      tool_name: 'subagent_response',
      tool_call_id: sCallId,
      args: respArgs,
      status: sStatus === 'completed' ? 'success' : 'error',
      output: sOutput,
      summary: sOutput,
      formattedResult: formattedSubResult,
      result: subRespObj
    });

    pendingSyncSubagents.splice(i, 1);
  }

  return { additionalToolCalls: additionalToolCalls, additionalToolResults: additionalToolResults };
}

/**
 * Block and wait for all pending sync subagents to finish (the wait path).
 * For each completed subagent, pushes assistant tool_call + tool messages into the
 * conversation and emits events. Calls sendHistoryUpdate when done.
 *
 * Returns true when it consumed the iteration (caller should `continue` the loop).
 * Returns false when pendingSyncSubagents was empty.
 */
export async function waitForPendingSubagents(
  pendingSyncSubagents, sessionId, sendEvent, messages, sendHistoryUpdate
) {
  if (pendingSyncSubagents.length === 0) return false;

  console.log('[DELEGATION ENGINE] Awaiting ' + pendingSyncSubagents.length + ' pending sync subagent(s) before concluding...');
  sendEvent({ type: EVENT_TYPES.AGENT_STATUS, status: 'waiting_for_subagent' });

  while (pendingSyncSubagents.length > 0) {
    var waitSub = pendingSyncSubagents.shift();
    try {
      var waitSubRes = await subagentManager.waitForSubagent(waitSub.id, sessionId);
      if (!waitSubRes) {
        waitSubRes = {
          status: 'failed',
          output: 'Subagent terminated or returned no result',
          success: false
        };
      }

      var wsOutput = (waitSubRes.summary || waitSubRes.output || waitSubRes.content) || '';
      if (!wsOutput && waitSubRes.finalResponse) {
        wsOutput = typeof waitSubRes.finalResponse === 'string'
          ? waitSubRes.finalResponse
          : (waitSubRes.finalResponse.text || '');
      }
      var wsName = waitSubRes.name || waitSub.name || waitSub.id;
      var wsRole = waitSubRes.role || waitSub.role || 'coder';
      var wsStatus = waitSubRes.status || (waitSubRes.success !== false ? 'completed' : 'failed');
      var wsCallId = 'call_resp_' + waitSub.id;
      var wsRespArgs = {
        id: waitSub.id,
        name: wsName,
        role: wsRole,
        task: waitSub.task || waitSubRes.task || '',
        execution: 'sync'
      };
      var wsFormatted = (wsStatus === 'completed' ? '✓' : '✗') + ' Subagent [' + String(wsRole).toUpperCase() + '] ' +
        wsName + ' finished (' + wsStatus + ').\n\n' + wsOutput;

      sendEvent({ type: 'tool_call', tool: 'subagent_response', id: wsCallId, args: wsRespArgs });
      sendEvent({
        type: 'tool_result',
        tool: 'subagent_response',
        tool_name: 'subagent_response',
        tool_call_id: wsCallId,
        args: wsRespArgs,
        status: wsStatus === 'completed' ? 'success' : 'error',
        output: wsOutput,
        summary: wsOutput,
        formattedResult: wsFormatted,
        result: {
          agentId: waitSub.id,
          subagent_id: waitSub.id,
          name: wsName,
          role: wsRole,
          status: wsStatus,
          output: wsOutput,
          summary: wsOutput,
          result: waitSubRes,
          args: wsRespArgs
        }
      });

      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: wsCallId,
          type: 'function',
          function: { name: 'subagent_response', arguments: JSON.stringify(wsRespArgs) }
        }]
      });
      messages.push({
        role: 'tool',
        tool_name: 'subagent_response',
        tool_call_id: wsCallId,
        content: wsFormatted
      });

    } catch (wErr) {
      console.warn('[DELEGATION ENGINE] Error waiting for subagent:', wErr.message);
      var failCallId = 'call_resp_' + waitSub.id;
      var failErrMsg = (wErr && wErr.message) ? wErr.message : 'Subagent execution or wait failed';
      var failRole = waitSub.role || 'subagent';
      var failName = waitSub.name || waitSub.id;
      var failFormatted = '✗ Subagent [' + String(failRole).toUpperCase() + '] ' +
        failName + ' failed: ' + failErrMsg;
      var failRespArgs = {
        id: waitSub.id,
        name: failName,
        role: failRole,
        task: waitSub.task || '',
        execution: 'sync',
        error: failErrMsg
      };

      sendEvent({ type: 'tool_call', tool: 'subagent_response', id: failCallId, args: failRespArgs });
      sendEvent({
        type: 'tool_result',
        tool: 'subagent_response',
        tool_name: 'subagent_response',
        tool_call_id: failCallId,
        args: failRespArgs,
        status: 'error',
        output: failErrMsg,
        summary: failErrMsg,
        formattedResult: failFormatted,
        result: {
          agentId: waitSub.id,
          subagent_id: waitSub.id,
          name: failName,
          role: failRole,
          status: 'failed',
          error: failErrMsg,
          remainingWork: true,
          args: failRespArgs
        }
      });

      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: failCallId,
          type: 'function',
          function: { name: 'subagent_response', arguments: JSON.stringify(failRespArgs) }
        }]
      });
      messages.push({
        role: 'tool',
        tool_name: 'subagent_response',
        tool_call_id: failCallId,
        content: failFormatted
      });
    }
  }

  sendHistoryUpdate();
  return true;
}
