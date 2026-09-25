// chats-message-manager.js (UI side)
// Manages user and assistant message bubbles, composer states, and avatars
// Strict traditional function declarations only

import { vscode } from '../controller/vscode-api.js';

export function toggleComposerGeneratingState(generating) {
  var input = document.getElementById('chatInput') || document.querySelector('.cr-textarea');
  if (input) {
    input.classList.toggle('cr-textarea--generating', Boolean(generating));
  }
  var sendBtn = document.getElementById('sendBtn') || document.querySelector('.cr-btn-send');
  if (sendBtn) {
    sendBtn.disabled = Boolean(generating);
  }
}

export function handleUserAvatarError(img) {
  if (img) {
    img.style.display = 'none';
  }
}

export function handleBotAvatarError(img) {
  if (img) {
    img.src = window.CODERUN_BOT_AVATAR || '';
  }
}

export function sendChatMessage(text, model, provider, image, history, workspaceFolder) {
  if (!text || !text.trim()) return;
  toggleComposerGeneratingState(true);
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'startChat',
      message: text,
      model: model,
      provider: provider,
      image: image,
      history: history,
      workspaceFolder: workspaceFolder
    });
  }
}

export function stopChatMessage(sessionId) {
  toggleComposerGeneratingState(false);
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'stopChat',
      sessionId: sessionId
    });
  }
}
