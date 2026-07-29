// goalTracker.js — Production-grade Goal Tracking Engine
// Tracks parent goals, subgoals, active tasks, completion rate, and syncs with planning & memory.

import * as projectKnowledge from './projectKnowledge.js';
import * as runtime from './runtime.js';
import * as memoryManager from './memoryManager.js';

var GOALS_KEY = 'mem_goals';

function loadGoals() {
  var raw = projectKnowledge.getSetting(GOALS_KEY);
  if (!raw) return { primaryGoal: '', subgoals: [], activeTaskId: '' };
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return { primaryGoal: '', subgoals: [], activeTaskId: '' };
  }
}

function saveGoals(data) {
  projectKnowledge.setSetting(GOALS_KEY, JSON.stringify(data));
  try {
    var pct = calculateCompletionRate(data.subgoals);
    runtime.setMemory('goal_completion_pct', pct);
    runtime.setMemory('active_task_id', data.activeTaskId);
  } catch (_) {}
}

function calculateCompletionRate(subgoals) {
  if (!subgoals || !subgoals.length) return 0;
  var completed = subgoals.filter(function(g) { return g.status === 'completed'; }).length;
  return Math.round((completed / subgoals.length) * 100);
}

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

export function initGoals(primaryGoal) {
  var data = {
    primaryGoal: primaryGoal || '',
    subgoals: [],
    activeTaskId: ''
  };
  saveGoals(data);
  memoryManager.setCurrentGoal(primaryGoal);
}

export function syncWithPlan(plan) {
  if (!plan) return;
  var data = loadGoals();
  data.primaryGoal = plan.goal || data.primaryGoal;

  var subgoals = [];
  if (plan.phases) {
    for (var pi = 0; pi < plan.phases.length; pi++) {
      var phase = plan.phases[pi];
      if (phase.tasks) {
        for (var ti = 0; ti < phase.tasks.length; ti++) {
          var t = phase.tasks[ti];
          subgoals.push({
            id: t.id,
            text: t.description,
            status: t.status || 'pending',
            phaseName: phase.name
          });
        }
      }
    }
  } else if (plan.steps) {
    for (var s = 0; s < plan.steps.length; s++) {
      var step = plan.steps[s];
      subgoals.push({
        id: String(step.id || step.order || s + 1),
        text: step.description,
        status: step.status || 'pending',
        phaseName: 'Execution Checklist'
      });
    }
  }

  data.subgoals = subgoals;
  var active = subgoals.find(function(g) { return g.status === 'active' || g.status === 'in_progress'; });
  if (!active) active = subgoals.find(function(g) { return g.status === 'pending'; });
  if (active) data.activeTaskId = active.id;
  saveGoals(data);
}

export function updateGoalStatus(goalId, status) {
  var data = loadGoals();
  var goal = data.subgoals.find(function(g) { return g.id === goalId; });
  if (goal) {
    goal.status = status;
    if (status === 'active' || status === 'in_progress') {
      data.activeTaskId = goalId;
    } else if (data.activeTaskId === goalId && (status === 'completed' || status === 'failed' || status === 'skipped')) {
      var next = data.subgoals.find(function(g) { return g.status === 'active' || g.status === 'in_progress'; });
      if (!next) next = data.subgoals.find(function(g) { return g.status === 'pending'; });
      data.activeTaskId = next ? next.id : '';
    }
    saveGoals(data);
  }
}

export function getActiveTask() {
  return loadGoals().activeTaskId;
}

export function getCompletionPercentage() {
  return calculateCompletionRate(loadGoals().subgoals);
}

/**
 * Get a status report from the Runtime's active plan.
 * This is the authoritative source — always reflects the latest plan state.
 * Falls back to legacy SQLite-based goals if no active plan exists.
 */
export function getStatusReport() {
  // Try Runtime's active plan first (authoritative)
  var activePlan = runtime.getCurrentPlan();
  if (activePlan && activePlan.phases) {
    var allTasks = [];
    for (var pi = 0; pi < activePlan.phases.length; pi++) {
      var phase = activePlan.phases[pi];
      if (phase.tasks) {
        for (var ti = 0; ti < phase.tasks.length; ti++) {
          allTasks.push({
            id: phase.tasks[ti].id,
            status: phase.tasks[ti].status,
            description: phase.tasks[ti].description,
            phaseName: phase.name
          });
        }
      }
    }

    var completedCount = allTasks.filter(function(t) { return t.status === 'completed'; }).length;
    var activeTask = allTasks.find(function(t) { return t.status === 'active'; });
    var pct = allTasks.length ? Math.round((completedCount / allTasks.length) * 100) : 0;

    var lines = ['## GOAL PROGRESS REPORT'];
    lines.push('Primary Goal: ' + (activePlan.goal || ''));
    lines.push('Plan ID: ' + activePlan.id);
    lines.push('Completion Rate: ' + pct + '%');
    lines.push('Active Task: ' + (activeTask ? '#' + activeTask.id : 'None'));
    lines.push('Status: ' + (activeTask ? activeTask.description : 'All tasks completed'));

    if (allTasks.length) {
      lines.push('\nTasks:');
      for (var i = 0; i < allTasks.length; i++) {
        var t = allTasks[i];
        var mark = t.status === 'completed' ? '[x]' : t.status === 'failed' ? '[!]' : t.status === 'active' ? '[→]' : '[ ]';
        lines.push('  ' + mark + ' #' + t.id + ' (' + t.status + '): ' + t.description + ' [' + t.phaseName + ']');
      }
    }
    return lines.join('\n');
  }

  // Fallback: legacy SQLite-based goals
  var data = loadGoals();
  var lines = ['## GOAL PROGRESS REPORT'];
  lines.push('Primary Goal: ' + data.primaryGoal);
  lines.push('Completion Rate: ' + calculateCompletionRate(data.subgoals) + '%');
  lines.push('Active Task: ' + (data.activeTaskId ? '#' + data.activeTaskId : 'None'));

  if (data.subgoals.length) {
    lines.push('\nTasks:');
    for (var i = 0; i < data.subgoals.length; i++) {
      var g = data.subgoals[i];
      var mark = g.status === 'completed' ? '[x]' : g.status === 'failed' ? '[!]' : '[ ]';
      lines.push('  ' + mark + ' #' + g.id + ' (' + g.status + '): ' + g.text);
    }
  }
  return lines.join('\n');
}

export function clear() {
  projectKnowledge.setSetting(GOALS_KEY, null);
}
