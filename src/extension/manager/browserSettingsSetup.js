// browserSettingsSetup.js — Automatic first-install VS Code settings initializer
// Ensures required VS Code browser settings are initialized once when the extension
// is installed without overriding existing user preferences or weakening non-browser tools.
// Pure functions, traditional function declarations only. Zero arrow functions, zero classes.

import * as vscode from 'vscode';

var SETUP_STATE_KEY = 'coderun.vscodeBrowserSettingsInitialized';

export async function ensureBrowserSettingsOnInstall(context, options) {
  options = options || {};
  var vscodeApi = options.vscodeApi || vscode;
  var force = Boolean(options.force);

  if (!force && context && context.globalState && typeof context.globalState.get === 'function') {
    if (context.globalState.get(SETUP_STATE_KEY)) {
      return { skipped: true, reason: 'already_initialized' };
    }
  }

  var result = {
    skipped: false,
    enableChatToolsUpdated: false,
    errors: []
  };

  if (!vscodeApi || !vscodeApi.workspace || typeof vscodeApi.workspace.getConfiguration !== 'function') {
    return result;
  }

  var globalTarget = (vscodeApi.ConfigurationTarget && vscodeApi.ConfigurationTarget.Global) ? vscodeApi.ConfigurationTarget.Global : 1;

  // 1. Ensure workbench.browser.enableChatTools is enabled if not explicitly set by user
  try {
    var browserCfg = vscodeApi.workspace.getConfiguration('workbench.browser');
    if (browserCfg && typeof browserCfg.update === 'function') {
      var enableInfo = typeof browserCfg.inspect === 'function' ? browserCfg.inspect('enableChatTools') : null;
      var currentEnable = enableInfo ? enableInfo.globalValue : (typeof browserCfg.get === 'function' ? browserCfg.get('enableChatTools') : undefined);
      if (currentEnable === undefined) {
        await browserCfg.update('enableChatTools', true, globalTarget);
        result.enableChatToolsUpdated = true;
      }
    }
  } catch (err1) {
    result.errors.push('enableChatTools: ' + (err1 ? err1.message : String(err1)));
  }

  if (context && context.globalState && typeof context.globalState.update === 'function') {
    try {
      await context.globalState.update(SETUP_STATE_KEY, true);
    } catch (stateErr) {
      result.errors.push('globalState: ' + (stateErr ? stateErr.message : String(stateErr)));
    }
  }

  return result;
}
