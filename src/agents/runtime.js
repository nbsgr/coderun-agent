// runtime.js — Centralized Execution Context (Runtime)
//
// SINGLE source of truth for ALL execution state.
// Every mutation emits an event via the events.js bus.
// The UI renders from Runtime state — never creates or modifies it.
//
// Ownership boundaries:
//   Runtime         — owns execution state + plan cache, emits events
//   Agent Loop      — drives execution, mutates Runtime state
//   Planner         — only modifies planning data through Runtime
//   Observer        — only records observations through Runtime
//   Memory Engine   — only stores structured knowledge through Runtime
//   UI (ChatSpace)  — renders Runtime state, never mutates it
//
// PLANNING ARCHITECTURE:
//   Runtime owns the authoritative plan cache (_plans). All plan objects
//   live here and are reference-stable — consumers always get the same
//   object until Runtime replaces it. The LLM never needs to reconstruct
//   plan state from conversation history; it queries Runtime APIs.
//
//   Plan flow:
//     create_plan → tools.js → planningManager → planningEngine (generates)
//                   ↓
//                 runtime.registerPlan() ← authoritative copy stored here
//                   ↓
//                 agentLoop reads runtime.getActivePlan() — always fresh
//                   ↓
//     update_plan → tools.js → planningManager → planningEngine (mutates)
//                   ↓
//                 runtime.updatePlan() ← cache updated, events emitted
//                   ↓
//                 agentLoop reads same object — no stale reference
//                   ↓
//     get_plan    → tools.js → runtime.getPlan() / getActivePlan()
//                              returns the exact same object reference
//
// State shape:
//   {
//     goal:          string,
//     state:         'idle'|'thinking'|'executing'|'verifying'|'completed'|'failed'|'stopped',
//     currentPlanId: string,          // ← plan ID, not object (avoids stale refs)
//     messages:      array,
//     toolResults:   array,
//     observations:  array,
//     decisions:     array,
//     memory:        object,
//     metadata:      { startedAt, iteration, sessionId }
//   }

import * as events from './events.js';
import * as agentState from './agentState.js';

// ── Plan cache ────────────────────────────────────────────
// SINGLE authoritative store for all plan objects.
// No other module holds a separate plan cache.
var _plans = {};           // { [planId]: Plan }
var _planSessionIndex = {};// { [sessionId]: [planId, ...] }

var _state = {
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
    sessionId: '',
    iterationLabel: ''
  }
};

// ═══════════════════════════════════════════════════════════
// SUBSCRIPTION
// ═══════════════════════════════════════════════════════════

var _subscribers = [];

/**
 * Subscribe to state changes. The callback receives the new state.
 * @param {function} fn - (newState) => void
 * @returns {function} unsubscribe
 */
function performUnsubscribe(subscriberList, fn) {
  var idx = subscriberList.indexOf(fn);
  if (idx !== -1) subscriberList.splice(idx, 1);
}

export function subscribe(fn) {
  _subscribers.push(fn);
  return performUnsubscribe.bind(null, _subscribers, fn);
}

// ═══════════════════════════════════════════════════════════
// READ
// ═══════════════════════════════════════════════════════════

export function getState() {
  return _state;
}

/**
 * Get the active plan object. Returns the authoritative plan from the
 * internal cache — always the same reference until replaced.
 * Returns null if no plan is active.
 */
export function getCurrentPlan() {
  return _state.currentPlanId ? (_plans[_state.currentPlanId] || null) : null;
}

export function getGoal() {
  return _state.goal;
}

export function getMessages() {
  return _state.messages;
}

export function getToolResults() {
  return _state.toolResults;
}

export function getMetadata() {
  return _state.metadata;
}

// ═══════════════════════════════════════════════════════════
// PLAN CACHE — Single Source of Truth for all plan objects
// ═══════════════════════════════════════════════════════════

/**
 * Register a plan in the runtime cache. Returns the same plan object.
 * If a plan with the same ID already exists, it is overwritten.
 * @param {object} plan - Plan object with .id and .sessionId
 * @returns {object} the same plan reference
 */
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

  if (fullyCompleted) {
    console.log('[RUNTIME] Plan ' + plan.id + ' fully completed. Deleting.');
    removePlan(plan.id);
  } else {
    _plans[plan.id] = plan;
    // Emit a runtime event so any listeners can react
    events.emit('runtime:plan_updated', {
      planId: plan.id,
      plan: plan,
      state: _state
    });
  }

  // Notify subscribers about the plan change
  if (_state.currentPlanId === plan.id || fullyCompleted) {
    for (var i = 0; i < _subscribers.length; i++) {
      try { _subscribers[i](_state, _state); } catch (e) {
        console.error('[RUNTIME] Subscriber error:', e);
      }
    }
  }
  return plan;
}

/**
 * Get the active plan ID string.
 * @returns {string}
 */
export function getActivePlanId() {
  return _state.currentPlanId;
}

/**
 * Set the active plan by ID. The plan must already be registered
 * (via registerPlan or updatePlan), otherwise it's a no-op.
 * @param {string} planId
 * @returns {boolean} whether the active plan was changed
 */
export function setActivePlanId(planId) {
  if (!planId || !_plans[planId]) return false;
  mutate({ currentPlanId: planId }, 'plan', { planId: planId });
  return true;
}

/**
 * Get a plan by ID from the runtime cache.
 * @param {string} planId
 * @returns {object|null}
 */
export function getPlan(planId) {
  return planId ? (_plans[planId] || null) : null;
}

/**
 * Get all registered plans.
 * @returns {object[]}
 */
export function getAllPlans() {
  var result = [];
  for (var pid in _plans) {
    result.push(_plans[pid]);
  }
  return result;
}

/**
 * Get all plans for a specific session.
 * @param {string} sessionId
 * @returns {object[]}
 */
export function getPlansBySession(sessionId) {
  if (!_planSessionIndex[sessionId]) return [];
  var result = [];
  for (var i = 0; i < _planSessionIndex[sessionId].length; i++) {
    var pid = _planSessionIndex[sessionId][i];
    if (_plans[pid]) result.push(_plans[pid]);
  }
  return result;
}

/**
 * Remove a plan from the cache. If it's the active plan,
 * the active plan is cleared.
 * @param {string} planId
 * @returns {boolean}
 */
export function removePlan(planId) {
  if (!_plans[planId]) return false;
  var plan = _plans[planId];
  delete _plans[planId];

  // Clean up session index
  if (plan.sessionId && _planSessionIndex[plan.sessionId]) {
    var idx = _planSessionIndex[plan.sessionId].indexOf(planId);
    if (idx !== -1) _planSessionIndex[plan.sessionId].splice(idx, 1);
  }

  // Clear active plan if removed
  if (_state.currentPlanId === planId) {
    _state.currentPlanId = '';
  }

  events.emit('runtime:plan_removed', {
    planId: planId,
    state: _state
  });
  return true;
}

/**
 * Count of registered plans.
 * @returns {number}
 */
export function planCount() {
  var count = 0;
  for (var _ in _plans) count++; // eslint-disable-line no-unused-vars
  return count;
}

// ═══════════════════════════════════════════════════════════
// MUTATE — all mutations go through here
// ═══════════════════════════════════════════════════════════

function mutate(changes, eventType, eventData) {
  var oldState = Object.assign({}, _state);
  Object.assign(_state, changes);

  // Emit through events.js bus
  if (eventType) {
    events.emit('runtime:' + eventType, {
      changes: changes,
      state: _state,
      data: eventData || null
    });
  }

  // Notify subscribers
  for (var i = 0; i < _subscribers.length; i++) {
    try { _subscribers[i](_state, oldState); } catch (e) {
      console.error('[RUNTIME] Subscriber error:', e);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// PUBLIC MUTATION API
// ═══════════════════════════════════════════════════════════

/**
 * Initialize a new session.
 */
export function initSession(goal, sessionId) {
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
      sessionId: sessionId || 'session_' + Date.now(),
      iterationLabel: ''
    }
  }, 'init', { goal: goal, sessionId: sessionId });
}

/**
 * Set the current goal.
 */
export function setGoal(goal) {
  mutate({ goal: goal }, 'goal', { goal: goal });
}

/**
 * Set the agent state machine state.
 */
export function setState(state) {
  if (agentState.getState() !== state) {
    agentState.transition(state);
  }
  mutate({ state: state }, 'state', { state: state });
}

/**
 * Set the current plan (legacy compatible — registers and activates the plan).
 * If the plan has an id, it's stored in the plan cache and set as active.
 */
export function setCurrentPlan(plan) {
  if (!plan) {
    mutate({ currentPlanId: '' }, 'plan', { plan: null });
    return;
  }
  // Register in cache if not already present
  if (plan.id && !_plans[plan.id]) {
    registerPlan(plan);
  }
  mutate({ currentPlanId: plan.id || '' }, 'plan', { plan: plan });
}

/**
 * Add a message to the conversation.
 */
export function addMessage(message) {
  var msgs = _state.messages.slice();
  msgs.push(message);
  mutate({ messages: msgs }, 'message', { message: message });
}

/**
 * Update the last message (for streaming content).
 */
export function updateLastMessage(updates) {
  var msgs = _state.messages.slice();
  if (msgs.length > 0) {
    var last = Object.assign({}, msgs[msgs.length - 1], updates);
    msgs[msgs.length - 1] = last;
    mutate({ messages: msgs }, 'message_update', { updates: updates });
  }
}

/**
 * Add a tool result.
 */
export function addToolResult(result) {
  var results = _state.toolResults.slice();
  results.push(result);
  mutate({ toolResults: results }, 'tool_result', { result: result });
}

/**
 * Record an observation.
 */
export function addObservation(type, detail, source) {
  var obs = _state.observations.slice();
  obs.push({
    type: type || 'info',
    detail: detail || '',
    source: source || 'system',
    timestamp: Date.now()
  });
  mutate({ observations: obs }, 'observation', { type: type, detail: detail });
}

/**
 * Record a decision (e.g., tool approval).
 */
export function addDecision(tool, decision, reason) {
  var decs = _state.decisions.slice();
  decs.push({
    tool: tool,
    decision: decision,
    reason: reason || '',
    timestamp: Date.now()
  });
  mutate({ decisions: decs }, 'decision', { tool: tool, decision: decision });
}

/**
 * Update metadata (iteration, etc.).
 */
export function updateMetadata(changes) {
  var meta = Object.assign({}, _state.metadata, changes);
  mutate({ metadata: meta }, 'metadata', { changes: changes });
}

/**
 * Set memory key.
 */
export function setMemory(key, value) {
  var mem = Object.assign({}, _state.memory);
  mem[key] = value;
  mutate({ memory: mem }, 'memory', { key: key });
}

/**
 * Reset the runtime to initial state.
 */
export function reset() {
  agentState.reset();
  _plans = {};
  _planSessionIndex = {};
  _state = {
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
      sessionId: '',
      iterationLabel: ''
    }
  };
  events.emit('runtime:reset', { state: _state });
}
