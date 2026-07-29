// planningManager.js — Planning Engine Bridge
//
// This is the public-facing bridge between the core planning engine
// (planningEngine.js) and the rest of the extension.
//
// Responsibilities:
//   - Expose planningEngine's capabilities with backward-compatible API
//   - Track session-level plan cache for fast lookups
//   - Provide formatted context for prompt injection
//   - Bridge LLM tool results (create_plan/update_plan) to engine state
//   - Handle plan discovery across sessions
//
// Consumers:
//   - agentLoop.js  → getSessionPlans, storePlan, getActivePlansContext, analyzeRequest
//   - contextManager.js → getActivePlansContext
//   - tools.js      → create_plan, update_plan tool implementations delegate here
//
// Public API:
//   Legacy (backward-compatible):
//     createPlan(goal, context, sessionId)        → Plan
//     getSessionPlans(sessionId)                  → Plan[]
//     getPlan(planId)                             → Plan | null
//     updatePlanStatus(planId, status)            → void
//     storePlan(plan)                             → void
//     getActivePlansContext()                     → string
//
//   New (from planningEngine):
//     analyzeRequest(goal, context, workspace)    → AnalysisResult
//     buildPlan(analysis, sessionId)              → Plan
//     updateTaskStatus(planId, taskId, status, obs) → UpdateResult
//     getReadyTasks(planId)                       → Task[]
//     getBlockedTasks(planId)                     → Task[]
//     formatPlanContext(plan)                     → string
//     getExecutionGraph(planId)                   → ExecutionGraph | null
//     replanFromObservation(planId, observation)  → Plan | null
//     addObservation(planId, observation)         → boolean

import * as planningEngine from './planningEngine.js';
import * as projectKnowledge from './projectKnowledge.js';

// ═══════════════════════════════════════════════════════════
// SESSION CACHE
// ═══════════════════════════════════════════════════════════

var _planCache = {};  // { [sessionId]: { planId: Plan } }
var _sessionPlanIndex = {};  // { [sessionId]: [planId, ...] }

// ═══════════════════════════════════════════════════════════
// LEGACY BACKWARD-COMPATIBLE API
// ═══════════════════════════════════════════════════════════

/**
 * Create a structured plan (legacy signature — delegates to engine).
 * @param {string} goal - User's stated goal
 * @param {object} context - From ContextManager.gatherContext()
 * @param {string} sessionId - Chat session ID
 * @returns {Promise<object>} Plan
 */
export async function createPlan(goal, context, sessionId) {
  var workspace = (context && context.workspace) || '';
  var analysis = planningEngine.analyzeRequest(goal, context, workspace);
  var plan = planningEngine.buildPlan(analysis, sessionId);
  cachePlan(sessionId, plan);
  return plan;
}

/**
 * Get all plans for a session (backward-compatible).
 */
export function getSessionPlans(sessionId) {
  // First check cache
  if (_sessionPlanIndex[sessionId] && _sessionPlanIndex[sessionId].length) {
    var plans = [];
    for (var i = 0; i < _sessionPlanIndex[sessionId].length; i++) {
      var plan = getFromCache(sessionId, _sessionPlanIndex[sessionId][i]);
      if (plan) plans.push(plan);
    }
    if (plans.length) return plans;
  }

  // Fallback: try loading from storage
  try {
    // Try loading via projectKnowledge's getPlansBySession
    var storedPlans = projectKnowledge.getPlansBySession(sessionId);
    if (storedPlans && storedPlans.length) {
      var enriched = [];
      for (var s = 0; s < storedPlans.length; s++) {
        var sp = storedPlans[s];
        // Try to load full plan from engine storage
        var fullPlan = planningEngine.getPlan(sp.id);
        var plan = fullPlan || sp;
        enriched.push(plan);
        cachePlan(sessionId, plan);
      }
      return enriched;
    }
  } catch (_) {}

  return [];
}

/**
 * Get a single plan by ID (backward-compatible).
 */
export function getPlan(planId) {
  // Check engine first
  var plan = planningEngine.getPlan(planId);
  if (plan) return plan;

  // Fallback: projectKnowledge
  try {
    return projectKnowledge.getPlan(planId);
  } catch (_) {
    return null;
  }
}

/**
 * Update a plan's status (backward-compatible).
 */
export function updatePlanStatus(planId, status) {
  planningEngine.updatePlanStatus(planId, status);
}

/**
 * Store a plan (backward-compatible — called from agentLoop).
 */
export function storePlan(plan) {
  if (!plan) return;
  // If it's a legacy flat plan, let the engine migrate and persist
  if (plan.steps && !plan.phases) {
    var migrated = planningEngine.migrateLegacyPlan(plan);
    if (migrated) {
      cachePlan(migrated.sessionId, migrated);
    }
  } else {
    // Already new format, persist via engine
    try {
      projectKnowledge.setSetting('pe_plan_' + plan.id, JSON.stringify(plan));
    } catch (_) {}
    cachePlan(plan.sessionId, plan);
  }
}

/**
 * Get active plans as a formatted string for prompt injection.
 */
export function getActivePlansContext() {
  // Collect from engine
  var engineContext = planningEngine.formatAllActivePlans();
  if (engineContext) return engineContext;

  // Fallback: scan cache for non-completed plans
  var activePlans = [];
  for (var sid in _planCache) {
    for (var pid in _planCache[sid]) {
      var p = _planCache[sid][pid];
      if (p.status !== 'completed' && p.status !== 'failed' && p.status !== 'cancelled') {
        activePlans.push(p);
      }
    }
  }

  if (!activePlans.length) return '';

  var parts = ['## 📋 ACTIVE PLANS'];
  for (var a = 0; a < activePlans.length; a++) {
    parts.push('');
    parts.push(planningEngine.formatPlanContext(activePlans[a]));
  }
  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════
// NEW API — Delegating to planningEngine
// ═══════════════════════════════════════════════════════════

/**
 * Analyze a user request before planning.
 */
export function analyzeRequest(goal, context, workspace) {
  return planningEngine.analyzeRequest(goal, context, workspace);
}

/**
 * Build a plan from an analysis result.
 */
export function buildPlan(analysis, sessionId) {
  var plan = planningEngine.buildPlan(analysis, sessionId);
  cachePlan(sessionId, plan);
  return plan;
}

/**
 * Update a task's status and record an observation.
 */
export function updateTaskStatus(planId, taskId, status, observation) {
  var result = planningEngine.updateTaskStatus(planId, taskId, status, observation);
  // Update cache if plan was modified
  if (result.success && result.plan) {
    cachePlan(result.plan.sessionId, result.plan);
  }
  return result;
}

/**
 * Get tasks that are ready for execution.
 */
export function getReadyTasks(planId) {
  return planningEngine.getReadyTasks(planId);
}

/**
 * Get tasks that are blocked.
 */
export function getBlockedTasks(planId) {
  return planningEngine.getBlockedTasks(planId);
}

/**
 * Format a plan for prompt context injection.
 */
export function formatPlanContext(plan) {
  return planningEngine.formatPlanContext(plan);
}

/**
 * Get the execution graph for a plan.
 */
export function getExecutionGraph(planId) {
  return planningEngine.getExecutionGraph(planId);
}

/**
 * Re-plan based on an execution observation.
 */
export function replanFromObservation(planId, observation) {
  return planningEngine.replanFromObservation(planId, observation);
}

/**
 * Add an observation to a plan.
 */
export function addObservation(planId, observation) {
  return planningEngine.addObservation(planId, observation);
}

// ═══════════════════════════════════════════════════════════
// INTERNAL: Cache management
// ═══════════════════════════════════════════════════════════

function cachePlan(sessionId, plan) {
  if (!sessionId || !plan || !plan.id) return;

  if (!_planCache[sessionId]) _planCache[sessionId] = {};
  _planCache[sessionId][plan.id] = plan;

  if (!_sessionPlanIndex[sessionId]) _sessionPlanIndex[sessionId] = [];
  if (_sessionPlanIndex[sessionId].indexOf(plan.id) === -1) {
    _sessionPlanIndex[sessionId].push(plan.id);
  }
}

function getFromCache(sessionId, planId) {
  if (_planCache[sessionId] && _planCache[sessionId][planId]) {
    return _planCache[sessionId][planId];
  }
  return null;
}

/**
 * Clear session cache (for testing or reset).
 */
export function clearCache(sessionId) {
  if (sessionId) {
    delete _planCache[sessionId];
    delete _sessionPlanIndex[sessionId];
  } else {
    _planCache = {};
    _sessionPlanIndex = {};
  }
}
