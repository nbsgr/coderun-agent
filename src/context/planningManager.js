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

function getPlanFromRuntime(id) {
  return runtime.getPlan(id);
}

function updatePlanInRuntime(id, plan) {
  runtime.updatePlan(plan);
}

function getAllPlansFromRuntime() {
  return runtime.getAllPlans();
}

// Wire planningEngine persistence to runtime's in-memory plan cache.
planningEngine.setStorage({
  get: getPlanFromRuntime,
  set: updatePlanInRuntime,
  getAll: getAllPlansFromRuntime
});

// ═══════════════════════════════════════════════════════════
// LEGACY BACKWARD-COMPATIBLE API
// ═══════════════════════════════════════════════════════════

/**
 * Create a structured plan (legacy signature — delegates to engine).
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
  return runtime.getPlansBySession(sessionId);
}

/**
 * Get a single plan by ID (backward-compatible).
 * Tries Runtime cache first.
 */
export function getPlan(planId) {
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
  if (plan.steps && !plan.phases) {
    var migrated = planningEngine.migrateLegacyPlan(plan);
    if (migrated) {
      runtime.registerPlan(migrated);
      return;
    }
  }
  runtime.registerPlan(plan);
  try {
    projectKnowledge.setSetting('pe_plan_' + plan.id, JSON.stringify(plan));
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }
}

/**
 * Get active plans as a formatted string for prompt injection.
 */
export function getActivePlansContext(sessionId) {
  var allPlans = sessionId ? runtime.getPlansBySession(sessionId) : runtime.getAllPlans();
  var activePlans = [];
  for (var a = 0; a < allPlans.length; a++) {
    var p = allPlans[a];
    if (p.status !== 'completed' && p.status !== 'failed' && p.status !== 'cancelled' && p.status !== 'blocked') {
      var totalTasks = 0, completedTasks = 0;
      if (p.phases) {
        for (var pi = 0; pi < p.phases.length; pi++) {
          if (p.phases[pi].tasks) {
            totalTasks += p.phases[pi].tasks.length;
            for (var ti = 0; ti < p.phases[pi].tasks.length; ti++) {
              if (p.phases[pi].tasks[ti].status === 'completed' || p.phases[pi].tasks[ti].status === 'skipped') {
                completedTasks++;
              }
            }
          }
        }
      } else if (p.steps) {
        totalTasks = p.steps.length;
        for (var si = 0; si < p.steps.length; si++) {
          if (p.steps[si].status === 'completed' || p.steps[si].status === 'skipped') {
            completedTasks++;
          }
        }
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
// NEW PLANNING SERVICE API
// ═══════════════════════════════════════════════════════════

export function analyzeRequest(goal, context, workspace) {
  return planningEngine.analyzeRequest(goal, context, workspace);
}

export function buildPlan(analysis, sessionId) {
  var plan = planningEngine.buildPlan(analysis, sessionId);
  runtime.registerPlan(plan);
  return plan;
}

function matchesTask(strId, lowerStr, numId, cleanTaskId, tObj, idx, ord) {
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

/**
 * Update a task's status and record an observation.
 *
 * Tries the engine (SQLite-backed) first. If the engine cannot find the plan
 * (e.g. projectKnowledge wasn't ready), falls back to the Runtime's plan cache.
 * The result is always synced back to the Runtime.
 */
export function updateTaskStatus(planId, taskId, status, observation, sessionId) {
  if (status === 'in_progress') {
    status = 'active';
  }
  var VALID_TASK_STATUSES = new Set(['pending', 'active', 'completed', 'failed', 'skipped', 'blocked']);
  if (!VALID_TASK_STATUSES.has(status)) {
    return { success: false, message: 'Invalid task status: ' + status, blockedTasks: [], readyTasks: [] };
  }

  var result = planningEngine.updateTaskStatus(planId, taskId, status, observation, sessionId);

  if (result.success) {
    if (result.plan) runtime.updatePlan(result.plan);
    return result;
  }

  var plan = runtime.getPlan(planId) || runtime.getCurrentPlan(sessionId);
  if (!plan) return result;

  var task = null;
  var strId = String(taskId).trim();
  var numId = Number(strId);
  var lowerStr = strId.toLowerCase();
  var cleanTaskId = lowerStr.replace(/^(task[_\s]?|step[_\s]?|t)/, '');

  if (plan.phases) {
    var gIdx = 0;
    for (var p = 0; p < plan.phases.length; p++) {
      var phase = plan.phases[p];
      if (phase.tasks) {
        for (var t = 0; t < phase.tasks.length; t++) {
          gIdx++;
          if (matchesTask(strId, lowerStr, numId, cleanTaskId, phase.tasks[t], t, gIdx)) {
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
      if (matchesTask(strId, lowerStr, numId, cleanTaskId, plan.steps[s], s, s + 1)) {
        task = plan.steps[s];
        break;
      }
    }
  }

  if (!task) return result;

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

  try {
    projectKnowledge.setSetting('pe_plan_' + plan.id, JSON.stringify(plan));
  } catch (setErr) {
    console.warn('[PLANNING MANAGER] Failed to persist plan to projectKnowledge for plan ' + plan.id + ':', setErr.message);
  }

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
