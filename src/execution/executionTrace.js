// executionTrace.js — Real-Time Execution Trace Engine
// Collects and serializes hierarchical trace data (User prompt, LLM calls, Tool calls, Results, Final response)
// and persists per-chat runs to VS Code globalStorage and local files.

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

var _activeTracesBySession = {};
var _completedTracesBySession = {};
var _defaultStoragePath = null;

export function setDefaultStoragePath(storagePath) {
  _defaultStoragePath = storagePath || null;
}

export function getDefaultStoragePath() {
  return _defaultStoragePath;
}

function createNewRun(sessionId, runId, userQuery, contextData, model, provider, agentIdentity) {
  var now = Date.now();
  var aId = (agentIdentity && agentIdentity.agentId) || (contextData && contextData.agentId) || 'root';
  var aName = (agentIdentity && agentIdentity.name) || (contextData && contextData.name) || '';
  var aTask = (agentIdentity && agentIdentity.task) || (contextData && contextData.task) || userQuery || '';
  var pAgentId = (agentIdentity && agentIdentity.parentAgentId) || (contextData && contextData.parentAgentId) || null;
  var pSessionId = (agentIdentity && agentIdentity.parentSessionId) || (contextData && contextData.parentSessionId) || null;
  var depth = 0;
  if (agentIdentity && agentIdentity.depth !== undefined) {
    depth = agentIdentity.depth;
  } else if (contextData && contextData.depth !== undefined) {
    depth = contextData.depth;
  }
  var role = (agentIdentity && agentIdentity.role) || (contextData && contextData.role) || 'coder';
  var aType = (agentIdentity && agentIdentity.agentType) || (contextData && contextData.agentType) || 'root';

  return {
    id: runId || 'run_' + now + '_' + Math.random().toString(36).substring(2, 8),
    sessionId: sessionId || 'session_' + now,
    agentId: aId,
    name: aName,
    task: aTask,
    parentAgentId: pAgentId,
    parentSessionId: pSessionId,
    depth: depth,
    role: role,
    agentType: aType,
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

export function startRun(sessionId, runId, userQuery, contextData, model, provider, isContinuation, agentIdentity) {
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

  var identity = agentIdentity || (contextData && contextData.agentIdentity) || contextData;
  var run = createNewRun(sessionId, runId, userQuery, contextData, model, provider, identity);
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

  var terminalStatuses = {
    completed: true,
    failed: true,
    cancelled: true,
    stopped: true,
    max_iterations: true
  };
  if (trace.completedAt && terminalStatuses[trace.status]) {
    return trace;
  }

  var now = Date.now();
  trace.status = status || 'completed';
  trace.completedAt = now;
  trace.durationMs = now - trace.startedAt;
  trace.metrics.totalDurationMs = trace.durationMs;

  if (metrics) {
    if (metrics.totalTokens) {
      var inT = metrics.totalTokens.input !== undefined ? metrics.totalTokens.input : (metrics.totalTokens.prompt_tokens || 0);
      var outT = metrics.totalTokens.output !== undefined ? metrics.totalTokens.output : (metrics.totalTokens.completion_tokens || 0);
      var totT = metrics.totalTokens.total !== undefined ? metrics.totalTokens.total : (inT + outT);
      if (totT > 0 || inT > 0 || outT > 0 || !trace.metrics.totalTokens || trace.metrics.totalTokens.total === 0) {
        trace.metrics.totalTokens = { input: inT, output: outT, total: totT };
      }
    }
    if (metrics.filesTouched) trace.metrics.filesTouched = metrics.filesTouched;
    if (metrics.error) trace.error = metrics.error;
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

export function getSubagentTraces(parentSessionId) {
  if (!parentSessionId) return [];
  var result = [];
  var seenIds = {};
  var keys = Object.keys(_completedTracesBySession);
  for (var k = 0; k < keys.length; k++) {
    var sId = keys[k];
    var sessionTraces = _completedTracesBySession[sId] || [];
    for (var i = 0; i < sessionTraces.length; i++) {
      var t = sessionTraces[i];
      var matches = t.parentSessionId === parentSessionId;
      if (matches && !seenIds[t.id]) {
        seenIds[t.id] = true;
        result.push(t);
      }
    }
  }
  var activeKeys = Object.keys(_activeTracesBySession);
  for (var a = 0; a < activeKeys.length; a++) {
    var act = _activeTracesBySession[activeKeys[a]];
    if (act) {
      var actMatches = act.parentSessionId === parentSessionId;
      if (actMatches && !seenIds[act.id]) {
        seenIds[act.id] = true;
        result.push(act);
      }
    }
  }
  return result;
}

export async function loadSubagentTracesFromDisk(globalStoragePath, parentSessionId) {
  if (!parentSessionId) return [];
  var searchDirs = [];
  if (globalStoragePath) {
    searchDirs.push(path.join(globalStoragePath, 'traces'));
  }
  if (_defaultStoragePath && _defaultStoragePath !== globalStoragePath) {
    searchDirs.push(path.join(_defaultStoragePath, 'traces'));
  }
  searchDirs.push(path.join(os.homedir(), '.coderun', 'traces'));

  var result = [];
  var seenIds = {};

  for (var d = 0; d < searchDirs.length; d++) {
    var targetDir = searchDirs[d];
    try {
      if (!existsSync(targetDir)) continue;
      var filenames = await fs.readdir(targetDir);
      for (var i = 0; i < filenames.length; i++) {
        if (!filenames[i].startsWith('trace_') || !filenames[i].endsWith('.json')) continue;
        try {
          var content = await fs.readFile(path.join(targetDir, filenames[i]), 'utf-8');
          var parsed = JSON.parse(content);
          if (!Array.isArray(parsed)) continue;
          for (var t = 0; t < parsed.length; t++) {
            var item = parsed[t];
            if (item && item.parentSessionId === parentSessionId) {
              if (item.id && !seenIds[item.id]) {
                seenIds[item.id] = true;
                result.push(item);
              }
            }
          }
        } catch (_) {
          // Ignore an individual malformed trace file.
        }
      }
      if (result.length > 0) {
        break;
      }
    } catch (_) {
      // Ignore unreadable directory
    }
  }
  return result;
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

function redactSensitiveData(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return obj
      .replace(/ghp_[a-zA-Z0-9]{20,}/g, '[REDACTED_GITHUB_TOKEN]')
      .replace(/github_pat_[a-zA-Z0-9_]{20,}/g, '[REDACTED_GITHUB_PAT]')
      .replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED_OPENAI_KEY]')
      .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]')
      .replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_GOOGLE_KEY]')
      .replace(/ey[A-Za-z0-9-_=]{10,}\.ey[A-Za-z0-9-_=]{10,}\.?[A-Za-z0-9-_.+/=]*/g, '[REDACTED_JWT]')
      .replace(/(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:]+:[^@]+@/gi, '$1://[REDACTED]@')
      .replace(/(?:api[_-]?key|token|secret|password|bearer|auth|authorization|aws_secret_access_key)["'\s:=]+(["'][a-zA-Z0-9_\-\.]{8,}["']|[a-zA-Z0-9_\-\.]{12,})/gi, '[REDACTED]')
      .replace(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
  }
  if (Array.isArray(obj)) {
    var arr = [];
    for (var i = 0; i < obj.length; i++) {
      arr.push(redactSensitiveData(obj[i]));
    }
    return arr;
  }
  if (typeof obj === 'object') {
    var out = {};
    for (var k in obj) {
      var lk = k.toLowerCase();
      var isTokenCount = (lk === 'tokens' || lk === 'totaltokens' || lk === 'prompttokens' || lk === 'completiontokens' || lk === 'systemprompttokens' || lk === 'inputtokens' || lk === 'outputtokens' || lk === 'prompt_tokens' || lk === 'completion_tokens' || lk === 'total_tokens');
      if (!isTokenCount && (lk === 'token' || lk === 'access_token' || lk === 'refresh_token' || lk === 'auth_token' || lk === 'api_token' || lk.includes('password') || lk.includes('apikey') || lk.includes('secret') || lk === 'authorization' || lk.includes('cookie') || lk.includes('database_url'))) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSensitiveData(obj[k]);
      }
    }
    return out;
  }
  return obj;
}

export function clearTraces(sessionId) {
  if (sessionId) {
    delete _activeTracesBySession[sessionId];
    delete _completedTracesBySession[sessionId];
  } else {
    _activeTracesBySession = {};
    _completedTracesBySession = {};
  }
}

function getSafeTraceFilename(sessionId) {
  var str = String(sessionId || 'default').trim();
  var clean = str.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 48);
  var hash = crypto.createHash('sha256').update(str, 'utf8').digest('hex').substring(0, 16);
  return 'trace_' + (clean ? clean + '_' : '') + hash + '.json';
}

export async function saveTraceToDisk(globalStoragePath, sessionId) {
  var traces = getTraces(sessionId);
  if (!traces.length) {
    var active = getActiveTrace(sessionId);
    if (active) traces = [active];
  }
  if (!traces.length) return '';

  var targetDirs = [];
  if (globalStoragePath) {
    targetDirs.push(path.join(globalStoragePath, 'traces'));
  }
  if (_defaultStoragePath && _defaultStoragePath !== globalStoragePath) {
    targetDirs.push(path.join(_defaultStoragePath, 'traces'));
  }
  var fallbackHome = path.join(os.homedir(), '.coderun', 'traces');
  if (targetDirs.indexOf(fallbackHome) === -1) {
    targetDirs.push(fallbackHome);
  }

  var primaryPath = '';
  var filename = getSafeTraceFilename(sessionId);

  for (var i = 0; i < targetDirs.length; i++) {
    var targetDir = targetDirs[i];
    try {
      if (!existsSync(targetDir)) {
        await fs.mkdir(targetDir, { recursive: true });
      }
      var filePath = path.join(targetDir, filename);
      var effectiveTraces = traces.slice();
      if (existsSync(filePath)) {
        try {
          var diskContent = await fs.readFile(filePath, 'utf-8');
          var diskParsed = JSON.parse(diskContent);
          if (Array.isArray(diskParsed) && diskParsed.length > 0) {
            var merged = diskParsed.slice();
            for (var ti = 0; ti < traces.length; ti++) {
              var currT = traces[ti];
              var foundIdx = -1;
              for (var mi = 0; mi < merged.length; mi++) {
                if (merged[mi].id === currT.id) {
                  foundIdx = mi;
                  break;
                }
              }
              if (foundIdx >= 0) {
                merged[foundIdx] = currT;
              } else {
                merged.push(currT);
              }
            }
            effectiveTraces = merged;
          }
        } catch (_) {}
      }
      var sanitized = redactSensitiveData(effectiveTraces);
      var jsonStr = JSON.stringify(sanitized, null, 2);
      await fs.writeFile(filePath, jsonStr, 'utf-8');
      if (!primaryPath) primaryPath = filePath;
    } catch (err) {
      console.warn('[EXECUTION TRACE] Failed to save trace to disk at ' + targetDir + ':', err.message);
    }
  }

  return primaryPath;
}

export async function loadTracesFromDisk(globalStoragePath, sessionId) {
  if (!sessionId) return [];
  var searchDirs = [];
  if (globalStoragePath) {
    searchDirs.push(path.join(globalStoragePath, 'traces'));
  }
  if (_defaultStoragePath && _defaultStoragePath !== globalStoragePath) {
    searchDirs.push(path.join(_defaultStoragePath, 'traces'));
  }
  searchDirs.push(path.join(os.homedir(), '.coderun', 'traces'));

  var filename = getSafeTraceFilename(sessionId);

  for (var i = 0; i < searchDirs.length; i++) {
    var filePath = path.join(searchDirs[i], filename);
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
      console.warn('[EXECUTION TRACE] Failed to read trace from disk at ' + filePath + ':', err.message);
    }
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
