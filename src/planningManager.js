// planningManager.js — Planning Engine
// Creates structured execution plans from user goals + project context.
// Plans are stored in SQLite and returned to the LLM as context.
// Execution is NOT performed here — that belongs to a future phase.
//
// Plan structure:
//   id             : UUID
//   session_id     : Chat session identifier
//   goal           : User's stated goal
//   steps          : Ordered array of Step objects
//   required_files : Files identified as relevant
//   risks          : Potential risks identified
//   estimated_calls: Estimated tool call count
//   status         : draft | active | completed | failed
//   created_at     : Timestamp
//
// Step structure:
//   { order, action, target, description, expected_output }

import * as projectKnowledge from './projectKnowledge.js';

// ========================================================
// PUBLIC API
// ========================================================

/**
 * Create a structured plan from a user goal and project context.
 *
 * @param {string} goal       - The user's stated goal/message
 * @param {object} context    - From ContextManager.gatherContext()
 * @param {string} sessionId  - Chat session ID for correlation
 * @returns {object} The created plan
 */
export async function createPlan(goal, context, sessionId) {
  var intent = context.intent || {};
  var relevantFiles = context.relevantFiles || [];
  var editor = context.editor || {};
  var planId = generateId();

  // Build ordered steps based on intent + context
  var steps = buildSteps(intent, goal, relevantFiles, editor);

  // Determine required files
  var requiredFiles = determineRequiredFiles(intent, relevantFiles, editor);

  // Assess risks
  var risks = assessRisks(intent, steps, requiredFiles);

  // Estimate tool calls
  var estimatedCalls = estimateToolCalls(intent, steps.length);

  var plan = {
    id: planId,
    session_id: sessionId,
    goal: goal,
    steps: steps,
    required_files: requiredFiles,
    risks: risks,
    estimated_calls: estimatedCalls,
    status: 'draft',
    created_at: Date.now()
  };

  // Store plan in SQLite
  await storePlan(plan);

  return plan;
}

/**
 * Retrieve all plans for a session.
 */
export function getSessionPlans(sessionId) {
  var plans = projectKnowledge.getPlansBySession(sessionId);
  return plans || [];
}

/**
 * Retrieve a single plan by ID.
 */
export function getPlan(planId) {
  return projectKnowledge.getPlan(planId);
}

/**
 * Update a plan's status.
 */
export function updatePlanStatus(planId, status) {
  projectKnowledge.updatePlanStatus(planId, status);
}

/**
 * Get active plans (draft or active status) as a formatted string for prompt context.
 */
export function getActivePlansContext() {
  var plans = projectKnowledge.getPlansByStatus('draft');
  var active = projectKnowledge.getPlansByStatus('active');
  var allPlans = (plans || []).concat(active || []);

  if (!allPlans.length) return '';

  var lines = ['## EXISTING PLANS'];
  for (var i = 0; i < allPlans.length; i++) {
    var p = allPlans[i];
    lines.push('');
    lines.push('---');
    lines.push('Plan: ' + p.id);
    lines.push('Goal: ' + p.goal);
    lines.push('Status: ' + p.status);
    lines.push('Steps (' + (p.steps ? p.steps.length : 0) + '):');
    if (p.steps) {
      for (var s = 0; s < p.steps.length; s++) {
        var step = p.steps[s];
        lines.push('  ' + step.order + '. ' + step.action + ': ' + step.description);
      }
    }
    if (p.risks && p.risks.length) {
      lines.push('Risks: ' + p.risks.join(', '));
    }
  }

  return lines.join('\n');
}

// ========================================================
// INTERNAL: Step building
// ========================================================

function buildSteps(intent, goal, relevantFiles, editor) {
  var steps = [];
  var order = 1;

  switch (intent.type) {
    case 'code_generation': {
      steps.push(createStep(order++, 'search', 'Search for relevant existing files', 'Find files that relate to the new code'));
      steps.push(createStep(order++, 'read', 'Read relevant files', 'Understand patterns and conventions'));
      if (relevantFiles.length) {
        steps.push(createStep(order++, 'read', 'Read existing code for context', 'Understand what exists before creating'));
      }
      steps.push(createStep(order++, 'write', 'Create or modify the file', 'Write the new code'));
      steps.push(createStep(order++, 'verify', 'Verify the changes', 'Check syntax, run build if applicable'));
      break;
    }
    case 'refactoring': {
      steps.push(createStep(order++, 'search', 'Locate the code to refactor', 'Find the specific files'));
      steps.push(createStep(order++, 'read', 'Read the existing implementation', 'Understand current behavior'));
      steps.push(createStep(order++, 'edit', 'Apply refactoring changes', 'Modify code according to the goal'));
      steps.push(createStep(order++, 'verify', 'Verify refactoring', 'Run tests or build to confirm'));
      break;
    }
    case 'debugging': {
      steps.push(createStep(order++, 'search', 'Find the problematic code', 'Search for error-related files'));
      steps.push(createStep(order++, 'read', 'Read relevant source files', 'Understand the code path'));
      steps.push(createStep(order++, 'terminal', 'Run diagnostic commands', 'Reproduce error, check logs'));
      steps.push(createStep(order++, 'edit', 'Apply the fix', 'Modify code to resolve the issue'));
      steps.push(createStep(order++, 'verify', 'Verify the fix', 'Confirm issue is resolved'));
      break;
    }
    case 'exploration': {
      steps.push(createStep(order++, 'search', 'Search for relevant files', 'Find files matching the query'));
      steps.push(createStep(order++, 'read', 'Read relevant files', 'Understand the code'));
      steps.push(createStep(order++, 'summarize', 'Summarize findings', 'Provide a clear answer'));
      break;
    }
    case 'testing': {
      steps.push(createStep(order++, 'search', 'Locate test files', 'Find existing tests'));
      steps.push(createStep(order++, 'read', 'Read existing tests', 'Understand patterns'));
      steps.push(createStep(order++, 'edit', 'Write or update tests', 'Add/modify test cases'));
      steps.push(createStep(order++, 'terminal', 'Run tests', 'Execute to verify'));
      break;
    }
    case 'build': {
      steps.push(createStep(order++, 'terminal', 'Run build command', 'Execute the build'));
      steps.push(createStep(order++, 'verify', 'Verify build output', 'Check for errors'));
      if (relevantFiles.length) {
        steps.push(createStep(order++, 'read', 'Read relevant config files', 'Understand build configuration'));
      }
      break;
    }
    default: {
      steps.push(createStep(order++, 'search', 'Search for relevant context', 'Find related files'));
      steps.push(createStep(order++, 'read', 'Read relevant files', 'Gather information'));
      steps.push(createStep(order++, 'summarize', 'Provide response', 'Answer based on gathered context'));
    }
  }

  return steps;
}

function createStep(order, action, description, expectedOutput) {
  return {
    order: order,
    action: action,
    target: '',
    description: description || '',
    expected_output: expectedOutput || ''
  };
}

// ========================================================
// INTERNAL: Required files
// ========================================================

function determineRequiredFiles(intent, relevantFiles, editor) {
  var files = [];

  // Always include file at cursor if present
  if (editor.activeFile) {
    files.push(editor.activeFile);
  }

  // Add relevant files from search
  for (var i = 0; i < relevantFiles.length; i++) {
    if (files.indexOf(relevantFiles[i]) === -1) {
      files.push(relevantFiles[i]);
    }
  }

  return files;
}

// ========================================================
// INTERNAL: Risk assessment
// ========================================================

function assessRisks(intent, steps, requiredFiles) {
  var risks = [];

  if (intent.type === 'refactoring' || intent.type === 'debugging') {
    risks.push('May modify existing working code');
    risks.push('May need to revert changes if unexpected behavior');
  }

  if (steps.some(function(s) { return s.action === 'terminal'; })) {
    risks.push('Terminal commands may have side effects');
  }

  if (requiredFiles.length > 5) {
    risks.push('Large number of files may be affected');
  }

  return risks;
}

// ========================================================
// INTERNAL: Tool call estimation
// ========================================================

function estimateToolCalls(intent, stepCount) {
  // Each step typically needs 1-3 tool calls
  var base = stepCount * 2;
  if (intent.type === 'debugging' || intent.type === 'refactoring') {
    return base + 2; // More iterations for recursive fixes
  }
  return base;
}

// ========================================================
// INTERNAL: SQLite persistence
// ========================================================

async function storePlan(plan) {
  try {
    var stepsJson = JSON.stringify(plan.steps || []);
    var filesJson = JSON.stringify(plan.required_files || []);
    var risksJson = JSON.stringify(plan.risks || []);

    projectKnowledge.setSetting('plan_' + plan.id + '_goal', plan.goal);
    projectKnowledge.setSetting('plan_' + plan.id + '_session', plan.session_id);
    projectKnowledge.setSetting('plan_' + plan.id + '_steps', stepsJson);
    projectKnowledge.setSetting('plan_' + plan.id + '_files', filesJson);
    projectKnowledge.setSetting('plan_' + plan.id + '_risks', risksJson);
    projectKnowledge.setSetting('plan_' + plan.id + '_estimated', String(plan.estimated_calls));
    projectKnowledge.setSetting('plan_' + plan.id + '_status', plan.status);
    projectKnowledge.setSetting('plan_' + plan.id + '_created', String(plan.created_at));

    // Also store in tasks table for compatibility with future execution phase
    projectKnowledge.addTask({
      id: plan.id,
      description: plan.goal,
      status: plan.status,
      created_at: plan.created_at,
      session_id: plan.session_id,
      result: JSON.stringify({ steps: plan.steps, files: plan.required_files })
    });
  } catch (_) {}
}

function generateId() {
  return 'plan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}
