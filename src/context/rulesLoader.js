// rulesLoader.js — Loads .coderunrules files from global and workspace locations
// Returns concatenated rules string for injection into the system prompt.

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

var RULES_FILENAME = '.coderunrules';
var GLOBAL_DIR = '.coderun';

var _cache = { workspace: '', content: '', timestamp: 0 };
var CACHE_TTL = 30000;

async function safeRead(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return '';
  }
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (_) {
    return '';
  }
}

export async function loadRules(workspace) {
  var now = Date.now();
  if (_cache.workspace === workspace && (now - _cache.timestamp) < CACHE_TTL) {
    return _cache.content;
  }

  var sections = [];

  // 1. Global rules: ~/.coderun/rules
  var globalPath = path.join(os.homedir(), GLOBAL_DIR, 'rules');
  var globalContent = await safeRead(globalPath);
  if (globalContent && globalContent.trim()) {
    sections.push('## GLOBAL USER RULES\n' + globalContent.trim());
  }

  // 2. Workspace rules: workspace/.coderunrules
  if (workspace) {
    var wsPath = path.join(workspace, RULES_FILENAME);
    var wsContent = await safeRead(wsPath);
    if (wsContent && wsContent.trim()) {
      sections.push('## PROJECT RULES\n' + wsContent.trim());
    }
  }

  var result = sections.length ? sections.join('\n\n') : '';
  _cache = { workspace: workspace, content: result, timestamp: now };
  return result;
}

export async function readRulesFile(filePath) {
  return await safeRead(filePath);
}

export async function writeRulesFile(filePath, content) {
  var dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(filePath, content || '', 'utf-8');
  invalidateCache();
}

export function getRulesPaths(workspace) {
  var globalPath = path.join(os.homedir(), GLOBAL_DIR, 'rules');
  var workspacePath = workspace ? path.join(workspace, RULES_FILENAME) : '';
  return { globalPath: globalPath, workspacePath: workspacePath };
}

export function invalidateCache() {
  _cache = { workspace: '', content: '', timestamp: 0 };
}
