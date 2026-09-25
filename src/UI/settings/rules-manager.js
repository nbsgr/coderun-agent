// rules-manager.js (UI side)
// Manages in-app rules editor, line gutter numbers, and global/workspace save actions
// Strict traditional function declarations only

import { vscode } from '../controller/vscode-api.js';

export function requestRules() {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({ type: 'loadRules' });
  }
}

export function saveRulesFromUi(level, content) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'saveRules',
      level: level,
      content: content
    });
  }
}

export function openRulesFileExternal(filePath) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'openFile',
      path: filePath
    });
  }
}
