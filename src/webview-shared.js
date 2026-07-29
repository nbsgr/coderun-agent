// webview-shared.js — Shared utilities for the webview context
// Follows the same IIFE + window pattern as MarkdownRenderer.js
// Dashboard.js and ChatSpace.js reference these instead of duplicating.
// The canonical implementations live in utils.js (extension host context);
// this file mirrors the subset needed in the sandboxed webview.

(function () {
  'use strict';

  /**
   * HTML-escape a string.
   */
  window.sharedEsc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  /**
   * Truncate a string to n characters with ellipsis.
   */
  window.sharedTruncate = function (s, n) {
    return s.length > n ? s.substring(0, n) + '\u2026' : s;
  };

  /**
   * Convert a value to a flat string representation.
   */
  window.sharedFlatStr = function (v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  };

  /**
   * Format a timestamp to a localized time string.
   */
  window.sharedFormatTime = function (ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  /**
   * Strip ANSI escape sequences, shell integration markers, and control
   * characters from terminal output. Keeps only human-readable text.
   * This is the canonical client-side implementation.
   */
  window.sharedStripAnsi = function (text) {
    if (!text) return '';
    return String(text)
      .replace(/\x1B\]\d+(?:;[^\x1B]*)*(?:\x1B\\)/g, '')
      .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1B\][^\x1B]*[\x07\x1B]/g, '')
      .replace(/\x07/g, '')
      .replace(/\x1B[\x5D\x5B][^\x1B]*[\x07\x5C]/g, '')
      .replace(/\x1B[\[\]()][0-9;]*[~A-Za-z]/g, '')
      .replace(/\x1B[\[\]()]/g, '')
      .replace(/\x1B[^\[\]()\s]/g, '')
      .replace(/\]633;/g, '')
      .replace(/\]133;/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
  };

  /**
   * Generate a unique identifier for conversations and messages.
   */
  window.sharedGenId = function () {
    return 'cr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  };

  /**
   * Safely parse JSON with a fallback value.
   */
  window.sharedSafeJsonParse = function (str, fallback) {
    try { return JSON.parse(str); } catch (_) { return fallback; }
  };

  console.log('[WEBVIEW SHARED] Utilities loaded');
})();
