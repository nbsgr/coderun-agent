// projectKnowledge.js — Persistent SQLite Project Knowledge Base
// Uses globalStorageUri for storage — NEVER writes inside the workspace.
//
// Storage layout:
//   <globalStorageUri>/
//     registry.db          ← maps workspaces → project databases
//     projects/
//       <Name_Hash>/
//         index.db          ← per-project file index + chunks + metadata
//
// Only Phase-1 tables are created: files, chunks, metadata.
// Stubs for future phases (memory, timeline, deps) return empty/no-op.
//
// This file replaces the .coderun-based projectKnowledge.js.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as crypto from 'crypto';
import initSqlJs from 'sql.js';

// ── Internal state ───────────────────────────────────────────
var _SQL = null;             // sql.js init result
var _registryDb = null;      // sql.js Database for registry.db
var _registryPath = null;    // full path to registry.db
var _projectDb = null;       // sql.js Database for current project's index.db
var _projectDbPath = null;   // full path to current project's index.db

var _globalStorage = null;   // globalStorageUri.fsPath
var _workspace = null;       // workspace root absolute path
var _workspaceHash = null;   // hex digest of _workspace
var _projectName = null;     // path.basename(_workspace)
var _projectFolder = null;   // relative folder name: Name_Hash
var _projectDir = null;      // full path to projects/Name_Hash/

var _ready = false;
var _indexing = false;
var _fileWatcher = null;
var _disposables = [];

var _REGISTRY_VERSION = 1;
var _INDEX_DB_VERSION = 1;

// ========================================================
// PUBLIC API
// ========================================================

/**
 * Initialize the project knowledge base.
 * Call once from extension activate().
 * Creates/opens registry.db, locates or creates project index.db,
 * starts file watcher, begins incremental workspace indexing.
 */
export async function initialize(context) {
  if (_ready) return;

  var folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) {
    console.log('[PK] No workspace folder open — skipping');
    return;
  }
  _workspace = folders[0].uri.fsPath;
  _projectName = path.basename(_workspace);

  _globalStorage = context.globalStorageUri.fsPath;
  try { await fs.mkdir(_globalStorage, { recursive: true }); } catch (_) {}

  _workspaceHash = crypto.createHash('sha256').update(_workspace).digest('hex').substring(0, 8).toUpperCase();
  _projectFolder = _projectName + '_' + _workspaceHash;
  _projectDir = path.join(_globalStorage, 'projects', _projectFolder);
  _projectDbPath = path.join(_projectDir, 'index.db');

  _SQL = await initSqlJs();
  console.log('[PK] sql.js initialized');

  _registryPath = path.join(_globalStorage, 'registry.db');
  await openRegistry();
  await registerWorkspace();
  await openProjectDb();
  setupWatcher();
  indexWorkspace();

  _ready = true;
  console.log('[PK] Ready — project:', _projectFolder, 'at', _projectDbPath);
}

/**
 * Get knowledge base stats.
 */
export function getStats() {
  if (!_projectDb || !_ready) return { ready: false, tables: {} };
  try {
    var tableStmt = _projectDb.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    var tables = {};
    for (var i = 0; i < tableStmt.length; i++) {
      var tName = tableStmt[i].values[0][0];
      var countStmt = _projectDb.exec('SELECT COUNT(*) FROM "' + tName + '"');
      tables[tName] = countStmt.length ? countStmt[0].values[0][0] : 0;
    }
    return { ready: true, tables: tables, workspace: _workspace };
  } catch (e) {
    return { ready: false, error: e.message };
  }
}

/**
 * Search indexed files by name or path.
 * Simple LIKE-based search.
 * Returns array of { path, language, size, last_modified }.
 */
export function searchFiles(query) {
  if (!_projectDb || !_ready || !query) return [];
  try {
    var like = '%' + query + '%';
    var stmt = _projectDb.prepare(
      'SELECT path, language, size, last_modified FROM files WHERE path LIKE ? OR path LIKE ? LIMIT 50'
    );
    stmt.bind([like, like]);
    var results = [];
    try {
      while (stmt.step()) {
      var row = stmt.getAsObject();
      row.score = row.path && row.path.toLowerCase().includes(query.toLowerCase()) ? 10 : 0;
      results.push(row);
    }
    } finally {
    stmt.free();
    }
    results.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
    return results;
  } catch (e) {
    console.error('[PK] searchFiles error:', e.message);
    return [];
  }
}

/**
 * Get a single file's indexed metadata.
 */
export function getFile(relPath) {
  if (!_projectDb || !_ready || !relPath) return null;
  try {
    var stmt = _projectDb.prepare('SELECT * FROM files WHERE path = ?');
    stmt.bind([relPath]);
    if (stmt.step()) {
      var row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Get formatted project metadata for prompt context.
 */
export function getProjectMetadata() {
  if (!_workspace) return null;
  var stats = getStats();
  return {
    name: _projectName,
    path: _workspace,
    fileCount: stats.tables && stats.tables.files ? stats.tables.files : 0,
    ready: _ready
  };
}

// ═══════════════════════════════════════════════════════════
// PLANNING API — consumed by planningManager.js
// ═══════════════════════════════════════════════════════════

/**
 * Store or update a task (used by Planning Engine).
 */
export function addTask(task) {
  if (!_projectDb || !_ready) return;
  try {
    var stmt = _projectDb.prepare(`
      INSERT OR REPLACE INTO tasks (id, description, status, created_at, completed_at, result, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.bind([
      task.id || '',
      task.description || '',
      task.status || 'draft',
      task.created_at || Date.now(),
      task.completed_at || null,
      task.result || '',
      task.session_id || ''
    ]);
    stmt.step();
    stmt.free();
    saveProjectDb();
  } catch (_) {}
}

/**
 * Get all plans/tasks for a session, ordered by creation time.
 */
export function getPlansBySession(sessionId) {
  if (!_projectDb || !_ready || !sessionId) return [];
  try {
    var stmt = _projectDb.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at DESC');
    stmt.bind([sessionId]);
    var results = [];
    try {
      while (stmt.step()) {
      var row = stmt.getAsObject();
      results.push(normalizeTask(row));
    }
    } finally {
    stmt.free();
    }
    return results;
  } catch (_) { return []; }
}

/**
 * Get a single plan/task by ID.
 */
export function getPlan(planId) {
  if (!_projectDb || !_ready || !planId) return null;
  try {
    var stmt = _projectDb.prepare('SELECT * FROM tasks WHERE id = ?');
    stmt.bind([planId]);
    if (stmt.step()) {
      var row = stmt.getAsObject();
      stmt.free();
      return normalizeTask(row);
    }
    stmt.free();
    return null;
  } catch (_) { return null; }
}

/**
 * Get all plans/tasks with a specific status.
 */
export function getPlansByStatus(status) {
  if (!_projectDb || !_ready || !status) return [];
  try {
    var stmt = _projectDb.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC');
    stmt.bind([status]);
    var results = [];
    try {
      while (stmt.step()) {
      var row = stmt.getAsObject();
      results.push(normalizeTask(row));
    }
    } finally {
    stmt.free();
    }
    return results;
  } catch (_) { return []; }
}

/**
 * Update a plan/task status.
 */
export function updatePlanStatus(planId, status) {
  if (!_projectDb || !_ready || !planId) return;
  try {
    var now = status === 'completed' || status === 'failed' ? Date.now() : null;
    _projectDb.run('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?', [status, now, planId]);
    // Also update the metadata-based plan status for backward compat
    _projectDb.run('UPDATE metadata SET value = ? WHERE key = ?', [status, 'plan_' + planId + '_status']);
    saveProjectDb();
  } catch (_) {}
}

function normalizeTask(row) {
  var result = {};
  try {
    if (row.result && typeof row.result === 'string') {
      result = JSON.parse(row.result);
    }
  } catch (_) {}
  return {
    id: row.id || '',
    description: row.description || '',
    status: row.status || 'pending',
    created_at: row.created_at || 0,
    completed_at: row.completed_at || null,
    session_id: row.session_id || '',
    steps: result.steps || [],
    required_files: result.files || []
  };
}

// ═══════════════════════════════════════════════════════════
// CHECKPOINT API — consumed by checkpointManager.js
// ═══════════════════════════════════════════════════════════

/**
 * Store a checkpoint.
 */
export function addCheckpoint(cp) {
  if (!_projectDb || !_ready || !cp || !cp.id) return;
  try {
    var stmt = _projectDb.prepare(`
      INSERT OR REPLACE INTO checkpoints (id, file_path, content, created_at, session_id, label)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.bind([cp.id, cp.file_path || '', cp.content || '', cp.created_at || Date.now(), cp.session_id || '', cp.label || '']);
    stmt.step();
    stmt.free();
    saveProjectDb();
  } catch (_) {}
}

/**
 * Get checkpoints for a specific file, most recent first.
 */
export function getCheckpoints(filePath, sessionId) {
  if (!_projectDb || !_ready || !filePath) return [];
  try {
    var sql = 'SELECT * FROM checkpoints WHERE file_path = ?';
    var params = [filePath];
    if (sessionId) {
      sql += ' AND session_id = ?';
      params.push(sessionId);
    }
    sql += ' ORDER BY created_at DESC';
    var stmt = _projectDb.prepare(sql);
    stmt.bind(params);
    var results = [];
    try {
      while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    } finally {
    stmt.free();
    }
    return results;
  } catch (_) { return []; }
}

/**
 * Get most recent checkpoints across all files.
 */
export function getRecentCheckpoints(sessionId, limit) {
  if (!_projectDb || !_ready) return [];
  limit = limit || 10;
  try {
    var sql = 'SELECT * FROM checkpoints';
    var params = [];
    if (sessionId) {
      sql += ' WHERE session_id = ?';
      params.push(sessionId);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    var stmt = _projectDb.prepare(sql);
    stmt.bind(params);
    var results = [];
    try {
      while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    } finally {
    stmt.free();
    }
    return results;
  } catch (_) { return []; }
}

/**
 * Delete a specific checkpoint by ID.
 */
export function deleteCheckpoint(id) {
  if (!_projectDb || !_ready || !id) return;
  try {
    _projectDb.run('DELETE FROM checkpoints WHERE id = ?', [id]);
    saveProjectDb();
  } catch (_) {}
}

/**
 * Delete all checkpoints for a session.
 */
export function deleteCheckpointsBySession(sessionId) {
  if (!_projectDb || !_ready || !sessionId) return;
  try {
    _projectDb.run('DELETE FROM checkpoints WHERE session_id = ?', [sessionId]);
    saveProjectDb();
  } catch (_) {}
}

/**
 * Get total checkpoint count.
 */
export function getCheckpointStats() {
  if (!_projectDb || !_ready) return { total: 0 };
  try {
    var stmt = _projectDb.exec('SELECT COUNT(*) as cnt FROM checkpoints');
    var total = stmt.length && stmt[0].values.length ? Number(stmt[0].values[0][0]) : 0;
    return { total: total };
  } catch (_) { return { total: 0 }; }
}

/**
 * Trim the oldest N checkpoints.
 */
export function trimOldestCheckpoints(count) {
  if (!_projectDb || !_ready || !count) return;
  try {
    _projectDb.run('DELETE FROM checkpoints WHERE id IN (SELECT id FROM checkpoints ORDER BY created_at ASC LIMIT ?)', [count]);
    saveProjectDb();
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
// FUTURE-PHASE STUBS — return empty / no-op until implemented
// ═══════════════════════════════════════════════════════════

export function getMemoryPrompt() { return ''; }
export function getDependencyGraph() { return ''; }
export function getTimelinePrompt(limit) { return ''; }
export function setMemory(key, value) {}
export function getMemory(key) { return null; }
export function addTimelineEntry(eventType, data) {}
export function addDependency(fromPath, toPath, depType) {}
export function setSetting(key, value) {
  if (!_projectDb || !_ready) return;
  try {
    var stmt = _projectDb.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
    stmt.bind([key, typeof value === 'string' ? value : JSON.stringify(value)]);
    stmt.step();
    stmt.free();
  } catch (_) {}
}
export function getSetting(key) {
  if (!_projectDb || !_ready) return null;
  try {
    var stmt = _projectDb.prepare('SELECT value FROM metadata WHERE key = ?');
    stmt.bind([key]);
    if (stmt.step()) {
      var v = stmt.getAsObject().value;
      stmt.free();
      try { return JSON.parse(v); } catch (_) { return v; }
    }
    stmt.free();
    return null;
  } catch (_) { return null; }
}

// ═══════════════════════════════════════════════════════════
// SEARCH API — consumed by searchManager.js
// ═══════════════════════════════════════════════════════════

/**
 * Get index status for the SearchManager.
 * Returns whether the index is ready and has been fully indexed at least once.
 */
export function getIndexStatus() {
  if (!_ready || !_projectDb) return { ready: false, indexed: false };
  try {
    var stmt = _registryDb.run("SELECT index_status FROM registry WHERE workspace_path = ?", [_workspace]);
    var status = 'pending';
    if (stmt.length && stmt[0].values.length) {
      status = stmt[0].values[0][0];
    }
    return { ready: _ready, indexed: status === 'ready' };
  } catch (_) {
    return { ready: _ready, indexed: false };
  }
}

/**
 * Search files by SQL LIKE pattern on path.
 * Used by searchManager.searchFiles() when index is available.
 */
export function searchByGlob(likePattern, subDir) {
  if (!_projectDb || !_ready || !likePattern) return [];
  try {
    var sql = 'SELECT path FROM files WHERE path LIKE ?';
    var params = [likePattern];
    if (subDir) {
      sql += ' AND (path LIKE ? OR path LIKE ?)';
      params.push(subDir + '/%', subDir + '\\%');
    }
    sql += ' LIMIT 200';
    var stmt = _projectDb.prepare(sql);
    stmt.bind(params);
    var results = [];
    try {
      while (stmt.step()) {
      results.push(stmt.getAsObject().path);
    }
    } finally {
    stmt.free();
    }
    return results;
  } catch (e) {
    console.error('[PK] searchByGlob error:', e.message);
    return [];
  }
}

/**
 * Search file contents (chunks) for a query string.
 * Used by searchManager.searchContent() when index is available.
 * Returns array of { path, matches, snippet }.
 */
export function searchChunks(query) {
  if (!_projectDb || !_ready || !query) return [];
  try {
    var like = '%' + query + '%';
    var sql = `
      SELECT DISTINCT f.path, c.content
      FROM chunks c
      JOIN files f ON f.id = c.file_id
      WHERE c.content LIKE ?
      LIMIT 30
    `;
    var stmt = _projectDb.prepare(sql);
    stmt.bind([like]);
    var results = [];
    try {
      while (stmt.step()) {
      var row = stmt.getAsObject();
      var content = row.content || '';
      var idx = content.toLowerCase().indexOf(query.toLowerCase());
      var snippet = '';
      if (idx !== -1) {
        var start = Math.max(0, idx - 40);
        var end = Math.min(content.length, idx + query.length + 40);
        snippet = '...' + content.substring(start, end).replace(/\n/g, ' ') + '...';
      }
      results.push({
        path: row.path,
        matches: 1,
        snippet: snippet
      });
    }
    } finally {
    stmt.free();
    }
    return results;
  } catch (e) {
    console.error('[PK] searchChunks error:', e.message);
    return [];
  }
}

/**
 * Get all indexed file paths.
 */
export function getAllPaths() {
  if (!_projectDb || !_ready) return [];
  try {
    var stmt = _projectDb.exec('SELECT path FROM files ORDER BY path');
    if (!stmt.length) return [];
    return stmt[0].values.map(function(r) { return r[0]; });
  } catch (_) { return []; }
}

/**
 * Check if a specific path is indexed and unchanged.
 */
export function isIndexed(relPath, currentHash, currentModified) {
  var existing = getFile(relPath);
  if (!existing) return false;
  if (currentHash && existing.hash !== currentHash) return false;
  if (currentModified && existing.last_modified !== currentModified) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════
// FILE OPERATIONS
// ═══════════════════════════════════════════════════════════

export async function touchFile(relPath) {
  if (!_projectDb || !_ready) return;
  await indexSingleFile(relPath);
  saveProjectDb();
}

export async function reindexWorkspace() {
  if (!_projectDb || !_ready) return;
  try {
    _projectDb.run('DELETE FROM files');
    _projectDb.run('DELETE FROM chunks');
    saveProjectDb();
  } catch (_) {}
  await indexWorkspace();
}

export function save() {
  saveProjectDb();
}

/**
 * Dispose (cleanup on deactivate).
 */
export function dispose() {
  saveProjectDb();
  saveRegistry();
  for (var i = 0; i < _disposables.length; i++) {
    _disposables[i].dispose();
  }
  _disposables = [];
  if (_fileWatcher) { _fileWatcher.dispose(); _fileWatcher = null; }
  if (_projectDb) { _projectDb.close(); _projectDb = null; }
  if (_registryDb) { _registryDb.close(); _registryDb = null; }
  _ready = false;
  console.log('[PK] Disposed');
}

// ========================================================
// INTERNAL: Registry
// ========================================================

async function openRegistry() {
  try {
    if (existsSync(_registryPath)) {
      var buf = await fs.readFile(_registryPath);
      _registryDb = new _SQL.Database(buf);
    } else {
      _registryDb = new _SQL.Database();
    }
  } catch (e) {
    console.error('[PK] Registry error:', e.message);
    _registryDb = new _SQL.Database();
  }

  _registryDb.run('PRAGMA journal_mode=WAL');
  _registryDb.run('PRAGMA synchronous=NORMAL');
  _registryDb.run(`
    CREATE TABLE IF NOT EXISTS registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_path TEXT NOT NULL UNIQUE,
      workspace_name TEXT NOT NULL DEFAULT '',
      workspace_hash TEXT NOT NULL DEFAULT '',
      project_folder TEXT NOT NULL DEFAULT '',
      db_version INTEGER NOT NULL DEFAULT 1,
      first_indexed INTEGER NOT NULL DEFAULT 0,
      last_indexed INTEGER NOT NULL DEFAULT 0,
      last_opened INTEGER NOT NULL DEFAULT 0,
      index_status TEXT NOT NULL DEFAULT 'pending'
    )
  `);
  _registryDb.run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `);
  var verStmt = _registryDb.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  verStmt.bind(['version', String(_REGISTRY_VERSION)]);
  verStmt.step();
  verStmt.free();

  saveRegistry();
  console.log('[PK] Registry opened:', _registryPath);
}

async function saveRegistry() {
  if (!_registryDb || !_registryPath) return;
  try {
    var data = _registryDb.export();
    await fs.writeFile(_registryPath, Buffer.from(data)).catch(function(e) {
      console.error('[PK] Failed to save registry:', e.message);
    });
  } catch (e) {
    console.error('[PK] Failed to export registry:', e.message);
  }
}

async function registerWorkspace() {
  if (!_registryDb || !_workspace || !_workspaceHash) return;

  var now = Date.now();
  var stmt = _registryDb.prepare(`
    INSERT OR REPLACE INTO registry
      (workspace_path, workspace_name, workspace_hash, project_folder, db_version, last_opened)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.bind([_workspace, _projectName, _workspaceHash, _projectFolder, _INDEX_DB_VERSION, now]);
  stmt.step();
  stmt.free();
  saveRegistry();

  var check = _registryDb.run('SELECT first_indexed FROM registry WHERE workspace_path = ?', [_workspace]);
  if (check.length && check[0].values.length && !Number(check[0].values[0][0])) {
    _registryDb.run('UPDATE registry SET first_indexed = ? WHERE workspace_path = ?', [now, _workspace]);
    saveRegistry();
  }
}

// ========================================================
// INTERNAL: Project database
// ========================================================

async function openProjectDb() {
  try { await fs.mkdir(_projectDir, { recursive: true }); } catch (_) {}

  try {
    if (existsSync(_projectDbPath)) {
      var buf = await fs.readFile(_projectDbPath);
      _projectDb = new _SQL.Database(buf);
      console.log('[PK] Loaded existing project database');
    } else {
      _projectDb = new _SQL.Database();
      console.log('[PK] Created new project database');
    }
  } catch (e) {
    console.error('[PK] Project DB error:', e.message);
    _projectDb = new _SQL.Database();
  }

  _projectDb.run('PRAGMA journal_mode=WAL');
  _projectDb.run('PRAGMA synchronous=NORMAL');

  _projectDb.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      language TEXT NOT NULL DEFAULT 'text',
      size INTEGER NOT NULL DEFAULT 0,
      hash TEXT NOT NULL DEFAULT '',
      last_modified TEXT NOT NULL DEFAULT '',
      last_indexed INTEGER NOT NULL DEFAULT 0
    )
  `);

  _projectDb.run(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL DEFAULT '',
      embedding BLOB DEFAULT NULL,
      FOREIGN KEY (file_id) REFERENCES files(id)
    )
  `);

  _projectDb.run(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `);

  _projectDb.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT 0,
      completed_at INTEGER DEFAULT NULL,
      result TEXT DEFAULT NULL,
      session_id TEXT NOT NULL DEFAULT ''
    )
  `);

  _projectDb.run(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      session_id TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT ''
    )
  `);

  _projectDb.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', ['db_version', String(_INDEX_DB_VERSION)]);

  saveProjectDb();
  console.log('[PK] Project database ready');
}

async function saveProjectDb() {
  if (!_projectDb || !_projectDbPath) return;
  try {
    var data = _projectDb.export();
    await fs.writeFile(_projectDbPath, Buffer.from(data)).catch(function(e) {
      console.error('[PK] Failed to save project DB:', e.message);
    });
  } catch (e) {
    console.error('[PK] Failed to export project DB:', e.message);
  }
}

// ========================================================
// INTERNAL: File indexing
// ========================================================

async function indexWorkspace() {
  if (_indexing || !_workspace) return;
  _indexing = true;

  if (_registryDb) {
    _registryDb.run('UPDATE registry SET index_status = ? WHERE workspace_path = ?', ['indexing', _workspace]);
    saveRegistry();
  }

  console.log('[PK] Starting incremental indexing...');
  var startTime = Date.now();
  var indexedCount = 0;
  var unchangedCount = 0;

  try {
    var result = await walkAndIndex(_workspace, _workspace);
    indexedCount = result.indexed;
    unchangedCount = result.unchanged;

    if (_registryDb) {
      var now = Date.now();
      _registryDb.run('UPDATE registry SET last_indexed = ?, index_status = ?, last_opened = ? WHERE workspace_path = ?', [now, 'ready', now, _workspace]);
      saveRegistry();
    }

    saveProjectDb();
    var elapsed = Date.now() - startTime;
    console.log('[PK] Done —', indexedCount, 'indexed,', unchangedCount, 'unchanged in', elapsed, 'ms');
  } catch (e) {
    console.error('[PK] Indexing error:', e.message);
    if (_registryDb) {
      _registryDb.run('UPDATE registry SET index_status = ? WHERE workspace_path = ?', ['error', _workspace]);
      saveRegistry();
    }
  }

  _indexing = false;
}

async function walkAndIndex(rootDir, dirPath) {
  var indexed = 0;
  var unchanged = 0;

  try {
    var entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];

      if (entry.name.startsWith('.') || entry.name === 'node_modules' ||
          entry.name === 'venv' || entry.name === '__pycache__') {
        continue;
      }

      var fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        var sub = await walkAndIndex(rootDir, fullPath);
        indexed += sub.indexed;
        unchanged += sub.unchanged;
        continue;
      }

      if (isBinaryExtension(entry.name)) continue;

      var relPath = path.relative(rootDir, fullPath);
      if (await indexSingleFile(relPath)) {
        indexed++;
      } else {
        unchanged++;
      }
    }
  } catch (_) {}

  return { indexed: indexed, unchanged: unchanged };
}

/**
 * Index a single file. Returns true if indexed, false if unchanged.
 * Compares stored hash with current hash to skip unchanged files.
 */
async function indexSingleFile(relPath) {
  if (!_workspace || !_projectDb) return false;
  var fullPath = path.join(_workspace, relPath);

  try {
    var stat = await fs.stat(fullPath);
    if (!stat.isFile()) return false;

    var size = stat.size;
    var modified = stat.mtime.toISOString();

    var fd = await fs.open(fullPath, 'r');
    try {
      var readLen = Math.min(size, 32768);
      var buffer = Buffer.alloc(readLen);
      await fd.read(buffer, 0, readLen, 0);
    } finally {
      await fd.close();
    }

    var content = buffer.toString('utf-8');
    var hash = simpleHash(content);
    var ext = path.extname(relPath).toLowerCase();
    var language = langFromExt(ext);

    // Hash + mtime comparison — skip if unchanged
    var existing = getFile(relPath);
    if (existing && existing.hash === hash && existing.last_modified === modified) {
      return false;
    }

    var upsertFile = _projectDb.prepare(`
      INSERT OR REPLACE INTO files (path, language, size, hash, last_modified, last_indexed)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    upsertFile.bind([relPath, language, size, hash, modified, Date.now()]);
    upsertFile.step();
    upsertFile.free();

    var idStmt = _projectDb.prepare('SELECT id FROM files WHERE path = ?');
    idStmt.bind([relPath]);
    var fileId = 0;
    if (idStmt.step()) fileId = Number(idStmt.getAsObject().id);
    idStmt.free();

    // Delete old chunks, create new ones
    _projectDb.run('DELETE FROM chunks WHERE file_id = ?', [fileId]);

    if (content.length > 0) {
      var insertChunk = _projectDb.prepare('INSERT INTO chunks (file_id, chunk_index, content) VALUES (?, ?, ?)');
      for (var ci = 0; ci < content.length; ci += 1000) {
        var chunkText = content.substring(ci, ci + 1000);
        insertChunk.bind([fileId, Math.floor(ci / 1000), chunkText]);
        insertChunk.step();
        insertChunk.free();
        insertChunk = _projectDb.prepare('INSERT INTO chunks (file_id, chunk_index, content) VALUES (?, ?, ?)');
      }
      insertChunk.free();
    }

    return true;
  } catch (_) {
    return false;
  }
}

// ========================================================
// INTERNAL: File watcher
// ========================================================

function setupWatcher() {
  if (!_workspace) return;

  try {
    _fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(_workspace, '**/*')
    );

    _disposables.push(
      _fileWatcher.onDidChange(function(uri) {
        if (!_projectDb || !_ready) return;
        var relPath = path.relative(_workspace, uri.fsPath);
        if (!relPath || relPath.startsWith('..') || isBinaryExtension(relPath)) return;
        indexSingleFile(relPath).then(function() { saveProjectDb(); }).catch(function() {});
      })
    );

    _disposables.push(
      _fileWatcher.onDidCreate(function(uri) {
        if (!_projectDb || !_ready) return;
        var relPath = path.relative(_workspace, uri.fsPath);
        if (!relPath || relPath.startsWith('..') || isBinaryExtension(relPath)) return;
        indexSingleFile(relPath).then(function() { saveProjectDb(); }).catch(function() {});
      })
    );

    _disposables.push(
      _fileWatcher.onDidDelete(function(uri) {
        if (!_projectDb || !_ready) return;
        var relPath = path.relative(_workspace, uri.fsPath);
        if (!relPath || relPath.startsWith('..')) return;
        try {
          _projectDb.run('DELETE FROM files WHERE path = ?', [relPath]);
          saveProjectDb();
        } catch (_) {}
      })
    );

    console.log('[PK] File watcher established');
  } catch (e) {
    console.error('[PK] Failed to set up file watcher:', e.message);
  }
}

// ========================================================
// INTERNAL: Helpers
// ========================================================

var BINARY_EXTS = {
  '.png': 1, '.jpg': 1, '.jpeg': 1, '.gif': 1, '.ico': 1, '.svg': 1,
  '.webp': 1, '.bmp': 1, '.mp3': 1, '.mp4': 1, '.wav': 1, '.ogg': 1,
  '.zip': 1, '.tar': 1, '.gz': 1, '.rar': 1, '.7z': 1, '.pdf': 1,
  '.doc': 1, '.docx': 1, '.xls': 1, '.xlsx': 1, '.ppt': 1, '.pptx': 1,
  '.exe': 1, '.dll': 1, '.so': 1, '.dylib': 1, '.wasm': 1, '.o': 1,
  '.a': 1, '.lib': 1, '.class': 1, '.pyc': 1, '.pyd': 1, '.ttf': 1,
  '.otf': 1, '.woff': 1, '.woff2': 1, '.eot': 1, '.map': 1
};

function isBinaryExtension(filename) {
  if (filename.endsWith('.min.js') || filename.endsWith('.min.css')) return true;
  return !!BINARY_EXTS[path.extname(filename).toLowerCase()];
}

function langFromExt(ext) {
  var map = {
    '.js': 'javascript', '.ts': 'typescript', '.jsx': 'javascript',
    '.tsx': 'typescript', '.py': 'python', '.rb': 'ruby',
    '.java': 'java', '.go': 'go', '.rs': 'rust', '.c': 'c',
    '.cpp': 'cpp', '.h': 'c-header', '.hpp': 'cpp-header',
    '.cs': 'csharp', '.swift': 'swift', '.kt': 'kotlin',
    '.scala': 'scala', '.php': 'php', '.html': 'html',
    '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.json': 'json', '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml',
    '.md': 'markdown', '.sql': 'sql', '.sh': 'bash', '.bash': 'bash',
    '.zsh': 'bash', '.ps1': 'powershell', '.dockerfile': 'dockerfile',
    '.tf': 'terraform', '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini',
    '.env': 'dotenv', '.gitignore': 'ignore', '.eslintrc': 'json'
  };
  return map[ext] || 'text';
}

function simpleHash(text) {
  var hash = 0;
  if (!text || !text.length) return String(hash);
  var len = Math.min(text.length, 10000);
  for (var i = 0; i < len; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return String(Math.abs(hash));
}
