import * as events from './events.js';
import * as agentState from './agentState.js';
import * as memoryManager from '../context/memoryManager.js';
import * as goalTracker from '../context/goalTracker.js';
import * as timelineManager from '../execution/timelineManager.js';
import * as permissions from '../tools/permissions.js';
import * as terminalManager from '../tools/terminalManager.js';
import * as projectKnowledge from '../context/projectKnowledge.js';
import * as diffManager from '../tools/diffManager.js';
import * as executionTrace from '../execution/executionTrace.js';

var _plans = {};           // { [planId]: Plan }
var _planSessionIndex = {};// { [sessionId]: [planId, ...] }
var _runtimeBySession = {};// { [sessionId]: SessionState }
var _subscribers = [];
var _activeSessionId = 'default';

function createInitialSessionState(sessionId) {
  return {
    goal: '',
    state: 'idle',
    currentPlanId: '',
    messages: [],
    toolResults: [],
    observations: [],
    decisions: [],
    memory: {},
    metadata: {
      startedAt: 0,
      iteration: 0,
      sessionId: sessionId || 'default',
      iterationLabel: ''
    }
  };
}

export function getSessionRuntime(sessionId) {
  var sid = sessionId || _activeSessionId || 'default';
  if (!_runtimeBySession[sid]) {
    _runtimeBySession[sid] = createInitialSessionState(sid);
  }
  return _runtimeBySession[sid];
}

// ═══════════════════════════════════════════════════════════
// SUBSCRIPTION
// ═══════════════════════════════════════════════════════════

export function subscribe(fn) {
  _subscribers.push(fn);
  function unsubscribe() {
    var idx = _subscribers.indexOf(fn);
    if (idx !== -1) _subscribers.splice(idx, 1);
  }
  return unsubscribe;
}

// ═══════════════════════════════════════════════════════════
// READ
// ═══════════════════════════════════════════════════════════

export function getState(sessionId) {
  return getSessionRuntime(sessionId);
}

export function getCurrentPlan(sessionId) {
  var sessState = getSessionRuntime(sessionId);
  return sessState.currentPlanId ? (_plans[sessState.currentPlanId] || null) : null;
}

export function getGoal(sessionId) {
  return getSessionRuntime(sessionId).goal;
}

export function getMessages(sessionId) {
  return getSessionRuntime(sessionId).messages;
}

export function getToolResults(sessionId) {
  return getSessionRuntime(sessionId).toolResults;
}

export function getMetadata(sessionId) {
  return getSessionRuntime(sessionId).metadata;
}

// ═══════════════════════════════════════════════════════════
// PLAN CACHE
// ═══════════════════════════════════════════════════════════

export function registerPlan(plan) {
  if (!plan || !plan.id) return plan;
  _plans[plan.id] = plan;
  if (plan.sessionId) {
    if (!_planSessionIndex[plan.sessionId]) _planSessionIndex[plan.sessionId] = [];
    if (_planSessionIndex[plan.sessionId].indexOf(plan.id) === -1) {
      _planSessionIndex[plan.sessionId].push(plan.id);
    }
  }
  return plan;
}

export function updatePlan(plan) {
  if (!plan || !plan.id) return plan;

  var fullyCompleted = false;
  if (plan.phases && plan.phases.length) {
    var allDone = true;
    for (var p = 0; p < plan.phases.length; p++) {
      var phase = plan.phases[p];
      if (phase.tasks && phase.tasks.length) {
        for (var t = 0; t < phase.tasks.length; t++) {
          var status = phase.tasks[t].status;
          if (status !== 'completed' && status !== 'skipped') {
            allDone = false;
            break;
          }
        }
      }
      if (!allDone) break;
    }
    fullyCompleted = allDone;
  }

  if (fullyCompleted && plan.status !== 'completed') {
    plan.status = 'completed';
    plan.updatedAt = Date.now();
  }
  _plans[plan.id] = plan;

  var sid = plan.sessionId || _activeSessionId;
  var sessState = getSessionRuntime(sid);
  var oldState = Object.assign({}, sessState);

  events.emit('runtime:plan_updated', {
    planId: plan.id,
    plan: plan,
    state: sessState,
    sessionId: sid
  });

  if (sessState.currentPlanId === plan.id || fullyCompleted) {
    for (var i = 0; i < _subscribers.length; i++) {
      try { _subscribers[i](sessState, oldState); } catch (e) {
        console.error('[RUNTIME] Subscriber error:', e);
      }
    }
  }
  return plan;
}

export function getActivePlanId(sessionId) {
  return getSessionRuntime(sessionId).currentPlanId;
}

export function setActivePlanId(planId, sessionId) {
  if (!planId || !_plans[planId]) return false;
  mutate({ currentPlanId: planId }, 'plan', { planId: planId }, sessionId);
  return true;
}

export function getPlan(planId, sessionId) {
  if (!planId || !_plans[planId]) return null;
  var plan = _plans[planId];
  if (sessionId && plan.sessionId && plan.sessionId !== 'default' && plan.sessionId !== sessionId) {
    return null;
  }
  return plan;
}

export function getAllPlans() {
  var result = [];
  for (var pid in _plans) {
    result.push(_plans[pid]);
  }
  return result;
}

export function getPlansBySession(sessionId) {
  if (!_planSessionIndex[sessionId]) return [];
  var result = [];
  for (var i = 0; i < _planSessionIndex[sessionId].length; i++) {
    var pid = _planSessionIndex[sessionId][i];
    if (_plans[pid]) result.push(_plans[pid]);
  }
  return result;
}

export function removePlan(planId) {
  if (!_plans[planId]) return false;
  var plan = _plans[planId];
  delete _plans[planId];

  if (plan.sessionId && _planSessionIndex[plan.sessionId]) {
    var idx = _planSessionIndex[plan.sessionId].indexOf(planId);
    if (idx !== -1) _planSessionIndex[plan.sessionId].splice(idx, 1);
  }

  var sid = plan.sessionId || _activeSessionId;
  var sessState = getSessionRuntime(sid);
  if (sessState.currentPlanId === planId) {
    sessState.currentPlanId = '';
  }

  events.emit('runtime:plan_removed', {
    planId: planId,
    state: sessState,
    sessionId: sid
  });
  return true;
}

export function planCount(sessionId) {
  if (sessionId) {
    return _planSessionIndex[sessionId] ? _planSessionIndex[sessionId].length : 0;
  }
  var count = 0;
  for (var _ in _plans) count++; // eslint-disable-line no-unused-vars
  return count;
}

// ═══════════════════════════════════════════════════════════
// MUTATE
// ═══════════════════════════════════════════════════════════

function mutate(changes, eventType, eventData, sessionId) {
  var sid = sessionId || _activeSessionId || 'default';
  var sessState = getSessionRuntime(sid);
  var oldState = Object.assign({}, sessState);
  Object.assign(sessState, changes);

  if (eventType) {
    events.emit('runtime:' + eventType, {
      changes: changes,
      state: sessState,
      sessionId: sid,
      data: eventData || null
    });
  }

  for (var i = 0; i < _subscribers.length; i++) {
    try { _subscribers[i](sessState, oldState); } catch (e) {
      console.error('[RUNTIME] Subscriber error:', e);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// PUBLIC MUTATION API
// ═══════════════════════════════════════════════════════════

export function initSession(goal, sessionId) {
  var sid = sessionId || 'session_' + Date.now();
  _activeSessionId = sid;
  _runtimeBySession[sid] = createInitialSessionState(sid);
  agentState.reset(sid);

  mutate({
    goal: goal || '',
    state: 'thinking',
    currentPlanId: '',
    messages: [],
    toolResults: [],
    observations: [],
    decisions: [],
    memory: {},
    metadata: {
      startedAt: Date.now(),
      iteration: 0,
      sessionId: sid,
      iterationLabel: ''
    }
  }, 'init', { goal: goal, sessionId: sid }, sid);
}

export function setGoal(goal, sessionId) {
  mutate({ goal: goal }, 'goal', { goal: goal }, sessionId);
}

export function setState(state, sessionId) {
  var sid = sessionId || _activeSessionId;
  if (agentState.getState(sid) !== state) {
    agentState.transition(state, sid);
  }
  mutate({ state: state }, 'state', { state: state }, sid);
}

export function setCurrentPlan(plan, sessionId) {
  var sid = sessionId || (plan && plan.sessionId) || _activeSessionId;
  if (!plan) {
    mutate({ currentPlanId: '' }, 'plan', { plan: null }, sid);
    return;
  }
  if (plan.id && !_plans[plan.id]) {
    if (!plan.sessionId) plan.sessionId = sid;
    registerPlan(plan);
  }
  mutate({ currentPlanId: plan.id || '' }, 'plan', { plan: plan }, sid);
}

export function addMessage(message, sessionId) {
  var sid = sessionId || _activeSessionId;
  var sessState = getSessionRuntime(sid);
  var msgs = sessState.messages.slice();
  msgs.push(message);
  mutate({ messages: msgs }, 'message', { message: message }, sid);
}

export function updateLastMessage(updates, sessionId) {
  var sid = sessionId || _activeSessionId;
  var sessState = getSessionRuntime(sid);
  var msgs = sessState.messages.slice();
  if (msgs.length > 0) {
    var last = Object.assign({}, msgs[msgs.length - 1], updates);
    msgs[msgs.length - 1] = last;
    mutate({ messages: msgs }, 'message_update', { updates: updates }, sid);
  }
}

export function addToolResult(result, sessionId) {
  var sid = sessionId || _activeSessionId;
  var sessState = getSessionRuntime(sid);
  var results = sessState.toolResults.slice();
  results.push(result);
  mutate({ toolResults: results }, 'tool_result', { result: result }, sid);
}

export function addObservation(type, detail, source, sessionId) {
  var sid = sessionId || _activeSessionId;
  var sessState = getSessionRuntime(sid);
  var obs = sessState.observations.slice();
  obs.push({
    type: type || 'info',
    detail: detail || '',
    source: source || 'system',
    timestamp: Date.now()
  });
  mutate({ observations: obs }, 'observation', { type: type, detail: detail }, sid);
}

export function addDecision(tool, decision, reason, sessionId) {
  var sid = sessionId || _activeSessionId;
  var sessState = getSessionRuntime(sid);
  var decs = sessState.decisions.slice();
  decs.push({
    tool: tool,
    decision: decision,
    reason: reason || '',
    timestamp: Date.now()
  });
  mutate({ decisions: decs }, 'decision', { tool: tool, decision: decision }, sid);
}

export function updateMetadata(changes, sessionId) {
  var sid = sessionId || _activeSessionId;
  var sessState = getSessionRuntime(sid);
  var meta = Object.assign({}, sessState.metadata, changes);
  mutate({ metadata: meta }, 'metadata', { changes: changes }, sid);
}

export function setMemory(key, value, sessionId) {
  var sid = sessionId || _activeSessionId;
  var sessState = getSessionRuntime(sid);
  var mem = Object.assign({}, sessState.memory);
  mem[key] = value;
  mutate({ memory: mem }, 'memory', { key: key }, sid);
}

export function reset(sessionId) {
  if (sessionId) {
    agentState.reset(sessionId);
    delete _runtimeBySession[sessionId];
    var sessionPlans = _planSessionIndex[sessionId] || [];
    for (var i = 0; i < sessionPlans.length; i++) {
      delete _plans[sessionPlans[i]];
    }
    delete _planSessionIndex[sessionId];
  } else {
    agentState.reset();
    _plans = {};
    _planSessionIndex = {};
    _runtimeBySession = {};
    _activeSessionId = 'default';
  }
  events.emit('runtime:reset', { sessionId: sessionId || 'all' });
}

export function disposeSession(sessionId) {
  if (!sessionId) return;
  reset(sessionId);
  try {
    memoryManager.clear(sessionId);
  } catch (_) {}
  try {
    goalTracker.clear(sessionId);
  } catch (_) {}
  try {
    timelineManager.clearTimeline(sessionId);
  } catch (_) {}
  try {
    permissions.resetChatDecisions(sessionId);
  } catch (_) {}
  try {
    terminalManager.resetTerminal(sessionId);
  } catch (_) {}
  try {
    projectKnowledge.deleteCheckpointsBySession(sessionId);
  } catch (_) {}
  try {
    diffManager.rejectAll(sessionId);
  } catch (_) {}
  try {
    executionTrace.clearTraces(sessionId);
  } catch (_) {}
  events.emit('session:disposed', { sessionId: sessionId });
}
