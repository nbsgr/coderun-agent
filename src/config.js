// config.js — Reads VS Code settings and merges with defaults
// All provider config (URL, API key, model name) is read from VS Code user settings.

import * as vscode from 'vscode';
import { PROVIDER_DEFAULTS, STORAGE_KEYS } from './constants.js';

var _cached = null;

/**
 * Get the full configuration from VS Code settings.
 * Settings are read from User Settings > Workspace Settings > Default values.
 */
export function getConfig() {
  if (_cached) return _cached;
  var cfg = vscode.workspace.getConfiguration('coderun');
  _cached = {
    provider: cfg.get('provider', 'ollama'),
    baseUrl: cfg.get('baseUrl', 'http://localhost:11434'),
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

/**
 * Build provider configuration object for API calls.
 * Reads baseUrl, model, provider from VS Code settings.
 * API key is read from VS Code secrets (not settings).
 */
export function getProviderConfig() {
  var cfg = getConfig();
  var defaults = PROVIDER_DEFAULTS[cfg.provider] || PROVIDER_DEFAULTS.ollama;
  return {
    provider: cfg.provider,
    baseUrl: cfg.baseUrl || defaults.baseUrl,
    model: cfg.model,
    needsKey: defaults.needsKey,
    organization: cfg.organization,
    project: cfg.project
  };
}

/**
 * Get provider config with API key resolved from secrets.
 * This is the complete config needed to make API calls.
 */
export async function getProviderConfigWithKey(context) {
  var cfg = getProviderConfig();
  if (needsApiKey(cfg.provider)) {
    cfg.apiKey = await getApiKey(context) || '';
  } else {
    cfg.apiKey = '';
  }
  return cfg;
}

/**
 * Get API key from VS Code secrets storage (encrypted).
 */
export function getApiKey(context) {
  return context.secrets.get('coderun.apiKey');
}

/**
 * Save API key to VS Code secrets storage (encrypted).
 */
export async function setApiKey(context, key) {
  await context.secrets.store('coderun.apiKey', key);
}

/**
 * Delete API key from VS Code secrets storage.
 */
export async function deleteApiKey(context) {
  await context.secrets.delete('coderun.apiKey');
}

export function getOllamaUrl() {
  var cfg = getConfig();
  return String(cfg.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
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

/**
 * Update a VS Code setting. This writes to User Settings by default.
 */
export async function updateSetting(key, value, target) {
  target = target || vscode.ConfigurationTarget.Global;
  var cfg = vscode.workspace.getConfiguration('coderun');
  await cfg.update(key, value, target);
  invalidateCache();
}

/**
 * Update multiple settings at once.
 */
export async function updateSettings(settings, target) {
  target = target || vscode.ConfigurationTarget.Global;
  var cfg = vscode.workspace.getConfiguration('coderun');
  for (var key in settings) {
    await cfg.update(key, settings[key], target);
  }
  invalidateCache();
}

/**
 * Check if a provider requires an API key.
 */
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
// Stores multiple provider configurations (baseUrl, apiKey, model)
// in VS Code globalState under coderun_provider_configs.
// ============================================================

/**
 * Get all saved provider configurations from globalState.
 * Returns an object like { ollama: { baseUrl, apiKey, model }, groq: {...} }
 */
export function getAllProviderConfigs(context) {
  if (!context) return {};
  try {
    var raw = context.globalState.get(STORAGE_KEYS.PROVIDER_CONFIGS, '{}');
    return JSON.parse(raw) || {};
  } catch (e) {
    return {};
  }
}

/**
 * Get a single provider's saved configuration.
 */
export function getSavedProviderConfig(context, provider) {
  var all = getAllProviderConfigs(context);
  return all[provider] || null;
}

/**
 * Save a provider's configuration.
 * config: { baseUrl, apiKey, model? }
 */
export async function saveProviderConfig(context, provider, config) {
  if (!context || !provider) return;
  var all = getAllProviderConfigs(context);
  all[provider] = {
    baseUrl: config.baseUrl || '',
    apiKey: config.apiKey || '',
    model: config.model || ''
  };
  await context.globalState.update(STORAGE_KEYS.PROVIDER_CONFIGS, JSON.stringify(all));
}

/**
 * Delete a provider's saved configuration.
 */
export async function deleteProviderConfig(context, provider) {
  if (!context || !provider) return;
  var all = getAllProviderConfigs(context);
  delete all[provider];
  await context.globalState.update(STORAGE_KEYS.PROVIDER_CONFIGS, JSON.stringify(all));
}

/**
 * Get the API key for a specific provider from its saved config.
 */
export function getProviderApiKey(context, provider) {
  var saved = getSavedProviderConfig(context, provider);
  return saved ? (saved.apiKey || '') : '';
}

/**
 * Build a full provider config for API calls by merging the saved config
 * with defaults. Used by extension.js when starting a chat with a specific provider.
 */
export async function getProviderConfigByName(context, providerName) {
  var saved = getSavedProviderConfig(context, providerName) || {};
  var isCompatible = providerName.startsWith('compatible');
  var defaults = isCompatible ? PROVIDER_DEFAULTS.compatible : (PROVIDER_DEFAULTS[providerName] || PROVIDER_DEFAULTS.ollama);
  return {
    provider: providerName,
    baseUrl: saved.baseUrl || defaults.baseUrl,
    model: saved.model || '',
    apiKey: saved.apiKey || '',
    needsKey: defaults.needsKey
  };
}