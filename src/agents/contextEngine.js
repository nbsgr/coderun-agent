// contextEngine.js — Startup and per-iteration context assembly for the agent loop
// Extracted from agentLoop.js. Responsible for gathering knowledge, initialising traces,
// setting up goals, and refreshing the system prompt on each iteration.
// agentLoop calls these functions and uses the returned values — no logic leaks back.

import * as contextManager from '../context/contextManager.js';
import * as projectKnowledge from '../context/projectKnowledge.js';
import * as planningManager from '../context/planningManager.js';
import * as goalTracker from '../context/goalTracker.js';
import * as memoryManager from '../context/memoryManager.js';
import * as timelineManager from '../execution/timelineManager.js';
import * as executionTrace from '../execution/executionTrace.js';
import * as mcpManager from '../mcp/mcpManager.js';
import * as multiAgentRuntime from '../execution/multiAgentRuntime.js';
import * as gitIntelligence from '../context/gitIntelligence.js';
import * as runtime from './runtime.js';
import * as events from './events.js';

/**
 * Gather everything needed at agent startup: knowledge base, project metadata,
 * active plans, MCP context, trace initialisation, goals, and memory.
 *
 * Returns an object with:
 *   { knowledge, currentPlan, mcpCtx, activeTrace }
 *
 * All internal failures are swallowed — partial context is better than none.
 */
export async function gatherStartupContext(
  effectivePrompt, userPrompt, workspace, sessionId,
  isContinuation, config, agentIdentity, images, sendEvent
) {
  // 1. Context manager (project knowledge, open files, memory, etc.)
  var contextResult = null;
  try {
    contextResult = await contextManager.gatherContext(effectivePrompt, workspace, sessionId);
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }
  var knowledge = contextResult ? contextResult.knowledge : {};

  // 2. Ensure projectMetadata minimum structure
  if (!knowledge.projectMetadata) {
    try {
      if (projectKnowledge.getStats().ready) {
        knowledge.projectMetadata = projectKnowledge.getProjectMetadata();
        var stats = projectKnowledge.getStats();
        knowledge.fileCount = stats.tables && stats.tables.files ? stats.tables.files : 0;
        knowledge.fileContext = true;
      }
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }
    if (!knowledge.projectMemory) knowledge.projectMemory = '';
    if (!knowledge.dependencyGraph) knowledge.dependencyGraph = '';
    if (!knowledge.timeline) knowledge.timeline = '';
  }

  // 3. Timeline — session start marker
  try {
    var sessionLabel = String(effectivePrompt || '').substring(0, 60);
    timelineManager.addEvent('session:start', sessionLabel, sessionId);
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }

  // 4. Execution trace + goals + memory init
  var activeTrace = null;
  try {
    events.emit('TaskStarted', { goal: effectivePrompt, sessionId: sessionId });
    var runContext = {
      images: images || [],
      workspaceFolder: workspace || '',
      openFiles: (knowledge && knowledge.openFiles) || [],
      agentId: agentIdentity ? agentIdentity.agentId : 'root',
      parentAgentId: agentIdentity ? agentIdentity.parentAgentId : null,
      parentSessionId: agentIdentity ? agentIdentity.parentSessionId : null,
      depth: agentIdentity ? agentIdentity.depth : 0,
      role: agentIdentity ? agentIdentity.role : 'coder',
      agentType: agentIdentity ? agentIdentity.agentType : 'root'
    };
    activeTrace = executionTrace.startRun(
      sessionId, null, userPrompt || effectivePrompt,
      runContext, config.model, config.provider,
      isContinuation, agentIdentity
    );
    sendEvent({ type: 'trace_updated', sessionId: sessionId, trace: activeTrace });

    if (!isContinuation) {
      goalTracker.initGoals(userPrompt, sessionId);
      memoryManager.clear(sessionId);
      memoryManager.setCurrentGoal(userPrompt, sessionId);
    } else {
      if (!goalTracker.getActiveTask(sessionId)) {
        goalTracker.initGoals(effectivePrompt, sessionId);
      }
    }
  } catch (e) {
    console.error('[CONTEXT ENGINE] Failed to initialize trace/goals:', e);
  }

  // 5. Active plan retrieval
  var currentPlan = null;
  try {
    var sessionPlans = planningManager.getSessionPlans(sessionId);
    if (sessionPlans && sessionPlans.length) {
      currentPlan = sessionPlans[sessionPlans.length - 1];
      if (currentPlan) runtime.setCurrentPlan(currentPlan, sessionId);
      if (currentPlan && !knowledge.activePlans) {
        try {
          knowledge.activePlans = planningManager.getActivePlansContext(sessionId);
        } catch (_) {
          // Intentionally ignored to allow safe execution fallback
        }
      }
    }
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }

  // 6. MCP context string for system prompt
  var mcpCtx = '';
  try {
    mcpCtx = mcpManager.getMcpPromptContext();
  } catch (_) {}

  return { knowledge: knowledge, currentPlan: currentPlan, mcpCtx: mcpCtx, activeTrace: activeTrace };
}

/**
 * Refresh the system prompt (messages[0].content) at the start of each iteration.
 * Injects current role, plan, goal status, git state, and memory fragment.
 *
 * Mutates messages[0].content in-place — same behaviour as the inline code it replaces.
 * All failures are swallowed individually so one bad module cannot break the iteration.
 */
export async function refreshIterationContext(messages, targetState, sessionCtx, sessionId, workspace) {
  try {
    var roleName = multiAgentRuntime.mapStateToRole(
      targetState,
      sessionCtx.plan ? sessionCtx.plan.activeTaskAction : ''
    );
    var rolePrompt = multiAgentRuntime.getRolePrompt(roleName);
    var gitPrompt = await gitIntelligence.getGitPromptFragment(workspace);
    var memPrompt = memoryManager.getPromptFragment(sessionId);
    var goalPrompt = goalTracker.getStatusReport(sessionId);
    var activePlanCtx = planningManager.getActivePlansContext(sessionId);

    if (messages && messages.length > 0 && messages[0].role === 'system') {
      messages[0].content = messages[0].content.split('\n\n## ACTIVE EXECUTION CONTEXT')[0] +
        '\n\n## ACTIVE EXECUTION CONTEXT\n' +
        rolePrompt + '\n\n' +
        (activePlanCtx ? activePlanCtx + '\n\n' : '') +
        goalPrompt + '\n\n' +
        gitPrompt + '\n\n' +
        memPrompt;
    }
  } catch (e) {
    console.error('[CONTEXT ENGINE] Failed to refresh iteration context:', e);
  }
}
