// workflowEngine.js — Production-grade Workflow Engine
// Defines reusable, technology-specific sequential execution gates.

var WORKFLOWS = {
  web: [
    { name: 'Plan', state: 'planning' },
    { name: 'Analyze Workspace', state: 'workspace_analysis' },
    { name: 'Research & Context', state: 'searching' },
    { name: 'Generate/Write Code', state: 'writing' },
    { name: 'Edit & Refine', state: 'editing' },
    { name: 'Syntax & Lint Checks', state: 'testing' },
    { name: 'Audit & Self-Review', state: 'reviewing' },
    { name: 'Final Validation', state: 'completed' }
  ],
  generic: [
    { name: 'Plan Tasks', state: 'planning' },
    { name: 'Execute Tools', state: 'executing' },
    { name: 'Review Outcome', state: 'reviewing' },
    { name: 'Done', state: 'completed' }
  ]
};

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

/**
 * Get workflow steps list by type.
 *
 * @param {string} type - 'web' | 'generic'
 * @returns {object[]} Workflow steps
 */
export function getWorkflow(type) {
  return WORKFLOWS[type] || WORKFLOWS.generic;
}

/**
 * Get the next recommended state in a workflow sequence.
 *
 * @param {string} type         - Workflow type
 * @param {string} currentState - Active agentState state
 * @returns {string} The next target state, or 'completed' if at the end
 */
export function getNextState(type, currentState) {
  var flow = getWorkflow(type);
  var idx = -1;
  for (var i = 0; i < flow.length; i++) {
    if (flow[i].state === currentState) {
      idx = i;
      break;
    }
  }
  if (idx !== -1 && idx < flow.length - 1) {
    return flow[idx + 1].state;
  }
  return 'completed';
}

/**
 * Check if a state is part of the designated workflow.
 */
export function isStateInWorkflow(type, state) {
  var flow = getWorkflow(type);
  for (var i = 0; i < flow.length; i++) {
    if (flow[i].state === state) {
      return true;
    }
  }
  return false;
}
