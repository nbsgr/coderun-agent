// executionTrace.js — Production-grade Execution Trace System
// Collects and serializes chronological trace data (timeline, states, observations, decisions) into audit log files.

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';

var _activeTrace = {
  sessionId: '',
  goal: '',
  startedAt: 0,
  transitions: [],
  events: [],
  toolCalls: [],
  observations: [],
  decisions: [],
  filesTouched: []
};

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

export function startTrace(sessionId, goal) {
  _activeTrace = {
    sessionId: sessionId || 'session_' + Date.now(),
    goal: goal || '',
    startedAt: Date.now(),
    transitions: [],
    events: [],
    toolCalls: [],
    observations: [],
    decisions: [],
    filesTouched: []
  };
}

export function recordTransition(from, to) {
  _activeTrace.transitions.push({ from: from, to: to, ts: Date.now() });
}

export function recordEvent(event, data) {
  _activeTrace.events.push({ event: event, data: data, ts: Date.now() });
}

export function recordToolCall(name, args, toolCallId) {
  _activeTrace.toolCalls.push({ name: name, args: args, id: toolCallId, ts: Date.now() });
  var file = args.file_path || args.folder_path || '';
  if (file && _activeTrace.filesTouched.indexOf(file) === -1) {
    _activeTrace.filesTouched.push(file);
  }
}

export function recordObservation(observation) {
  _activeTrace.observations.push(observation);
}

export function recordDecision(tool, decision, reason) {
  _activeTrace.decisions.push({ tool: tool, decision: decision, reason: reason || '', ts: Date.now() });
}

/**
 * Serialize and save the trace to .agents/traces/trace_<sessionId>.json.
 *
 * @param {string} workspaceRoot - Absolute workspace root path
 * @returns {Promise<string>} Path of the written trace file, or empty string
 */
export async function saveTrace(workspaceRoot) {
  if (!workspaceRoot || !_activeTrace.sessionId) return '';

  _activeTrace.completedAt = Date.now();
  _activeTrace.duration = _activeTrace.completedAt - _activeTrace.startedAt;

  var agentsDir = path.join(workspaceRoot, '.agents');
  var tracesDir = path.join(agentsDir, 'traces');

  try {
    // Ensure .agents/traces exists
    if (!existsSync(agentsDir)) {
      await fs.mkdir(agentsDir);
    }
    if (!existsSync(tracesDir)) {
      await fs.mkdir(tracesDir);
    }

    var fileName = 'trace_' + _activeTrace.sessionId + '.json';
    var filePath = path.join(tracesDir, fileName);

    var content = JSON.stringify(_activeTrace, null, 2);
    await fs.writeFile(filePath, content, 'utf-8');
    console.log('[EXECUTION TRACE] Trace successfully saved to: ' + filePath);
    return filePath;
  } catch (e) {
    console.warn('[EXECUTION TRACE] Failed to write trace file:', e.message);
    return '';
  }
}
