// agentState.js — Formal State Machine for the Agent Loop
//
// States:
//   idle          — Ready, no active session
//   thinking      — LLM provider is streaming a response
//   executing     — Executing tool calls
//   verifying     — Verifying tool result
//   completed     — Agent finished successfully (terminal)
//   failed        — Agent terminated with unrecoverable error
//   stopped       — User requested stop between iterations
//
// Valid transitions (enforced):
//   idle → thinking
//   thinking → executing (tool calls received)
//   thinking → completed (no tool calls, direct answer)
//   executing → thinking (more iterations needed)
//   executing → verifying (after tool execution)
//   verifying → thinking (continue loop)
//   verifying → completed (all steps done)
//   executing → completed (no more iterations)
//   * → failed (on error)
//   * → stopped (on user signal)
//
// Invalid transitions throw StateError.

var _state = 'idle';

/** Error thrown on invalid state transitions. */
export class StateError extends Error {
  constructor(from, to) {
    super('Invalid state transition: ' + from + ' → ' + to);
    this.name = 'StateError';
    this.from = from;
    this.to = to;
  }
}

/** Map of valid transitions: [fromState] → Set of allowed toStates */
var TRANSITIONS = {
  idle:       new Set(['thinking']),
  thinking:   new Set(['executing', 'completed', 'failed', 'stopped']),
  executing:  new Set(['thinking', 'verifying', 'completed', 'failed', 'stopped']),
  verifying:  new Set(['thinking', 'completed', 'failed', 'stopped']),
  completed:  new Set([]),  // terminal
  failed:     new Set([]),  // terminal
  stopped:    new Set([])   // terminal
};

/** Human-readable labels for each state. */
export var LABELS = {
  idle:       'Idle',
  thinking:   'Thinking',
  executing:  'Executing Tools',
  verifying:  'Verifying',
  completed:  'Completed',
  failed:     'Failed',
  stopped:    'Stopped'
};

/**
 * Transition to a new state. Throws StateError if the transition is invalid.
 * @param {string} to - Target state
 * @returns {string} The new state
 */
export function transition(to) {
  var allowed = TRANSITIONS[_state];
  if (!allowed || !allowed.has(to)) {
    throw new StateError(_state, to);
  }
  var from = _state;
  _state = to;
  return from;
}

/**
 * Get the current state.
 * @returns {string}
 */
export function getState() {
  return _state;
}

/**
 * Reset to idle. Always allowed (used for session cleanup).
 */
export function reset() {
  _state = 'idle';
}

/**
 * Check if the current state allows transitioning to `to`.
 * @param {string} to - Target state to check
 * @returns {boolean}
 */
export function canTransition(to) {
  var allowed = TRANSITIONS[_state];
  return !!allowed && allowed.has(to);
}

/**
 * Check if the current state is a terminal state (completed, failed, stopped).
 * @returns {boolean}
 */
export function isTerminal() {
  return _state === 'completed' || _state === 'failed' || _state === 'stopped';
}
