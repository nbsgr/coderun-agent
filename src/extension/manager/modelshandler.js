// modelshandler.js (extension side)
// Handles provider connectivity health checks and multi-provider model listing
// Strict traditional function declarations only

import * as vscode from 'vscode';
import * as config from '../agents/config.js';
import * as providerManager from '../providers/providerManager.js';

var isRefreshingModels = false;

export async function checkProviderHealth(webview, overrideConfig, extensionContext, statusBarItem) {
  var cfg = overrideConfig;
  if (!cfg) {
    var activeProvider = extensionContext?.globalState.get('coderun_selected_provider', '') || '';
    if (activeProvider) {
      cfg = await config.getProviderConfigByName(extensionContext, activeProvider);
    } else {
      cfg = await config.getProviderConfigWithKey(extensionContext);
    }
  }
  console.log('[CODERUN] Checking health for provider:', cfg.provider, 'at', cfg.baseUrl, 'model:', cfg.model);

  if (!cfg.baseUrl) {
    console.error('[CODERUN] Health check skipped: No baseUrl configured');
    if (statusBarItem) {
      statusBarItem.text = '$(warning) CodeRun (No URL)';
      statusBarItem.tooltip = 'Please configure base URL in CodeRun settings';
    }
    if (webview && typeof webview.postMessage === 'function') {
      webview.postMessage({
        type: 'healthStatus',
        online: false,
        provider: cfg.provider || 'none',
        error: 'No base URL configured. Please set it in settings.'
      });
    }
    return;
  }

  if (config.needsApiKey(cfg.provider) && !cfg.apiKey) {
    console.error('[CODERUN] Health check skipped: API key required but not set');
    if (statusBarItem) {
      statusBarItem.text = '$(warning) CodeRun (No API Key)';
      statusBarItem.tooltip = 'Please set API key in CodeRun settings';
    }
    if (webview && typeof webview.postMessage === 'function') {
      webview.postMessage({
        type: 'healthStatus',
        online: false,
        provider: cfg.provider || 'none',
        error: 'API key required. Please enter your API key in settings and click Save.',
        models: []
      });
    }
    return;
  }

  try {
    var provider = providerManager.createProvider(cfg);
    var models = await provider.listModels(cfg);

    if (statusBarItem) {
      statusBarItem.text = '$(comment-discussion) CodeRun (Online)';
      statusBarItem.tooltip = cfg.provider + ': ' + cfg.baseUrl + ' | Models: ' + models.length;
    }

    if (webview && typeof webview.postMessage === 'function') {
      webview.postMessage({
        type: 'healthStatus',
        online: true,
        provider: cfg.provider,
        models: models
      });
    }
  } catch (err) {
    console.error('[CODERUN] Health check failed:', err.message);
    if (statusBarItem) {
      statusBarItem.text = '$(warning) CodeRun (Offline)';
      statusBarItem.tooltip = 'Cannot reach ' + cfg.provider + ' at ' + cfg.baseUrl + ' - ' + err.message;
    }

    if (webview && typeof webview.postMessage === 'function') {
      webview.postMessage({
        type: 'healthStatus',
        online: false,
        provider: cfg.provider,
        error: err.message,
        models: []
      });
    }
  }
}

async function checkOneSavedProvider(webview, provName, extensionContext, statusBarItem) {
  try {
    var provCfg = await config.getProviderConfigByName(extensionContext, provName);
    await checkProviderHealth(webview, provCfg, extensionContext, statusBarItem);
  } catch (err) {
    console.error('[CODERUN] Failed refreshing provider ' + provName + ':', err.message);
  }
}

export async function refreshAllProviderModels(webview, extensionContext, statusBarItem) {
  if (isRefreshingModels) {
    return;
  }
  isRefreshingModels = true;
  try {
    var allConfigs = config.getAllProviderConfigs(extensionContext);
    var providerKeys = Object.keys(allConfigs);

    if (!providerKeys.length) {
      await checkProviderHealth(webview, null, extensionContext, statusBarItem);
      return;
    }

    var promises = [];
    for (var i = 0; i < providerKeys.length; i++) {
      promises.push(checkOneSavedProvider(webview, providerKeys[i], extensionContext, statusBarItem));
    }
    await Promise.allSettled(promises);
  } finally {
    isRefreshingModels = false;
  }
}
