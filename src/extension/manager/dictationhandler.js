// dictationhandler.js
// Handler coordinating Webview dictation requests with dictationManager.
// Strict traditional function declarations only.

import * as path from 'node:path';
import {
  startDictationSession,
  stopDictationSession,
  isDictationActive
} from './dictationManager.js';

function sendDictationMessage(webview, payload) {
  if (webview && typeof webview.postMessage === 'function') {
    try {
      webview.postMessage(payload);
    } catch (e) {
      console.warn('[CODERUN ASR] Could not send dictation update:', e ? e.message : e);
    }
  }
}

export async function handleStartDictation(message, webview, context) {
  var langTag = (message && message.langTag) ? String(message.langTag) : '<en-US>';
  function onDictationStatus(status) {
    sendDictationMessage(webview, {
      type: 'dictationStatus',
      status: status
    });
  }
  function onDictationPartial(text, delta) {
    sendDictationMessage(webview, {
      type: 'dictationPartial',
      text: text,
      delta: delta
    });
  }
  function onDictationFinal(text) {
    sendDictationMessage(webview, {
      type: 'dictationFinal',
      text: text
    });
  }
  function onDictationError(errorMessage) {
    sendDictationMessage(webview, {
      type: 'dictationError',
      error: errorMessage || 'Dictation error'
    });
  }

  try {
    if (isDictationActive()) {
      await stopDictationSession();
      return;
    }

    var storagePath = context && context.globalStorageUri && context.globalStorageUri.fsPath;
    if (!storagePath) {
      throw new Error('Dictation requires the extension global storage directory.');
    }

    await startDictationSession({
      cacheDir: path.join(storagePath, 'dictation-models'),
      langTag: langTag,
      onStatus: onDictationStatus,
      onPartial: onDictationPartial,
      onFinal: onDictationFinal,
      onError: onDictationError
    });
  } catch (err) {
    sendDictationMessage(webview, {
      type: 'dictationStatus',
      status: 'stopped'
    });
    sendDictationMessage(webview, {
      type: 'dictationError',
      error: err && err.message ? err.message : String(err)
    });
  }
}

export async function handleStopDictation(webview) {
  if (!isDictationActive()) {
    sendDictationMessage(webview, {
      type: 'dictationStatus',
      status: 'stopped'
    });
    return;
  }

  sendDictationMessage(webview, {
    type: 'dictationStatus',
    status: 'stopping'
  });
  try {
    await stopDictationSession();
  } catch (err) {
    sendDictationMessage(webview, {
      type: 'dictationStatus',
      status: 'stopped'
    });
    sendDictationMessage(webview, {
      type: 'dictationError',
      error: err && err.message ? err.message : String(err)
    });
  }
}
