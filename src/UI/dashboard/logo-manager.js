// logo-manager.js (UI side)
// Handles logo resolution and image updates in Webview header and welcome hero
// Strict traditional function declarations only

import { vscode } from '../controller/vscode-api.js';

export function getlogo() {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({ id: 'logo', type: 'logo' });
  }
}

export function handlelogoresponse(message) {
  if (!message || !message.uri) return;
  var logoEl = document.getElementById('logo') || document.getElementById('agentLogo');
  if (logoEl) {
    logoEl.src = message.uri;
  }
  var welcomeLogo = document.getElementById('welcomeLogo');
  if (welcomeLogo) {
    welcomeLogo.src = message.uri;
  }
}
