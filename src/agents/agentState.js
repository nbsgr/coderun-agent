// agentState.js — Formal State Machine for the Agent Loop (Session Scoped)

var _stateBySession = {};

export function StateError(from, to) {
  var err = new Error('Invalid state transition: ' + from + ' → ' + to);
  Object.setPrototypeOf(err, StateError.prototype);
  err.name = 'StateError';
  err.from = from;
  err.to = to;
  return err;
}
StateError.prototype = Object.create(Error.prototype);
StateError.prototype.constructor = StateError;

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

export function transition(to, sessionId) {
  var sid = sessionId || 'default';
  var current = _stateBySession[sid] || 'idle';
  var allowed = TRANSITIONS[current];
  if (!allowed || !allowed.has(to)) {
    throw new StateError(current, to);
  }
  _stateBySession[sid] = to;
  return current;
}

export function getState(sessionId) {
  var sid = sessionId || 'default';
  return _stateBySession[sid] || 'idle';
}

export function isTerminal(sessionId) {
  var sid = sessionId || 'default';
  var s = _stateBySession[sid] || 'idle';
  return s === 'completed' || s === 'failed' || s === 'cancelled' || s === 'stopped';
}

export function reset(sessionId) {
  if (sessionId) {
    delete _stateBySession[sessionId];
  } else {
    _stateBySession = {};
  }
}
