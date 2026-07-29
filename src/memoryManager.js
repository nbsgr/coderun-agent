// memoryManager.js — Manages structured agent memory across execution runs
// Persisted in SQLite project metadata via projectKnowledge.

import * as projectKnowledge from './projectKnowledge.js';
import * as runtime from './runtime.js';

var PREFIX = 'mem_';

function getVal(key, fallback) {
  var raw = projectKnowledge.getSetting(PREFIX + key);
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return raw;
  }
}

function setVal(key, value) {
  var str = JSON.stringify(value);
  projectKnowledge.setSetting(PREFIX + key, str);
  // Synchronize with runtime memory state
  try {
    runtime.setMemory(key, value);
  } catch (_) {}
}

export function getCurrentGoal() { return getVal('currentGoal', ''); }
export function setCurrentGoal(goal) { setVal('currentGoal', goal); }

export function getTaskHistory() { return getVal('taskHistory', []); }
export function recordTaskExecution(toolName, args, resultSummary) {
  var history = getTaskHistory();
  history.push({ tool: toolName, args: args, summary: resultSummary, ts: Date.now() });
  setVal('taskHistory', history);
}

export function getCompletedSteps() { return getVal('completedSteps', []); }
export function setCompletedSteps(steps) { setVal('completedSteps', steps); }

export function getRemainingSteps() { return getVal('remainingSteps', []); }
export function setRemainingSteps(steps) { setVal('remainingSteps', steps); }

export function getFilesCreated() { return getVal('filesCreated', []); }
export function recordFileCreated(filePath) {
  var files = getFilesCreated();
  if (files.indexOf(filePath) === -1) {
    files.push(filePath);
    setVal('filesCreated', files);
  }
}

export function getFilesModified() { return getVal('filesModified', []); }
export function recordFileModified(filePath) {
  var files = getFilesModified();
  if (files.indexOf(filePath) === -1) {
    files.push(filePath);
    setVal('filesModified', files);
  }
}

export function getCommandsExecuted() { return getVal('commandsExecuted', []); }
export function recordCommandExecuted(command) {
  var cmds = getCommandsExecuted();
  cmds.push({ command: command, ts: Date.now() });
  setVal('commandsExecuted', cmds);
}

export function getErrors() { return getVal('errors', []); }
export function recordError(errorMsg) {
  var errs = getErrors();
  errs.push({ error: errorMsg, ts: Date.now() });
  setVal('errors', errs);
}

export function getWarnings() { return getVal('warnings', []); }
export function recordWarning(warningMsg) {
  var warns = getWarnings();
  warns.push({ warning: warningMsg, ts: Date.now() });
  setVal('warnings', warns);
}

export function getRetries() { return getVal('retries', {}); }
export function recordRetry(key) {
  var retries = getRetries();
  retries[key] = (retries[key] || 0) + 1;
  setVal('retries', retries);
}

export function getWorkspaceFacts() { return getVal('workspaceFacts', {}); }
export function learnFact(key, value) {
  var facts = getWorkspaceFacts();
  facts[key] = value;
  setVal('workspaceFacts', facts);
}

export function getUserDecisions() { return getVal('userDecisions', []); }
export function recordUserDecision(toolName, action, decision) {
  var decs = getUserDecisions();
  decs.push({ tool: toolName, action: action, decision: decision, ts: Date.now() });
  setVal('userDecisions', decs);
}

export function clear() {
  var keys = [
    'currentGoal', 'taskHistory', 'completedSteps', 'remainingSteps',
    'filesCreated', 'filesModified', 'commandsExecuted', 'errors',
    'warnings', 'retries', 'workspaceFacts', 'userDecisions'
  ];
  for (var i = 0; i < keys.length; i++) {
    projectKnowledge.setSetting(PREFIX + keys[i], null);
  }
}

export function getPromptFragment() {
  var facts = getWorkspaceFacts();
  var lines = [];
  var factKeys = Object.keys(facts);
  if (factKeys.length > 0) {
    lines.push('### LEARNED WORKSPACE FACTS:');
    for (var i = 0; i < factKeys.length; i++) {
      lines.push('  - ' + factKeys[i] + ': ' + JSON.stringify(facts[factKeys[i]]));
    }
  }
  var filesCreated = getFilesCreated();
  if (filesCreated.length > 0) {
    lines.push('### CREATED FILES: ' + filesCreated.join(', '));
  }
  var filesModified = getFilesModified();
  if (filesModified.length > 0) {
    lines.push('### MODIFIED FILES: ' + filesModified.join(', '));
  }
  return lines.join('\n');
}