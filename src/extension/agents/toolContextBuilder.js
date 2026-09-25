// toolContextBuilder.js — Tool execution context and loop safety utilities
// Extracted from agentLoop.js. All functions are pure or operate on their arguments only.

import * as toolRegistry from '../tools/toolRegistry.js';

/**
 * Build the context object passed to every tool execution.
 * Contains workspace, session, agent identity, and callback references.
 */
export function buildToolContext(workspace, sessionId, signal, sessionCtx, sendEvent, askPermission) {
  var identity = sessionCtx && sessionCtx.agentIdentity ? sessionCtx.agentIdentity : {};
  return {
    workspace: workspace,
    sessionId: sessionId,
    signal: signal,
    config: sessionCtx ? sessionCtx.config : null,
    sendEvent: sendEvent,
    askPermission: askPermission,
    agentId: identity.agentId || 'root',
    agentName: identity.name || 'Main Agent',
    parentAgentId: identity.parentAgentId || null,
    parentSessionId: identity.parentSessionId || null,
    rootSessionId: (identity.rootSessionId || (sessionCtx && sessionCtx.rootSessionId)) || sessionId,
    agentType: identity.agentType || 'root',
    agentRunner: sessionCtx ? sessionCtx.agentRunner : null,
    images: sessionCtx ? sessionCtx.images : []
  };
}

/**
 * Returns true when the tool is read-only and safe to run in parallel
 * without worrying about write conflicts. First queries toolRegistry metadata,
 * falling back to built-in descriptor knowledge.
 */
export function isReadOnlyTool(toolName) {
  var canonical = (toolRegistry && typeof toolRegistry.resolveAlias === 'function')
    ? (toolRegistry.resolveAlias(toolName) || toolName)
    : toolName;
  if (toolRegistry && typeof toolRegistry.isReadOnly === 'function' && toolRegistry.isReadOnly(canonical)) {
    return true;
  }
  var readTools = {
    read_file: true,
    search_code: true,
    search_files: true,
    list_dir: true,
    list_directory: true,
    get_file_info: true,
    grep_search: true,
    find_by_name: true,
    find_in_files: true,
    get_symbols: true,
    list_symbols: true,
    get_stats: true,
    view_file: true,
    read_url_content: true,
    read_rules: true,
    get_definition: true,
    find_references: true,
    document_symbols: true,
    get_current_datetime: true,
    query_project_db: true,
    subagent_status: true,
    subagents_list: true
  };
  return !!readTools[canonical];
}

/**
 * Returns true when the tool mutates the filesystem.
 * Used to track failed mutations and report them to the caller.
 * First queries toolRegistry metadata, falling back to built-in descriptor knowledge.
 */
export function isMutationTool(toolName) {
  var canonical = (toolRegistry && typeof toolRegistry.resolveAlias === 'function')
    ? (toolRegistry.resolveAlias(toolName) || toolName)
    : toolName;
  if (toolRegistry && typeof toolRegistry.isMutation === 'function' && toolRegistry.isMutation(canonical)) {
    return true;
  }
  return canonical === 'write_file' || canonical === 'edit_file' || canonical === 'patch_file' ||
    canonical === 'delete_file' || canonical === 'create_folder' || canonical === 'delete_folder';
}

/**
 * Strips private underscore-prefixed fields (_sessionId etc.) from args
 * before using them as a loop repetition signature.
 */
export function cleanToolArgs(args) {
  if (!args || typeof args !== 'object') return {};
  var clean = {};
  var keys = Object.keys(args);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.charAt(0) === '_') continue;
    clean[k] = args[k];
  }
  return clean;
}

/**
 * Produces a stable string representation of a tool result
 * for use in repetition-detection signatures.
 */
export function normalizeToolOutput(result, formattedResult) {
  if (formattedResult && typeof formattedResult === 'string') {
    return formattedResult.trim();
  }
  if (!result) return '';
  if (typeof result === 'string') return result.trim();
  var out = result.message || result.output || result.content || result.error || '';
  if (typeof out === 'string') return out.trim();
  return JSON.stringify(out);
}

/**
 * Detects when the same tool is called 3+ consecutive times with identical
 * args and output — a loop that is not making progress.
 * Returns a warning string to inject into messages, or null if no issue.
 * Mutates sessionCtx.consecutiveToolInvocations.
 */
export function checkLoopHygiene(sessionCtx, toolName, args, result, formattedResult) {
  if (!sessionCtx || !toolName) return null;
  sessionCtx.consecutiveToolInvocations = sessionCtx.consecutiveToolInvocations || [];

  var cleanArgsObj = cleanToolArgs(args);
  var serializedArgs = JSON.stringify(cleanArgsObj);
  var normalizedOutput = normalizeToolOutput(result, formattedResult);
  var signature = toolName + '|||' + serializedArgs + '|||' + normalizedOutput;

  sessionCtx.consecutiveToolInvocations.push({
    signature: signature,
    toolName: toolName,
    args: cleanArgsObj,
    serializedArgs: serializedArgs
  });

  var list = sessionCtx.consecutiveToolInvocations;
  if (list.length >= 3) {
    var count = 0;
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].signature === signature) {
        count++;
      } else {
        break;
      }
    }
    if (count >= 3) {
      return 'already ' + toolName + ' is called with this args(' + serializedArgs + ') with the same output. Please stop repeating this call, analyze why this action is not advancing the task, and choose an alternative strategy.';
    }
  }

  if (list.length >= 6) {
    var len = list.length;
    var tA = list[len - 1].toolName;
    var tB = list[len - 2].toolName;
    if (tA !== tB) {
      if (list[len - 3].toolName === tA &&
          list[len - 4].toolName === tB &&
          list[len - 5].toolName === tA &&
          list[len - 6].toolName === tB) {
        return '⚠️ RUNTIME PROGRESS STALL: Detected alternating sequence between "' + tB + '" and "' + tA + '" with no progress advancement. Please break the cycle, re-inspect your approach, or formulate a concrete new strategy.';
      }
    }
  }

  return null;
}

/**
 * Detects when the same tool fails 3+ consecutive times with identical args.
 * Returns a warning string or null. Mutates sessionCtx.recentFailures.
 */
export function checkToolFailureRepetition(sessionCtx, toolName, args, result) {
  if (!sessionCtx) return null;
  if (!result || result.success !== false) {
    sessionCtx.recentFailures = [];
    return null;
  }
  sessionCtx.recentFailures = sessionCtx.recentFailures || [];
  var key = toolName + ':' + JSON.stringify(args || {});
  sessionCtx.recentFailures.push(key);

  if (sessionCtx.recentFailures.length >= 3) {
    var count = 0;
    for (var i = sessionCtx.recentFailures.length - 1; i >= 0; i--) {
      if (sessionCtx.recentFailures[i] === key) {
        count++;
      } else {
        break;
      }
    }
    if (count >= 3) {
      return '⚠️ REPETITIVE TOOL FAILURE: You have called "' + toolName + '" 3 times consecutively with the same failing result. Please stop repeating this command, inspect workspace files/directories, and choose an alternative strategy.';
    }
  }
  return null;
}
