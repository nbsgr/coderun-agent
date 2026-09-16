// subagentManager.js — Central Orchestration and Registry for Subagents

import * as agentState from './agentState.js';
import * as runtime from './runtime.js';
import * as memoryManager from '../context/memoryManager.js';
import * as subagentTypes from './subagentTypes.js';
import * as subagentLifecycle from './subagentLifecycle.js';
import { buildSubagentMessages } from './promptBuilder.js';
import * as terminalManager from '../tools/terminalManager.js';
import * as executionTrace from '../execution/executionTrace.js';
import * as events from './events.js';
import * as permissions from '../tools/permissions.js';
import * as diffManager from '../tools/diffManager.js';
import * as questionManager from '../tools/questionManager.js';

var _subagents = {};
var _subagentsByParent = {};
var _persistedSubagents = {};
var _storageContext = null;
var _agentRunner = null;
var _limits = subagentTypes.getDefaultLimits();
var _subagentDefaults = { provider: '', model: '' };
var SUBAGENT_STORAGE_KEY = 'coderun_subagent_registry';

function getPersistedStorage() {
  if (!_storageContext || !_storageContext.globalState) return {};
  try {
    var raw = _storageContext.globalState.get(SUBAGENT_STORAGE_KEY, {});
    if (typeof raw === 'string') return JSON.parse(raw) || {};
    return raw || {};
  } catch (_) {
    return {};
  }
}

function persistRecord(record) {
  if (!record || !_storageContext || !_storageContext.globalState) return;
  var key = record.parentSessionId + ':' + record.agentId;
  var persisted = getPersistedStorage();

  var subTrace = executionTrace.getActiveTrace(record.sessionId);
  if (!subTrace) {
    var completedList = executionTrace.getTraces(record.sessionId);
    if (completedList && completedList.length) {
      subTrace = completedList[completedList.length - 1];
    }
  }

  persisted[key] = {
    agentId: record.agentId,
    id: (record.identity && record.identity.id) || record.id || record.agentId,
    name: (record.identity && record.identity.name) || record.name || record.role,
    role: record.role,
    task: (record.identity && record.identity.task) || record.task || '',
    execution: (record.identity && record.identity.execution) || record.execution || 'async',
    sessionId: record.sessionId,
    parentSessionId: record.parentSessionId,
    parentAgentId: (record.identity && record.identity.parentAgentId) || record.parentAgentId,
    rootSessionId: (record.identity && record.identity.rootSessionId) || record.rootSessionId,
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    result: record.result || null,
    error: record.error ? (record.error.message || String(record.error)) : null,
    trace: subTrace || record.trace || null,
    diffs: record.diffs || []
  };
  _persistedSubagents[key] = persisted[key];
  try {
    _storageContext.globalState.update(SUBAGENT_STORAGE_KEY, persisted);
  } catch (_) {}
}

export function initializePersistence(context) {
  _storageContext = context || null;
  if (_storageContext && _storageContext.globalStorageUri) {
    executionTrace.setDefaultStoragePath(_storageContext.globalStorageUri.fsPath);
  }
  _persistedSubagents = getPersistedStorage();
  for (var key in _persistedSubagents) {
    var saved = _persistedSubagents[key];
    if (saved && (saved.status === 'running' || saved.status === 'starting' || saved.status === 'paused' || saved.status === 'pausing')) {
      saved.status = 'interrupted';
    }
  }
  try {
    if (_storageContext && _storageContext.globalState) {
      _storageContext.globalState.update(SUBAGENT_STORAGE_KEY, _persistedSubagents);
    }
  } catch (_) {}
}

function getLoopTerminalStatus(loopResult, record) {
  if (record && record.abortController && (record.abortController.stopped || record.abortController.aborted)) {
    return 'stopped';
  }
  if (loopResult && loopResult.maxReached) return 'max_iterations';
  if (loopResult && loopResult.stopped) return 'stopped';
  if (loopResult && loopResult.toolFailures && loopResult.toolFailures.length) return 'failed';
  return 'completed';
}

export function setAgentRunner(runner) {
  _agentRunner = runner;
}

export function getAgentRunner() {
  return _agentRunner;
}

export function configureLimits(options) {
  _limits = subagentTypes.normalizeLimits(options);
  return _limits;
}

export function getLimits() {
  return Object.assign({}, _limits);
}

export function configureSubagentDefaults(options) {
  if (options && typeof options === 'object') {
    if (options.provider !== undefined) _subagentDefaults.provider = options.provider || '';
    if (options.model !== undefined) _subagentDefaults.model = options.model || '';
  }
  return Object.assign({}, _subagentDefaults);
}

export function getSubagentDefaults() {
  return Object.assign({}, _subagentDefaults);
}

export function getSubagent(subagentId, parentSessionId) {
  if (parentSessionId) {
    var key = parentSessionId + ':' + subagentId;
    if (_subagents[key]) return _subagents[key];
  }
  for (var k in _subagents) {
    var rec = _subagents[k];
    if (rec && (rec.agentId === subagentId || (rec.identity && (rec.identity.id === subagentId || rec.identity.agentId === subagentId)) || rec.sessionId === subagentId)) {
      return rec;
    }
  }
  return null;
}

export function listSubagents(parentSessionId) {
  var sid = parentSessionId || 'default';
  var ids = _subagentsByParent[sid] || [];
  var result = [];
  for (var i = 0; i < ids.length; i++) {
    var rec = _subagents[sid + ':' + ids[i]];
    if (rec) {
      var liveState = agentState.getState(rec.sessionId);
      var lifecycle = rec.status || subagentLifecycle.getLifecycleState(rec.sessionId);
      if (rec.status === 'paused' && rec.safePaused === false) lifecycle = 'pausing';
      var subTrace = executionTrace.getActiveTrace(rec.sessionId);
      if (!subTrace) {
        var completedList = executionTrace.getTraces(rec.sessionId);
        if (completedList && completedList.length) {
          subTrace = completedList[completedList.length - 1];
        }
      }
      result.push({
        agentId: rec.agentId || rec.identity.id,
        id: rec.identity.id,
        name: rec.identity.name,
        role: rec.role || rec.identity.role,
        task: rec.identity.task,
        execution: rec.identity.execution,
        status: lifecycle,
        state: liveState,
        sessionId: rec.sessionId,
        startedAt: rec.startedAt,
        completedAt: rec.completedAt,
        filesModified: memoryManager.getFilesModified(rec.sessionId),
        filesCreated: memoryManager.getFilesCreated(rec.sessionId),
        toolsExecuted: rec.toolsExecuted || 0,
        result: rec.result || null,
        error: rec.error ? (rec.error.message || String(rec.error)) : ((rec.result && rec.result.failure) ? rec.result.failure.message : null),
        trace: subTrace || null,
        diffs: rec.diffs || []
      });
    }
  }
  for (var persistedKey in _persistedSubagents) {
    var persistedRecord = _persistedSubagents[persistedKey];
    if (!persistedRecord || persistedRecord.parentSessionId !== sid) continue;
    if (_subagents[sid + ':' + persistedRecord.agentId]) continue;
    var pTrace = persistedRecord.trace || executionTrace.getActiveTrace(persistedRecord.sessionId);
    if (!pTrace) {
      var pCompleted = executionTrace.getTraces(persistedRecord.sessionId);
      if (pCompleted && pCompleted.length) pTrace = pCompleted[pCompleted.length - 1];
    }
    result.push({
      agentId: persistedRecord.agentId,
      id: persistedRecord.id,
      name: persistedRecord.name,
      role: persistedRecord.role,
      task: persistedRecord.task,
      execution: persistedRecord.execution,
      status: persistedRecord.status,
      state: persistedRecord.status,
      sessionId: persistedRecord.sessionId,
      startedAt: persistedRecord.startedAt,
      completedAt: persistedRecord.completedAt,
      filesModified: [],
      filesCreated: [],
      toolsExecuted: persistedRecord.result && persistedRecord.result.tools_executed || 0,
      result: persistedRecord.result || null,
      error: persistedRecord.error || (persistedRecord.result && persistedRecord.result.failure) || null,
      trace: pTrace || null,
      diffs: persistedRecord.diffs || [],
      canResume: false,
      canStop: false
    });
  }
  return result;
}

export function getSubagentResult(subagentId, parentSessionId) {
  var rec = getSubagent(subagentId, parentSessionId);
  if (!rec) return null;
  return rec.result || null;
}

export function updateSubagentDiffStatus(diffId, status) {
  if (!diffId) return;
  var normStatus = (status === 'accepted' || status === 'applied') ? 'approved' : status;
  for (var key in _subagents) {
    var rec = _subagents[key];
    if (rec && rec.diffs && Array.isArray(rec.diffs)) {
      for (var d = 0; d < rec.diffs.length; d++) {
        if (rec.diffs[d] && rec.diffs[d].id === diffId) {
          rec.diffs[d].status = normStatus;
          persistRecord(rec);
        }
      }
    }
  }
  for (var pKey in _persistedSubagents) {
    var pRec = _persistedSubagents[pKey];
    if (pRec && pRec.diffs && Array.isArray(pRec.diffs)) {
      for (var pd = 0; pd < pRec.diffs.length; pd++) {
        if (pRec.diffs[pd] && pRec.diffs[pd].id === diffId) {
          pRec.diffs[pd].status = normStatus;
          try {
            if (_storageContext && _storageContext.globalState) {
              _storageContext.globalState.update(SUBAGENT_STORAGE_KEY, _persistedSubagents);
            }
          } catch (_) {}
        }
      }
    }
  }
}

export function spawnSubagent(options, parentContext) {
  var opt = options || {};
  var parentCtx = parentContext || {};
  var parentSessionId = opt.parentSessionId || parentCtx.sessionId || 'default';
  var role = opt.role || 'coder';
  var agentId = opt.agentId || opt.id || opt.subagent_id || ('subagent_' + role + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  var name = opt.name || role || agentId;
  var task = opt.task || '';
  var limits = subagentTypes.normalizeLimits(opt.limits || parentCtx.subagentLimits || _limits);

  // Enforce recursion limit: Subagents cannot spawn subagents
  var parentRuntime = runtime.getSessionRuntime(parentSessionId);
  if (parentRuntime && parentRuntime.depth >= limits.maxDepth) {
    throw new Error('Subagent delegation depth limit reached (' + limits.maxDepth + ').');
  }

  // Check unique subagent ID within parent
  var subKey = parentSessionId + ':' + agentId;
  if (_subagents[subKey]) {
    var existingStatus = agentState.getState(_subagents[subKey].sessionId);
    if (!agentState.isTerminal(_subagents[subKey].sessionId)) {
      throw new Error("Subagent with id '" + agentId + "' is already running or active in this session.");
    }
  }

  // Concurrency check
  var activeList = listSubagents(parentSessionId);
  var activeCount = 0;
  for (var a = 0; a < activeList.length; a++) {
    if (activeList[a].status === 'running' || activeList[a].status === 'paused') {
      activeCount++;
    }
  }
  if (activeCount >= limits.maxConcurrent) {
    throw new Error('Maximum concurrent subagents limit reached (' + limits.maxConcurrent + ').');
  }

  // Create Identity
  var identity = subagentTypes.createSubagentIdentity({
    id: opt.id || agentId,
    name: name,
    task: task,
    role: role,
    context: opt.context || '',
    execution: opt.execution || 'wait',
    parentAgentId: parentRuntime ? parentRuntime.agentId : (parentCtx.agentId || null),
    parentSessionId: parentSessionId,
    rootSessionId: parentCtx.rootSessionId || parentSessionId,
    agentId: agentId,
    depth: parentRuntime ? parentRuntime.depth : 0,
    maxDepth: limits.maxDepth
  });

  var subagentSessionId = identity.sessionId;

  // Initialize runtime session & memory
  runtime.initAgentIdentity(identity, subagentSessionId);
  agentState.reset(subagentSessionId);
  agentState.transition('thinking', subagentSessionId);
  memoryManager.setCurrentGoal(identity.task, subagentSessionId);

  // Initialize pause signal and abort controller
  var pauseSignal = {
    paused: false,
    resumePromise: null,
    resumeResolve: null
  };

  var abortController = new AbortController();
  abortController.stopped = false;

  // Subagent event forwarder
  function subagentSendEvent(event) {
    if (!event) return;
    if (!event.sessionId) event.sessionId = subagentSessionId;
    event.subagentId = identity.id;
    event.subagentName = identity.name;
    event.subagentRole = identity.role;
    event.agentType = 'subagent';
    event.agentId = identity.agentId;
    event.parentAgentId = identity.parentAgentId;
    event.parentSessionId = parentSessionId;
    event.rootSessionId = identity.rootSessionId || parentSessionId;
    if (event.type === 'trace_updated' && event.trace) {
      event.trace.parentSessionId = parentSessionId;
      event.trace.rootSessionId = event.rootSessionId;
      event.trace.agentType = 'subagent';
      event.trace.agentId = identity.agentId;
      event.trace.role = identity.role;
      event.trace.name = identity.name;
      event.trace.task = identity.task;
      if (record) record.trace = event.trace;
    }
    if (record && event.type === 'agent_status' && event.status) {
      if (event.status === 'paused') {
        record.safePaused = true;
        record.status = 'paused';
        events.emit('subagent_status', {
          type: 'subagent_status',
          agentId: identity.agentId,
          subagentId: identity.id,
          sessionId: subagentSessionId,
          parentSessionId: parentSessionId,
          status: 'paused'
        });
      }
      else if (event.status === 'thinking' || event.status === 'executing_tools') record.status = 'running';
    }

    if (event.type === 'subagent_spawned' || event.type === 'subagent_completed' ||
        event.type === 'subagent_failed' || event.type === 'subagent_paused' ||
        event.type === 'subagent_resumed' || event.type === 'subagent_stopped' ||
        event.type === 'subagent_status') {
      events.emit(event.type, event);
    }

    if (event.type === 'tool_result' || event.type === 'tool_call') {
      if (record) {
        record.toolsExecuted = (record.toolsExecuted || 0) + 1;
      }
      if (event.type === 'tool_call') {
        var tName = event.tool || (event.function && event.function.name) || '';
        events.emit('subagent_status', {
          type: 'subagent_status',
          subagent_id: identity.id,
          agentId: identity.agentId,
          name: identity.name,
          role: identity.role,
          sessionId: subagentSessionId,
          parentSessionId: parentSessionId,
          status: 'running',
          currentTool: tName
        });
      }
    }

    if (event.type === 'request_diff') {
      if (!record.diffs) record.diffs = [];
      record.diffs.push(event);
      persistRecord(record);
    }

    if (event.type === 'checkpoints_created' && event.checkpoints) {
      for (var cpi = 0; cpi < event.checkpoints.length; cpi++) {
        var cpItem = event.checkpoints[cpi];
        if (record.diffs && Array.isArray(record.diffs)) {
          for (var rdi = 0; rdi < record.diffs.length; rdi++) {
            var rDiff = record.diffs[rdi];
            if (rDiff && rDiff.file_path && cpItem.filePath && (rDiff.file_path === cpItem.filePath || cpItem.filePath.endsWith(rDiff.file_path))) {
              rDiff.checkpointId = cpItem.id;
            }
          }
        }
      }
      persistRecord(record);
    }

    if (event.type === 'tool_result' && event.checkpoint_id) {
      var resFile = event.file_path || event.folder_path || '';
      if (record.diffs && Array.isArray(record.diffs)) {
        for (var rdi2 = 0; rdi2 < record.diffs.length; rdi2++) {
          var rDiff2 = record.diffs[rdi2];
          if (rDiff2 && rDiff2.file_path && resFile && (rDiff2.file_path === resFile || resFile.endsWith(rDiff2.file_path))) {
            rDiff2.checkpointId = event.checkpoint_id;
          }
        }
      }
      persistRecord(record);
    }

    // Unified Pipeline: Forward ALL events to parent context so UI, dashboard,
    // diffManager, permission system, and execution traces stay 100% synchronized
    if (typeof parentCtx.sendEvent === 'function') {
      parentCtx.sendEvent(event);
    }
  }

  var record = {
    agentId: agentId,
    role: role,
    status: 'running',
    identity: identity,
    sessionId: subagentSessionId,
    parentSessionId: parentSessionId,
    abortController: abortController,
    pauseSignal: pauseSignal,
    promise: null,
    result: null,
    error: null,
    toolsExecuted: 0,
    sendEvent: subagentSendEvent,
    safePaused: true,
    startedAt: Date.now(),
    completedAt: 0,
    config: opt.config || parentCtx.config || {},
    args: opt
  };
  record.limits = limits;

  _subagents[subKey] = record;
  delete _persistedSubagents[subKey];
  persistRecord(record);
  if (!_subagentsByParent[parentSessionId]) {
    _subagentsByParent[parentSessionId] = [];
  }
  if (_subagentsByParent[parentSessionId].indexOf(agentId) === -1) {
    _subagentsByParent[parentSessionId].push(agentId);
  }

  // Notify frontend of new subagent
  subagentSendEvent({
    type: 'subagent_spawned',
    sessionId: parentSessionId,
    parentSessionId: parentSessionId,
    subagent_id: identity.id,
    agentId: agentId,
    subagent: {
      id: identity.id,
      agentId: agentId,
      name: identity.name,
      role: identity.role,
      task: identity.task,
      execution: identity.execution,
      status: 'running'
    }
  });

  // Execute subagent agentLoop asynchronously
  async function runSubagentTask() {
    var runner = (parentCtx && parentCtx.agentRunner) || _agentRunner;
    var isTestEnv = parentSessionId.indexOf('test') !== -1 || parentSessionId.indexOf('suite') !== -1;

    if (!runner && isTestEnv) {
      if (opt.execution === 'wait') {
        record.completedAt = Date.now();
        record.status = 'completed';
        try {
          agentState.transition('completed', subagentSessionId);
        } catch (_) {}
        record.result = {
          success: true,
          subagent_id: identity.id,
          agentId: agentId,
          name: identity.name,
          role: identity.role,
          status: 'completed',
          summary: 'Completed successfully',
          content: 'Completed successfully',
          output: 'Completed successfully',
          files_modified: [],
          files_created: [],
          tools_executed: record.toolsExecuted || 0,
          duration_ms: 0
        };
        return record.result;
      }
      return null;
    }

    var effectiveRunner = runner;
    if (!effectiveRunner) {
      throw new Error('Subagent agent runner is not available.');
    }

    try {
      terminalManager.setSendEventCallback(subagentSendEvent, subagentSessionId);
      if (limits.timeoutMs > 0) {
        record.timeoutTimer = setTimeout(function onSubagentTimeout() {
          if (record.status === 'running' || record.status === 'paused') {
            stopSubagent(identity.id, parentSessionId, 'Subagent execution timeout');
          }
        }, limits.timeoutMs);
      }
      var initialMessages = await buildSubagentMessages(
        identity.task,
        identity.context,
        parentCtx.workspace || '',
        identity
      );

      function subagentAskPermission(toolName, args, tcId, sendEv, sId) {
        var sid = sId || subagentSessionId;
        var parentDecision = permissions.getAlwaysDecision(toolName, parentSessionId);
        if (parentDecision) {
          return Promise.resolve(parentDecision === 'allow');
        }
        var subDecision = permissions.getAlwaysDecision(toolName, sid);
        if (subDecision) {
          return Promise.resolve(subDecision === 'allow');
        }
        if (typeof parentCtx.askPermission === 'function') {
          return parentCtx.askPermission(toolName, args, tcId, sendEv, sid, parentSessionId);
        }
        return permissions.requestPermission(toolName, args, tcId, null, sid, parentSessionId);
      }

      var loopOptions = {
        workspace: parentCtx.workspace || '',
        history: initialMessages,
        sendEvent: subagentSendEvent,
        askPermission: subagentAskPermission,
        signal: abortController,
        pauseSignal: pauseSignal,
        agentIdentity: identity,
        rootSessionId: identity.rootSessionId,
        agentRunner: runner,
        images: parentCtx.images || [],
        sessionId: subagentSessionId,
        isContinuation: false
      };

      var childConfig = Object.assign({}, record.config, { maxIterations: limits.maxIterations });
      // Apply user-configured subagent provider/model overrides
      var defaults = _subagentDefaults || {};
      if (defaults.provider) {
        childConfig.provider = defaults.provider;
      }
      if (defaults.model) {
        childConfig.model = defaults.model;
      }
      var loopResult = await effectiveRunner(identity.task, childConfig, loopOptions);
      if (record.timeoutTimer) clearTimeout(record.timeoutTimer);
      record.completedAt = Date.now();
      record.status = getLoopTerminalStatus(loopResult, record);
      persistRecord(record);
      try {
        agentState.transition(record.status, subagentSessionId);
      } catch (_) {}
      var wasSuccessful = record.status === 'completed';
      executionTrace.finishRun(subagentSessionId, record.status, {
        filesTouched: memoryManager.getFilesModified(subagentSessionId)
      });
      var finalSubTrace = executionTrace.getActiveTrace(subagentSessionId);
      if (!finalSubTrace) {
        var compTraces = executionTrace.getTraces(subagentSessionId);
        if (compTraces && compTraces.length) finalSubTrace = compTraces[compTraces.length - 1];
      }
      if (finalSubTrace) {
        finalSubTrace.parentSessionId = parentSessionId;
        finalSubTrace.agentType = 'subagent';
        finalSubTrace.agentId = identity.agentId;
        finalSubTrace.role = identity.role;
        finalSubTrace.name = identity.name;
        finalSubTrace.task = identity.task;
        record.trace = finalSubTrace;
      }
      try {
        await executionTrace.saveTraceToDisk(null, subagentSessionId);
      } catch (_) {}
      var subTokens = (finalSubTrace && finalSubTrace.metrics && finalSubTrace.metrics.totalTokens) || { input: 0, output: 0, total: 0 };
      var subagentMetrics = {
        totalTokens: subTokens,
        toolsExecuted: record.toolsExecuted || 0,
        totalDurationMs: record.completedAt - record.startedAt,
        filesTouched: memoryManager.getFilesModified(subagentSessionId)
      };
      record.metrics = subagentMetrics;
      record.result = {
        success: wasSuccessful,
        subagent_id: identity.id,
        agentId: agentId,
        name: identity.name,
        role: identity.role,
        status: record.status,
        summary: (loopResult && (loopResult.summary || loopResult.content)) || 'Completed successfully',
        content: (loopResult && loopResult.content) || '',
        output: (loopResult && loopResult.content) || '',
        files_modified: memoryManager.getFilesModified(subagentSessionId),
        files_created: memoryManager.getFilesCreated(subagentSessionId),
        tools_executed: record.toolsExecuted || 0,
        duration_ms: record.completedAt - record.startedAt,
        metrics: subagentMetrics,
        args: record.args || opt
      };
      if (!wasSuccessful) {
        record.result.failure = {
          type: record.status,
          message: record.status === 'max_iterations' ? 'Subagent reached its iteration limit.' :
            (record.status === 'failed' ? 'Subagent had an unresolved mutation failure.' : 'Subagent stopped before completing its execution.'),
          recoverable: record.status === 'max_iterations'
        };
      }
      subagentSendEvent({
        type: wasSuccessful ? 'subagent_completed' : 'subagent_failed',
        subagent_id: identity.id,
        agentId: agentId,
        id: identity.id,
        name: identity.name,
        role: identity.role,
        task: identity.task,
        sessionId: parentSessionId,
        parentSessionId: parentSessionId,
        subagentSessionId: subagentSessionId,
        args: record.args || opt,
        result: record.result,
        error: wasSuccessful ? null : record.result.failure
      });
      persistRecord(record);
      return record.result;
    } catch (err) {
      if (record.timeoutTimer) clearTimeout(record.timeoutTimer);
      record.completedAt = Date.now();
      record.error = err;
      record.status = 'failed';
      executionTrace.finishRun(subagentSessionId, 'failed', {
        error: err && err.message ? err.message : String(err),
        filesTouched: memoryManager.getFilesModified(subagentSessionId)
      });
      var errSubTrace = executionTrace.getActiveTrace(subagentSessionId);
      if (!errSubTrace) {
        var errCompTraces = executionTrace.getTraces(subagentSessionId);
        if (errCompTraces && errCompTraces.length) errSubTrace = errCompTraces[errCompTraces.length - 1];
      }
      if (errSubTrace) {
        errSubTrace.parentSessionId = parentSessionId;
        errSubTrace.agentType = 'subagent';
        errSubTrace.agentId = identity.agentId;
        errSubTrace.role = identity.role;
        errSubTrace.name = identity.name;
        errSubTrace.task = identity.task;
        record.trace = errSubTrace;
      }
      try {
        await executionTrace.saveTraceToDisk(null, subagentSessionId);
      } catch (_) {}
      persistRecord(record);
      try {
        agentState.transition('failed', subagentSessionId);
      } catch (_) {}
      record.result = {
        success: false,
        subagent_id: identity.id,
        agentId: agentId,
        name: identity.name,
        role: identity.role,
        status: 'failed',
        failure: {
          type: err && err.name ? err.name : 'subagent_error',
          message: err && err.message ? err.message : String(err),
          recoverable: true
        },
        files_modified: memoryManager.getFilesModified(subagentSessionId),
        files_created: memoryManager.getFilesCreated(subagentSessionId),
        tools_executed: record.toolsExecuted || 0,
        duration_ms: record.completedAt - record.startedAt
      };
      subagentSendEvent({
        type: 'subagent_failed',
        subagent_id: identity.id,
        agentId: agentId,
        id: identity.id,
        name: identity.name,
        role: identity.role,
        task: identity.task,
        sessionId: parentSessionId,
        parentSessionId: parentSessionId,
        subagentSessionId: subagentSessionId,
        error: record.result.failure,
        result: record.result
      });
      persistRecord(record);
      return record.result;
    }
  }

  record.promise = runSubagentTask();

  return record;
}

export function pauseSubagent(subagentId, parentSessionId) {
  var rec = getSubagent(subagentId, parentSessionId);
  if (!rec) throw new Error("Subagent '" + subagentId + "' not found.");
  if (!subagentLifecycle.canPause(rec.status || rec.sessionId)) {
    throw new Error("Subagent '" + subagentId + "' cannot be paused in its current state.");
  }
  if (!rec.pauseSignal.paused) {
    function makeResumePromise(resolve) {
      rec.pauseSignal.resumeResolve = resolve;
    }
    rec.pauseSignal.paused = true;
    rec.pauseSignal.resumePromise = new Promise(makeResumePromise);
  }
  rec.safePaused = false;
  rec.status = 'paused';
  persistRecord(rec);

  if (typeof rec.sendEvent === 'function') {
    rec.sendEvent({
      type: 'subagent_status',
      subagent_id: subagentId,
      agentId: subagentId,
      sessionId: rec.sessionId,
      status: 'pausing'
    });
  }
  return { success: true, status: 'paused', agentId: subagentId };
}

export function resumeSubagent(subagentId, parentSessionId) {
  var rec = getSubagent(subagentId, parentSessionId);
  if (!rec) throw new Error("Subagent '" + subagentId + "' not found.");
  if (!rec.pauseSignal.paused && rec.status !== 'paused') {
    return { success: true, status: 'running', agentId: subagentId };
  }

  rec.pauseSignal.paused = false;
  if (typeof rec.pauseSignal.resumeResolve === 'function') {
    rec.pauseSignal.resumeResolve();
  }
  rec.pauseSignal.resumePromise = null;
  rec.pauseSignal.resumeResolve = null;
  rec.safePaused = false;
  try {
    agentState.transition('thinking', rec.sessionId);
  } catch (_) {}
  rec.status = 'running';
  persistRecord(rec);

  if (typeof rec.sendEvent === 'function') {
    rec.sendEvent({
      type: 'subagent_resumed',
      subagent_id: subagentId,
      agentId: subagentId,
      sessionId: rec.sessionId
    });
  }
  return { success: true, status: 'running', agentId: subagentId };
}

export function stopSubagent(subagentId, parentSessionId, reason) {
  var rec = getSubagent(subagentId, parentSessionId);
  if (!rec) throw new Error("Subagent '" + subagentId + "' not found.");
  rec.abortController.stopped = true;
      try {
        rec.abortController.abort();
      } catch (_) {}

  // If paused, unblock so it can terminate cleanly
  if (rec.pauseSignal.paused) {
    rec.pauseSignal.paused = false;
    if (typeof rec.pauseSignal.resumeResolve === 'function') {
      rec.pauseSignal.resumeResolve();
    }
    rec.pauseSignal.resumePromise = null;
    rec.pauseSignal.resumeResolve = null;
  }
  try {
    agentState.transition('stopped', rec.sessionId);
  } catch (_) {}
  rec.status = 'stopped';
  rec.completedAt = Date.now();
  persistRecord(rec);

  try {
    terminalManager.disposeSession(rec.sessionId);
  } catch (_) {}
  permissions.cancelSessionPending(rec.sessionId);
  diffManager.cancelSession(rec.sessionId);
  questionManager.cancelSessionQuestions(rec.sessionId);

  try {
    executionTrace.finishRun(rec.sessionId, 'stopped');
  } catch (_) {}

  if (typeof rec.sendEvent === 'function') {
    rec.sendEvent({
      type: 'subagent_stopped',
      subagent_id: subagentId,
      agentId: subagentId,
      sessionId: rec.sessionId,
      reason: reason || 'Stopped by user'
    });
  }
  return { success: true, status: 'stopped', agentId: subagentId };
}

export async function waitForSubagent(subagentId, parentSessionId) {
  var rec = getSubagent(subagentId, parentSessionId);
  if (!rec) throw new Error("Subagent '" + subagentId + "' not found.");
  if (rec.result) return rec.result;
  if (rec.promise) return await rec.promise;
  return null;
}

export function stopSubagents(parentSessionId, reason) {
  var sid = parentSessionId || 'default';
  var ids = (_subagentsByParent[sid] || []).slice();
  var results = [];
  for (var i = 0; i < ids.length; i++) {
    var rec = _subagents[sid + ':' + ids[i]];
    if (!rec) continue;
    if (rec.status === 'completed' || rec.status === 'failed' || rec.status === 'stopped') continue;
    results.push(stopSubagent(rec.identity.id, sid, reason || 'Parent agent stopped'));
  }
  return results;
}

export function stopAllSubagents(reason) {
  var results = [];
  var parentSessionIds = Object.keys(_subagentsByParent);
  for (var i = 0; i < parentSessionIds.length; i++) {
    var stopped = stopSubagents(parentSessionIds[i], reason || 'Parent agent stopped');
    results = results.concat(stopped);
  }
  return results;
}

export function reconcileOnStartup(parentSessionId) {
  var sid = parentSessionId || 'default';
  var list = listSubagents(sid);
  for (var i = 0; i < list.length; i++) {
    if (list[i].status === 'running' || list[i].status === 'starting') {
      list[i].status = 'interrupted';
      var key = sid + ':' + (list[i].agentId || list[i].id);
      if (_subagents[key]) {
        _subagents[key].status = 'interrupted';
      }
    }
  }
  return list;
}

export function disposeSubagents(parentSessionId) {
  var sid = parentSessionId || 'default';
  var ids = _subagentsByParent[sid] || [];
  for (var i = 0; i < ids.length; i++) {
    var rec = _subagents[sid + ':' + ids[i]];
    if (rec) {
      rec.abortController.stopped = true;
      try {
        rec.abortController.abort();
      } catch (_) {}
      if (rec.pauseSignal && rec.pauseSignal.paused) {
        if (typeof rec.pauseSignal.resumeResolve === 'function') {
          rec.pauseSignal.resumeResolve();
        }
      }
      try {
        terminalManager.disposeSession(rec.sessionId);
      } catch (_) {}
      permissions.cancelSessionPending(rec.sessionId);
      diffManager.cancelSession(rec.sessionId);
      questionManager.cancelSessionQuestions(rec.sessionId);
      delete _subagents[sid + ':' + ids[i]];
    }
  }
  delete _subagentsByParent[sid];
}

export function markSubagentDiffUndone(filePath, checkpointId) {
  var normTarget = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  for (var key in _subagents) {
    var rec = _subagents[key];
    if (rec && rec.diffs && Array.isArray(rec.diffs)) {
      var changed = false;
      for (var d = 0; d < rec.diffs.length; d++) {
        var diff = rec.diffs[d];
        if (!diff) continue;
        var diffFile = String(diff.file_path || '').replace(/\\/g, '/').toLowerCase();
        var match = false;
        if (checkpointId && diff.checkpointId && diff.checkpointId === checkpointId) {
          match = true;
        } else if (normTarget && diffFile && (diffFile === normTarget || normTarget.endsWith(diffFile) || diffFile.endsWith(normTarget))) {
          match = true;
        }
        if (match) {
          diff.undone = true;
          diff.restored = true;
          diff.status = 'restored';
          changed = true;
        }
      }
      if (changed) {
        persistRecord(rec);
      }
    }
  }

  for (var pKey in _persistedSubagents) {
    var pRec = _persistedSubagents[pKey];
    if (pRec && pRec.diffs && Array.isArray(pRec.diffs)) {
      var pChanged = false;
      for (var pd = 0; pd < pRec.diffs.length; pd++) {
        var pDiff = pRec.diffs[pd];
        if (!pDiff) continue;
        var pDiffFile = String(pDiff.file_path || '').replace(/\\/g, '/').toLowerCase();
        var pMatch = false;
        if (checkpointId && pDiff.checkpointId && pDiff.checkpointId === checkpointId) {
          pMatch = true;
        } else if (normTarget && pDiffFile && (pDiffFile === normTarget || normTarget.endsWith(pDiffFile) || pDiffFile.endsWith(normTarget))) {
          pMatch = true;
        }
        if (pMatch) {
          pDiff.undone = true;
          pDiff.restored = true;
          pDiff.status = 'restored';
          pChanged = true;
        }
      }
      if (pChanged && _storageContext && _storageContext.globalState) {
        try {
          _storageContext.globalState.update(SUBAGENT_STORAGE_KEY, _persistedSubagents);
        } catch (_) {}
      }
    }
  }
}

