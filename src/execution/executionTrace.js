// executionTrace.js — Real-Time Execution Trace Engine
// Collects and serializes hierarchical trace data (User prompt, LLM calls, Tool calls, Results, Final response)
// and persists per-chat runs to VS Code globalStorage and local files.

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

var _activeTracesBySession = {};
var _completedTracesBySession = {};

function createNewRun(sessionId, runId, userQuery, contextData, model, provider) {
  var now = Date.now();
  return {
    id: runId || 'run_' + now + '_' + Math.random().toString(36).substring(2, 8),
    sessionId: sessionId || 'session_' + now,
    startedAt: now,
    completedAt: 0,
    durationMs: 0,
    status: 'running',
    provider: provider || 'ollama',
    model: model || '',
    user: {
      query: userQuery || '',
      images: (contextData && contextData.images) || [],
      context: {
        workspaceFolder: (contextData && contextData.workspaceFolder) || '',
        openFiles: (contextData && contextData.openFiles) || [],
        systemPromptTokens: (contextData && contextData.systemPromptTokens) || 0
      }
    },
    steps: [],
    finalResponse: {
      text: '',
      thinking: '',
      durationMs: 0
    },
    metrics: {
      totalDurationMs: 0,
      totalTokens: { input: 0, output: 0, total: 0 },
      toolsExecuted: 0,
      filesTouched: []
    },
    transitions: [],
    events: [],
    observations: [],
    decisions: []
  };
}

export function startRun(sessionId, runId, userQuery, contextData, model, provider, isContinuation) {
  if (!sessionId) sessionId = 'session_' + Date.now();

  if (!_completedTracesBySession[sessionId]) {
    _completedTracesBySession[sessionId] = [];
  }

  // If continuing an active/paused trace, resume it to retain the entire execution
  if (_activeTracesBySession[sessionId] && (isContinuation || !userQuery || userQuery === 'Continue')) {
    var existingActive = _activeTracesBySession[sessionId];
    existingActive.status = 'running';
    existingActive.completedAt = 0;
    return existingActive;
  }

  if (_activeTracesBySession[sessionId]) {
    var prev = _activeTracesBySession[sessionId];
    if (prev.status === 'running') {
      prev.status = prev.error ? 'failed' : 'completed';
      prev.completedAt = Date.now();
      prev.durationMs = prev.completedAt - prev.startedAt;
      prev.asciiTree = generateAsciiTree(prev);
      var alreadyIn = false;
      for (var p = 0; p < _completedTracesBySession[sessionId].length; p++) {
        if (_completedTracesBySession[sessionId][p].id === prev.id) {
          alreadyIn = true;
          _completedTracesBySession[sessionId][p] = prev;
          break;
        }
      }
      if (!alreadyIn) {
        _completedTracesBySession[sessionId].push(prev);
      }
    }
  }

  var run = createNewRun(sessionId, runId, userQuery, contextData, model, provider);
  _activeTracesBySession[sessionId] = run;
  return run;
}

export function startTrace(sessionId, goal) {
  return startRun(sessionId, null, goal, {}, '', '');
}

export function recordTransition(sessionId, from, to) {
  var trace = getActiveTrace(sessionId);
  if (trace) {
    trace.transitions.push({ from: from, to: to, ts: Date.now() });
  }
}

export function recordEvent(sessionId, event, data) {
  var trace = getActiveTrace(sessionId);
  if (trace) {
    trace.events.push({ event: event, data: data, ts: Date.now() });
  }
}

export function recordDecision(sessionId, tool, decision, reason) {
  var trace = getActiveTrace(sessionId);
  if (trace) {
    trace.decisions.push({ tool: tool, decision: decision, reason: reason || '', ts: Date.now() });
  }
}

export function recordObservation(sessionId, observation) {
  var trace = getActiveTrace(sessionId);
  if (trace) {
    trace.observations.push(observation);
  }
}

export function recordLLMCall(sessionId, stepIndex, llmData) {
  var trace = getActiveTrace(sessionId);
  if (!trace) return null;

  var step = findOrCreateStep(trace, stepIndex);
  var inputTokens = (llmData && llmData.tokens && llmData.tokens.input) || 0;
  var outputTokens = (llmData && llmData.tokens && llmData.tokens.output) || 0;

  step.llmCall = {
    model: (llmData && llmData.model) || trace.model,
    provider: (llmData && llmData.provider) || trace.provider,
    messages: {
      system: (llmData && llmData.messages && llmData.messages.system) || '',
      user: (llmData && llmData.messages && llmData.messages.user) || trace.user.query,
      toolResults: (llmData && llmData.messages && llmData.messages.toolResults) || null
    },
    thinking: (llmData && llmData.thinking) || '',
    decision: (llmData && llmData.decision) || '',
    tokens: {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens
    },
    durationMs: (llmData && llmData.durationMs) || 0
  };

  trace.metrics.totalTokens.input += inputTokens;
  trace.metrics.totalTokens.output += outputTokens;
  trace.metrics.totalTokens.total = trace.metrics.totalTokens.input + trace.metrics.totalTokens.output;

  return trace;
}

export function recordToolCall(sessionId, stepIndex, toolData) {
  var trace = getActiveTrace(sessionId);
  if (!trace) return null;

  var step = findOrCreateStep(trace, stepIndex);
  var toolRecord = {
    id: (toolData && toolData.id) || 'tool_' + Date.now(),
    toolName: (toolData && toolData.toolName) || '',
    command: (toolData && toolData.command) || '',
    input: (toolData && toolData.input) || {},
    output: (toolData && toolData.output) || '',
    success: toolData && toolData.success !== false,
    durationMs: (toolData && toolData.durationMs) || 0,
    timestamp: Date.now()
  };

  var existingIdx = -1;
  for (var i = 0; i < step.toolCalls.length; i++) {
    if (step.toolCalls[i].id === toolRecord.id) {
      existingIdx = i;
      break;
    }
  }

  if (existingIdx >= 0) {
    step.toolCalls[existingIdx] = toolRecord;
  } else {
    step.toolCalls.push(toolRecord);
    trace.metrics.toolsExecuted += 1;
  }

  var targetFile = (toolData && toolData.input && (toolData.input.file_path || toolData.input.folder_path)) || '';
  if (targetFile && trace.metrics.filesTouched.indexOf(targetFile) === -1) {
    trace.metrics.filesTouched.push(targetFile);
  }

  return trace;
}

export function recordFinalResponse(sessionId, responseData) {
  var trace = getActiveTrace(sessionId);
  if (!trace) return null;

  trace.finalResponse = {
    text: (responseData && responseData.text) || '',
    thinking: (responseData && responseData.thinking) || '',
    durationMs: (responseData && responseData.durationMs) || 0
  };

  return trace;
}

export function finishRun(sessionId, status, metrics) {
  var trace = getActiveTrace(sessionId);
  if (!trace) return null;

  var now = Date.now();
  trace.status = status || 'completed';
  trace.completedAt = now;
  trace.durationMs = now - trace.startedAt;
  trace.metrics.totalDurationMs = trace.durationMs;

  if (metrics) {
    if (metrics.totalTokens) trace.metrics.totalTokens = metrics.totalTokens;
    if (metrics.filesTouched) trace.metrics.filesTouched = metrics.filesTouched;
  }

  trace.asciiTree = generateAsciiTree(trace);

  if (!_completedTracesBySession[sessionId]) {
    _completedTracesBySession[sessionId] = [];
  }

  var existingIndex = -1;
  for (var i = 0; i < _completedTracesBySession[sessionId].length; i++) {
    if (_completedTracesBySession[sessionId][i].id === trace.id) {
      existingIndex = i;
      break;
    }
  }

  if (existingIndex >= 0) {
    _completedTracesBySession[sessionId][existingIndex] = trace;
  } else {
    _completedTracesBySession[sessionId].push(trace);
  }

  return trace;
}

export function getActiveTrace(sessionId) {
  if (!sessionId) {
    var keys = Object.keys(_activeTracesBySession);
    if (keys.length) return _activeTracesBySession[keys[keys.length - 1]];
    return null;
  }
  return _activeTracesBySession[sessionId] || null;
}

export function getTraces(sessionId) {
  if (!sessionId) return [];
  return _completedTracesBySession[sessionId] || [];
}

export function generateAsciiTree(trace) {
  if (!trace) return '';
  var lines = [];
  lines.push('Agent Run [' + trace.model + ' | ' + trace.status.toUpperCase() + ' | ' + (trace.durationMs / 1000).toFixed(1) + 's]');
  lines.push('│');
  lines.push('├── User Input');
  lines.push('│   └── "' + trace.user.query + '"');
  lines.push('│');

  for (var s = 0; s < trace.steps.length; s++) {
    var step = trace.steps[s];
    lines.push('├── LLM Call #' + step.stepIndex);
    lines.push('│   ├── Model: ' + (step.llmCall.model || trace.model));
    if (step.llmCall.thinking) {
      lines.push('│   ├── Reasoning: "' + truncateText(step.llmCall.thinking, 90) + '"');
    }
    if (step.llmCall.decision) {
      lines.push('│   └── Decision: ' + truncateText(step.llmCall.decision, 90));
    }
    lines.push('│');

    for (var t = 0; t < step.toolCalls.length; t++) {
      var tc = step.toolCalls[t];
      lines.push('├── Tool Call');
      lines.push('│   └── ' + tc.toolName + '(' + formatToolArgsInline(tc.input) + ')');
      lines.push('│');
      lines.push('├── Tool Result');
      lines.push('│   └── [' + (tc.success ? '✓' : '✗') + ' ' + tc.durationMs + 'ms]: ' + truncateText(tc.output || '', 90));
      lines.push('│');
    }
  }

  lines.push('└── Final Response');
  if (trace.finalResponse && trace.finalResponse.text) {
    lines.push('    └── "' + truncateText(trace.finalResponse.text, 100) + '"');
  } else {
    lines.push('    └── (Completed)');
  }

  return lines.join('\n');
}

export async function saveTraceToDisk(globalStoragePath, sessionId) {
  var traces = getTraces(sessionId);
  if (!traces.length) {
    var active = getActiveTrace(sessionId);
    if (active) traces = [active];
  }
  if (!traces.length) return '';

  var targetDir = globalStoragePath;
  if (!targetDir) {
    var homeDir = os.homedir();
    targetDir = path.join(homeDir, '.coderun', 'traces');
  } else {
    targetDir = path.join(targetDir, 'traces');
  }

  try {
    if (!existsSync(targetDir)) {
      await fs.mkdir(targetDir, { recursive: true });
    }
    var filePath = path.join(targetDir, 'trace_' + sessionId + '.json');
    await fs.writeFile(filePath, JSON.stringify(traces, null, 2), 'utf-8');
    return filePath;
  } catch (err) {
    console.warn('[EXECUTION TRACE] Failed to save trace to disk:', err.message);
    return '';
  }
}

export async function loadTracesFromDisk(globalStoragePath, sessionId) {
  if (!sessionId) return [];
  var targetDir = globalStoragePath ? path.join(globalStoragePath, 'traces') : path.join(os.homedir(), '.coderun', 'traces');
  var filePath = path.join(targetDir, 'trace_' + sessionId + '.json');
  try {
    if (existsSync(filePath)) {
      var content = await fs.readFile(filePath, 'utf-8');
      var parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        _completedTracesBySession[sessionId] = parsed;
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[EXECUTION TRACE] Failed to read trace from disk:', err.message);
  }
  return [];
}

export async function saveTrace(workspaceRoot) {
  var active = getActiveTrace();
  if (!active || !active.sessionId) return '';
  return await saveTraceToDisk(null, active.sessionId);
}

function findOrCreateStep(trace, stepIndex) {
  var index = stepIndex || (trace.steps.length + 1);
  for (var i = 0; i < trace.steps.length; i++) {
    if (trace.steps[i].stepIndex === index) {
      return trace.steps[i];
    }
  }
  var newStep = {
    stepIndex: index,
    llmCall: {
      model: trace.model,
      provider: trace.provider,
      messages: { system: '', user: '', toolResults: null },
      thinking: '',
      decision: '',
      tokens: { input: 0, output: 0, total: 0 },
      durationMs: 0
    },
    toolCalls: []
  };
  trace.steps.push(newStep);
  return newStep;
}

function truncateText(str, maxLen) {
  if (!str) return '';
  str = String(str).replace(/[\r\n]+/g, ' ').trim();
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

function formatToolArgsInline(args) {
  if (!args) return '';
  try {
    var keys = Object.keys(args);
    if (!keys.length) return '';
    var pairs = [];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var val = typeof args[k] === 'string' ? '"' + truncateText(args[k], 25) + '"' : String(args[k]);
      pairs.push(k + ': ' + val);
    }
    return pairs.join(', ');
  } catch (_) {
    return '';
  }
}
