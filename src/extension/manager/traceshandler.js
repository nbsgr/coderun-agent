// traceshandler.js (extension side)
// Handles execution trace persistence and querying for chats and subagents
// Strict traditional function declarations only

import * as executionTrace from '../execution/executionTrace.js';

export async function handleSaveTrace(message, extensionContext) {
  if (message.sessionId && extensionContext && extensionContext.globalStorageUri) {
    try {
      var storagePath = extensionContext.globalStorageUri.fsPath;
      await executionTrace.saveTraceToDisk(storagePath, message.sessionId);
    } catch (e) {
      console.warn('[TRACES] Failed to save trace to disk:', e ? e.message : e);
    }
  }
}

export async function handleGetTraces(message, webview, extensionContext) {
  if (!message.sessionId) return;
  try {
    var inMemTraces = executionTrace.getTraces(message.sessionId) || [];
    var activeTr = executionTrace.getActiveTrace(message.sessionId);
    var mergedTraces = [];
    var seenIds = {};

    for (var mi = 0; mi < inMemTraces.length; mi++) {
      if (inMemTraces[mi] && inMemTraces[mi].id) {
        seenIds[inMemTraces[mi].id] = true;
        mergedTraces.push(inMemTraces[mi]);
      }
    }
    if (activeTr && activeTr.id && !seenIds[activeTr.id]) {
      seenIds[activeTr.id] = true;
      mergedTraces.push(activeTr);
    }

    if (extensionContext && extensionContext.globalStorageUri) {
      var storagePath = extensionContext.globalStorageUri.fsPath;
      var diskTraces = await executionTrace.loadTracesFromDisk(storagePath, message.sessionId);
      for (var di = 0; di < diskTraces.length; di++) {
        var dt = diskTraces[di];
        if (dt && dt.id) {
          if (!seenIds[dt.id]) {
            seenIds[dt.id] = true;
            mergedTraces.push(dt);
          } else {
            for (var mti = 0; mti < mergedTraces.length; mti++) {
              if (mergedTraces[mti].id === dt.id && (!mergedTraces[mti].steps || !mergedTraces[mti].steps.length)) {
                mergedTraces[mti] = dt;
              }
            }
          }
        }
      }
    }

    webview.postMessage({
      type: 'loadedTraces',
      sessionId: message.sessionId,
      traces: mergedTraces
    });
  } catch (e) {
    console.error('[TRACES] Failed to load traces:', e ? e.message : e);
  }
}

export async function handleGetSubagentTraces(message, webview, extensionContext) {
  if (!message.sessionId) return;
  try {
    var subTraces = executionTrace.getSubagentTraces(message.sessionId);
    if (extensionContext && extensionContext.globalStorageUri) {
      var diskSubTraces = await executionTrace.loadSubagentTracesFromDisk(extensionContext.globalStorageUri.fsPath, message.sessionId);
      for (var dti = 0; dti < diskSubTraces.length; dti++) {
        var diskTrace = diskSubTraces[dti];
        var alreadyLoaded = false;
        for (var sti = 0; sti < subTraces.length; sti++) {
          if (subTraces[sti].id === diskTrace.id) {
            subTraces[sti] = diskTrace;
            alreadyLoaded = true;
            break;
          }
        }
        if (!alreadyLoaded) subTraces.push(diskTrace);
      }
    }
    webview.postMessage({
      type: 'loadedSubagentTraces',
      sessionId: message.sessionId,
      traces: subTraces
    });
  } catch (e) {
    console.error('[TRACES] Failed to get subagent traces:', e ? e.message : e);
  }
}
