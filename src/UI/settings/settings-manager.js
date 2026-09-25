// settings-manager.js (UI side)
// Dispatches settings updates, model preferences, and API keys to extension host
// Strict traditional function declarations only

import { vscode } from '../controller/vscode-api.js';

export function saveSettingsFromUi(settings, apiKey) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'saveSettings',
      settings: settings,
      apiKey: apiKey
    });
  }
}

export function saveApiKeyFromUi(apiKey) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'saveApiKey',
      apiKey: apiKey
    });
  }
}

export function saveSelectedModelFromUi(model, provider) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'saveSelectedModel',
      model: model,
      provider: provider
    });
  }
}

export function checkHealthFromUi() {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({ type: 'checkHealth' });
  }
}

export function refreshAllModelsFromUi() {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({ type: 'refreshAllModels' });
  }
}
