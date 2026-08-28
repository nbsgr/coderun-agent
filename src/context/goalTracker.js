// goalTracker.js — Production-grade Goal Tracking Engine (Session Scoped)
// Tracks parent goals, subgoals, active tasks, completion rate, and syncs with planning & memory.

import * as projectKnowledge from './projectKnowledge.js';
import * as runtime from '../agents/runtime.js';
import * as memoryManager from './memoryManager.js';

var GOALS_KEY = 'mem_goals_';

function loadGoals(sessionId) {
  var sid = sessionId || 'default';
  var raw = projectKnowledge.getSetting(GOALS_KEY + sid);
  if (!raw) return { primaryGoal: '', subgoals: [], activeTaskId: '' };
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return { primaryGoal: '', subgoals: [], activeTaskId: '' };
  }
}

function saveGoals(data, sessionId) {
  var sid = sessionId || 'default';
  projectKnowledge.setSetting(GOALS_KEY + sid, JSON.stringify(data));
  try {
    var pct = calculateCompletionRate(data.subgoals);
    runtime.setMemory('goal_completion_pct', pct, sid);
    runtime.setMemory('active_task_id', data.activeTaskId, sid);
  } catch (_) {
    // Intentionally ignored
  }
}

function calculateCompletionRate(subgoals) {
  if (!subgoals || !subgoals.length) return 0;
  var completed = 0;
  for (var i = 0; i < subgoals.length; i++) {
    if (subgoals[i].status === 'completed') {
      completed++;
    }
  }
  return Math.round((completed / subgoals.length) * 100);
}

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

export function initGoals(primaryGoal, sessionId) {
  var sid = sessionId || 'default';
  var data = {
    primaryGoal: primaryGoal || '',
    subgoals: [],
    activeTaskId: ''
  };
  saveGoals(data, sid);
  memoryManager.setCurrentGoal(primaryGoal, sid);
}

export function syncWithPlan(plan, sessionId) {
  if (!plan) return;
  var sid = sessionId || plan.sessionId || 'default';
  var data = loadGoals(sid);
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
  var active = null;
  for (var i = 0; i < subgoals.length; i++) {
    var status = subgoals[i].status;
    if (status === 'active' || status === 'in_progress') {
      active = subgoals[i];
      break;
    }
  }
  if (!active) {
    for (var j = 0; j < subgoals.length; j++) {
      if (subgoals[j].status === 'pending') {
        active = subgoals[j];
        break;
      }
    }
  }
  if (active) data.activeTaskId = active.id;
  saveGoals(data, sid);
}

export function updateGoalStatus(goalId, status, sessionId) {
  var sid = sessionId || 'default';
  var data = loadGoals(sid);
  var goal = null;
  for (var i = 0; i < data.subgoals.length; i++) {
    if (data.subgoals[i].id === goalId) {
      goal = data.subgoals[i];
      break;
    }
  }
  if (goal) {
    goal.status = status;
    if (status === 'active' || status === 'in_progress') {
      data.activeTaskId = goalId;
    } else if (data.activeTaskId === goalId && (status === 'completed' || status === 'failed' || status === 'skipped')) {
      var next = null;
      for (var k = 0; k < data.subgoals.length; k++) {
        var st = data.subgoals[k].status;
        if (st === 'active' || st === 'in_progress') {
          next = data.subgoals[k];
          break;
        }
      }
      if (!next) {
        for (var m = 0; m < data.subgoals.length; m++) {
          if (data.subgoals[m].status === 'pending') {
            next = data.subgoals[m];
            break;
          }
        }
      }
      data.activeTaskId = next ? next.id : '';
    }
    saveGoals(data, sid);
  }
}

export function getActiveTask(sessionId) {
  return loadGoals(sessionId).activeTaskId;
}

export function getCompletionPercentage(sessionId) {
  return calculateCompletionRate(loadGoals(sessionId).subgoals);
}

export function getStatusReport(sessionId) {
  var sid = sessionId || 'default';
  var activePlan = runtime.getCurrentPlan(sid);
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

    var completedCount = 0;
    var activeTask = null;
    for (var i = 0; i < allTasks.length; i++) {
      if (allTasks[i].status === 'completed') {
        completedCount++;
      }
      if (allTasks[i].status === 'active') {
        activeTask = allTasks[i];
      }
    }
    var pct = allTasks.length ? Math.round((completedCount / allTasks.length) * 100) : 0;

    var lines = ['## GOAL PROGRESS REPORT'];
    lines.push('Primary Goal: ' + (activePlan.goal || ''));
    lines.push('Plan ID: ' + activePlan.id);
    lines.push('Completion Rate: ' + pct + '%');
    lines.push('Active Task: ' + (activeTask ? '#' + activeTask.id : 'None'));
    lines.push('Status: ' + (activeTask ? activeTask.description : 'All tasks completed'));

    if (allTasks.length) {
      lines.push('\nTasks:');
      for (var j = 0; j < allTasks.length; j++) {
        var t = allTasks[j];
        var mark = t.status === 'completed' ? '[x]' : t.status === 'failed' ? '[!]' : t.status === 'active' ? '[→]' : '[ ]';
        lines.push('  ' + mark + ' #' + t.id + ' (' + t.status + '): ' + t.description + ' [' + t.phaseName + ']');
      }
    }
    return lines.join('\n');
  }

  var data = loadGoals(sid);
  var lines2 = ['## GOAL PROGRESS REPORT'];
  lines2.push('Primary Goal: ' + data.primaryGoal);
  lines2.push('Completion Rate: ' + calculateCompletionRate(data.subgoals) + '%');
  lines2.push('Active Task: ' + (data.activeTaskId ? '#' + data.activeTaskId : 'None'));

  if (data.subgoals.length) {
    lines2.push('\nTasks:');
    for (var k = 0; k < data.subgoals.length; k++) {
      var g = data.subgoals[k];
      var mark2 = g.status === 'completed' ? '[x]' : g.status === 'failed' ? '[!]' : '[ ]';
      lines2.push('  ' + mark2 + ' #' + g.id + ' (' + g.status + '): ' + g.text);
    }
  }
  return lines2.join('\n');
}

export function clear(sessionId) {
  var sid = sessionId || 'default';
  projectKnowledge.setSetting(GOALS_KEY + sid, null);
}
