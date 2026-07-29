// multiAgentRuntime.js — Production-grade Multi-Agent Runtime
// Defines specialized agent roles, prompts, and coordinating contexts.

var ROLES = {
  planner: {
    title: 'Planner Agent',
    instruction: 'You are the Planner Agent. Your primary focus is to analyze the user goals, construct the hierarchical execution plan, determine task dependencies, detect parallel opportunities, and assess project execution risks. Do not generate code or run random commands; focus entirely on planning.'
  },
  research: {
    title: 'Research Agent',
    instruction: 'You are the Research Agent. Your primary focus is to explore the workspace, locate relevant files, parse symbols, search codebase files for queries, and read documentation or patterns. Focus on gathering factual information about the codebase.'
  },
  coding: {
    title: 'Coding Agent',
    instruction: 'You are the Coding Agent. Your primary focus is code generation, refactoring, modifying code files, and implementing feature logic. Strictly follow the project naming conventions, error handling guidelines, and architecture.'
  },
  testing: {
    title: 'Testing Agent',
    instruction: 'You are the Testing Agent. Your primary focus is syntax validation, building the workspace, writing unit tests, and running verification scripts to verify that code runs correctly and meets specs.'
  },
  review: {
    title: 'Review Agent',
    instruction: 'You are the Review Agent. Your primary focus is self-reflection, checking code consistency, looking for hardcoded secrets, analyzing error handling, checking for duplication, and reviewing naming conventions.'
  },
  documentation: {
    title: 'Documentation Agent',
    instruction: 'You are the Documentation Agent. Your primary focus is writing project markdown files, README files, walkthrough logs, and adding JSDoc comments to code files.'
  }
};

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

/**
 * Get system prompt instruction for a specialized role.
 *
 * @param {string} roleName - 'planner' | 'research' | 'coding' | 'testing' | 'review' | 'documentation'
 * @returns {string} The role system prompt snippet
 */
export function getRolePrompt(roleName) {
  var role = ROLES[roleName] || ROLES.coding;
  return '## CURRENT ROLE: ' + role.title + '\n' + role.instruction;
}

/**
 * Map an agentState or active task action to a specialized agent role.
 *
 * @param {string} state      - Current agentState
 * @param {string} taskAction - Current plan task action (e.g. read, write, test, search)
 * @returns {string} Role name
 */
export function mapStateToRole(state, taskAction) {
  if (state === 'planning') return 'planner';
  if (state === 'workspace_analysis' || state === 'searching' || state === 'reading') return 'research';
  if (state === 'writing' || state === 'editing') return 'coding';
  if (state === 'testing') return 'testing';
  if (state === 'reviewing') return 'review';

  // Fallback to task action mappings
  var action = String(taskAction || '').toLowerCase();
  if (action.includes('plan')) return 'planner';
  if (action.includes('read') || action.includes('search') || action.includes('find')) return 'research';
  if (action.includes('write') || action.includes('edit') || action.includes('code') || action.includes('implement')) return 'coding';
  if (action.includes('test') || action.includes('check') || action.includes('verify') || action.includes('build')) return 'testing';
  if (action.includes('review') || action.includes('audit') || action.includes('reflect')) return 'review';
  if (action.includes('doc') || action.includes('readme') || action.includes('writeup')) return 'documentation';

  return 'coding';
}
