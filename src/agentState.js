// agentState.js — Formal State Machine for the Agent Loop
//
// States:
//   idle              — Ready, no active session
//   thinking          — LLM provider is streaming a response
//   workspace_analysis — Analyzing workspace structure
//   planning          — Planning steps
//   searching         — Searching files
//   reading           — Reading file content
//   writing           — Writing files
//   editing           — Editing files
//   executing         — Executing tool calls / commands
//   testing           — Running tests
//   reviewing         — Reviewing & reflecting on results
//   waiting           — Waiting for user approval
//   completed         — Agent finished successfully (terminal)
//   failed            — Agent terminated with unrecoverable error
//   cancelled         — Agent cancelled
//   stopped           — User requested stop between iterations
//
// Valid transitions: any non-terminal state → any active state.
// Terminal states (completed, failed, cancelled, stopped) are sink states.
// * → failed (on error)
// * → stopped (on user signal)
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
var ACTIVE_STATES = ['thinking', 'verifying', 'workspace_analysis', 'planning', 'searching', 'reading', 'writing', 'editing', 'executing', 'testing', 'reviewing', 'waiting', 'completed', 'failed', 'cancelled', 'stopped'];
var TRANSITIONS = {
  idle:               new Set(ACTIVE_STATES),
  thinking:           new Set(ACTIVE_STATES),
  verifying:          new Set(ACTIVE_STATES),
  workspace_analysis: new Set(ACTIVE_STATES),
  planning:           new Set(ACTIVE_STATES),
  searching:          new Set(ACTIVE_STATES),
  reading:            new Set(ACTIVE_STATES),
  writing:            new Set(ACTIVE_STATES),
  editing:            new Set(ACTIVE_STATES),
  executing:          new Set(ACTIVE_STATES),
  testing:            new Set(ACTIVE_STATES),
  reviewing:          new Set(ACTIVE_STATES),
  waiting:            new Set(ACTIVE_STATES),
  completed:          new Set([]), // terminal
  failed:             new Set([]), // terminal
  cancelled:          new Set([]), // terminal
  stopped:            new Set([])  // terminal
};

/** Human-readable labels for each state. */
export var LABELS = {
  idle:               'Idle',
  thinking:           'Thinking',
  verifying:          'Verifying',
  workspace_analysis: 'Analyzing Workspace',
  planning:           'Planning',
  searching:          'Searching Files',
  reading:            'Reading File',
  writing:            'Writing File',
  editing:            'Editing File',
  executing:          'Executing Command',
  testing:            'Running Tests',
  reviewing:          'Reviewing & Reflecting',
  waiting:            'Waiting for Approval',
  completed:          'Completed',
  failed:             'Failed',
  cancelled:          'Cancelled',
  stopped:            'Stopped'
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
 * Check if the current state is a terminal state (completed, failed, cancelled).
 * @returns {boolean}
 */
export function isTerminal() {
  return _state === 'completed' || _state === 'failed' || _state === 'cancelled' || _state === 'stopped';
}
