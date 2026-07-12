// learningManager.js — Learning Engine (Project Knowledge, NOT chat memory)
// Learns about the project's structure, frameworks, conventions, and patterns.
// Stores everything in SQLite via projectKnowledge metadata.
// ContextManager consumes this to enrich prompts automatically.
//
// What is learned:
//   - Framework(s) detected
//   - Libraries / dependencies
//   - Build system
//   - Project architecture
//   - Coding style & conventions
//   - Important files (entry points, configs)
//   - Frequently edited files (from execution history)
//   - Frequently used commands

import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as projectKnowledge from './projectKnowledge.js';
import * as searchManager from './searchManager.js';

// ========================================================
// PUBLIC API
// ========================================================

/**
 * Initialize learning for the workspace.
 * Call once on extension startup (from contextManager or extension.js).
 * Runs async — does not block.
 */
export async function initialize(workspace) {
  if (!workspace) return;
  console.log('[LEARN] Initializing learning engine for', workspace);

  // Step 1: Detect framework and build system
  if (!projectKnowledge.getSetting('learn_framework_detected')) {
    await detectFramework(workspace);
  }

  // Step 2: Scan for conventions
  if (!projectKnowledge.getSetting('learn_conventions_detected')) {
    await detectConventions(workspace);
  }

  // Step 3: Identify important files
  if (!projectKnowledge.getSetting('learn_important_files_detected')) {
    await identifyImportantFiles(workspace);
  }

  console.log('[LEARN] Learning initialized');
}

/**
 * Get formatted learning context for prompt injection.
 */
export function getLearningContext() {
  var parts = [];

  var framework = projectKnowledge.getSetting('learn_framework');
  if (framework) {
    parts.push('## PROJECT LEARNING');
    parts.push('Framework: ' + framework);
  }

  var buildSystem = projectKnowledge.getSetting('learn_build_system');
  if (buildSystem) parts.push('Build System: ' + buildSystem);

  var conventions = projectKnowledge.getSetting('learn_conventions');
  if (conventions) {
    try {
      var convList = JSON.parse(conventions);
      if (convList && convList.length) {
        parts.push('Conventions: ' + convList.join(', '));
      }
    } catch (_) {}
  }

  var importantFiles = projectKnowledge.getSetting('learn_important_files');
  if (importantFiles) {
    try {
      var fileList = JSON.parse(importantFiles);
      if (fileList && fileList.length) {
        parts.push('Key Files: ' + fileList.join(', '));
      }
    } catch (_) {}
  }

  var commands = projectKnowledge.getSetting('learn_frequent_commands');
  if (commands) {
    try {
      var cmdList = JSON.parse(commands);
      if (cmdList && cmdList.length) {
        parts.push('Frequent Commands: ' + cmdList.slice(0, 5).join(' | '));
      }
    } catch (_) {}
  }

  var architecture = projectKnowledge.getSetting('learn_architecture');
  if (architecture) {
    parts.push('Architecture: ' + architecture);
  }

  return parts.length > 1 ? parts.join('\n') : '';
}

/**
 * Record that a tool or command was used (for frequency tracking).
 */
export function recordToolUsage(toolName, command) {
  var key = 'learn_usage_' + toolName;
  var count = Number(projectKnowledge.getSetting(key) || 0);
  projectKnowledge.setSetting(key, String(count + 1));

  // Track specific commands used
  if (command && command.length > 5) {
    var cmdKey = 'learn_cmd_' + simpleHash(command);
    var cmdCount = Number(projectKnowledge.getSetting(cmdKey) || 0);
    projectKnowledge.setSetting(cmdKey, String(cmdCount + 1));
  }
}

/**
 * Get most frequently used tools/commands for prompt context.
 */
export function getFrequentCommands(limit) {
  limit = limit || 3;
  // This reads from the metadata table where key starts with 'learn_cmd_'
  // Returns top N commands by usage count
  var cmds = [];
  try {
    var db = getProjectDb();
    if (!db) return cmds;
    var stmt = db.exec("SELECT key, value FROM metadata WHERE key LIKE 'learn_cmd_%' ORDER BY CAST(value AS INTEGER) DESC LIMIT " + limit);
    if (stmt.length && stmt[0].values.length) {
      for (var i = 0; i < stmt[0].values.length; i++) {
        var row = stmt[0].values[i];
        cmds.push(row[0].replace('learn_cmd_', ''));
      }
    }
  } catch (_) {}
  return cmds;
}

// ========================================================
// INTERNAL: Framework detection
// ========================================================

async function detectFramework(workspace) {
  var framework = 'unknown';
  var buildSystem = 'unknown';

  // Check for package.json (Node.js projects)
  var pkgPath = path.join(workspace, 'package.json');
  if (existsSync(pkgPath)) {
    buildSystem = 'npm';
    try {
      var pkgRaw = await fs.readFile(pkgPath, 'utf-8');
      var pkg = JSON.parse(pkgRaw);
      var deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});

      if (deps.next) framework = 'Next.js';
      else if (deps.react) framework = 'React';
      else if (deps.vue) framework = 'Vue';
      else if (deps.angular || deps['@angular/core']) framework = 'Angular';
      else if (deps.express) framework = 'Express';
      else if (deps['@nestjs/core']) framework = 'NestJS';
      else if (deps.svelte) framework = 'Svelte';
      else if (deps.electron) framework = 'Electron';
      else if (pkg.scripts && (pkg.scripts.build || pkg.scripts.start)) framework = 'Node.js';
      else framework = 'JavaScript/Node.js';

      // Detect build tool
      if (deps.typescript) buildSystem = 'npm + TypeScript';
      if (deps.vite || pkg.devDependencies?.vite) buildSystem = 'Vite';
      if (deps.webpack || pkg.devDependencies?.webpack) buildSystem += ' + Webpack';
      if (deps.esbuild || pkg.devDependencies?.esbuild) buildSystem += ' + ESBuild';
    } catch (_) {}
  }

  // Check for pom.xml (Maven)
  if (existsSync(path.join(workspace, 'pom.xml'))) {
    framework = existsSync(path.join(workspace, 'src/main/java')) ? 'Java/Spring' : 'Java/Maven';
    buildSystem = 'Maven';
  }

  // Check for build.gradle (Gradle)
  if (existsSync(path.join(workspace, 'build.gradle')) || existsSync(path.join(workspace, 'build.gradle.kts'))) {
    framework = existsSync(path.join(workspace, 'settings.gradle')) ? 'Java/Gradle' : 'Kotlin/Gradle';
    buildSystem = 'Gradle';
  }

  // Check for requirements.txt or pyproject.toml (Python)
  if (existsSync(path.join(workspace, 'requirements.txt')) || existsSync(path.join(workspace, 'pyproject.toml'))) {
    // Detect framework from imports
    try {
      var entries = await fs.readdir(workspace, { withFileTypes: true });
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].name.endsWith('.py')) {
          var pyContent = await fs.readFile(path.join(workspace, entries[i].name), 'utf-8');
          if (pyContent.includes('from django') || pyContent.includes('import django')) {
            framework = 'Django';
            break;
          }
          if (pyContent.includes('from flask') || pyContent.includes('import flask')) {
            framework = 'Flask';
            break;
          }
          if (pyContent.includes('from fastapi') || pyContent.includes('import fastapi')) {
            framework = 'FastAPI';
            break;
          }
        }
      }
    } catch (_) {}
    if (framework === 'unknown') framework = 'Python';
    buildSystem = 'pip';
  }

  // Check for Cargo.toml (Rust)
  if (existsSync(path.join(workspace, 'Cargo.toml'))) {
    framework = 'Rust';
    buildSystem = 'Cargo';
  }

  // Check for go.mod (Go)
  if (existsSync(path.join(workspace, 'go.mod'))) {
    framework = 'Go';
    buildSystem = 'Go Modules';
  }

  // Check for .csproj or .sln (C#)
  if (existsSync(path.join(workspace, '*.sln')) || existsSync(path.join(workspace, '*.csproj'))) {
    framework = 'C#/.NET';
    buildSystem = 'dotnet';
  }

  projectKnowledge.setSetting('learn_framework', framework);
  projectKnowledge.setSetting('learn_build_system', buildSystem);
  projectKnowledge.setSetting('learn_framework_detected', 'true');
  console.log('[LEARN] Detected framework:', framework, '| build:', buildSystem);
}

// ========================================================
// INTERNAL: Convention detection
// ========================================================

async function detectConventions(workspace) {
  var conventions = [];
  var architecture = '';

  // Check for TypeScript
  var hasTsConfig = existsSync(path.join(workspace, 'tsconfig.json'));
  if (hasTsConfig) conventions.push('TypeScript');

  // Check for ESLint
  if (existsSync(path.join(workspace, '.eslintrc')) ||
      existsSync(path.join(workspace, '.eslintrc.json')) ||
      existsSync(path.join(workspace, '.eslintrc.js'))) {
    conventions.push('ESLint');
  }

  // Check for Prettier
  if (existsSync(path.join(workspace, '.prettierrc')) ||
      existsSync(path.join(workspace, '.prettierrc.json')) ||
      existsSync(path.join(workspace, '.prettierrc.js'))) {
    conventions.push('Prettier');
  }

  // Check for tests directory or test files
  var hasTestsDir = existsSync(path.join(workspace, '__tests__')) ||
                    existsSync(path.join(workspace, 'test')) ||
                    existsSync(path.join(workspace, 'tests'));
  if (hasTestsDir) conventions.push('Has test suite');

  // Detect project architecture from directory layout
  if (existsSync(path.join(workspace, 'src/pages'))) architecture = 'Pages router';
  else if (existsSync(path.join(workspace, 'src/app'))) architecture = 'App router';
  else if (existsSync(path.join(workspace, 'src/components')) &&
           existsSync(path.join(workspace, 'src/views'))) architecture = 'Component/View';
  else if (existsSync(path.join(workspace, 'src/controllers')) ||
           existsSync(path.join(workspace, 'src/controllers'))) architecture = 'MVC';
  else if (existsSync(path.join(workspace, 'src/services')) ||
           existsSync(path.join(workspace, 'src/services'))) architecture = 'Service-oriented';

  if (conventions.length) {
    projectKnowledge.setSetting('learn_conventions', JSON.stringify(conventions));
  }
  if (architecture) {
    projectKnowledge.setSetting('learn_architecture', architecture);
  }
  projectKnowledge.setSetting('learn_conventions_detected', 'true');
  console.log('[LEARN] Conventions:', conventions, '| Architecture:', architecture);
}

// ========================================================
// INTERNAL: Important files identification
// ========================================================

async function identifyImportantFiles(workspace) {
  var importantFiles = [];

  // Config files
  var configCandidates = [
    'package.json', 'tsconfig.json', '.env', '.env.example',
    'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile',
    'webpack.config.js', 'vite.config.js', 'vite.config.ts',
    'next.config.js', 'next.config.ts', 'tailwind.config.js',
    '.eslintrc.js', '.eslintrc.json', '.prettierrc', 'jest.config.js',
    'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle',
    'Cargo.toml', 'go.mod', 'requirements.txt', 'pyproject.toml',
    'Makefile', 'CMakeLists.txt', 'Gemfile', 'Podfile'
  ];

  for (var i = 0; i < configCandidates.length; i++) {
    if (existsSync(path.join(workspace, configCandidates[i]))) {
      importantFiles.push(configCandidates[i]);
    }
  }

  // Entry point files (common patterns)
  var entryCandidates = [
    'src/index.js', 'src/index.ts', 'src/main.js', 'src/main.ts',
    'src/app.js', 'src/app.ts', 'index.js', 'index.ts', 'app.js',
    'main.py', 'app.py', 'cli.py', 'Main.java', 'main.go',
    'src/main/java/**/Application.java', 'Program.cs'
  ];

  for (var j = 0; j < entryCandidates.length; j++) {
    var entryPath = path.join(workspace, entryCandidates[j]);
    // Check glob-like patterns
    if (entryCandidates[j].includes('*')) continue; // skip glob for now
    if (existsSync(entryPath)) {
      importantFiles.push(entryCandidates[j]);
    }
  }

  if (importantFiles.length) {
    projectKnowledge.setSetting('learn_important_files', JSON.stringify(importantFiles));
  }
  projectKnowledge.setSetting('learn_important_files_detected', 'true');
  console.log('[LEARN] Identified', importantFiles.length, 'important files');
}

// ========================================================
// INTERNAL: Helper
// ========================================================

function simpleHash(text) {
  var hash = 0;
  if (!text) return String(hash);
  for (var i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return 'h' + String(Math.abs(hash));
}

function getProjectDb() {
  // Access the internal projectDb from projectKnowledge for direct queries
  try {
    var stats = projectKnowledge.getStats();
    if (!stats.ready) return null;
    return null; // No direct DB access — use metadata API
  } catch (_) { return null; }
}
