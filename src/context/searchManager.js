// searchManager.js — Search abstraction layer for the project index.
// All search tools delegate here instead of accessing SQLite or filesystem directly.
// Future: semantic_search, symbol_search, dependency_search all route through this.
//
// Call chain:  tool → searchManager.searchFiles() / searchContent()
//                → projectKnowledge (SQLite) if index is ready
//                → filesystem fallback if index is unavailable
//                → schedules background re-index for files found via fallback

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as projectKnowledge from './projectKnowledge.js';

// ========================================================
// SEARCH FILES — glob-based filename search
// ========================================================

/**
 * Search for files matching a glob pattern.
 * Uses SQLite index when ready, falls back to filesystem walk.
 *
 * @param {string} pattern - Glob pattern (e.g. "*.js", "src/**&#47;*.js")
 * @param {string} rootDir - Absolute workspace root
 * @param {string} subDir  - Relative subdirectory to scope search (optional)
 * @returns {Promise<string[]>} Array of relative paths
 */
export async function searchFiles(pattern, rootDir, subDir) {
  if (!pattern || !rootDir) return [];

  var likePattern = pattern.replace(/\*\*/g, '*').replace(/\?/g, '_');

  var status = projectKnowledge.getIndexStatus();
  if (status.ready && status.indexed) {
    try {
      var sqlLike = patternToLike(likePattern);
      var results = projectKnowledge.searchByGlob(sqlLike, subDir || '');
      if (results && results.length) {
        return results;
      }
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }
  }

  return await fallbackWalk(pattern, rootDir, subDir);
}

// ========================================================
// SEARCH CONTENT — full-text content search
// ========================================================

/**
 * Search file contents for a query string.
 * Uses SQLite chunks table when ready, falls back to filesystem grep.
 *
 * @param {string} query   - Text to search for in file contents
 * @param {string} rootDir - Absolute workspace root
 * @returns {Promise<Array<{path: string, matches: number, snippet: string}>>}
 */
export async function searchContent(query, rootDir) {
  if (!query || !rootDir) return [];

  var status = projectKnowledge.getIndexStatus();
  if (status.ready && status.indexed) {
    try {
      var results = projectKnowledge.searchChunks(query);
      if (results && results.length) {
        return results;
      }
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }
  }

  return await fallbackGrep(query, rootDir);
}

// ========================================================
// STATS
// ========================================================

/**
 * Get search engine status for display/prompt injection.
 */
export function getSearchStatus() {
  var status = projectKnowledge.getIndexStatus();
  var stats = projectKnowledge.getStats();
  return {
    ready: status.ready,
    indexed: status.indexed,
    totalFiles: status.ready ? (stats.tables && stats.tables.files ? Number(stats.tables.files) : 0) : 0,
    usingIndex: status.ready && status.indexed
  };
}

// ========================================================
// INTERNAL: Glob → SQL LIKE conversion
// ========================================================

function patternToLike(pattern) {
  var like = pattern;
  like = like.replace(/\*/g, '%');
  like = like.replace(/\?/g, '_');
  like = like.replace(/\./g, '.');
  like = like.replace(/^[.\\/]+/, '');
  if (!like.startsWith('%')) like = '%' + like;
  if (like.includes('.') && !like.endsWith('%')) like = like + '%';
  else if (!like.endsWith('%')) like = like + '%';
  return like;
}

// ========================================================
// INTERNAL: Filesystem fallback walk
// ========================================================

function globToRegex(pat) {
  var escaped = pat.replace(/[-[\]{}()+?.,\^$|#\s]/g, '\\$&');
  var wildcards = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + wildcards + '$', 'i');
}

async function walkFilesFallback(dir, regex, searchDir, matches) {
  try {
    var list = await fs.readdir(dir, { withFileTypes: true });
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var fullPath = path.resolve(dir, item.name);
      if (item.isDirectory()) {
        if (item.name === 'node_modules' || item.name === '.git' || item.name === '.venv' || item.name === '__pycache__') continue;
        if (item.name.startsWith('.')) continue;
        await walkFilesFallback(fullPath, regex, searchDir, matches);
      } else {
        if (regex.test(item.name)) {
          matches.push(path.relative(searchDir, fullPath));
        }
      }
    }
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }
}

async function runTouchFile(relPath) {
  try {
    await projectKnowledge.touchFile(relPath);
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }
}

async function fallbackWalk(pattern, rootDir, subDir) {
  var searchDir = subDir ? path.join(rootDir, subDir) : rootDir;
  var matches = [];
  var regex = globToRegex(pattern);

  if (existsSync(searchDir)) {
    await walkFilesFallback(searchDir, regex, searchDir, matches);
  }

  if (matches.length) {
    for (var m = 0; m < matches.length; m++) {
      var relPath = subDir ? path.join(subDir, matches[m]) : matches[m];
      runTouchFile(relPath);
    }
  }

  return matches;
}

// ========================================================
// INTERNAL: Filesystem fallback grep
// ========================================================

var GREP_BINARY_EXTS = {
  '.png':1,'.jpg':1,'.jpeg':1,'.gif':1,'.ico':1,'.svg':1,'.webp':1,
  '.bmp':1,'.mp3':1,'.mp4':1,'.wav':1,'.ogg':1,'.zip':1,'.tar':1,'.gz':1,
  '.rar':1,'.7z':1,'.pdf':1,'.doc':1,'.docx':1,'.xls':1,'.xlsx':1,
  '.exe':1,'.dll':1,'.so':1,'.dylib':1,'.wasm':1,'.o':1,'.a':1,'.lib':1,
  '.class':1,'.pyc':1,'.pyd':1,'.ttf':1,'.otf':1,'.woff':1,'.woff2':1,'.eot':1
};

function sortSearchResultsByMatches(a, b) {
  return b.matches - a.matches;
}

async function walkGrepFallback(dir, lowerQuery, rootDir, results) {
  try {
    var entries = await fs.readdir(dir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var fullPath = path.resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.venv' || entry.name.startsWith('.')) continue;
        await walkGrepFallback(fullPath, lowerQuery, rootDir, results);
      } else {
        var ext = path.extname(entry.name).toLowerCase();
        if (GREP_BINARY_EXTS[ext]) continue;
        try {
          var content = await fs.readFile(fullPath, 'utf-8');
          var lowerContent = content.toLowerCase();
          var idx = lowerContent.indexOf(lowerQuery);
          if (idx !== -1) {
            var start = Math.max(0, idx - 40);
            var end = Math.min(content.length, idx + lowerQuery.length + 40);
            var snippet = content.substring(start, end).replace(/\n/g, ' ');
            var relPath = path.relative(rootDir, fullPath);
            var matchesPattern = lowerQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            var matchesCount = (lowerContent.match(new RegExp(matchesPattern, 'g')) || []).length;
            results.push({
              path: relPath,
              matches: matchesCount,
              snippet: '...' + snippet + '...'
            });
          }
        } catch (_) {
          // Intentionally ignored to allow safe execution fallback
        }
      }
    }
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }
}

async function fallbackGrep(query, rootDir) {
  var results = [];
  var lowerQuery = query.toLowerCase();

  await walkGrepFallback(rootDir, lowerQuery, rootDir, results);
  results.sort(sortSearchResultsByMatches);
  return results.slice(0, 20);
}
