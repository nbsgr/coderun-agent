// subagentLifecycle.js — Lifecycle State Machine and Guards for Subagents

import * as agentState from './agentState.js';

export function getLifecycleState(sessionIdOrState) {
  if (!sessionIdOrState) return 'idle';
  var raw = agentState.getState(sessionIdOrState);
  if (raw === 'idle' && (
      sessionIdOrState === 'thinking' || sessionIdOrState === 'verifying' ||
      sessionIdOrState === 'workspace_analysis' || sessionIdOrState === 'planning' ||
      sessionIdOrState === 'searching' || sessionIdOrState === 'reading' ||
      sessionIdOrState === 'writing' || sessionIdOrState === 'editing' ||
      sessionIdOrState === 'executing' || sessionIdOrState === 'testing' ||
      sessionIdOrState === 'reviewing' || sessionIdOrState === 'running' ||
      sessionIdOrState === 'pausing' ||
      sessionIdOrState === 'waiting' || sessionIdOrState === 'paused' ||
      sessionIdOrState === 'completed' || sessionIdOrState === 'failed' ||
      sessionIdOrState === 'cancelled' || sessionIdOrState === 'stopped' ||
      sessionIdOrState === 'max_iterations'
  )) {
    raw = sessionIdOrState;
  }
  if (raw === 'idle') return 'created';
  if (raw === 'running' || raw === 'thinking' || raw === 'verifying' || raw === 'workspace_analysis' ||
      raw === 'planning' || raw === 'searching' || raw === 'reading' ||
      raw === 'writing' || raw === 'editing' || raw === 'executing' ||
      raw === 'testing' || raw === 'reviewing') {
    return 'running';
  }
  if (raw === 'waiting') return 'waiting';
  if (raw === 'pausing') return 'pausing';
  if (raw === 'paused') return 'paused';
  if (raw === 'completed' || raw === 'max_iterations') return 'completed';
  if (raw === 'failed') return 'failed';
  if (raw === 'cancelled') return 'cancelled';
  if (raw === 'stopped') return 'stopped';
  return raw;
}

export function canPause(sessionIdOrState) {
  var s = getLifecycleState(sessionIdOrState);
  return s === 'running';
}

export function canResume(sessionIdOrState) {
  var s = getLifecycleState(sessionIdOrState);
  return s === 'paused';
}

export function canStop(sessionIdOrState) {
  var s = getLifecycleState(sessionIdOrState);
  return s !== 'completed' && s !== 'failed' && s !== 'cancelled' && s !== 'stopped' && s !== 'created' && s !== 'idle';
}
