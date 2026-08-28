// memoryManager.js — Manages structured agent memory across execution runs (Session Scoped)
// Persisted in SQLite project metadata via projectKnowledge.

import * as projectKnowledge from './projectKnowledge.js';
import * as runtime from '../agents/runtime.js';

var PREFIX = 'mem_';
var _memCacheBySession = {}; // { [sessionId]: { [key]: value } }

function getSessionCache(sessionId) {
  var sid = sessionId || 'default';
  if (!_memCacheBySession[sid]) {
    _memCacheBySession[sid] = {};
  }
  return _memCacheBySession[sid];
}

function getVal(key, fallback, sessionId) {
  var sid = sessionId || 'default';
  var cache = getSessionCache(sid);
  if (Object.prototype.hasOwnProperty.call(cache, key)) {
    return cache[key];
  }
  var raw = null;
  try {
    raw = projectKnowledge.getSetting(PREFIX + sid + '_' + key);
  } catch (_) {}
  if (raw === null || raw === undefined) return fallback;
  try {
    var parsed = JSON.parse(raw);
    cache[key] = parsed;
    return parsed;
  } catch (_) {
    cache[key] = raw;
    return raw;
  }
}

function setVal(key, value, sessionId) {
  var sid = sessionId || 'default';
  var cache = getSessionCache(sid);
  cache[key] = value;
  var str = JSON.stringify(value);
  try {
    projectKnowledge.setSetting(PREFIX + sid + '_' + key, str);
  } catch (_) {
    // Intentionally ignored
  }
  try {
    runtime.setMemory(key, value, sid);
  } catch (_) {
    // Intentionally ignored
  }
}

export function getCurrentGoal(sessionId) { return getVal('currentGoal', '', sessionId); }
export function setCurrentGoal(goal, sessionId) { setVal('currentGoal', goal, sessionId); }

export function getTaskHistory(sessionId) { return getVal('taskHistory', [], sessionId); }
export function recordTaskExecution(toolName, args, resultSummary, sessionId) {
  var history = getTaskHistory(sessionId);
  history.push({ tool: toolName, args: args, summary: resultSummary, ts: Date.now() });
  setVal('taskHistory', history, sessionId);
}

export function getCompletedSteps(sessionId) { return getVal('completedSteps', [], sessionId); }
export function setCompletedSteps(steps, sessionId) { setVal('completedSteps', steps, sessionId); }

export function getRemainingSteps(sessionId) { return getVal('remainingSteps', [], sessionId); }
export function setRemainingSteps(steps, sessionId) { setVal('remainingSteps', steps, sessionId); }

export function getFilesCreated(sessionId) { return getVal('filesCreated', [], sessionId); }
export function recordFileCreated(filePath, sessionId) {
  var files = getFilesCreated(sessionId);
  if (files.indexOf(filePath) === -1) {
    files.push(filePath);
    setVal('filesCreated', files, sessionId);
  }
}

export function getFilesModified(sessionId) { return getVal('filesModified', [], sessionId); }
export function recordFileModified(filePath, sessionId) {
  var files = getFilesModified(sessionId);
  if (files.indexOf(filePath) === -1) {
    files.push(filePath);
    setVal('filesModified', files, sessionId);
  }
}

export function getAllChangedFiles(sessionId) {
  var modified = getFilesModified(sessionId);
  var created = getFilesCreated(sessionId);
  var combined = [];
  for (var i = 0; i < modified.length; i++) {
    if (combined.indexOf(modified[i]) === -1) combined.push(modified[i]);
  }
  for (var j = 0; j < created.length; j++) {
    if (combined.indexOf(created[j]) === -1) combined.push(created[j]);
  }
  return combined;
}

export function getCommandsExecuted(sessionId) { return getVal('commandsExecuted', [], sessionId); }
export function recordCommandExecuted(command, sessionId) {
  var cmds = getCommandsExecuted(sessionId);
  cmds.push({ command: command, ts: Date.now() });
  setVal('commandsExecuted', cmds, sessionId);
}

export function getErrors(sessionId) { return getVal('errors', [], sessionId); }
export function recordError(errorMsg, sessionId) {
  var errs = getErrors(sessionId);
  errs.push({ error: errorMsg, ts: Date.now() });
  setVal('errors', errs, sessionId);
}

export function getWarnings(sessionId) { return getVal('warnings', [], sessionId); }
export function recordWarning(warningMsg, sessionId) {
  var warns = getWarnings(sessionId);
  warns.push({ warning: warningMsg, ts: Date.now() });
  setVal('warnings', warns, sessionId);
}

export function getRetries(sessionId) { return getVal('retries', {}, sessionId); }
export function recordRetry(key, sessionId) {
  var retries = getRetries(sessionId);
  retries[key] = (retries[key] || 0) + 1;
  setVal('retries', retries, sessionId);
}

export function getWorkspaceFacts(sessionId) { return getVal('workspaceFacts', {}, sessionId); }
export function learnFact(key, value, sessionId) {
  var facts = getWorkspaceFacts(sessionId);
  facts[key] = value;
  setVal('workspaceFacts', facts, sessionId);
}

export function getUserDecisions(sessionId) { return getVal('userDecisions', [], sessionId); }
export function recordUserDecision(toolName, action, decision, sessionId) {
  var decs = getUserDecisions(sessionId);
  decs.push({ tool: toolName, action: action, decision: decision, ts: Date.now() });
  setVal('userDecisions', decs, sessionId);
}

export function clear(sessionId) {
  var sid = sessionId || 'default';
  delete _memCacheBySession[sid];
  var keys = [
    'currentGoal', 'taskHistory', 'completedSteps', 'remainingSteps',
    'filesCreated', 'filesModified', 'commandsExecuted', 'errors',
    'warnings', 'retries', 'workspaceFacts', 'userDecisions'
  ];
  for (var i = 0; i < keys.length; i++) {
    projectKnowledge.setSetting(PREFIX + sid + '_' + keys[i], null);
  }
}

export function getPromptFragment(sessionId) {
  var facts = getWorkspaceFacts(sessionId);
  var lines = [];
  var factKeys = Object.keys(facts);
  if (factKeys.length > 0) {
    lines.push('### LEARNED WORKSPACE FACTS:');
    for (var i = 0; i < factKeys.length; i++) {
      lines.push('  - ' + factKeys[i] + ': ' + JSON.stringify(facts[factKeys[i]]));
    }
  }
  var filesCreated = getFilesCreated(sessionId);
  if (filesCreated.length > 0) {
    lines.push('### CREATED FILES: ' + filesCreated.join(', '));
  }
  var filesModified = getFilesModified(sessionId);
  if (filesModified.length > 0) {
    lines.push('### MODIFIED FILES: ' + filesModified.join(', '));
  }
  return lines.join('\n');
}