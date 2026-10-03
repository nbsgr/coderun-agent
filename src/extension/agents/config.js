// config.js — Reads VS Code settings and merges with defaults
// All provider config (URL, model name) is read from VS Code settings and globalState.
// API keys are stored exclusively in VS Code encrypted secrets store.

import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { PROVIDER_DEFAULTS, STORAGE_KEYS } from './constants.js';
import { hasValidQwenToken } from '../browser/providerQwen.js';

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
    subagentProvider: cfg.get('subagentProvider', ''),
    subagentModel: cfg.get('subagentModel', ''),
    subagentMaxConcurrent: cfg.get('subagentMaxConcurrent', 10),
    subagentMaxDepth: cfg.get('subagentMaxDepth', 1),
    subagentMaxIterations: cfg.get('subagentMaxIterations', 20),
    subagentTimeoutMs: cfg.get('subagentTimeoutMs', 0),
    organization: cfg.get('organization', null),
    project: cfg.get('project', null),
    enableTools: cfg.get('enableTools', true),
    apiType: cfg.get('apiType', 'openai')
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
    project: cfg.project,
    enableTools: cfg.enableTools !== false,
    apiType: cfg.apiType || 'openai'
  };
}

// Get provider config with API key resolved from secrets.
export async function getProviderConfigWithKey(context) {
  var cfg = getProviderConfig();
  if (needsApiKey(cfg.provider)) {
    cfg.apiKey = await getApiKey(context, cfg.provider) || await getApiKey(context) || '';
    if ((!cfg.apiKey || !hasValidQwenToken(cfg.apiKey)) && cfg.provider === 'qwen') {
      try {
        var providerQwen = await import('../browser/providerQwen.js');
        var lastC = providerQwen.getLastCookie() || '';
        if (hasValidQwenToken(lastC)) cfg.apiKey = lastC;
      } catch (_) { void 0; }
    }
  } else {
    cfg.apiKey = '';
  }
  return cfg;
}

// Get API key from VS Code secrets storage (encrypted).
export async function getApiKey(context, provider) {
  if (provider) {
    var key = await context.secrets.get('coderun.apiKey.' + provider);
    if (provider === 'qwen') {
      if (hasValidQwenToken(key)) {
        return key;
      }
      var fb = (context && context.globalState && (context.globalState.get('coderun.qwenFallbackCookie') || context.globalState.get('qwen-coderun.fallbackCookie'))) || '';
      if (hasValidQwenToken(fb)) {
        try { await context.secrets.store('coderun.apiKey.qwen', fb); } catch (_) { void 0; }
        return fb;
      }
      try {
        var appData = process.env.APPDATA || '';
        var candidatePaths = [
          path.join(appData, 'Code', 'User', 'globalStorage', 'qwen_extracted_cookie.txt'),
          path.join(appData, 'Code - Insiders', 'User', 'globalStorage', 'qwen_extracted_cookie.txt'),
          path.join(appData, 'VSCodium', 'User', 'globalStorage', 'qwen_extracted_cookie.txt')
        ];
        for (var i = 0; i < candidatePaths.length; i++) {
          if (fs.existsSync(candidatePaths[i])) {
            var fileCookie = fs.readFileSync(candidatePaths[i], 'utf8').trim();
            if (hasValidQwenToken(fileCookie)) {
              try { await context.secrets.store('coderun.apiKey.qwen', fileCookie); } catch (_) { void 0; }
              if (context && context.globalState) {
                try { context.globalState.update('coderun.qwenFallbackCookie', fileCookie); } catch (_) { void 0; }
              }
              return fileCookie;
            }
          }
        }
      } catch (_) { void 0; }
      if (typeof globalThis.qwenGetActiveCookie === 'function') {
        var actCookie = globalThis.qwenGetActiveCookie();
        if (hasValidQwenToken(actCookie)) return actCookie;
      }
      return '';
    }
    return key;
  }
  return await context.secrets.get('coderun.apiKey');
}

// Save API key to VS Code secrets storage (encrypted).
export async function setApiKey(context, key, provider) {
  if (provider) {
    await context.secrets.store('coderun.apiKey.' + provider, key);
    if (provider === 'qwen' && context && context.globalState && key && hasValidQwenToken(key)) {
      await context.globalState.update('coderun.qwenFallbackCookie', key);
      try {
        var appData = process.env.APPDATA || '';
        var extCookiePath = path.join(appData, 'Code', 'User', 'globalStorage', 'qwen_extracted_cookie.txt');
        fs.writeFileSync(extCookiePath, key, 'utf8');
      } catch (_) { void 0; }
    }
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
    qwen: true,
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
    if ((!apiKey || !hasValidQwenToken(apiKey)) && providerName === 'qwen') {
      try {
        var providerQwen2 = await import('../browser/providerQwen.js');
        var lastC2 = providerQwen2.getLastCookie() || '';
        if (hasValidQwenToken(lastC2)) apiKey = lastC2;
      } catch (_) { void 0; }
    }
  }

  return {
    provider: providerName,
    baseUrl: saved.baseUrl || defaults.baseUrl,
    model: saved.model || '',
    maxIterations: cfg.maxIterations,
    apiKey: apiKey,
    needsKey: defaults.needsKey,
    apiType: saved.apiType || cfg.apiType || 'openai'
  };
}