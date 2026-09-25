// settings.js (UI side)
// Primary settings view container coordinating settings managers
// Strict traditional function declarations only

import * as settingsManager from './settings-manager.js';
import * as modelManager from './model-manager.js';
import * as tracesManager from './traces-manager.js';
import * as rulesManager from './rules-manager.js';
import * as mcpManager from './mcp-manager.js';

export function settingshtml() {
  return '<div class="cr-settings-root" id="settingsRoot"></div>';
}

export {
  settingsManager,
  modelManager,
  tracesManager,
  rulesManager,
  mcpManager
};
