// workspaceIntelligence.js — Workspace Intelligence Query Layer
//
// SINGLE query point for workspace understanding. Other modules call THIS
// instead of scanning files themselves.
//
// ═══════════════════════════════════════════════════════════════
// DATA FLOW (how workspace info flows through the system)
// ═══════════════════════════════════════════════════════════════
//
//   extension.js activate()
//     │
//     ├── projectKnowledge.initialize(context)
//     │     └── Creates SQLite DB at:
//     │           <globalStorageUri>/projects/<Name_Hash>/index.db
//     │     └── Tables: files, chunks, metadata, tasks, checkpoints
//     │     └── indexWorkspace() — walks project, stores file metadata
//     │           in `files` table + content `chunks` table
//     │     └── setupWatcher() — watches for create/change/delete,
//     │           re-indexes single file via hash+mtime comparison
//     │
//     ├── workspaceIntelligence.scan(workspaceRoot)
//     │     └── Triggers learningManager.initialize() which detects:
//     │           learn_framework   → 'React', 'Next.js', etc.
//     │           learn_build_system → 'Vite', 'Maven', etc.
//     │           learn_conventions  → JSON['TypeScript','ESLint']
//     │           learn_architecture → 'App router', 'MVC', etc.
//     │         All stored via projectKnowledge.setSetting('learn_*')
//     │         → SQLite `metadata` table
//     │     └── Additional WI-only discovery (git, components, etc.)
//     │         stored via projectKnowledge.setSetting('wi_*')
//     │         → SQLite `metadata` table
//     │
//   contextManager.gatherContext()
//     │
//     ├── Calls workspaceIntelligence.formatForPrompt()
//     │     └── Reads ONLY from SQLite (projectKnowledge.getSetting)
//     │     └── Zero filesystem access
//     │
//     └── Calls learningManager.getLearningContext()
//           └── Reads learn_* keys from SQLite
//
//   promptBuilder.buildMessages()
//     ├── Injects workspace intelligence context
//     ├── Injects learning context
//     └── Sends to LLM
//
//   LLM receives structured workspace info in system prompt and DECIDES:
//     a) "I have enough info" → answers directly from context
//     b) "I need details" → uses tools (read_file, search_files)
//     c) "I need to verify" → uses search or find_in_files
//
// ═══════════════════════════════════════════════════════════════
// SQLite DATABASE SCHEMA (created by projectKnowledge.js)
// ═══════════════════════════════════════════════════════════════
//
//   files table (file index):
//     id, path, language, size, hash, last_modified, last_indexed
//
//   chunks table (file content chunks):
//     id, file_id, chunk_index, content, embedding
//
//   metadata table (key-value store):
//     key        → 'learn_framework', 'wi_project_type', etc.
//     value      → string value (JSON for arrays)
//
//   tasks table (planning engine):
//     id, description, status, created_at, completed_at, result, session_id
//
//   checkpoints table (undo engine):
//     id, file_path, content, created_at, session_id, label
//
// ═══════════════════════════════════════════════════════════════
// WORKSPACE INTEL KEYS IN SQLITE (wi_* prefix)
// ═══════════════════════════════════════════════════════════════
//
//   wi_name, wi_project_type, wi_languages, wi_package_manager,
//   wi_build_system, wi_entry_points, wi_config_files,
//   wi_has_src, wi_has_test, wi_components, wi_services,
//   wi_dependencies, wi_dev_dependencies, wi_total_deps,
//   wi_git_branch, wi_git_repo, wi_is_monorepo, wi_sub_projects,
//   wi_detected_at

import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as projectKnowledge from './projectKnowledge.js';
import * as learningManager from './learningManager.js';

var _scanInProgress = null;

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

/**
 * Run a full workspace scan: triggers learningManager + additional discovery.
 * All results stored in SQLite via projectKnowledge. Idempotent — subsequent
 * calls within the same session skip if already scanned.
 *
 * @param {string} workspaceRoot - Absolute path to workspace root
 * @returns {Promise<boolean>} true if scan was performed
 */
export async function scan(workspaceRoot) {
  if (!workspaceRoot) return false;

  // Skip if already scanned in this session
  if (projectKnowledge.getSetting('wi_detected_at')) return false;

  // Dedup concurrent scans
  if (_scanInProgress) {
    try { return await _scanInProgress; } catch (_) { return false; }
  }

  _scanInProgress = doScan(workspaceRoot);
  try {
    return await _scanInProgress;
  } finally {
    _scanInProgress = null;
  }
}

/**
 * Get a formatted text summary of the workspace for prompt injection.
 * Reads from SQLite (projectKnowledge.getSetting) — no filesystem access.
 */
export function formatForPrompt() {
  var projectType = projectKnowledge.getSetting('wi_project_type') || 'unknown';
  if (projectType === 'unknown') return '';

  var parts = ['## WORKSPACE INTELLIGENCE'];

  var framework = projectKnowledge.getSetting('learn_framework');
  var buildSystem = projectKnowledge.getSetting('wi_build_system') || projectKnowledge.getSetting('learn_build_system') || 'unknown';
  var pkgMgr = projectKnowledge.getSetting('wi_package_manager') || '';

  parts.push('- Project: ' + esc(projectKnowledge.getSetting('wi_name') || '') + ' (' + projectType + ')');

  var languages = safeJsonParse(projectKnowledge.getSetting('wi_languages'), []);
  if (languages.length) parts.push('- Languages: ' + languages.join(', '));

  if (framework && framework !== 'unknown') parts.push('- Framework: ' + framework);
  parts.push('- Build: ' + buildSystem + (pkgMgr ? ' | Package: ' + pkgMgr : ''));

  var entryPoints = safeJsonParse(projectKnowledge.getSetting('wi_entry_points'), []);
  if (entryPoints.length) parts.push('- Entry Points: ' + entryPoints.join(', '));

  var architecture = projectKnowledge.getSetting('learn_architecture');
  if (architecture) parts.push('- Architecture: ' + architecture);

  var configFiles = safeJsonParse(projectKnowledge.getSetting('wi_config_files'), []);
  if (configFiles.length) parts.push('- Config Files: ' + configFiles.join(', '));

  var components = safeJsonParse(projectKnowledge.getSetting('wi_components'), []);
  if (components.length) {
    parts.push('- Components (' + components.length + '): ' +
      components.slice(0, 8).join(', ') + (components.length > 8 ? '...' : ''));
  }

  var services = safeJsonParse(projectKnowledge.getSetting('wi_services'), []);
  if (services.length) {
    parts.push('- Services: ' + services.slice(0, 5).join(', ') + (services.length > 5 ? '...' : ''));
  }

  var deps = safeJsonParse(projectKnowledge.getSetting('wi_dependencies'), []);
  if (deps.length) parts.push('- Key Dependencies: ' + deps.slice(0, 10).join(', ') + (deps.length > 10 ? '...' : ''));

  var branch = projectKnowledge.getSetting('wi_git_branch');
  if (branch) {
    var repoName = projectKnowledge.getSetting('wi_git_repo');
    parts.push('- Git: ' + esc(branch) + (repoName ? ' | ' + esc(repoName) : ''));
  }

  var hasSrc = projectKnowledge.getSetting('wi_has_src') === 'true';
  var hasTest = projectKnowledge.getSetting('wi_has_test') === 'true';
  var subProjects = safeJsonParse(projectKnowledge.getSetting('wi_sub_projects'), []);
  if (hasSrc || hasTest || subProjects.length) {
    parts.push('- Structure: ' + (hasSrc ? 'src/' : '') + (hasTest ? 'tests/' : '') +
      (subProjects.length ? 'monorepo(' + subProjects.length + ')' : ''));
  }

  return parts.join('\n');
}

/**
 * Check if workspace intelligence has been collected.
 */
export function isReady() {
  return !!projectKnowledge.getSetting('wi_detected_at');
}

// ═══════════════════════════════════════════════════════════
// INTERNAL: Full scan
// ═══════════════════════════════════════════════════════════

async function doScan(root) {
  console.log('[WI] Scanning workspace:', root);

  // Step 1: Trigger learningManager (framework, build, conventions)
  try {
    await learningManager.initialize(root);
  } catch (_) {}

  // Step 2: Quick filesystem analysis for WI-specific data
  try {
    var entries = await fs.readdir(root, { withFileTypes: true });
    var fileNames = entries.filter(function(e) { return e.isFile(); }).map(function(e) { return e.name; });
    var dirNames = entries.filter(function(e) { return e.isDirectory(); }).map(function(e) { return e.name; });

    storeBasic(root, fileNames, dirNames);
    storeLanguages(fileNames, dirNames);
    storeEntryPoints(root, fileNames);
    storeConfigFiles(fileNames);
    await storeComponents(root, dirNames);
    await storeServices(root, dirNames);
    await storeGitInfo(root);
    await storeDependencies(root, fileNames);
    await storeMonoRepo(root, fileNames, dirNames);
  } catch (e) {
    console.warn('[WI] Scan error:', e.message);
  }

  projectKnowledge.setSetting('wi_detected_at', String(Date.now()));
  console.log('[WI] Scan complete');
  return true;
}

// ═══════════════════════════════════════════════════════════
// DETECTION HELPERS
// ═══════════════════════════════════════════════════════════

function storeBasic(root, fileNames, dirNames) {
  projectKnowledge.setSetting('wi_name', path.basename(root));

  var type = 'other';
  if (fileNames.indexOf('package.json') !== -1) type = 'node';
  else if (fileNames.indexOf('pom.xml') !== -1) type = 'java';
  else if (fileNames.indexOf('build.gradle') !== -1 || fileNames.indexOf('build.gradle.kts') !== -1) type = 'java';
  else if (fileNames.indexOf('pyproject.toml') !== -1 || fileNames.indexOf('requirements.txt') !== -1) type = 'python';
  else if (fileNames.indexOf('Cargo.toml') !== -1) type = 'rust';
  else if (fileNames.indexOf('go.mod') !== -1) type = 'go';
  else if (fileNames.some(function(f) { return f.endsWith('.csproj') || f.endsWith('.sln'); })) type = 'dotnet';
  else if (dirNames.indexOf('node_modules') !== -1) type = 'node';
  else if (dirNames.indexOf('venv') !== -1 || dirNames.indexOf('.venv') !== -1) type = 'python';
  projectKnowledge.setSetting('wi_project_type', type);

  // Package manager
  if (fileNames.indexOf('pnpm-lock.yaml') !== -1) projectKnowledge.setSetting('wi_package_manager', 'pnpm');
  else if (fileNames.indexOf('yarn.lock') !== -1) projectKnowledge.setSetting('wi_package_manager', 'yarn');
  else if (fileNames.indexOf('package-lock.json') !== -1) projectKnowledge.setSetting('wi_package_manager', 'npm');
  else if (fileNames.indexOf('bun.lockb') !== -1) projectKnowledge.setSetting('wi_package_manager', 'bun');

  // Build system (beyond learningManager)
  var buildTools = [];
  if (fileNames.indexOf('vite.config.ts') !== -1 || fileNames.indexOf('vite.config.js') !== -1) buildTools.push('Vite');
  if (fileNames.indexOf('webpack.config.js') !== -1) buildTools.push('Webpack');
  if (fileNames.indexOf('rollup.config.js') !== -1) buildTools.push('Rollup');
  if (fileNames.indexOf('tsconfig.json') !== -1) buildTools.push('TypeScript');
  if (buildTools.length) projectKnowledge.setSetting('wi_build_system', buildTools.join(' + '));

  projectKnowledge.setSetting('wi_has_src', dirNames.indexOf('src') !== -1 ? 'true' : 'false');
  projectKnowledge.setSetting('wi_has_test',
    (dirNames.indexOf('test') !== -1 || dirNames.indexOf('tests') !== -1 ||
     dirNames.indexOf('__tests__') !== -1) ? 'true' : 'false');
}

function storeLanguages(fileNames, dirNames) {
  var langs = new Set();
  for (var i = 0; i < fileNames.length; i++) {
    var ext = path.extname(fileNames[i]).toLowerCase();
    switch (ext) {
      case '.js': case '.mjs': case '.cjs': case '.jsx': langs.add('JavaScript'); break;
      case '.ts': case '.tsx': case '.mts': langs.add('TypeScript'); break;
      case '.py': langs.add('Python'); break;
      case '.java': langs.add('Java'); break;
      case '.kt': case '.kts': langs.add('Kotlin'); break;
      case '.rs': langs.add('Rust'); break;
      case '.go': langs.add('Go'); break;
      case '.cs': langs.add('C#'); break;
      case '.rb': langs.add('Ruby'); break;
      case '.php': langs.add('PHP'); break;
      case '.vue': langs.add('Vue'); break;
      case '.svelte': langs.add('Svelte'); break;
      case '.css': case '.scss': case '.sass': case '.less': langs.add('CSS'); break;
    }
  }
  if (fileNames.indexOf('tsconfig.json') !== -1) langs.add('TypeScript');
  if (langs.size) projectKnowledge.setSetting('wi_languages', JSON.stringify(Array.from(langs)));
}

function storeEntryPoints(root, fileNames) {
  var entries = [];
  if (fileNames.indexOf('package.json') !== -1) {
    try {
      var raw = fs.readFileSync(path.join(root, 'package.json'), 'utf-8');
      var pkg = JSON.parse(raw);
      if (pkg.main) entries.push(pkg.main);
      if (pkg.module) entries.push(pkg.module);
      if (pkg.bin) {
        if (typeof pkg.bin === 'string') entries.push(pkg.bin);
        else for (var b in pkg.bin) entries.push(pkg.bin[b]);
      }
    } catch (_) {}
  }
  var common = ['src/index.js', 'src/index.ts', 'src/main.js', 'src/main.ts',
    'index.js', 'index.ts', 'main.js', 'main.ts', 'src/app.js', 'src/app.tsx',
    'src/App.jsx', 'src/App.tsx', 'src/main.tsx', 'server.js', 'server.ts',
    'app.js', 'setup.py', 'main.py', 'app.py', 'manage.py', 'main.rs', 'main.go'];
  for (var i = 0; i < common.length; i++) {
    if (existsSync(path.join(root, common[i])) && entries.indexOf(common[i]) === -1) entries.push(common[i]);
  }
  if (entries.length) projectKnowledge.setSetting('wi_entry_points', JSON.stringify(entries));
}

function storeConfigFiles(fileNames) {
  var known = ['package.json', 'tsconfig.json', 'jsconfig.json',
    '.eslintrc', '.eslintrc.json', '.prettierrc', '.prettierrc.json',
    'babel.config.js', 'postcss.config.js', 'tailwind.config.js', 'tailwind.config.ts',
    'next.config.js', 'next.config.mjs', 'vite.config.ts', 'vite.config.js',
    'webpack.config.js', 'jest.config.js', 'vitest.config.ts',
    'docker-compose.yaml', 'docker-compose.yml', 'Dockerfile', 'Makefile',
    'pom.xml', 'build.gradle', 'pyproject.toml', 'requirements.txt',
    'Cargo.toml', 'go.mod', 'Gemfile', 'composer.json',
    '.env', '.env.example', '.gitignore', '.editorconfig', '.nvmrc'];
  var configs = fileNames.filter(function(f) { return known.indexOf(f) !== -1; });
  if (configs.length) projectKnowledge.setSetting('wi_config_files', JSON.stringify(configs));
}

async function storeComponents(root, dirNames) {
  var searchPaths = [];
  if (dirNames.indexOf('src') !== -1) searchPaths.push(path.join(root, 'src'));
  if (dirNames.indexOf('lib') !== -1) searchPaths.push(path.join(root, 'lib'));
  if (dirNames.indexOf('app') !== -1) searchPaths.push(path.join(root, 'app'));
  if (dirNames.indexOf('components') !== -1) searchPaths.push(path.join(root, 'components'));
  var comps = [];
  var seen = new Set();
  for (var sp = 0; sp < searchPaths.length; sp++) {
    try {
      var sub = await fs.readdir(searchPaths[sp], { withFileTypes: true });
      for (var d = 0; d < sub.length; d++) {
        if (sub[d].isDirectory() && !sub[d].name.startsWith('_') && !sub[d].name.startsWith('.') && /^[A-Z]/.test(sub[d].name) && !seen.has(sub[d].name)) {
          seen.add(sub[d].name);
          comps.push(sub[d].name);
        }
      }
    } catch (_) {}
  }
  if (comps.length) projectKnowledge.setSetting('wi_components', JSON.stringify(comps));
}

async function storeServices(root, dirNames) {
  var candidates = ['src/services', 'src/service', 'lib/services', 'services', 'src/api', 'api'];
  var svcs = [];
  var seen = new Set();
  for (var i = 0; i < candidates.length; i++) {
    var fullPath = path.join(root, candidates[i]);
    if (!existsSync(fullPath)) continue;
    try {
      var files = await fs.readdir(fullPath, { withFileTypes: true });
      for (var f = 0; f < files.length; f++) {
        if (files[f].isFile()) {
          var name = path.basename(files[f].name, path.extname(files[f].name));
          if ((name.endsWith('Service') || name.endsWith('Client') || name.endsWith('Api') || name.endsWith('Repository') || name.endsWith('Controller')) && !seen.has(name)) {
            seen.add(name);
            svcs.push(name);
          }
        }
      }
    } catch (_) {}
  }
  if (svcs.length) projectKnowledge.setSetting('wi_services', JSON.stringify(svcs));
}

async function storeGitInfo(root) {
  var gitDir = path.join(root, '.git');
  if (!existsSync(gitDir)) return;
  try {
    var headPath = path.join(gitDir, 'HEAD');
    if (existsSync(headPath)) {
      var head = await fs.readFile(headPath, 'utf-8');
      var m = head.match(/ref:\s*refs\/heads\/(.+)/);
      if (m) projectKnowledge.setSetting('wi_git_branch', m[1].trim());
    }
  } catch (_) {}
  try {
    var cfgPath = path.join(gitDir, 'config');
    if (existsSync(cfgPath)) {
      var cfg = await fs.readFile(cfgPath, 'utf-8');
      var m = cfg.match(/url\s*=\s*(?:https:\/\/[^/]+|git@[^:]+)[:/](.+?)\.git/);
      if (m) projectKnowledge.setSetting('wi_git_repo', m[1]);
    }
  } catch (_) {}
}

async function storeDependencies(root, fileNames) {
  try {
    if (fileNames.indexOf('package.json') !== -1) {
      var raw = await fs.readFile(path.join(root, 'package.json'), 'utf-8');
      var pkg = JSON.parse(raw);
      var deps = Object.keys(pkg.dependencies || {});
      var devDeps = Object.keys(pkg.devDependencies || {});
      projectKnowledge.setSetting('wi_dependencies', JSON.stringify(deps));
      projectKnowledge.setSetting('wi_dev_dependencies', JSON.stringify(devDeps));
      projectKnowledge.setSetting('wi_total_deps', String(deps.length + devDeps.length));
    }
  } catch (_) {}
}

async function storeMonoRepo(root, fileNames, dirNames) {
  var isMono = fileNames.indexOf('lerna.json') !== -1 || fileNames.indexOf('nx.json') !== -1 ||
               fileNames.indexOf('turbo.json') !== -1 || dirNames.indexOf('packages') !== -1;
  if (!isMono) return;
  projectKnowledge.setSetting('wi_is_monorepo', 'true');
  var subProjects = [];
  var pkgDirs = ['packages', 'apps', 'libs'];
  for (var i = 0; i < pkgDirs.length; i++) {
    var pkgPath = path.join(root, pkgDirs[i]);
    if (!existsSync(pkgPath)) continue;
    try {
      var items = await fs.readdir(pkgPath, { withFileTypes: true });
      for (var s = 0; s < items.length; s++) {
        if (items[s].isDirectory() && existsSync(path.join(pkgPath, items[s].name, 'package.json'))) {
          subProjects.push(path.join(pkgDirs[i], items[s].name));
        }
      }
    } catch (_) {}
  }
  if (subProjects.length) projectKnowledge.setSetting('wi_sub_projects', JSON.stringify(subProjects));
}

// ═══════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch (_) { return fallback; }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
