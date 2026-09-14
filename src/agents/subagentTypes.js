// subagentTypes.js — Subagent Identity Models and Constants

export var MAX_SUBAGENT_DEPTH = 1;
export var MAX_CONCURRENT_SUBAGENTS = 10;
export var DEFAULT_SUBAGENT_TIMEOUT_MS = 0;
export var DEFAULT_SUBAGENT_MAX_ITERATIONS = 20;

export function getDefaultLimits() {
  return {
    maxDepth: MAX_SUBAGENT_DEPTH,
    maxConcurrent: MAX_CONCURRENT_SUBAGENTS,
    maxIterations: DEFAULT_SUBAGENT_MAX_ITERATIONS,
    timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS
  };
}

export function normalizeLimits(options) {
  var defaults = getDefaultLimits();
  var input = options || {};
  var maxDepth = Number(input.maxDepth);
  var maxConcurrent = Number(input.maxConcurrent);
  var maxIterations = Number(input.maxIterations);
  var timeoutMs = Number(input.timeoutMs);
  return {
    maxDepth: Number.isFinite(maxDepth) && maxDepth >= 0 ? Math.floor(maxDepth) : defaults.maxDepth,
    maxConcurrent: Number.isFinite(maxConcurrent) && maxConcurrent > 0 ? Math.floor(maxConcurrent) : defaults.maxConcurrent,
    maxIterations: Number.isFinite(maxIterations) && maxIterations > 0 ? Math.floor(maxIterations) : defaults.maxIterations,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : defaults.timeoutMs
  };
}

export function createAgentId() {
  return 'agent_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

export function createSubagentIdentity(options) {
  var opt = options || {};
  var parentDepth = 0;
  if (opt.depth !== undefined) {
    parentDepth = opt.depth;
  } else if (opt.parentDepth !== undefined) {
    parentDepth = opt.parentDepth;
  }
  var maxDepth = opt.maxDepth !== undefined ? Number(opt.maxDepth) : MAX_SUBAGENT_DEPTH;
  if (parentDepth >= maxDepth) {
    throw new Error('Subagent recursion limit reached: depth cannot exceed ' + maxDepth);
  }
  return {
    agentId: opt.agentId || createAgentId(),
    id: opt.id || 'subagent_' + Date.now(),
    name: opt.name || opt.role || 'Subagent',
    role: opt.role || opt.name || 'Subagent',
    task: opt.task || '',
    context: opt.context || '',
    execution: opt.execution === 'wait' ? 'wait' : 'async',
    parentAgentId: opt.parentAgentId || null,
    sessionId: opt.sessionId || ('session_sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)),
    parentSessionId: opt.parentSessionId || null,
    depth: parentDepth + 1,
    agentType: 'subagent'
  };
}

export function createRootIdentity(sessionId) {
  return {
    agentId: 'agent_root_' + (sessionId || Date.now()),
    id: 'root',
    name: 'Main Agent',
    role: 'Root Agent',
    task: '',
    context: '',
    execution: 'root',
    parentAgentId: null,
    sessionId: sessionId || 'session_root',
    parentSessionId: null,
    depth: 0,
    agentType: 'root'
  };
}
