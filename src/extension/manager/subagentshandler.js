// subagentshandler.js (extension side)
// Handles child subagent lifecycle requests: list, pause, resume, stop
// Strict traditional function declarations only

import * as subagentManager from '../agents/subagentManager.js';
import * as executionTrace from '../execution/executionTrace.js';

export async function handleGetSubagents(message, webview, extensionContext) {
  if (!message.sessionId) return;
  try {
    var subs = subagentManager.listSubagents(message.sessionId);
    var subTracesList = executionTrace.getSubagentTraces(message.sessionId);
    if (extensionContext && extensionContext.globalStorageUri) {
      var diskSubTraces = await executionTrace.loadSubagentTracesFromDisk(extensionContext.globalStorageUri.fsPath, message.sessionId);
      for (var dti = 0; dti < diskSubTraces.length; dti++) {
        var diskTrace = diskSubTraces[dti];
        var alreadyLoaded = false;
        for (var sti = 0; sti < subTracesList.length; sti++) {
          if (subTracesList[sti].id === diskTrace.id) {
            subTracesList[sti] = diskTrace;
            alreadyLoaded = true;
            break;
          }
        }
        if (!alreadyLoaded) subTracesList.push(diskTrace);
      }
    }

    for (var sIdx = 0; sIdx < subs.length; sIdx++) {
      var subItem = subs[sIdx];
      if (!subItem.trace || !subItem.trace.steps || !subItem.trace.steps.length) {
        for (var trIdx = 0; trIdx < subTracesList.length; trIdx++) {
          var candidateTr = subTracesList[trIdx];
          if (candidateTr.agentId === subItem.agentId || candidateTr.agentId === subItem.id || candidateTr.sessionId === subItem.sessionId) {
            subItem.trace = candidateTr;
            break;
          }
        }
      }
    }

    webview.postMessage({
      type: 'loadedSubagents',
      sessionId: message.sessionId,
      subagents: subs
    });
  } catch (e) {
    console.error('[SUBAGENTS] Failed to list subagents:', e ? e.message : e);
  }
}

export async function handlePauseSubagent(message) {
  if (message.agentId) {
    try {
      await subagentManager.pauseSubagent(message.agentId, message.sessionId || message.conversationId);
    } catch (e) {
      console.error('[SUBAGENTS] Failed to pause subagent:', e ? e.message : e);
    }
  }
}

export async function handleResumeSubagent(message) {
  if (message.agentId) {
    try {
      await subagentManager.resumeSubagent(message.agentId, message.sessionId || message.conversationId);
    } catch (e) {
      console.error('[SUBAGENTS] Failed to resume subagent:', e ? e.message : e);
    }
  }
}

export async function handleStopSubagent(message) {
  if (message.agentId) {
    try {
      await subagentManager.stopSubagent(message.agentId, message.sessionId || message.conversationId, message.reason);
    } catch (e) {
      console.error('[SUBAGENTS] Failed to stop subagent:', e ? e.message : e);
    }
  }
}
