// config.js — Reads VS Code settings and merges with defaults
// All provider config (URL, model name) is read from VS Code settings and globalState.
// API keys are stored exclusively in VS Code encrypted secrets store.

import * as vscode from 'vscode';
import { PROVIDER_DEFAULTS, STORAGE_KEYS } from './constants.js';

var _cached = null;

// Get the full configuration from VS Code settings.
export function getConfig() {
  if (_cached) return _cached;
  var cfg = vscode.workspace.getConfiguration('coderun');
  _cached = {
    provider: cfg.get('provider', 'ollama'),
    baseUrl: cfg.get('baseUrl', 'http://localhost:11434/v1'),
    model: cfg.get('model', ''),
    maxIterations: cfg.get('maxIterations', 20),
    streaming: cfg.get('streaming', true),
    showThinking: cfg.get('showThinking', true),
    autoScroll: cfg.get('autoScroll', true),
    confirmDangerous: cfg.get('confirmDangerous', true),
    organization: cfg.get('organization', null),
    project: cfg.get('project', null)
  };
  return _cached;
}

export function invalidateCache() {
  _cached = null;
}

// Build provider configuration object for API calls.
export function getProviderConfig() {
  var cfg = getConfig();
  var defaults = PROVIDER_DEFAULTS[cfg.provider] || PROVIDER_DEFAULTS.ollama;
  return {
    provider: cfg.provider,
    baseUrl: cfg.baseUrl || defaults.baseUrl,
    model: cfg.model,
    maxIterations: cfg.maxIterations,
    needsKey: defaults.needsKey,
    organization: cfg.organization,
    project: cfg.project
  };
}

// Get provider config with API key resolved from secrets.
export async function getProviderConfigWithKey(context) {
  var cfg = getProviderConfig();
  if (needsApiKey(cfg.provider)) {
    cfg.apiKey = await getApiKey(context, cfg.provider) || await getApiKey(context) || '';
  } else {
    cfg.apiKey = '';
  }
  return cfg;
}

// Get API key from VS Code secrets storage (encrypted).
export function getApiKey(context, provider) {
  if (provider) {
    return context.secrets.get('coderun.apiKey.' + provider);
  }
  return context.secrets.get('coderun.apiKey');
}

// Save API key to VS Code secrets storage (encrypted).
export async function setApiKey(context, key, provider) {
  if (provider) {
    await context.secrets.store('coderun.apiKey.' + provider, key);
  } else {
    await context.secrets.store('coderun.apiKey', key);
  }
}

// Delete API key from VS Code secrets storage.
export async function deleteApiKey(context, provider) {
  if (provider) {
    await context.secrets.delete('coderun.apiKey.' + provider);
  } else {
    await context.secrets.delete('coderun.apiKey');
  }
}

export function getOllamaUrl() {
  var cfg = getConfig();
  return String(cfg.baseUrl || 'http://localhost:11434/v1').replace(/\/+$/, '');
}

export function getMaxIterations() {
  return getConfig().maxIterations;
}

export function shouldConfirmDangerous() {
  return getConfig().confirmDangerous;
}

export function isStreamingEnabled() {
  return getConfig().streaming;
}

export function shouldShowThinking() {
  return getConfig().showThinking;
}

// Update a VS Code setting.
export async function updateSetting(key, value, target) {
  target = target || vscode.ConfigurationTarget.Global;
  var cfg = vscode.workspace.getConfiguration('coderun');
  await cfg.update(key, value, target);
  invalidateCache();
}

// Update multiple settings at once.
export async function updateSettings(settings, target) {
  target = target || vscode.ConfigurationTarget.Global;
  var cfg = vscode.workspace.getConfiguration('coderun');
  for (var key in settings) {
    await cfg.update(key, settings[key], target);
  }
  invalidateCache();
}

// Check if a provider requires an API key.
export function needsApiKey(provider) {
  if (provider && provider.startsWith('compatible')) {
    return true;
  }
  var needs = {
    ollama: false,
    openai: true,
    anthropic: true,
    gemini: true,
    openrouter: true,
    xai: true,
    groq: true,
    compatible: true
  };
  return needs[provider] || false;
}

// ============================================================
// MULTI-PROVIDER CONFIG STORAGE
// Stores provider non-sensitive settings (baseUrl, model, apiType)
// in VS Code globalState under coderun_provider_configs.
// API keys are strictly excluded from globalState.
// ============================================================

// Get all saved provider configurations from globalState.
export function getAllProviderConfigs(context) {
  if (!context) return {};
  try {
    var raw = context.globalState.get(STORAGE_KEYS.PROVIDER_CONFIGS, '{}');
    var configs = JSON.parse(raw) || {};
    // Strip any legacy plaintext apiKey properties if present
    for (var k in configs) {
      if (configs[k] && configs[k].apiKey) {
        delete configs[k].apiKey;
      }
    }
    return configs;
  } catch (e) {
    return {};
  }
}

// Get a single provider's saved configuration.
export function getSavedProviderConfig(context, provider) {
  var all = getAllProviderConfigs(context);
  return all[provider] || null;
}

// Save a provider's configuration without storing apiKey in globalState.
export async function saveProviderConfig(context, provider, config) {
  if (!context || !provider) return;
  var all = getAllProviderConfigs(context);
  all[provider] = {
    baseUrl: config.baseUrl || '',
    model: config.model || '',
    apiType: config.apiType || 'openai'
  };
  await context.globalState.update(STORAGE_KEYS.PROVIDER_CONFIGS, JSON.stringify(all));
}

// Delete a provider's saved configuration.
export async function deleteProviderConfig(context, provider) {
  if (!context || !provider) return;
  var all = getAllProviderConfigs(context);
  delete all[provider];
  await context.globalState.update(STORAGE_KEYS.PROVIDER_CONFIGS, JSON.stringify(all));
}

// Get the API key for a specific provider strictly from secrets store.
export async function getProviderApiKey(context, provider) {
  return await getApiKey(context, provider);
}

// Build a full provider config for API calls by merging saved config with secrets.
export async function getProviderConfigByName(context, providerName) {
  var cfg = getConfig();
  var saved = getSavedProviderConfig(context, providerName) || {};
  var isCompatible = providerName.startsWith('compatible');
  var defaults = isCompatible ? PROVIDER_DEFAULTS.compatible : (PROVIDER_DEFAULTS[providerName] || PROVIDER_DEFAULTS.ollama);

  var apiKey = '';
  if (needsApiKey(providerName)) {
    apiKey = await getApiKey(context, providerName) || await getApiKey(context) || '';
  }

  return {
    provider: providerName,
    baseUrl: saved.baseUrl || defaults.baseUrl,
    model: saved.model || '',
    maxIterations: cfg.maxIterations,
    apiKey: apiKey,
    needsKey: defaults.needsKey,
    apiType: saved.apiType || 'openai'
  };
}