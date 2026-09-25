// subagentTools.js — 7 Subagent Control Tools (Async Generators)

import * as subagentManager from '../agents/subagentManager.js';
import * as memoryManager from '../context/memoryManager.js';
import * as agentState from '../agents/agentState.js';
import * as subagentLifecycle from '../agents/subagentLifecycle.js';

export async function* spawn_subagent(args, context) {
  var role = (args && args.role) ? String(args.role).trim() : 'coder';
  var task = (args && args.task) ? String(args.task).trim() : '';
  var id = (args && (args.id || args.agentId || args.subagent_id)) ? String(args.id || args.agentId || args.subagent_id).trim() : ('subagent_' + role + '_' + Date.now());
  var name = (args && args.name) ? String(args.name).trim() : (role || id);
  var subContext = (args && args.context) ? String(args.context) : '';
  var rawExec = (args && args.execution) ? String(args.execution).trim().toLowerCase() : 'sync';
  var execution = rawExec === 'wait' ? 'wait' : ((rawExec === 'sync' || rawExec === 'parallel' || rawExec === 'async') ? rawExec : 'sync');
  var isWait = execution === 'wait';

  if (!task) {
    yield {
      type: 'tool_result',
      tool: 'spawn_subagent',
      tool_name: 'spawn_subagent',
      args: args,
      success: false,
      message: 'spawn_subagent requires a task description.'
    };
    return;
  }

  yield {
    type: 'action',
    action: 'spawn_subagent',
    tool: 'spawn_subagent',
    tool_name: 'spawn_subagent',
    agentId: id,
    subagent_id: id,
    id: id,
    role: role,
    name: name,
    task: task,
    execution: execution
  };

  try {
    var parentCtx = {
      workspace: context ? context.workspace : '',
      sessionId: context ? context.sessionId : 'default',
      config: context ? context.config : {},
      sendEvent: context ? context.sendEvent : null,
      askPermission: context ? context.askPermission : null,
      signal: context ? context.signal : null,
      agentRunner: context ? context.agentRunner : null,
      agentId: context ? context.agentId : null,
      rootSessionId: context ? context.rootSessionId : null,
      images: context ? context.images : []
    };

    var rec = subagentManager.spawnSubagent({
      id: id,
      agentId: id,
      subagent_id: id,
      name: name,
      role: role,
      task: task,
      context: subContext,
      execution: execution
    }, parentCtx);

    if (isWait) {
      var waitResult = await subagentManager.waitForSubagent(id, parentCtx.sessionId);
      var subSummary = (waitResult && (waitResult.summary || (waitResult.result && waitResult.result.summary) || waitResult.output || waitResult.content)) || '';
      if (!subSummary && waitResult && waitResult.finalResponse) {
        subSummary = typeof waitResult.finalResponse === 'string' ? waitResult.finalResponse : (waitResult.finalResponse.text || '');
      }
      var finalOutputText = subSummary || (waitResult && waitResult.success !== false
        ? "Subagent '" + name + "' completed task."
        : "Subagent '" + name + "' ended with status " + ((waitResult && waitResult.status) || 'failed') + ".");

      yield {
        type: 'tool_result',
        tool: 'spawn_subagent',
        tool_name: 'spawn_subagent',
        args: args,
        success: waitResult && waitResult.success !== false,
        agentId: id,
        subagent_id: id,
        id: id,
        role: role,
        name: name,
        task: task,
        execution: execution,
        status: (waitResult && waitResult.status) || 'completed',
        result: waitResult,
        output: finalOutputText,
        summary: subSummary,
        message: waitResult && waitResult.success !== false
          ? "Subagent '" + name + "' completed task."
          : "Subagent '" + name + "' ended with status " + ((waitResult && waitResult.status) || 'failed') + "."
      };
      return;
    }

    yield {
      type: 'tool_result',
      tool: 'spawn_subagent',
      tool_name: 'spawn_subagent',
      args: args,
      success: true,
      agentId: id,
      subagent_id: id,
      id: id,
      role: role,
      name: name,
      task: task,
      execution: execution,
      status: 'completed',
      output: "Subagent '" + name + "' is running on the assigned task and will return the response.",
      message: "Subagent '" + name + "' (" + id + ") started successfully in " + execution + " mode. It is running on the assigned task and will return the response.",
      result: {
        agentId: id,
        subagent_id: id,
        id: id,
        role: role,
        name: name,
        task: task,
        execution: execution,
        status: 'completed',
        summary: "Subagent '" + name + "' is running on the assigned task and will return the response.",
        output: "Subagent '" + name + "' is running on the assigned task and will return the response."
      }
    };
  } catch (err) {
    yield {
      type: 'tool_result',
      tool: 'spawn_subagent',
      tool_name: 'spawn_subagent',
      args: args,
      success: false,
      agentId: id,
      subagent_id: id,
      id: id,
      role: role,
      name: name,
      message: err && err.message ? err.message : String(err)
    };
  }
}

export async function* subagent_status(args, context) {
  var agentId = (args && (args.agentId || args.subagent_id || args.id)) ? String(args.agentId || args.subagent_id || args.id).trim() : '';
  var parentSessionId = context ? context.sessionId : 'default';

  if (!agentId) {
    yield {
      type: 'tool_result',
      tool: 'subagent_status',
      tool_name: 'subagent_status',
      args: args,
      success: false,
      message: 'subagent_status requires agentId.'
    };
    return;
  }

  yield {
    type: 'action',
    action: 'subagent_status',
    tool: 'subagent_status',
    tool_name: 'subagent_status',
    args: args,
    agentId: agentId,
    subagent_id: agentId,
    id: agentId
  };

  var sub = subagentManager.getSubagent(agentId, parentSessionId);
  if (!sub) {
    yield {
      type: 'tool_result',
      tool: 'subagent_status',
      tool_name: 'subagent_status',
      args: args,
      success: false,
      agentId: agentId,
      subagent_id: agentId,
      id: agentId,
      message: "Subagent '" + agentId + "' not found in this session."
    };
    return;
  }

  var liveState = agentState.getState(sub.sessionId);
  var filesMod = memoryManager.getFilesModified(sub.sessionId);
  var filesCreated = memoryManager.getFilesCreated(sub.sessionId);
  var filesRead = (typeof memoryManager.getFilesRead === 'function') ? memoryManager.getFilesRead(sub.sessionId) : [];
  var elapsed = sub.completedAt ? (sub.completedAt - sub.startedAt) : (Date.now() - sub.startedAt);

  yield {
    type: 'tool_result',
    tool: 'subagent_status',
    tool_name: 'subagent_status',
    args: args,
    success: true,
    agentId: agentId,
    subagent_id: agentId,
    id: agentId,
    name: sub.identity ? sub.identity.name : agentId,
    role: sub.role || (sub.identity && sub.identity.role) || 'coder',
    task: sub.identity ? sub.identity.task : '',
    lifecycle_status: sub.status || 'running',
    status: sub.status || liveState,
    current_agent_state: liveState,
    progress: (sub.status === 'completed' || sub.status === 'stopped' || sub.status === 'failed') ? 'completed' : 'in_progress',
    current_activity: liveState,
    started_at: sub.startedAt,
    elapsed_time_ms: elapsed,
    current_iteration: sub.currentIteration || 0,
    files_read: filesRead,
    files_modified: filesMod,
    files_created: filesCreated,
    tools_executed: sub.toolsExecuted || 0,
    tools_used: (sub.trace && Array.isArray(sub.trace.toolsUsed)) ? sub.trace.toolsUsed : [],
    latest_result: sub.result || null,
    output: (sub.result && (sub.result.output || sub.result.summary || sub.result.content)) || ("Subagent '" + agentId + "' status is " + (sub.status || liveState) + "."),
    summary: (sub.result && (sub.result.summary || sub.result.output || sub.result.content)) || '',
    message: "Subagent '" + agentId + "' status: " + (sub.status || liveState) + (sub.status === 'completed' ? '. Task completed.' : '.'),
    error: sub.error || null,
    can_resume: subagentLifecycle.canResume(sub.status || sub.sessionId),
    can_stop: subagentLifecycle.canStop(sub.status || sub.sessionId)
  };
}

export async function* subagents_list(args, context) {
  var parentSessionId = context ? context.sessionId : 'default';

  yield {
    type: 'action',
    action: 'subagents_list',
    tool: 'subagents_list',
    tool_name: 'subagents_list',
    args: args
  };

  var list = subagentManager.listSubagents(parentSessionId);

  yield {
    type: 'tool_result',
    tool: 'subagents_list',
    tool_name: 'subagents_list',
    args: args,
    success: true,
    count: list.length,
    subagents: list
  };
}

export async function* stop_subagent(args, context) {
  var agentId = (args && (args.agentId || args.subagent_id || args.id)) ? String(args.agentId || args.subagent_id || args.id).trim() : '';
  var reason = (args && args.reason) ? String(args.reason).trim() : 'Stopped by user';
  var parentSessionId = context ? context.sessionId : 'default';

  if (!agentId) {
    yield {
      type: 'tool_result',
      tool: 'stop_subagent',
      tool_name: 'stop_subagent',
      args: args,
      success: false,
      message: 'stop_subagent requires agentId.'
    };
    return;
  }

  yield {
    type: 'action',
    action: 'stop_subagent',
    tool: 'stop_subagent',
    tool_name: 'stop_subagent',
    args: args,
    agentId: agentId,
    subagent_id: agentId,
    reason: reason
  };

  try {
    var res = subagentManager.stopSubagent(agentId, parentSessionId, reason);
    yield {
      type: 'tool_result',
      tool: 'stop_subagent',
      tool_name: 'stop_subagent',
      args: args,
      success: true,
      agentId: agentId,
      subagent_id: agentId,
      status: (res && res.status) || 'stopped',
      message: "Subagent '" + agentId + "' stopped successfully."
    };
  } catch (err) {
    yield {
      type: 'tool_result',
      tool: 'stop_subagent',
      tool_name: 'stop_subagent',
      args: args,
      success: false,
      agentId: agentId,
      subagent_id: agentId,
      message: err && err.message ? err.message : String(err)
    };
  }
}

export async function* wait_for_subagent(args, context) {
  var agentId = (args && (args.agentId || args.subagent_id || args.id)) ? String(args.agentId || args.subagent_id || args.id).trim() : '';
  var parentSessionId = context ? context.sessionId : 'default';

  if (!agentId) {
    yield {
      type: 'tool_result',
      tool: 'wait_for_subagent',
      tool_name: 'wait_for_subagent',
      args: args,
      success: false,
      message: 'wait_for_subagent requires agentId.'
    };
    return;
  }

  yield {
    type: 'action',
    action: 'wait_for_subagent',
    tool: 'wait_for_subagent',
    tool_name: 'wait_for_subagent',
    args: args,
    agentId: agentId,
    subagent_id: agentId
  };

  try {
    var result = await subagentManager.waitForSubagent(agentId, parentSessionId);
    var subSummary = (result && (result.summary || result.output || result.content)) || '';
    if (!subSummary && result && result.finalResponse) {
      subSummary = typeof result.finalResponse === 'string' ? result.finalResponse : (result.finalResponse.text || '');
    }
    var finalOutputText = subSummary || (result && result.success !== false
      ? "Subagent '" + agentId + "' completed task."
      : "Subagent '" + agentId + "' ended with status " + ((result && result.status) || 'failed') + ".");

    yield {
      type: 'tool_result',
      tool: 'wait_for_subagent',
      tool_name: 'wait_for_subagent',
      args: args,
      success: result && result.success !== false,
      agentId: agentId,
      subagent_id: agentId,
      status: (result && result.status) || 'completed',
      output: finalOutputText,
      summary: subSummary,
      message: "Subagent '" + agentId + "' completed with status: " + ((result && result.status) || 'completed'),
      result: result
    };
  } catch (err) {
    yield {
      type: 'tool_result',
      tool: 'wait_for_subagent',
      tool_name: 'wait_for_subagent',
      args: args,
      success: false,
      agentId: agentId,
      subagent_id: agentId,
      message: err && err.message ? err.message : String(err)
    };
  }
}

export async function* pause_subagent(args, context) {
  var agentId = (args && (args.agentId || args.subagent_id || args.id)) ? String(args.agentId || args.subagent_id || args.id).trim() : '';
  var parentSessionId = context ? context.sessionId : 'default';

  if (!agentId) {
    yield {
      type: 'tool_result',
      tool: 'pause_subagent',
      tool_name: 'pause_subagent',
      args: args,
      success: false,
      message: 'pause_subagent requires agentId.'
    };
    return;
  }

  yield {
    type: 'action',
    action: 'pause_subagent',
    tool: 'pause_subagent',
    tool_name: 'pause_subagent',
    args: args,
    agentId: agentId,
    subagent_id: agentId
  };

  try {
    var res = subagentManager.pauseSubagent(agentId, parentSessionId);
    yield {
      type: 'tool_result',
      tool: 'pause_subagent',
      tool_name: 'pause_subagent',
      args: args,
      success: true,
      agentId: agentId,
      subagent_id: agentId,
      status: (res && res.status) || 'paused',
      message: "Subagent '" + agentId + "' paused."
    };
  } catch (err) {
    yield {
      type: 'tool_result',
      tool: 'pause_subagent',
      tool_name: 'pause_subagent',
      args: args,
      success: false,
      agentId: agentId,
      subagent_id: agentId,
      message: err && err.message ? err.message : String(err)
    };
  }
}

export async function* resume_subagent(args, context) {
  var agentId = (args && (args.agentId || args.subagent_id || args.id)) ? String(args.agentId || args.subagent_id || args.id).trim() : '';
  var parentSessionId = context ? context.sessionId : 'default';

  if (!agentId) {
    yield {
      type: 'tool_result',
      tool: 'resume_subagent',
      tool_name: 'resume_subagent',
      args: args,
      success: false,
      message: 'resume_subagent requires agentId.'
    };
    return;
  }

  yield {
    type: 'action',
    action: 'resume_subagent',
    tool: 'resume_subagent',
    tool_name: 'resume_subagent',
    args: args,
    agentId: agentId,
    subagent_id: agentId
  };

  try {
    var res = subagentManager.resumeSubagent(agentId, parentSessionId);
    yield {
      type: 'tool_result',
      tool: 'resume_subagent',
      tool_name: 'resume_subagent',
      args: args,
      success: true,
      agentId: agentId,
      subagent_id: agentId,
      status: (res && res.status) || 'running',
      message: "Subagent '" + agentId + "' resumed."
    };
  } catch (err) {
    yield {
      type: 'tool_result',
      tool: 'resume_subagent',
      tool_name: 'resume_subagent',
      args: args,
      success: false,
      agentId: agentId,
      subagent_id: agentId,
      message: err && err.message ? err.message : String(err)
    };
  }
}

export async function* subagent_response(args, context) {
  var id = (args && (args.id || args.agentId || args.subagent_id)) ? String(args.id || args.agentId || args.subagent_id).trim() : '';
  var name = (args && args.name) ? String(args.name).trim() : id;
  var role = (args && args.role) ? String(args.role).trim() : 'coder';
  var status = (args && args.status) ? String(args.status).trim() : 'completed';
  var output = (args && (args.output || args.summary || args.content)) || '';
  yield {
    type: 'tool_result',
    tool: 'subagent_response',
    tool_name: 'subagent_response',
    success: status !== 'failed',
    agentId: id,
    subagent_id: id,
    id: id,
    name: name,
    role: role,
    status: status,
    output: output,
    summary: output,
    args: args || {},
    result: args || {},
    message: "Subagent response received."
  };
}
