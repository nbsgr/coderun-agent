// utils.js — Small reusable helpers

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function genId() {
  return 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

export function truncate(s, n) {
  return s.length > n ? s.substring(0, n) + '…' : s;
}

export function flatStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

export function formatTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function debounce(fn, ms) {
  var timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

export function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch (_) { return fallback; }
}

export function clamp(num, min, max) {
  return Math.min(Math.max(num, min), max);
}

export function isEmpty(obj) {
  if (obj == null) return true;
  if (typeof obj === 'string') return obj.trim() === '';
  if (Array.isArray(obj)) return obj.length === 0;
  if (typeof obj === 'object') return Object.keys(obj).length === 0;
  return false;
}

export function pick(obj, keys) {
  var result = {};
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (obj.hasOwnProperty(k)) result[k] = obj[k];
  }
  return result;
}

export function mergeDefaults(target, defaults) {
  var result = {};
  for (var k in defaults) {
    result[k] = target.hasOwnProperty(k) ? target[k] : defaults[k];
  }
  for (var k in target) {
    if (!result.hasOwnProperty(k)) result[k] = target[k];
  }
  return result;
}