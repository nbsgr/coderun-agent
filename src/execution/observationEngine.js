// observationEngine.js — Production-grade Observation Engine
// Intercepts tool execution outputs and produces structured observations (Session-Scoped).

import * as runtime from '../agents/runtime.js';

/**
 * Generate a structured observation from a completed tool execution.
 *
 * @returns {object} The structured Observation object
 */
export function generateObservation(toolName, args, result, durationMs, sessionId) {
  var res = result || {};
  var output = res.output || res.content || res.message || res.stdout || '';
  if (typeof output !== 'string') {
    try {
      output = JSON.stringify(output);
    } catch (_) {
      // Intentionally fall back to string coercion if JSON stringify fails
      output = String(output);
    }
  }

  var lowerOutput = output.toLowerCase();

  // 1. Scan for errors
  var errorKeywords = ['error:', 'failed', 'failure', 'exception:', 'cannot', 'not found', 'denied', 'unauthorized', 'syntaxerror', 'typeerror', 'enoent'];
  var errors = [];
  for (var i = 0; i < errorKeywords.length; i++) {
    if (lowerOutput.includes(errorKeywords[i])) {
      errors.push(errorKeywords[i]);
    }
  }
  if (res.success === false || res.error) {
    errors.push(res.error || 'execution failed');
  }

  // 2. Scan for warnings
  var warningKeywords = ['warning:', 'deprecated', 'warn:'];
  var warnings = [];
  for (var w = 0; w < warningKeywords.length; w++) {
    if (lowerOutput.includes(warningKeywords[w])) {
      warnings.push(warningKeywords[w]);
    }
  }

  // 3. Exit Code heuristics
  var exitCode = res.exitCode !== undefined ? res.exitCode : null;
  if (exitCode === null && (lowerOutput.includes('exit code') || lowerOutput.includes('exit status'))) {
    var match = output.match(/(?:exit code|exit status)\s*[:=]?\s*(\d+)/i);
    if (match) exitCode = parseInt(match[1], 10);
  }

  // 4. Summarize
  var summary = '';
  var target = args.file_path || args.command || args.pattern || args.url || '';
  if (toolName === 'run_terminal') {
    summary = 'Executed terminal: ' + String(target).substring(0, 50);
  } else if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'edit_file' || toolName === 'delete_file') {
    summary = toolName + ' on ' + String(target).substring(0, 50);
  } else {
    summary = 'Called tool ' + toolName;
  }
  if (errors.length) {
    summary += ' (with ' + errors.length + ' error(s))';
  }

  // 5. Confidence rating
  var confidence = 1.0;
  if (errors.length) {
    confidence = 0.2;
  } else if (warnings.length) {
    confidence = 0.8;
  }

  var observation = {
    tool: toolName,
    input: args,
    output: output.substring(0, 1000), // cap raw output length
    executionTime: durationMs || 0,
    exitCode: exitCode,
    errors: errors,
    warnings: warnings,
    summary: summary,
    confidence: confidence,
    timestamp: Date.now()
  };

  // Add to runtime state
  try {
    runtime.addObservation(errors.length ? 'error' : 'success', summary, 'observation_engine', sessionId);
  } catch (obsErr) {
    console.warn('[OBSERVATION ENGINE] Failed to record runtime observation for session ' + (sessionId || 'default') + ':', obsErr.message);
  }

  return observation;
}
