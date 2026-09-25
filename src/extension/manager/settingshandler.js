// settingshandler.js (extension side)
// Handles configuration updates, API keys in secrets storage, and saved endpoints
// Strict traditional function declarations only

import * as vscode from 'vscode';
import * as config from '../agents/config.js';
import { PROVIDER_DEFAULTS } from '../agents/constants.js';
import { checkProviderHealth, refreshAllProviderModels } from './modelshandler.js';

export async function sendCurrentSettings(webview, extensionContext) {
  var activeProvider = extensionContext?.globalState.get('coderun_selected_provider', '') || '';
  var cfg;
  if (activeProvider) {
    var saved = config.getSavedProviderConfig(extensionContext, activeProvider) || {};
    var isCompatible = activeProvider.startsWith('compatible');
    var defaults = isCompatible ? PROVIDER_DEFAULTS.compatible : (PROVIDER_DEFAULTS[activeProvider] || PROVIDER_DEFAULTS.ollama);
    var currentSelectedModel = extensionContext?.globalState.get('coderun_selected_model', '') || '';
    var selectedProv = extensionContext?.globalState.get('coderun_selected_provider', '') || '';
    var modelToUse = saved.model || (selectedProv === activeProvider ? currentSelectedModel : '');
    cfg = {
      provider: activeProvider,
      baseUrl: saved.baseUrl || defaults.baseUrl,
      model: modelToUse,
      maxIterations: config.getConfig().maxIterations,
      streaming: config.getConfig().streaming,
      showThinking: config.getConfig().showThinking,
      confirmDangerous: config.getConfig().confirmDangerous
    };
  } else {
    cfg = config.getConfig();
  }

  var hasKey = false;
  try {
    if (activeProvider) {
      var key = await config.getApiKey(extensionContext, activeProvider);
      var savedEntry = config.getSavedProviderConfig(extensionContext, activeProvider);
      hasKey = (Boolean(key) && key.length > 0) || (Boolean(savedEntry) && Boolean(savedEntry.apiKey));
    } else {
      var defaultKey = await config.getApiKey(extensionContext);
      hasKey = Boolean(defaultKey) && defaultKey.length > 0;
    }
  } catch (err) {
    console.debug('[SETTINGS] Error checking API key:', err ? err.message : err);
    hasKey = false;
  }

  var providerConfigs = config.getAllProviderConfigs(extensionContext);
  var hasKeyMap = {};
  var providerKeys = Object.keys(providerConfigs);

  function checkOneKey(pk) {
    function resolveOneKey(pkKey) {
      hasKeyMap[pk] = Boolean(pkKey) && pkKey.length > 0;
    }
    function catchOneKey() {
      hasKeyMap[pk] = false;
    }
    return config.getApiKey(extensionContext, pk)
      .then(resolveOneKey)
      .catch(catchOneKey);
  }

  var keyPromises = [];
  for (var pi = 0; pi < providerKeys.length; pi++) {
    keyPromises.push(checkOneKey(providerKeys[pi]));
  }
  await Promise.all(keyPromises);

  if (webview && typeof webview.postMessage === 'function') {
    webview.postMessage({
      type: 'currentSettings',
      settings: {
        provider: cfg.provider,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        maxIterations: cfg.maxIterations,
        streaming: cfg.streaming,
        showThinking: cfg.showThinking,
        confirmDangerous: cfg.confirmDangerous,
        enableTools: cfg.enableTools !== false,
        hasApiKey: hasKey,
        subagentProvider: config.getConfig().subagentProvider || '',
        subagentModel: config.getConfig().subagentModel || '',
        subagentMaxConcurrent: config.getConfig().subagentMaxConcurrent || 10,
        subagentMaxIterations: config.getConfig().subagentMaxIterations || 20,
        subagentMaxDepth: config.getConfig().subagentMaxDepth || 1
      },
      providerConfigs: providerConfigs,
      providerHasKeyMap: hasKeyMap
    });
  }
}

export async function handleSaveSettings(message, webview, extensionContext, statusBarItem) {
  if (!message.settings) return;
  console.log('[SETTINGS] Saving settings:', JSON.stringify(message.settings));
  try {
    var settingsToUpdate = {};
    if (message.settings.provider !== undefined) settingsToUpdate.provider = message.settings.provider;
    if (message.settings.baseUrl !== undefined) settingsToUpdate.baseUrl = message.settings.baseUrl;
    if (message.settings.model !== undefined) settingsToUpdate.model = message.settings.model;
    if (message.settings.maxIterations !== undefined) settingsToUpdate.maxIterations = message.settings.maxIterations;
    if (message.settings.streaming !== undefined) settingsToUpdate.streaming = message.settings.streaming;
    if (message.settings.showThinking !== undefined) settingsToUpdate.showThinking = message.settings.showThinking;
    if (message.settings.confirmDangerous !== undefined) settingsToUpdate.confirmDangerous = message.settings.confirmDangerous;
    if (message.settings.enableTools !== undefined) settingsToUpdate.enableTools = message.settings.enableTools;
    if (message.settings.subagentProvider !== undefined) settingsToUpdate.subagentProvider = message.settings.subagentProvider;
    if (message.settings.subagentModel !== undefined) settingsToUpdate.subagentModel = message.settings.subagentModel;
    if (message.settings.subagentMaxConcurrent !== undefined) settingsToUpdate.subagentMaxConcurrent = message.settings.subagentMaxConcurrent;
    if (message.settings.subagentMaxIterations !== undefined) settingsToUpdate.subagentMaxIterations = message.settings.subagentMaxIterations;
    if (message.settings.subagentMaxDepth !== undefined) settingsToUpdate.subagentMaxDepth = message.settings.subagentMaxDepth;

    await config.updateSettings(settingsToUpdate, vscode.ConfigurationTarget.Global);

    try {
      var subagentMgr = await import('../agents/subagentManager.js');
      subagentMgr.configureLimits({
        maxConcurrent: settingsToUpdate.subagentMaxConcurrent,
        maxIterations: settingsToUpdate.subagentMaxIterations,
        maxDepth: settingsToUpdate.subagentMaxDepth
      });
      subagentMgr.configureSubagentDefaults({
        provider: settingsToUpdate.subagentProvider || '',
        model: settingsToUpdate.subagentModel || ''
      });
    } catch (limErr) {
      console.error('[SETTINGS] Failed to update subagent limits:', limErr ? limErr.message : limErr);
    }

    if (message.settings.provider !== undefined || message.settings.baseUrl !== undefined || message.settings.model !== undefined || message.apiKey !== undefined) {
      var savedProvider = message.settings.provider || config.getConfig().provider;
      var savedBaseUrl = message.settings.baseUrl || config.getConfig().baseUrl;
      var resolvedApiKey = '';

      if (message.apiKey !== undefined && message.apiKey !== null) {
        if (message.apiKey === '') {
          await config.deleteApiKey(extensionContext, savedProvider);
        } else if (message.apiKey !== '••••••••') {
          await config.setApiKey(extensionContext, message.apiKey, savedProvider);
          resolvedApiKey = message.apiKey;
        } else {
          try {
            resolvedApiKey = await config.getApiKey(extensionContext, savedProvider) || '';
          } catch (keyErr) {
            console.debug('[SETTINGS] Error reading stored key:', keyErr ? keyErr.message : keyErr);
          }
        }
      }

      await config.saveProviderConfig(extensionContext, savedProvider, {
        baseUrl: savedBaseUrl,
        apiKey: resolvedApiKey,
        model: message.settings.model || '',
        apiType: message.settings.apiType || 'openai'
      });

      var overrideCfg = await config.getProviderConfigWithKey(extensionContext);
      if (message.settings.provider) overrideCfg.provider = message.settings.provider;
      if (message.settings.baseUrl) overrideCfg.baseUrl = message.settings.baseUrl;
      if (message.settings.model) overrideCfg.model = message.settings.model;

      await checkProviderHealth(webview, overrideCfg, extensionContext, statusBarItem);
      await refreshAllProviderModels(webview, extensionContext, statusBarItem);
    }

    await sendCurrentSettings(webview, extensionContext);
  } catch (e) {
    console.error('[SETTINGS] Failed to save settings:', e);
    if (webview && typeof webview.postMessage === 'function') {
      webview.postMessage({ type: 'showAlert', message: 'Failed to save settings: ' + e.message });
    }
  }
}

export async function handleSaveApiKey(message, webview, extensionContext, statusBarItem) {
  if (message.apiKey !== undefined && extensionContext) {
    if (message.apiKey === '') {
      await config.deleteApiKey(extensionContext);
    } else {
      await config.setApiKey(extensionContext, message.apiKey);
    }
    await sendCurrentSettings(webview, extensionContext);
    await checkProviderHealth(webview, null, extensionContext, statusBarItem);
    await refreshAllProviderModels(webview, extensionContext, statusBarItem);
  }
}

export async function handleRemoveProviderConfig(message, webview, extensionContext, statusBarItem) {
  if (message.provider && extensionContext) {
    await config.deleteProviderConfig(extensionContext, message.provider);
    await sendCurrentSettings(webview, extensionContext);
    await refreshAllProviderModels(webview, extensionContext, statusBarItem);
  }
}

export async function handleSaveSelectedModel(message, webview, extensionContext) {
  if (message.model && extensionContext) {
    try {
      await extensionContext.globalState.update('coderun_selected_model', message.model);
    } catch (e) {
      console.error('[SETTINGS] Failed to save model:', e ? e.message : e);
    }
  }
  if (message.provider !== undefined && extensionContext) {
    try {
      await extensionContext.globalState.update('coderun_selected_provider', message.provider);
    } catch (e) {
      console.error('[SETTINGS] Failed to save provider:', e ? e.message : e);
    }
  }
  if (message.provider && message.model && extensionContext) {
    try {
      var existingCfg = config.getSavedProviderConfig(extensionContext, message.provider) || {};
      existingCfg.model = message.model;
      await config.saveProviderConfig(extensionContext, message.provider, existingCfg);
    } catch (e) {
      console.error('[SETTINGS] Failed to update provider model config:', e ? e.message : e);
    }
  }
  await sendCurrentSettings(webview, extensionContext);
}

export async function handleSavePinnedModels(message, extensionContext) {
  if (message.pinnedModels && extensionContext) {
    try {
      await extensionContext.globalState.update('coderun_pinned_models', message.pinnedModels);
    } catch (e) {
      console.error('[SETTINGS] Failed to save pinned models:', e ? e.message : e);
    }
  }
}
