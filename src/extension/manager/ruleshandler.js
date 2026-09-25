// ruleshandler.js (extension side)
// Handles global and workspace rules loading and saving
// Strict traditional function declarations only

import { getWorkspaceFolder } from '../context/workspaceContext.js';
import * as rulesLoader from '../context/rulesLoader.js';

export async function handleLoadRules(message, webview) {
  var wsPath = getWorkspaceFolder();
  var paths = rulesLoader.getRulesPaths(wsPath);
  try {
    var globalRules = await rulesLoader.readRulesFile(paths.globalPath);
    var workspaceRules = wsPath ? await rulesLoader.readRulesFile(paths.workspacePath) : '';
    webview.postMessage({
      type: 'rulesLoaded',
      globalRules: globalRules,
      workspaceRules: workspaceRules,
      globalPath: paths.globalPath,
      workspacePath: paths.workspacePath,
      hasWorkspace: Boolean(wsPath)
    });
  } catch (err) {
    console.error('[RULES] Failed to load rules:', err ? err.message : err);
  }
}

export async function handleSaveRules(message, webview) {
  var wsPath = getWorkspaceFolder();
  var paths = rulesLoader.getRulesPaths(wsPath);
  var targetPath = message.level === 'global' ? paths.globalPath : paths.workspacePath;
  if (!targetPath) return;

  try {
    await rulesLoader.writeRulesFile(targetPath, message.content);
    webview.postMessage({
      type: 'rulesSaved',
      level: message.level,
      success: true
    });
  } catch (err) {
    console.error('[RULES] Failed to save rules:', err ? err.message : err);
    webview.postMessage({
      type: 'rulesSaved',
      level: message.level,
      success: false,
      error: err ? err.message : 'Unknown error'
    });
  }
}
