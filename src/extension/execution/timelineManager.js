// timelineManager.js — Agent Timeline (Session Scoped)
// Records chronological events: tool executions, file edits, terminal runs, etc.
// Stores entries as a JSON array in SQLite metadata keyed by session.
// ContextManager surfaces the timeline for LLM prompt context.

import * as projectKnowledge from '../context/projectKnowledge.js';

var TIMELINE_KEY = 'timeline_data';
var MAX_ENTRIES = 50;

function getSessionTimelineKey(sessionId) {
  return TIMELINE_KEY + (sessionId ? '_' + sessionId : '');
}

// ========================================================
// PUBLIC API
// ========================================================

/**
 * Record a timeline event.
 *
 * Event types:
 *   tool:call      — LLM requested a tool execution
 *   tool:result    — Tool execution succeeded
 *   tool:error     — Tool execution failed
 *   file:read      — File was read
 *   file:write     — File was created/written
 *   file:edit      — File was edited
 *   file:delete    — File was deleted
 *   terminal:run   — Terminal command was executed
 *   session:start  — Chat session started
 *   error          — General error
 */
export function addEvent(type, summary, sessionId) {
  if (!type || !summary) return;

  var entries = loadEntries(sessionId);
  entries.push({
    type: type,
    summary: String(summary).substring(0, 120),
    ts: Date.now()
  });

  // Keep only the most recent entries
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }

  saveEntries(entries, sessionId);
}

/**
 * Record a complete tool execution event derived from its result.
 */
export function addToolEvent(toolName, args, success, message, sessionId) {
  var target = args.file_path || args.command || args.pattern || '';
  var summary = toolName + ': ' + String(target).substring(0, 80);

  if (success !== false) {
    addEvent('tool:result', summary, sessionId);
  } else {
    addEvent('tool:error', summary + ' — ' + String(message || 'failed').substring(0, 60), sessionId);
  }

  // Add file/terminal-specific events for richer timeline
  if (toolName === 'write_file' || toolName === 'edit_file') {
    addEvent('file:' + (toolName === 'write_file' ? 'write' : 'edit'), (args.file_path || ''), sessionId);
  } else if (toolName === 'delete_file') {
    addEvent('file:delete', (args.file_path || ''), sessionId);
  } else if (toolName === 'read_file') {
    addEvent('file:read', (args.file_path || ''), sessionId);
  } else if (toolName === 'run_terminal') {
    addEvent('terminal:run', '$ ' + String(args.command || '').substring(0, 80), sessionId);
  } else if (toolName === 'list_directory') {
    addEvent('tool:result', 'Listed: ' + (args.folder_path || '.'), sessionId);
  } else if (toolName === 'search_files') {
    addEvent('tool:result', 'Searched: ' + (args.pattern || '*'), sessionId);
  }
}

/**
 * Get recent timeline entries as a formatted string for prompt context.
 * Newest first.
 */
export function getRecentContext(limit, sessionId) {
  limit = limit || 8;
  var entries = getRecent(limit, sessionId);
  if (!entries.length) return '';

  var lines = ['## RECENT TIMELINE'];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var time = new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var icon = getEventIcon(e.type);
    lines.push('  [' + time + '] ' + icon + ' ' + e.summary);
  }

  return lines.join('\n');
}

/**
 * Get recent entries as an array of { type, summary, ts }.
 */
export function getRecent(limit, sessionId) {
  limit = limit || 10;
  var entries = loadEntries(sessionId);
  // Return newest first
  var result = [];
  for (var i = entries.length - 1; i >= 0 && result.length < limit; i--) {
    result.push(entries[i]);
  }
  return result;
}

/**
 * Clear all timeline entries for a session.
 */
export function clearAll(sessionId) {
  projectKnowledge.setSetting(getSessionTimelineKey(sessionId), '[]');
}

/**
 * Get formatted timeline with event icons for prompt injection.
 */
export function getTimelinePrompt(limit, sessionId) {
  return getRecentContext(limit, sessionId);
}

// ========================================================
// INTERNAL
// ========================================================

var _sessionCache = {};

function loadEntries(sessionId) {
  var sid = sessionId || 'default';
  if (_sessionCache[sid]) {
    return _sessionCache[sid];
  }
  var key = getSessionTimelineKey(sid);
  var raw = projectKnowledge.getSetting(key);
  if (!raw) {
    _sessionCache[sid] = [];
    return _sessionCache[sid];
  }
  try {
    var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    _sessionCache[sid] = Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    _sessionCache[sid] = [];
  }
  return _sessionCache[sid];
}

function saveEntries(entries, sessionId) {
  var sid = sessionId || 'default';
  _sessionCache[sid] = entries;
  var key = getSessionTimelineKey(sid);
  projectKnowledge.setSetting(key, JSON.stringify(entries));
}

function getEventIcon(type) {
  if (!type) return '•';
  if (type.startsWith('tool:result')) return '✓';
  if (type.startsWith('tool:error')) return '✗';
  if (type.startsWith('file:write')) return '+';
  if (type.startsWith('file:edit')) return '∼';
  if (type.startsWith('file:delete')) return '−';
  if (type.startsWith('file:read')) return '→';
  if (type.startsWith('terminal:run')) return '$';
  if (type.startsWith('session:start')) return '▶';
  if (type === 'error') return '‼';
  return '•';
}
