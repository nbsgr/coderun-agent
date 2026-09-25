// model-manager.js (UI side)
// Manages the searchable model combobox, provider model groups, and pinned models
// Strict traditional function declarations only

import { vscode } from '../controller/vscode-api.js';

export function requestProviderModels(providerName) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'checkHealth',
      provider: providerName
    });
  }
}

export function filterModelsByQuery(models, query) {
  if (!query || !query.trim()) return models || [];
  var q = query.trim().toLowerCase();
  var filtered = [];
  for (var i = 0; i < (models || []).length; i++) {
    var m = models[i];
    var mName = typeof m === 'object' ? (m.name || m.id || '') : String(m);
    if (mName.toLowerCase().indexOf(q) !== -1) {
      filtered.push(m);
    }
  }
  return filtered;
}

export function togglePinnedModel(modelName, pinnedModels) {
  var pins = Object.assign({}, pinnedModels || {});
  pins[modelName] = !pins[modelName];
  if (!pins[modelName]) {
    delete pins[modelName];
  }
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'savePinnedModels',
      pinnedModels: pins
    });
  }
  return pins;
}
