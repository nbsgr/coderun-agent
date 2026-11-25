// chats-dictation-manager.js (UI side)
// Manages Webview microphone button state and live streaming transcript into chat input.
// Classic Webview script: strict traditional function declarations only, no ES module syntax.

function initializeDictationManager() {
  var activeUi = {
    micBtn: null,
    input: null,
    statusEl: null,
    onTextChanged: null,
    status: 'stopped',
    prefixText: ''
  };

  function getVscodeApi() {
    if (typeof window !== 'undefined') {
      return window.VSCODE_API || window.vscode || null;
    }
    return null;
  }

  function updateMicButtonState(status) {
    var btn = activeUi.micBtn;
    var statusEl = activeUi.statusEl;
    var statusText = '';

    if (btn) {
      btn.classList.remove(
        'cr-mic-btn--loading',
        'cr-mic-btn--listening',
        'cr-mic-btn--recognizing',
        'cr-mic-btn--stopping'
      );
      if (status === 'loading') {
        btn.classList.add('cr-mic-btn--loading');
        btn.title = 'Loading speech model... (click to cancel)';
        btn.setAttribute('aria-label', 'Cancel voice dictation startup');
      } else if (status === 'listening') {
        btn.classList.add('cr-mic-btn--listening');
        btn.title = 'Listening in English... (click to stop)';
        btn.setAttribute('aria-label', 'Stop English voice dictation');
      } else if (status === 'recognizing') {
        btn.classList.add('cr-mic-btn--recognizing');
        btn.title = 'Recognizing speech... (click to stop)';
        btn.setAttribute('aria-label', 'Stop English voice dictation');
      } else if (status === 'stopping') {
        btn.classList.add('cr-mic-btn--stopping');
        btn.title = 'Stopping dictation...';
        btn.setAttribute('aria-label', 'Dictation is stopping');
      } else {
        btn.title = 'Voice dictation in English (on-device)';
        btn.setAttribute('aria-label', 'Start English voice dictation');
      }
    }

    if (status === 'loading') statusText = 'Loading Nemotron...';
    else if (status === 'listening') statusText = 'Listening in English';
    else if (status === 'recognizing') statusText = 'Recognizing speech...';
    else if (status === 'stopping') statusText = 'Stopping dictation...';
    else if (status === 'error') statusText = 'Dictation error';

    if (statusEl) {
      statusEl.textContent = statusText;
      statusEl.classList.toggle('cr-dictation-status--active', Boolean(statusText));
      statusEl.classList.toggle('cr-dictation-status--recognizing', status === 'recognizing');
      statusEl.classList.toggle('cr-dictation-status--stopping', status === 'stopping');
      statusEl.classList.toggle('cr-dictation-status--error', status === 'error');
      statusEl.setAttribute('aria-hidden', statusText ? 'false' : 'true');
    }
  }

  function applyTranscriptText(text) {
    var input = activeUi.input;
    if (!input) return;
    input.value = activeUi.prefixText + (text || '');
    if (typeof activeUi.onTextChanged === 'function') {
      activeUi.onTextChanged();
    }
  }

  function registerDictationUI(micBtn, input, onTextChanged, statusEl) {
    activeUi.micBtn = micBtn || null;
    activeUi.input = input || null;
    activeUi.statusEl = statusEl || null;
    activeUi.onTextChanged = typeof onTextChanged === 'function' ? onTextChanged : null;
    updateMicButtonState(activeUi.status);
  }

  function toggleDictation() {
    var api = getVscodeApi();
    if (!api || typeof api.postMessage !== 'function') {
      console.warn('[CODERUN UI] VS Code API unavailable for dictation');
      return;
    }
    if (activeUi.status === 'listening' || activeUi.status === 'recognizing' || activeUi.status === 'loading') {
      activeUi.status = 'stopping';
      updateMicButtonState('stopping');
      api.postMessage({ command: 'stopDictation' });
      return;
    }
    if (activeUi.status === 'stopping') return;

    var existing = activeUi.input ? String(activeUi.input.value || '') : '';
    if (existing && !/\s$/.test(existing)) {
      activeUi.prefixText = existing + ' ';
    } else {
      activeUi.prefixText = existing;
    }

    activeUi.status = 'loading';
    updateMicButtonState('loading');
    api.postMessage({
      command: 'startDictation',
      langTag: 'en-US'
    });
  }

  function handleDictationMessage(message) {
    if (!message) return;
    var msgType = message.type || message.id;

    if (msgType === 'dictationStatus') {
      if (activeUi.status === 'stopping' && message.status !== 'stopped' && message.status !== 'error') {
        return;
      }
      activeUi.status = message.status || 'stopped';
      updateMicButtonState(activeUi.status);
      if (activeUi.status === 'stopped' && activeUi.input) {
        activeUi.input.focus();
      }
    } else if (msgType === 'dictationPartial') {
      if (activeUi.status === 'stopping') return;
      applyTranscriptText(message.text || '');
    } else if (msgType === 'dictationFinal') {
      if (typeof message.text === 'string' && message.text.length > 0) {
        applyTranscriptText(message.text);
      }
      activeUi.status = 'stopped';
      updateMicButtonState('stopped');
      if (activeUi.input) {
        activeUi.input.focus();
      }
    } else if (msgType === 'dictationError') {
      activeUi.status = 'error';
      updateMicButtonState('error');
      if (activeUi.micBtn && message.error) {
        activeUi.micBtn.title = 'Dictation error: ' + message.error;
      }
      console.warn('[CODERUN UI] Dictation error:', message.error || 'Unknown error');
    }
  }

  if (typeof window !== 'undefined') {
    window.registerDictationUI = registerDictationUI;
    window.toggleDictation = toggleDictation;
    window.handleDictationMessage = handleDictationMessage;
  }
}

initializeDictationManager();
