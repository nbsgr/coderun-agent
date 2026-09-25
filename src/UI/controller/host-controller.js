// host-controller.js (UI side)
// Main message receiver and router for webview frontend.
// Pure functions, traditional function declarations only. Zero business logic.

import { handleDiffResult } from '../chats/chats-diff-manager.js';
import { handleUndoComplete } from '../chats/chats-checkpoint-manager.js';

var listeners = [];

export function registerresponses() {
  console.log('[CODERUN UI] host-controller initialized');
  window.addEventListener('message', receivemessage);
}

export function subscribeToHostMessages(listenerFn) {
  if (typeof listenerFn === 'function') {
    listeners.push(listenerFn);
  }
}

function receivemessage(event) {
  console.log('[CODERUN UI] Webview received message:', event.data ? (event.data.type || event.data.id) : event);
  ondidreceivemessage(event.data);
}

function ondidreceivemessage(message) {
  if (!message || typeof message !== 'object') return;
  handlemessage(message);

  for (var i = 0; i < listeners.length; i++) {
    try {
      listeners[i](message);
    } catch (e) {
      console.debug('[CODERUN UI] Listener error:', e ? e.message : e);
    }
  }
}

function handlemessage(message) {
  var msgType = message.type || message.id;

  if (msgType === 'diffResult') {
    handleDiffResult(message);
  } else if (msgType === 'undoComplete') {
    handleUndoComplete(message);
  } else if (msgType === 'showAlert') {
    if (message.message && typeof alert === 'function') {
      alert(message.message);
    }
  }
}
