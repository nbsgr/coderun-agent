// planningEngine.js — Production-grade Planning Engine
//
// Responsibilities:
//   - Analyze user requests before execution
//   - Build hierarchical plans (Plan → Phase → Task) with DAG dependencies
//   - Detect parallel execution opportunities
//   - Estimate complexity and identify required tools
//   - Support re-planning based on execution observations
//   - Provide structured context for prompt injection
//
// This is a pure engine with NO coupling to:
//   - UI (Dashboard, ChatSpace)
//   - Tool execution (tools.js, toolRegistry)
//   - Providers (provider*.js)
//   - Terminal management
//   - File management
//
// Public API (consumed by planningManager.js bridge):
//   analyzeRequest(goal, context, workspace) → AnalysisResult
//   buildPlan(analysis, sessionId) → Plan
//   getPlan(planId) → Plan | null
//   updatePlanStatus(planId, status) → void
//   updateTaskStatus(planId, taskId, status, observation?) → TaskUpdateResult
//   getExecutionGraph(planId) → ExecutionGraph | null
//   getReadyTasks(planId) → Task[]
//   getBlockedTasks(planId) → Task[]
//   formatPlanContext(plan) → string
//   formatAllActivePlans() → string
//   replanFromObservation(planId, observation) → Plan

import * as projectKnowledge from './projectKnowledge.js';

// ═══════════════════════════════════════════════════════════
// DATA MODEL HELPERS
// ═══════════════════════════════════════════════════════════

function generateId() {
  return 'plan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

function generateTaskId(phaseOrder, taskOrder) {
  return 't' + phaseOrder + '_' + taskOrder + '_' + Math.random().toString(36).slice(2, 6);
}

var VALID_PLAN_STATUSES = new Set(['draft', 'approved', 'in_progress', 'completed', 'failed', 'cancelled']);
var VALID_TASK_STATUSES = new Set(['pending', 'active', 'completed', 'failed', 'skipped', 'blocked']);
var VALID_PHASE_STATUSES = new Set(['pending', 'active', 'completed', 'failed', 'skipped']);

// ═══════════════════════════════════════════════════════════
// REQUEST ANALYSIS
// ═══════════════════════════════════════════════════════════

/**
 * Analyze a user request and produce a structured analysis result.
 * This is called BEFORE any plan is created.
 *
 * @param {string} goal - User's request text
 * @param {object} context - From contextManager.gatherContext()
 * @param {string} workspace - Absolute workspace path
 * @returns {object} AnalysisResult
 */
export function analyzeRequest(goal, context, workspace) {
  var lower = (goal || '').toLowerCase();
  var intent = detectIntent(goal, context);
  var complexity = estimateComplexity(goal, intent, context);
  var requiredTools = identifyRequiredTools(intent, goal);
  var estimatedIterations = estimateIterations(intent, complexity, requiredTools);
  var risks = assessRisks(intent, goal, requiredTools);
  var suggestions = generateSuggestions(intent, complexity);

  return {
    goal: goal,
    intent: intent,
    complexity: complexity,
    requiredTools: requiredTools,
    estimatedIterations: estimatedIterations,
    risks: risks,
    suggestions: suggestions,
    workspace: workspace,
    analyzedAt: Date.now()
  };
}

// ═══════════════════════════════════════════════════════════
// INTENT DETECTION
// ═══════════════════════════════════════════════════════════

/**
 * Detect user intent from the request text and context.
 * Returns { type, subtype, description, confidence }.
 */
function detectIntent(goal, context) {
  var lower = (goal || '').toLowerCase();
  var words = lower.split(/\s+/);
  var bigrams = [];
  for (var i = 0; i < words.length - 1; i++) {
    bigrams.push(words[i] + ' ' + words[i + 1]);
  }

  var intent = {
    type: 'unknown',
    subtype: null,
    description: '',
    confidence: 0,
    isModification: false,
    isExploration: false,
    isExecution: false
  };

  // === Code Generation ===
  if (hasAny(lower, ['create', 'generate', 'write a', 'implement', 'build a', 'new file', 'add feature', 'scaffold'])) {
    intent.type = 'code_generation';
    intent.subtype = detectGenerationSubtype(lower);
    intent.isModification = true;
    intent.confidence = 0.8;
    intent.description = 'Generate new code';
  }

  // === Refactoring ===
  else if (hasAny(lower, ['refactor', 'rename', 'extract', 'move', 'reorganize', 'restructure', 'clean up', 'simplify'])) {
    intent.type = 'refactoring';
    intent.subtype = detectRefactoringSubtype(lower);
    intent.isModification = true;
    intent.confidence = 0.85;
    intent.description = 'Refactor existing code';
  }

  // === Debugging ===
  else if (hasAny(lower, ['debug', 'fix', 'bug', 'error', 'issue', 'not working', 'broken', 'crash', 'failed', 'unexpected'])) {
    intent.type = 'debugging';
    intent.isModification = true;
    intent.confidence = 0.9;
    intent.description = 'Diagnose and fix a bug';
  }

  // === Testing ===
  else if (hasAny(lower, ['test', 'spec', 'unit test', 'integration test', 'e2e', 'coverage', 'assert'])) {
    intent.type = 'testing';
    intent.isModification = true;
    intent.confidence = 0.7;
    intent.description = 'Write or update tests';
  }

  // === Build / Deploy ===
  else if (hasAny(lower, ['build', 'compile', 'deploy', 'publish', 'release', 'ci', 'cd'])) {
    intent.type = 'build';
    intent.isExecution = true;
    intent.confidence = 0.7;
    intent.description = 'Build or deploy the project';
  }

  // === Dependency / Config ===
  else if (hasAny(lower, ['install', 'update ', 'upgrade', 'dependency', 'package', 'config', 'configure', 'setup'])) {
    intent.type = 'configuration';
    intent.isModification = true;
    intent.confidence = 0.7;
    intent.description = 'Configure or update dependencies';
  }

  // === Exploration / Question ===
  else if (hasAny(lower, ['what is', 'how does', 'explain', 'show me', 'find', 'search', 'where is', 'tell me about', 'document'])) {
    intent.type = 'exploration';
    intent.isExploration = true;
    intent.confidence = 0.8;
    intent.description = 'Explore and explain the codebase';
  }

  // === Documentation ===
  else if (hasAny(lower, ['document', 'readme', 'comment', 'docstring', 'api doc', 'changelog'])) {
    intent.type = 'documentation';
    intent.isModification = true;
    intent.confidence = 0.7;
    intent.description = 'Write or update documentation';
  }

  // === Terminal / Exec ===
  else if (hasAny(lower, ['run ', 'execute', 'start ', 'stop ', 'restart', 'npm ', 'git '])) {
    intent.type = 'execution';
    intent.isExecution = true;
    intent.confidence = 0.7;
    intent.description = 'Execute a command or script';
  }

  // === Architecture / Design ===
  else if (hasAny(lower, ['architecture', 'design', 'plan', 'diagram', 'schema', 'module'])) {
    intent.type = 'architecture';
    intent.isExploration = true;
    intent.confidence = 0.6;
    intent.description = 'Architecture analysis or design';
  }

  return intent;
}

function detectGenerationSubtype(lower) {
  if (hasAny(lower, ['component', 'react', 'vue', 'svelte', 'angular'])) return 'ui_component';
  if (hasAny(lower, ['api', 'endpoint', 'route', 'rest', 'graphql'])) return 'api';
  if (hasAny(lower, ['function', 'util', 'helper', 'library'])) return 'utility';
  if (hasAny(lower, ['class', 'model', 'entity', 'schema'])) return 'data_model';
  if (hasAny(lower, ['cli', 'command', 'script'])) return 'cli_tool';
  return 'general';
}

function detectRefactoringSubtype(lower) {
  if (hasAny(lower, ['rename', 'move'])) return 'rename';
  if (hasAny(lower, ['extract', 'inline'])) return 'extract';
  if (hasAny(lower, ['migrate', 'convert', 'upgrade'])) return 'migration';
  if (hasAny(lower, ['clean', 'simplify', 'remove dead'])) return 'cleanup';
  return 'general';
}

// ═══════════════════════════════════════════════════════════
// COMPLEXITY ESTIMATION
// ═══════════════════════════════════════════════════════════

function estimateComplexity(goal, intent, context) {
  var score = 0;
  var lower = (goal || '').toLowerCase();

  // Length-based
  if (goal.length > 500) score += 3;
  else if (goal.length > 200) score += 2;
  else if (goal.length > 80) score += 1;

  // Intent-based
  if (intent.type === 'refactoring' || intent.type === 'debugging') score += 2;
  if (intent.type === 'code_generation') score += 1;
  if (intent.type === 'architecture') score += 2;

  // Multi-file indicators
  if (hasAny(lower, ['all files', 'every', 'entire', 'multiple', 'many', 'project-wide'])) score += 2;
  if (hasAny(lower, ['refactor all', 'migrate', 'convert'])) score += 3;

  // Risk indicators
  if (hasAny(lower, ['production', 'deploy', 'database', 'migration'])) score += 2;
  if (hasAny(lower, ['dangerous', 'irreversible', 'careful', 'backup'])) score += 2;

  var label = 'low';
  if (score >= 3) label = 'medium';
  if (score >= 6) label = 'high';
  if (score >= 10) label = 'very_high';

  return { score: score, label: label };
}

// ═══════════════════════════════════════════════════════════
// TOOL IDENTIFICATION
// ═══════════════════════════════════════════════════════════

function identifyRequiredTools(intent, goal) {
  var tools = new Set();
  var lower = (goal || '').toLowerCase();

  switch (intent.type) {
    case 'code_generation':
    case 'documentation':
      tools.add('read_file');
      tools.add('write_file');
      tools.add('search_files');
      if (hasAny(lower, ['edit', 'update', 'modify', 'change'])) tools.add('edit_file');
      break;
    case 'refactoring':
      tools.add('read_file');
      tools.add('edit_file');
      tools.add('search_files');
      tools.add('list_directory');
      break;
    case 'debugging':
      tools.add('read_file');
      tools.add('search_files');
      tools.add('run_terminal');
      tools.add('edit_file');
      tools.add('find_in_files');
      break;
    case 'testing':
      tools.add('read_file');
      tools.add('write_file');
      tools.add('run_terminal');
      tools.add('search_files');
      break;
    case 'build':
      tools.add('run_terminal');
      break;
    case 'exploration':
      tools.add('read_file');
      tools.add('search_files');
      tools.add('list_directory');
      tools.add('find_in_files');
      break;
    case 'configuration':
      tools.add('read_file');
      tools.add('edit_file');
      tools.add('run_terminal');
      tools.add('search_files');
      break;
    case 'execution':
      tools.add('run_terminal');
      break;
    case 'architecture':
      tools.add('read_file');
      tools.add('list_directory');
      tools.add('search_files');
      tools.add('find_in_files');
      break;
    default:
      tools.add('read_file');
      tools.add('search_files');
      break;
  }

  return Array.from(tools);
}

// ═══════════════════════════════════════════════════════════
// ITERATION ESTIMATION
// ═══════════════════════════════════════════════════════════

function estimateIterations(intent, complexity, requiredTools) {
  var base = 3;
  switch (intent.type) {
    case 'code_generation': base = 4; break;
    case 'refactoring':     base = 5; break;
    case 'debugging':       base = 6; break;
    case 'testing':         base = 5; break;
    case 'exploration':     base = 2; break;
    case 'build':           base = 2; break;
    case 'architecture':    base = 4; break;
    case 'documentation':   base = 3; break;
    default:                base = 3; break;
  }
  // Scale by complexity
  if (complexity.label === 'medium') base += 3;
  if (complexity.label === 'high') base += 6;
  if (complexity.label === 'very_high') base += 12;
  return base;
}

// ═══════════════════════════════════════════════════════════
// RISK ASSESSMENT
// ═══════════════════════════════════════════════════════════

function assessRisks(intent, goal, requiredTools) {
  var risks = [];
  var lower = (goal || '').toLowerCase();

  // Intent-based risks
  if (intent.isModification) {
    risks.push({ level: 'medium', description: 'Modifies existing code — may need rollback capability' });
  }
  if (intent.type === 'refactoring' || intent.type === 'debugging') {
    risks.push({ level: 'high', description: 'Changes to working code — verify behavior after changes' });
  }

  // Tool-based risks
  if (requiredTools.indexOf('run_terminal') !== -1) {
    risks.push({ level: 'medium', description: 'Terminal execution may have side effects on the environment' });
  }
  if (requiredTools.indexOf('delete_file') !== -1) {
    risks.push({ level: 'high', description: 'File deletion is irreversible without checkpoint restore' });
  }

  // Keyword risks
  if (hasAny(lower, ['database', 'db ', 'migration'])) {
    risks.push({ level: 'high', description: 'Database operations may cause data loss' });
  }
  if (hasAny(lower, ['production', 'prod', 'deploy', 'live'])) {
    risks.push({ level: 'critical', description: 'Production deployment — requires human approval' });
  }

  return risks;
}

// ═══════════════════════════════════════════════════════════
// SUGGESTIONS
// ═══════════════════════════════════════════════════════════

function generateSuggestions(intent, complexity) {
  var suggestions = [];

  if (complexity.label === 'high' || complexity.label === 'very_high') {
    suggestions.push('Consider breaking this task into smaller independent subtasks');
    suggestions.push('Use checkpoints before making irreversible changes');
  }
  if (intent.type === 'debugging') {
    suggestions.push('Reproduce the issue first before applying fixes');
    suggestions.push('Add logging before and after the suspected problem area');
  }
  if (intent.type === 'refactoring') {
    suggestions.push('Run existing tests before refactoring to ensure no regressions');
    suggestions.push('Refactor in small, verifiable steps');
  }

  return suggestions;
}

// ═══════════════════════════════════════════════════════════
// PLAN BUILDING
// ═══════════════════════════════════════════════════════════

/**
 * Build a hierarchical Plan from an analysis result.
 *
 * @param {object} analysis  - Result from analyzeRequest()
 * @param {string} sessionId - Chat session ID
 * @returns {object} Plan
 */
export function buildPlan(analysis, sessionId) {
  var planId = generateId();
  var phases = buildPhases(analysis);
  var graph = buildExecutionGraph(phases);

  var plan = {
    id: planId,
    sessionId: sessionId,
    goal: analysis.goal,
    summary: '',
    status: 'draft',
    estimatedIterations: analysis.estimatedIterations,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    phases: phases,
    complexity: analysis.complexity,
    risks: analysis.risks,
    requiredTools: analysis.requiredTools,
    suggestions: analysis.suggestions,
    executionGraph: graph,
    observations: []
  };

  plan.summary = summarizePlan(plan);
  persistPlan(plan);
  return plan;
}

/**
 * Retrieve a plan from storage.
 */
export function getPlan(planId) {
  return loadPlan(planId);
}

/**
 * Update plan status with validation.
 */
export function updatePlanStatus(planId, status) {
  if (!VALID_PLAN_STATUSES.has(status)) {
    console.warn('[PLAN ENGINE] Invalid plan status:', status);
    return false;
  }
  var plan = loadPlan(planId);
  if (!plan) return false;
  plan.status = status;
  plan.updatedAt = Date.now();
  persistPlan(plan);
  return true;
}

/**
 * Update a specific task's status and optionally record an observation.
 * Returns { success, blockedTasks, readyTasks }.
 */
export function updateTaskStatus(planId, taskId, status, observation) {
  if (!VALID_TASK_STATUSES.has(status)) {
    console.warn('[PLAN ENGINE] Invalid task status:', status);
    return { success: false, blockedTasks: [], readyTasks: [] };
  }

  var plan = loadPlan(planId);
  if (!plan) return { success: false, blockedTasks: [], readyTasks: [] };

  var task = findTaskInPlan(plan, taskId);
  if (!task) return { success: false, blockedTasks: [], readyTasks: [] };

  // Record observation if provided
  if (observation) {
    if (!plan.observations) plan.observations = [];
    plan.observations.push({
      taskId: taskId,
      type: observation.type || 'info',
      detail: observation.detail || '',
      timestamp: Date.now(),
      source: observation.source || 'system'
    });
    if (!task.observations) task.observations = [];
    task.observations.push({
      type: observation.type || 'info',
      detail: observation.detail || '',
      timestamp: Date.now(),
      source: observation.source || 'system'
    });
  }

  task.status = status;
  task.actualOutput = observation && observation.output ? observation.output : task.actualOutput;
  if (status === 'active') task.startedAt = Date.now();
  if (status === 'completed' || status === 'failed') task.completedAt = Date.now();

  plan.updatedAt = Date.now();

  // Update parent phase status
  updatePhaseStatus(plan, task.phaseId);

  // Rebuild execution graph
  plan.executionGraph = buildExecutionGraph(plan.phases);

  persistPlan(plan);

  var blockedTasks = getBlockedTasks(plan);
  var readyTasks = getReadyTasks(plan);

  return {
    success: true,
    plan: plan,
    blockedTasks: blockedTasks,
    readyTasks: readyTasks
  };
}

/**
 * Record an observation against a plan (not task-specific).
 */
export function addObservation(planId, observation) {
  var plan = loadPlan(planId);
  if (!plan) return false;
  if (!plan.observations) plan.observations = [];
  plan.observations.push({
    taskId: null,
    type: observation.type || 'info',
    detail: observation.detail || '',
    timestamp: Date.now(),
    source: observation.source || 'system'
  });
  plan.updatedAt = Date.now();
  persistPlan(plan);
  return true;
}

// ═══════════════════════════════════════════════════════════
// EXECUTION GRAPH
// ═══════════════════════════════════════════════════════════

/**
 * Get the execution graph for a plan.
 */
export function getExecutionGraph(planId) {
  var plan = loadPlan(planId);
  return plan ? plan.executionGraph : null;
}

/**
 * Get tasks that are ready to execute (all dependencies satisfied).
 */
export function getReadyTasks(planId) {
  var plan = loadPlan(planId);
  if (!plan) return [];
  return _getReadyTasksFromPlan(plan);
}

function _getReadyTasksFromPlan(plan) {
  var ready = [];
  if (!plan || !plan.phases) return ready;

  for (var p = 0; p < plan.phases.length; p++) {
    var phase = plan.phases[p];
    if (phase.status === 'completed' || phase.status === 'skipped') continue;

    var allTasksResolved = true;
    for (var t = 0; t < phase.tasks.length; t++) {
      var task = phase.tasks[t];
      if (task.status !== 'pending' && task.status !== 'blocked') continue;

      var depsMet = true;
      if (task.dependsOn && task.dependsOn.length) {
        for (var d = 0; d < task.dependsOn.length; d++) {
          var depTask = findTaskInPlan(plan, task.dependsOn[d]);
          if (!depTask || depTask.status !== 'completed') {
            depsMet = false;
            break;
          }
        }
      }

      if (depsMet) {
        if (task.status === 'pending' || task.status === 'blocked') {
          ready.push(task);
        }
      } else {
        // Not blocked yet, just pending dependency
        allTasksResolved = false;
      }
    }

    // If all tasks in this phase are resolved, move to next phase
    // but still return ready tasks from current phase
  }

  return ready;
}

/**
 * Get tasks that are blocked (dependencies not met).
 */
export function getBlockedTasks(planId) {
  var plan = loadPlan(planId);
  if (!plan) return [];
  return _getBlockedTasksFromPlan(plan);
}

function _getBlockedTasksFromPlan(plan) {
  var blocked = [];
  if (!plan || !plan.phases) return blocked;

  for (var p = 0; p < plan.phases.length; p++) {
    var phase = plan.phases[p];
    for (var t = 0; t < phase.tasks.length; t++) {
      var task = phase.tasks[t];
      if (task.status === 'blocked') {
        blocked.push(task);
      } else if (task.status === 'pending' && task.dependsOn && task.dependsOn.length) {
        var anyDepFailed = false;
        var anyDepPending = false;
        for (var d = 0; d < task.dependsOn.length; d++) {
          var depTask = findTaskInPlan(plan, task.dependsOn[d]);
          if (!depTask || depTask.status === 'failed' || depTask.status === 'skipped') {
            anyDepFailed = true;
          } else if (depTask.status !== 'completed') {
            anyDepPending = true;
          }
        }
        if (anyDepFailed) {
          task.status = 'blocked';
          blocked.push(task);
        } else if (anyDepPending) {
          blocked.push(task);
        }
      }
    }
  }

  return blocked;
}

// ═══════════════════════════════════════════════════════════
// RE-PLANNING
// ═══════════════════════════════════════════════════════════

/**
 * Re-plan based on execution observation.
 * Called when the current plan is invalidated by new information.
 *
 * @param {string} planId
 * @param {object} observation - { type, detail, source, revisedGoal? }
 * @returns {object|null} Revised plan or null
 */
export function replanFromObservation(planId, observation) {
  var plan = loadPlan(planId);
  if (!plan) return null;

  // Record the observation
  if (!plan.observations) plan.observations = [];
  plan.observations.push({
    taskId: null,
    type: observation.type || 'info',
    detail: observation.detail || '',
    timestamp: Date.now(),
    source: observation.source || 'system',
    revision: plan.phases.length
  });

  // If a revised goal is provided, rebuild phases from the goal
  if (observation.revisedGoal) {
    var analysis = analyzeRequest(observation.revisedGoal, null, plan.planId);
    var newPhases = buildPhases(analysis);
    // Merge incomplete tasks from old plan with new phases
    plan.phases = mergePhases(plan, newPhases, analysis);
    plan.goal = observation.revisedGoal;
    plan.estimatedIterations = analysis.estimatedIterations;
    plan.complexity = analysis.complexity;
    plan.risks = analysis.risks;
    plan.requiredTools = analysis.requiredTools;
  } else {
    // Rebuild phases based on current state (mark completed tasks as skipped)
    plan = revisePlan(plan, observation);
  }

  plan.executionGraph = buildExecutionGraph(plan.phases);
  plan.summary = summarizePlan(plan);
  plan.updatedAt = Date.now();
  persistPlan(plan);
  return plan;
}

// ═══════════════════════════════════════════════════════════
// CONTEXT FORMATTING
// ═══════════════════════════════════════════════════════════

/**
 * Format a plan as structured text for prompt injection.
 */
export function formatPlanContext(plan) {
  if (!plan) return '';

  var graph = plan.executionGraph || {};
  var lines = ['📋 **Execution Plan: ' + esc(plan.goal) + '**'];
  lines.push('Status: ' + plan.status + ' | Estimated: ~' + plan.estimatedIterations + ' iterations | Complexity: ' + plan.complexity.label);

  if (plan.risks && plan.risks.length) {
    lines.push('Risks: ' + plan.risks.map(function(r) { return r.description; }).join('; '));
  }

  lines.push('');

  for (var p = 0; p < plan.phases.length; p++) {
    var phase = plan.phases[p];
    var phaseIcon = phase.status === 'completed' ? '✅' : phase.status === 'active' ? '▶️' : phase.status === 'failed' ? '❌' : '📌';
    lines.push(phaseIcon + ' Phase ' + (p + 1) + ': ' + esc(phase.name) + ' [' + phase.status + ']');

    for (var t = 0; t < phase.tasks.length; t++) {
      var task = phase.tasks[t];
      var taskIcon = task.status === 'completed' ? '  ✅' : task.status === 'active' ? '  ▶️' : task.status === 'failed' ? '  ❌' : task.status === 'blocked' ? '  🔒' : '  ⬜';
      lines.push(taskIcon + ' Task ' + task.id + ': ' + esc(task.description));

      if (task.dependsOn && task.dependsOn.length) {
        lines.push('      Depends on: ' + task.dependsOn.join(', '));
      }
      if (task.parallelWith && task.parallelWith.length) {
        lines.push('      Parallel with: ' + task.parallelWith.join(', '));
      }
    }
    lines.push('');
  }

  // Execution graph summary
  if (graph.entryPoints && graph.entryPoints.length) {
    lines.push('Entry points: ' + graph.entryPoints.join(', '));
  }
  if (graph.criticalPath && graph.criticalPath.length) {
    lines.push('Critical path: ' + graph.criticalPath.join(' → '));
  }

  return lines.join('\n');
}

/**
 * Format all active plans across sessions.
 */
export function formatAllActivePlans() {
  var plans = loadAllActivePlans();
  if (!plans || !plans.length) return '';

  var parts = ['## 📋 ACTIVE PLANS'];
  for (var i = 0; i < plans.length; i++) {
    parts.push('');
    parts.push(formatPlanContext(plans[i]));
  }
  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════
// INTERNAL: Phase/Task building
// ═══════════════════════════════════════════════════════════

function buildPhases(analysis) {
  var phases = [];
  var intent = analysis.intent;

  switch (intent.type) {
    case 'code_generation':
      phases.push(buildPhase(1, 'Research & Context', 'Gather existing code context and patterns', [
        { desc: 'Search for relevant existing files', action: 'search', target: 'project', complexity: 'low' },
        { desc: 'Read related files to understand patterns', action: 'read', target: 'files', complexity: 'low', dependsOn: ['t1_1'] }
      ]));
      phases.push(buildPhase(2, 'Implementation', 'Write the new code', [
        { desc: 'Create or modify the target file', action: 'write', target: 'file', complexity: 'medium', dependsOn: ['t1_1', 't1_2'] }
      ]));
      phases.push(buildPhase(3, 'Verification', 'Verify correctness', [
        { desc: 'Verify file was created correctly', action: 'verify', target: 'file', complexity: 'low', dependsOn: ['t2_1'] },
        { desc: 'Run build or syntax check if applicable', action: 'verify', target: 'build', complexity: 'low', dependsOn: ['t3_1'] }
      ]));
      break;

    case 'refactoring':
      phases.push(buildPhase(1, 'Analysis', 'Understand current implementation', [
        { desc: 'Locate code to refactor', action: 'search', target: 'files', complexity: 'low' },
        { desc: 'Read the existing implementation', action: 'read', target: 'file', complexity: 'low', dependsOn: ['t1_1'] }
      ]));
      phases.push(buildPhase(2, 'Refactoring', 'Apply refactoring changes', [
        { desc: 'Apply refactoring changes', action: 'edit', target: 'file', complexity: 'medium', dependsOn: ['t1_1', 't1_2'] }
      ]));
      phases.push(buildPhase(3, 'Verification', 'Verify no regressions', [
        { desc: 'Run tests to verify', action: 'verify', target: 'tests', complexity: 'low', dependsOn: ['t2_1'] }
      ]));
      break;

    case 'debugging':
      phases.push(buildPhase(1, 'Diagnosis', 'Reproduce and diagnose the issue', [
        { desc: 'Find the problematic code', action: 'search', target: 'files', complexity: 'low' },
        { desc: 'Read relevant source files', action: 'read', target: 'file', complexity: 'low', dependsOn: ['t1_1'] },
        { desc: 'Run diagnostic commands', action: 'terminal', target: 'diagnostic', complexity: 'medium', dependsOn: ['t1_2'] }
      ]));
      phases.push(buildPhase(2, 'Fix', 'Apply the fix', [
        { desc: 'Edit the file to fix the bug', action: 'edit', target: 'file', complexity: 'medium', dependsOn: ['t1_1', 't1_2', 't1_3'] }
      ]));
      phases.push(buildPhase(3, 'Verify', 'Confirm the fix', [
        { desc: 'Verify the fix works', action: 'verify', target: 'fix', complexity: 'low', dependsOn: ['t2_1'] }
      ]));
      break;

    case 'testing':
      phases.push(buildPhase(1, 'Test Discovery', 'Find existing tests and patterns', [
        { desc: 'Locate test files', action: 'search', target: 'tests', complexity: 'low' },
        { desc: 'Read existing tests for patterns', action: 'read', target: 'file', complexity: 'low', dependsOn: ['t1_1'] }
      ]));
      phases.push(buildPhase(2, 'Test Writing', 'Write or update tests', [
        { desc: 'Write or update test file', action: 'write', target: 'file', complexity: 'medium', dependsOn: ['t1_1', 't1_2'] }
      ]));
      phases.push(buildPhase(3, 'Test Execution', 'Run tests to verify', [
        { desc: 'Run the test suite', action: 'terminal', target: 'tests', complexity: 'low', dependsOn: ['t2_1'] }
      ]));
      break;

    case 'exploration':
      phases.push(buildPhase(1, 'Discovery', 'Search and read relevant files', [
        { desc: 'Search for relevant files', action: 'search', target: 'files', complexity: 'low' },
        { desc: 'Read discovered files', action: 'read', target: 'file', complexity: 'low', dependsOn: ['t1_1'] }
      ]));
      phases.push(buildPhase(2, 'Synthesis', 'Synthesize findings', [
        { desc: 'Summarize findings and provide answer', action: 'summarize', target: 'findings', complexity: 'low', dependsOn: ['t1_1', 't1_2'] }
      ]));
      break;

    case 'build':
    case 'execution':
      phases.push(buildPhase(1, 'Execution', 'Run the command', [
        { desc: 'Execute the command', action: 'terminal', target: 'command', complexity: 'medium' }
      ]));
      phases.push(buildPhase(2, 'Verification', 'Verify the output', [
        { desc: 'Check command output for errors', action: 'verify', target: 'output', complexity: 'low', dependsOn: ['t1_1'] }
      ]));
      break;

    case 'architecture':
      phases.push(buildPhase(1, 'Codebase Analysis', 'Analyze project structure and dependencies', [
        { desc: 'List project structure', action: 'search', target: 'project', complexity: 'low' },
        { desc: 'Search for key patterns and modules', action: 'search', target: 'patterns', complexity: 'low', dependsOn: ['t1_1'] },
        { desc: 'Read architecture-relevant files', action: 'read', target: 'files', complexity: 'medium', dependsOn: ['t1_2'] }
      ]));
      phases.push(buildPhase(2, 'Synthesis', 'Document architecture analysis', [
        { desc: 'Provide architecture analysis', action: 'summarize', target: 'architecture', complexity: 'medium', dependsOn: ['t1_1', 't1_2', 't1_3'] }
      ]));
      break;

    case 'configuration':
      phases.push(buildPhase(1, 'Discovery', 'Find configuration files', [
        { desc: 'Search for configuration files', action: 'search', target: 'config', complexity: 'low' },
        { desc: 'Read current configuration', action: 'read', target: 'file', complexity: 'low', dependsOn: ['t1_1'] }
      ]));
      phases.push(buildPhase(2, 'Modification', 'Apply configuration changes', [
        { desc: 'Edit configuration file', action: 'edit', target: 'file', complexity: 'medium', dependsOn: ['t1_1', 't1_2'] },
        { desc: 'Run command to apply changes if needed', action: 'terminal', target: 'command', complexity: 'low', dependsOn: ['t2_1'] }
      ]));
      break;

    case 'documentation':
      phases.push(buildPhase(1, 'Research', 'Gather information', [
        { desc: 'Search for relevant files to document', action: 'search', target: 'files', complexity: 'low' },
        { desc: 'Read code to understand what to document', action: 'read', target: 'file', complexity: 'low', dependsOn: ['t1_1'] }
      ]));
      phases.push(buildPhase(2, 'Writing', 'Write documentation', [
        { desc: 'Write or update documentation', action: 'write', target: 'file', complexity: 'medium', dependsOn: ['t1_1', 't1_2'] }
      ]));
      break;

    default:
      phases.push(buildPhase(1, 'Investigation', 'Explore and understand', [
        { desc: 'Search for relevant context', action: 'search', target: 'context', complexity: 'low' },
        { desc: 'Read relevant files', action: 'read', target: 'file', complexity: 'low', dependsOn: ['t1_1'] },
        { desc: 'Provide response', action: 'summarize', target: 'answer', complexity: 'low', dependsOn: ['t1_1', 't1_2'] }
      ]));
      break;
  }

  return phases;
}

function buildPhase(order, name, description, taskDefs) {
  var tasks = [];
  for (var i = 0; i < taskDefs.length; i++) {
    var def = taskDefs[i];
    var taskId = generateTaskId(order, i + 1);
    tasks.push({
      id: taskId,
      phaseId: 'phase_' + order,
      planId: null,  // set when attached to plan
      description: def.desc,
      status: 'pending',
      complexity: def.complexity || 'low',
      action: def.action,
      target: def.target || '',
      toolType: def.action,
      dependsOn: def.dependsOn || [],
      parallelWith: [],
      requiredContext: [],
      expectedOutput: '',
      actualOutput: '',
      observations: [],
      retries: 0,
      maxRetries: 3,
      estimatedDuration: 0,
      actualDuration: 0,
      createdAt: Date.now()
    });
  }

  // Detect parallel groups within this phase
  var parallelGroups = detectParallelGroups(tasks);

  return {
    id: 'phase_' + order,
    planId: null,
    name: name,
    description: description,
    order: order,
    status: 'pending',
    tasks: tasks,
    parallelGroups: parallelGroups
  };
}

// ═══════════════════════════════════════════════════════════
// INTERNAL: DAG and Parallel Detection
// ═══════════════════════════════════════════════════════════

function buildExecutionGraph(phases) {
  var nodes = {};
  var entryPoints = [];
  var allTaskIds = [];

  for (var p = 0; p < phases.length; p++) {
    var phase = phases[p];
    for (var t = 0; t < phase.tasks.length; t++) {
      var task = phase.tasks[t];
      allTaskIds.push(task.id);

      if (!nodes[task.id]) {
        nodes[task.id] = { predecessors: [], successors: [] };
      }

      // Build from dependsOn
      if (task.dependsOn && task.dependsOn.length) {
        for (var d = 0; d < task.dependsOn.length; d++) {
          var depId = task.dependsOn[d];
          if (!nodes[depId]) nodes[depId] = { predecessors: [], successors: [] };
          nodes[task.id].predecessors.push(depId);
          nodes[depId].successors.push(task.id);
        }
      }
    }
  }

  // Entry points = tasks with no predecessors
  for (var n in nodes) {
    if (nodes[n].predecessors.length === 0 && allTaskIds.indexOf(n) !== -1) {
      entryPoints.push(n);
    }
  }

  // Critical path = longest chain through the graph (simple heuristic: depth-first)
  var criticalPath = findCriticalPath(nodes, entryPoints);

  return {
    nodes: nodes,
    entryPoints: entryPoints,
    criticalPath: criticalPath,
    depth: criticalPath.length
  };
}

function findCriticalPath(nodes, entryPoints) {
  var longest = [];
  var visited = {};

  function dfs(nodeId, path) {
    if (visited[nodeId]) return;
    visited[nodeId] = true;
    path.push(nodeId);
    var successors = nodes[nodeId] ? nodes[nodeId].successors : [];
    if (successors.length === 0) {
      if (path.length > longest.length) {
        longest = path.slice();
      }
    } else {
      for (var i = 0; i < successors.length; i++) {
        dfs(successors[i], path);
      }
    }
    path.pop();
    visited[nodeId] = false;
  }

  for (var e = 0; e < entryPoints.length; e++) {
    dfs(entryPoints[e], []);
  }

  return longest;
}

/**
 * Detect tasks within a phase that can run in parallel.
 * Tasks without dependency chains between them can be parallelized.
 */
function detectParallelGroups(tasks) {
  var groups = [];
  var assigned = {};

  for (var i = 0; i < tasks.length; i++) {
    if (assigned[tasks[i].id]) continue;
    var group = [tasks[i]];
    assigned[tasks[i].id] = true;

    for (var j = i + 1; j < tasks.length; j++) {
      if (assigned[tasks[j].id]) continue;
      var noDep = true;
      for (var k = 0; k < group.length; k++) {
        if (tasks[j].dependsOn.indexOf(group[k].id) !== -1 ||
            group[k].dependsOn.indexOf(tasks[j].id) !== -1) {
          noDep = false;
          break;
        }
      }
      if (noDep) {
        group.push(tasks[j]);
        assigned[tasks[j].id] = true;
        // Mark as parallel with each other
        tasks[j].parallelWith = group.filter(function(g) { return g.id !== tasks[j].id; }).map(function(g) { return g.id; });
        for (var g = 0; g < group.length; g++) {
          if (group[g].id !== tasks[j].id) {
            if (!group[g].parallelWith) group[g].parallelWith = [];
            if (group[g].parallelWith.indexOf(tasks[j].id) === -1) {
              group[g].parallelWith.push(tasks[j].id);
            }
          }
        }
      }
    }
    groups.push(group);
  }

  return groups;
}

// ═══════════════════════════════════════════════════════════
// INTERNAL: Phase status management
// ═══════════════════════════════════════════════════════════

function updatePhaseStatus(plan, phaseId) {
  for (var p = 0; p < plan.phases.length; p++) {
    if (plan.phases[p].id !== phaseId) continue;
    var phase = plan.phases[p];
    var allCompleted = true;
    var anyFailed = false;
    var anyActive = false;

    for (var t = 0; t < phase.tasks.length; t++) {
      var task = phase.tasks[t];
      if (task.status === 'failed') anyFailed = true;
      if (task.status === 'active') anyActive = true;
      if (task.status !== 'completed' && task.status !== 'skipped') allCompleted = false;
    }

    if (anyFailed) phase.status = 'failed';
    else if (allCompleted) phase.status = 'completed';
    else if (anyActive) phase.status = 'active';
    else phase.status = 'pending';
    break;
  }
}

// ═══════════════════════════════════════════════════════════
// INTERNAL: Re-planning helpers
// ═══════════════════════════════════════════════════════════

function mergePhases(oldPlan, newPhases, analysis) {
  // Preserve completed/skipped tasks, replace pending/failed with new phases
  var merged = [];
  for (var p = 0; p < newPhases.length; p++) {
    var newPhase = newPhases[p];
    var oldPhase = findPhaseByOrder(oldPlan, newPhase.order);
    if (oldPhase && oldPhase.status === 'completed') {
      merged.push(oldPhase);
    } else {
      newPhase.planId = oldPlan.id;
      for (var t = 0; t < newPhase.tasks.length; t++) {
        newPhase.tasks[t].planId = oldPlan.id;
      }
      merged.push(newPhase);
    }
  }
  return merged;
}

function revisePlan(plan, observation) {
  // Mark failed tasks as skipped if they have a failing dependency
  for (var p = 0; p < plan.phases.length; p++) {
    var phase = plan.phases[p];
    for (var t = 0; t < phase.tasks.length; t++) {
      var task = phase.tasks[t];
      if (task.status === 'blocked') {
        // Check if blocked because of a failed dependency
        if (task.dependsOn && task.dependsOn.length) {
          var anyDepFailed = false;
          for (var d = 0; d < task.dependsOn.length; d++) {
            var depTask = findTaskInPlan(plan, task.dependsOn[d]);
            if (depTask && depTask.status === 'failed') {
              anyDepFailed = true;
              break;
            }
          }
          if (anyDepFailed) {
            task.status = 'skipped';
          }
        }
      }
    }
  }
  return plan;
}

// ═══════════════════════════════════════════════════════════
// INTERNAL: Search helpers
// ═══════════════════════════════════════════════════════════

function findTaskInPlan(plan, taskId) {
  for (var p = 0; p < plan.phases.length; p++) {
    var phase = plan.phases[p];
    for (var t = 0; t < phase.tasks.length; t++) {
      if (phase.tasks[t].id === taskId) return phase.tasks[t];
    }
  }
  return null;
}

function findPhaseByOrder(plan, order) {
  for (var p = 0; p < plan.phases.length; p++) {
    if (plan.phases[p].order === order) return plan.phases[p];
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// INTERNAL: Summary
// ═══════════════════════════════════════════════════════════

function summarizePlan(plan) {
  var totalTasks = 0;
  var completedTasks = 0;
  var failedTasks = 0;
  var pendingTasks = 0;

  for (var p = 0; p < plan.phases.length; p++) {
    var phase = plan.phases[p];
    for (var t = 0; t < phase.tasks.length; t++) {
      totalTasks++;
      if (phase.tasks[t].status === 'completed') completedTasks++;
      else if (phase.tasks[t].status === 'failed') failedTasks++;
      else if (phase.tasks[t].status === 'pending' || phase.tasks[t].status === 'blocked') pendingTasks++;
    }
  }

  return 'Phase ' + plan.phases.length + ' phases | ' + totalTasks + ' tasks | ' +
         completedTasks + ' done, ' + pendingTasks + ' pending, ' + failedTasks + ' failed | ' +
         'Complexity: ' + plan.complexity.label + ' | ~' + plan.estimatedIterations + ' iterations';
}

// ═══════════════════════════════════════════════════════════
// INTERNAL: Persistence
// ═══════════════════════════════════════════════════════════

function persistPlan(plan) {
  try {
    projectKnowledge.setSetting('pe_plan_' + plan.id, JSON.stringify(plan));
    // Also sync plan status to tasks table and metadata for backward compat
    projectKnowledge.updatePlanStatus(plan.id, plan.status);
  } catch (e) {
    console.error('[PLAN ENGINE] Failed to persist plan:', e.message);
  }
}

function loadPlan(planId) {
  try {
    var raw = projectKnowledge.getSetting('pe_plan_' + planId);
    if (!raw) return null;
    var plan = JSON.parse(raw);
    // Ensure backward compatibility with old structure
    if (!plan.phases && plan.steps) {
      plan = migrateLegacyPlan(plan);
    }
    return plan;
  } catch (e) {
    console.error('[PLAN ENGINE] Failed to load plan:', e.message);
    return null;
  }
}

function loadAllActivePlans() {
  try {
    // Scan all keys in metadata for plan data
    // We use the known prefix to find them
    // For simplicity, iterate through known plan IDs stored in session
    // This is a best-effort query
    return []; // Will be populated by planningManager bridge
  } catch (_) {
    return [];
  }
}

/**
 * Migrate a legacy flat-checklist plan to the new hierarchical structure.
 */
function migrateLegacyPlan(legacy) {
  var tasks = [];
  for (var i = 0; i < legacy.steps.length; i++) {
    var s = legacy.steps[i];
    tasks.push({
      id: generateTaskId(1, i + 1),
      phaseId: 'phase_1',
      planId: legacy.id,
      description: s.description || s.action,
      status: s.status || 'pending',
      complexity: 'medium',
      action: s.action || 'custom',
      target: s.target || '',
      toolType: s.action || 'custom',
      dependsOn: i > 0 ? [tasks[i - 1] ? tasks[i - 1].id : ''] : [],
      parallelWith: [],
      requiredContext: [],
      expectedOutput: s.expected_output || '',
      actualOutput: '',
      observations: [],
      retries: 0,
      maxRetries: 3,
      estimatedDuration: 0,
      actualDuration: 0,
      createdAt: legacy.created_at || Date.now()
    });
  }

  var phase = {
    id: 'phase_1',
    planId: legacy.id,
    name: 'Execution',
    description: 'Main execution phase',
    order: 1,
    status: legacy.status === 'completed' ? 'completed' : 'active',
    tasks: tasks,
    parallelGroups: detectParallelGroups(tasks)
  };

  var complexity = { score: legacy.steps.length, label: legacy.steps.length > 5 ? 'high' : legacy.steps.length > 3 ? 'medium' : 'low' };

  return {
    id: legacy.id,
    sessionId: legacy.session_id,
    goal: legacy.goal,
    summary: summarizePlan({ phases: [phase] }),
    status: legacy.status === 'completed' ? 'completed' : legacy.status === 'failed' ? 'failed' : 'in_progress',
    estimatedIterations: legacy.estimated_calls || 10,
    createdAt: legacy.created_at || Date.now(),
    updatedAt: Date.now(),
    phases: [phase],
    complexity: complexity,
    risks: legacy.risks || [],
    requiredTools: [],
    suggestions: [],
    executionGraph: null,
    observations: []
  };
}

// ═══════════════════════════════════════════════════════════
// INTERNAL: Utilities
// ═══════════════════════════════════════════════════════════

function hasAny(text, keywords) {
  for (var i = 0; i < keywords.length; i++) {
    if (text.indexOf(keywords[i]) !== -1) return true;
  }
  return false;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
