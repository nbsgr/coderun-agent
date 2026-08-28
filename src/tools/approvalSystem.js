// approvalSystem.js — Production-grade Human Approval System
// Checks and intercepts destructive or sensitive operations, prompting the user for approval.

import * as permissions from './permissions.js';
import * as toolRegistry from './toolRegistry.js';

var DANGEROUS_COMMANDS = [
  // POSIX / Linux / macOS
  'rm ', 'rmdir', 'del ', 'erase', 'format',
  'git reset', 'git clean', 'git branch -d', 'git branch -D', 'git push --force',
  'docker rm', 'docker rmi', 'docker system prune',
  'npm uninstall', 'yarn remove', 'pnpm remove', 'pip uninstall',
  // Windows PowerShell cmdlets & aliases
  'remove-item', 'ri ', 'rd ', 'clear-content', 'clc ', 'stop-process', 'spps ', 'taskkill',
  'fdisk', 'diskpart',
  // Database destructive operations
  'drop database', 'drop table', 'truncate table', 'drop schema'
];

var DEPLOY_COMMANDS = [
  'deploy', 'publish', 'push', 's3 sync', 'docker push'
];

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

// Determine if a tool invocation requires human approval.
export function requiresApproval(toolName, args) {
  args = args || {};
  var canonicalName = normalizeToolName(toolName);

  // 1. Any tool registered as needing permission must prompt.
  if (toolRegistry.needsPermission(canonicalName) || toolRegistry.isDangerous(canonicalName)) {
    return true;
  }

  // 2. Sensitive write/execution actions must prompt even if metadata is missing.
  if (canonicalName === 'write_file' ||
      canonicalName === 'edit_file' ||
      canonicalName === 'patch_file' ||
      canonicalName === 'delete_file' ||
      canonicalName === 'create_folder' ||
      canonicalName === 'delete_folder' ||
      canonicalName === 'terminal_input' ||
      canonicalName === 'web_request') {
    return true;
  }

  // 3. Dangerous terminal commands
  if (canonicalName === 'run_terminal') {
    var cmd = String(args.command || '').trim().toLowerCase();
    if (!cmd) return false;

    // Check dangerous operations
    for (var i = 0; i < DANGEROUS_COMMANDS.length; i++) {
      if (cmd.includes(DANGEROUS_COMMANDS[i])) {
        return true;
      }
    }

    // Check deployment commands
    for (var d = 0; d < DEPLOY_COMMANDS.length; d++) {
      if (cmd.includes(DEPLOY_COMMANDS[d])) {
        return true;
      }
    }
  }

  return false;
}

function normalizeToolName(toolName) {
  var raw = String(toolName || '').trim();
  var canonical = toolRegistry.resolveAlias(raw);
  if (canonical) return canonical;

  var normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
  canonical = toolRegistry.resolveAlias(normalized);
  if (canonical) return canonical;

  return normalized;
}

// Request approval for a tool call.
export async function requestApproval(toolName, args, toolCallId, sendEvent, sessionId) {
  try {
    return await permissions.requestPermission(toolName, args, toolCallId, sendEvent, sessionId);
  } catch (e) {
    console.error('[APPROVAL SYSTEM] Request error:', e);
    return false;
  }
}
