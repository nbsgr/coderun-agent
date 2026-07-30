// planningManager.js — Planning Engine Bridge
//
// Thin facade between planningEngine and the rest of the extension.
// The Runtime (runtime.js) is the SINGLE source of truth for all plan
// objects. This module:
//   - Delegates plan creation/mutation to planningEngine
//   - Registers/syncs all plan changes with Runtime's plan cache
//   - Formats plan data for prompt injection
//   - Provides backward-compatible legacy API
//
// NO plan caching here — the Runtime owns the plan cache.
//
// Consumers:
//   - agentLoop.js    → getSessionPlans, storePlan, getActivePlansContext, analyzeRequest
//   - contextManager.js → getActivePlansContext
//   - tools.js        → create_plan, update_plan delegate here
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
//   New:
//     analyzeRequest(goal, context, workspace)    → AnalysisResult
//     buildPlan(analysis, sessionId)              → Plan (cached in Runtime)
//     updateTaskStatus(planId, taskId, status, obs) → UpdateResult
//     getReadyTasks(planId)                       → Task[]
//     getBlockedTasks(planId)                     → Task[]
//     formatPlanContext(plan)                     → string
//     getExecutionGraph(planId)                   → ExecutionGraph | null
//     replanFromObservation(planId, observation)  → Plan | null
//     addObservation(planId, observation)         → boolean
//     getAllPlansContext()                        → string

import * as planningEngine from './planningEngine.js';
import * as runtime from '../agents/runtime.js';
import * as projectKnowledge from './projectKnowledge.js';

// Wire planningEngine persistence to runtime's in-memory plan cache.
// This replaces the old SQLite-backed storage — plans are now stored
// in VS Code workspaceState via extension.js event listeners.
planningEngine.setStorage({
  get: function(id) { return runtime.getPlan(id); },
  set: function(id, plan) { runtime.updatePlan(plan); },
  getAll: function() { return runtime.getAllPlans(); }
});

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
  runtime.registerPlan(plan);
  return plan;
}

export function getSessionPlans(sessionId) {
  // Runtime is the authoritative cache
  return runtime.getPlansBySession(sessionId);
}

/**
 * Get a single plan by ID (backward-compatible).
 * Tries Runtime cache first.
 */
export function getPlan(planId) {
  // Runtime is authoritative
  return runtime.getPlan(planId);
}

/**
 * Update a plan's status (backward-compatible).
 */
export function updatePlanStatus(planId, status) {
  planningEngine.updatePlanStatus(planId, status);
  var plan = planningEngine.getPlan(planId);
  if (plan) runtime.updatePlan(plan);
}

/**
 * Store a plan (backward-compatible — called from agentLoop).
 * Delegates to Runtime's plan cache.
 */
export function storePlan(plan) {
  if (!plan) return;
  // If it's a legacy flat plan, let the engine migrate and persist
  if (plan.steps && !plan.phases) {
    var migrated = planningEngine.migrateLegacyPlan(plan);
    if (migrated) {
      runtime.registerPlan(migrated);
      return;
    }
  }
  // Register/update in runtime cache
  runtime.registerPlan(plan);
  // Best-effort persistence
  try {
    projectKnowledge.setSetting('pe_plan_' + plan.id, JSON.stringify(plan));
  } catch (_) {}
}

/**
 * Get active plans as a formatted string for prompt injection.
 */
export function getActivePlansContext() {
  var allPlans = runtime.getAllPlans();
  var activePlans = [];
  for (var a = 0; a < allPlans.length; a++) {
    var p = allPlans[a];
    if (p.status !== 'completed' && p.status !== 'failed' && p.status !== 'cancelled') {
      var totalTasks = 0, completedTasks = 0;
      if (p.phases) {
        for (var pi = 0; pi < p.phases.length; pi++) {
          if (p.phases[pi].tasks) {
            totalTasks += p.phases[pi].tasks.length;
            completedTasks += p.phases[pi].tasks.filter(function(t) { return t.status === 'completed'; }).length;
          }
        }
      } else if (p.steps) {
        totalTasks = p.steps.length;
        completedTasks = p.steps.filter(function(s) { return s.status === 'completed'; }).length;
      }
      if (totalTasks === 0 || completedTasks < totalTasks) {
        activePlans.push(p);
      }
    }
  }
  if (!activePlans.length) return '';

  var parts = ['## 📋 ACTIVE PLANS'];
  for (var a2 = 0; a2 < activePlans.length; a2++) {
    parts.push('');
    parts.push(planningEngine.formatPlanContext(activePlans[a2]));
  }
  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════
// NEW API — Delegating to planningEngine, syncing to Runtime
// ═══════════════════════════════════════════════════════════

/**
 * Analyze a user request before planning.
 */
export function analyzeRequest(goal, context, workspace) {
  return planningEngine.analyzeRequest(goal, context, workspace);
}

/**
 * Get all plans as a formatted context string for the LLM.
 * Reads from Runtime cache — always authoritative.
 */
export function getAllPlansContext() {
  var allPlans = runtime.getAllPlans();
  if (!allPlans.length) return '';

  var lines = ['## ALL PLANS'];
  for (var i = 0; i < allPlans.length; i++) {
    var p = allPlans[i];
    lines.push('');
    lines.push('Plan: ' + esc(p.id));
    lines.push('  Goal: ' + esc(p.goal || '').substring(0, 100));
    lines.push('  Status: ' + (p.status || 'unknown'));
    if (p.summary) lines.push('  Summary: ' + p.summary);
    if (p.phases) {
      for (var ph = 0; ph < p.phases.length; ph++) {
        var phase = p.phases[ph];
        lines.push('  Phase ' + phase.order + ': ' + phase.name + ' [' + phase.status + ']');
        if (phase.tasks) {
          for (var t = 0; t < phase.tasks.length; t++) {
            var task = phase.tasks[t];
            lines.push('    Task ' + task.id + ': ' + esc(task.description) + ' [' + task.status + ']');
          }
        }
      }
    }
  }
  return lines.join('\n');
}

/**
 * Build a plan from an analysis result and register it with Runtime.
 */
export function buildPlan(analysis, sessionId) {
  var plan = planningEngine.buildPlan(analysis, sessionId);
  runtime.registerPlan(plan);
  return plan;
}

/**
 * Update a task's status and record an observation.
 *
 * Tries the engine (SQLite-backed) first. If the engine cannot find the plan
 * (e.g. projectKnowledge wasn't ready), falls back to the Runtime's plan cache.
 * The result is always synced back to the Runtime.
 */
export function updateTaskStatus(planId, taskId, status, observation) {
  // Try the engine (SQLite-backed) first
  var result = planningEngine.updateTaskStatus(planId, taskId, status, observation);

  // Engine succeeded — sync result to Runtime
  if (result.success) {
    if (result.plan) runtime.updatePlan(result.plan);
    return result;
  }

  // Engine failed — try to find the plan in Runtime cache
  var plan = runtime.getPlan(planId) || runtime.getCurrentPlan();
  if (!plan) return result; // not in Runtime either — return original failure

  // Find the task by searching phases or steps using flexible matching
  var task = null;
  var strId = String(taskId).trim();
  var numId = Number(strId);
  var lowerStr = strId.toLowerCase();
  var cleanTaskId = lowerStr.replace(/^(task[_\s]?|step[_\s]?|t)/, '');

  function matches(tObj, idx, ord) {
    if (!tObj) return false;
    var tId = String(tObj.id || '').trim();
    var tDesc = String(tObj.description || '').trim().toLowerCase();
    var tOrd = tObj.order || ord || (idx + 1);
    if (tId === strId || tId.toLowerCase() === lowerStr) return true;
    if (!isNaN(numId) && numId > 0 && (tOrd === numId || (idx + 1) === numId)) return true;
    var cleanTId = tId.toLowerCase().replace(/^(task[_\s]?|step[_\s]?|t)/, '');
    if (cleanTId && cleanTaskId && cleanTId === cleanTaskId) return true;
    if (tDesc && lowerStr && (tDesc === lowerStr || tDesc.includes(lowerStr) || lowerStr.includes(tDesc))) return true;
    var ptMatch = lowerStr.match(/^t?(\d+)[._-](\d+)$/);
    if (ptMatch) {
      var reqTask = Number(ptMatch[2]);
      if (ord === reqTask || (idx + 1) === reqTask) return true;
    }
    return false;
  }

  if (plan.phases) {
    var gIdx = 0;
    for (var p = 0; p < plan.phases.length; p++) {
      var phase = plan.phases[p];
      if (phase.tasks) {
        for (var t = 0; t < phase.tasks.length; t++) {
          gIdx++;
          if (matches(phase.tasks[t], t, gIdx)) {
            task = phase.tasks[t];
            break;
          }
        }
      }
      if (task) break;
    }
  }

  if (!task && plan.steps) {
    for (var s = 0; s < plan.steps.length; s++) {
      if (matches(plan.steps[s], s, s + 1)) {
        task = plan.steps[s];
        break;
      }
    }
  }

  if (!task) return result;

  // Update the task directly in memory
  task.status = status;
  if (observation) {
    if (!task.observations) task.observations = [];
    task.observations.push({
      type: observation.type || 'info',
      detail: observation.detail || '',
      timestamp: Date.now(),
      source: observation.source || 'update_plan_tool'
    });
  }
  if (status === 'completed' || status === 'failed') task.completedAt = Date.now();
  if (status === 'active') task.startedAt = Date.now();
  plan.updatedAt = Date.now();

  // Best-effort SQLite persistence
  try {
    projectKnowledge.setSetting('pe_plan_' + plan.id, JSON.stringify(plan));
  } catch (_) {}

  // Sync the updated plan back to Runtime
  runtime.updatePlan(plan);

  return {
    success: true,
    plan: plan,
    readyTasks: [],
    blockedTasks: []
  };
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
// INTERNAL: Helpers
// ═══════════════════════════════════════════════════════════

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
