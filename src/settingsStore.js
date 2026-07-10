// settingsStore.js — Settings storage and retrieval

import { STORAGE_KEYS } from './constants.js';
import { safeJsonParse } from './utils.js';

var _settings = null;

export function loadSettings() {
  if (_settings) return _settings;
  try {
    var raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    _settings = safeJsonParse(raw, {});
  } catch (_) {
    _settings = {};
  }
  return _settings;
}

export function saveSettings(settings) {
  _settings = settings || {};
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(_settings));
  } catch (_) {}
}

export function getSetting(key, defaultValue) {
  var s = loadSettings();
  return s.hasOwnProperty(key) ? s[key] : defaultValue;
}

export function setSetting(key, value) {
  var s = loadSettings();
  s[key] = value;
  saveSettings(s);
}

export function getProviderSettings() {
  return getSetting('provider', {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: '',
    apiKey: ''
  });
}

export function setProviderSettings(settings) {
  setSetting('provider', settings);
}