// contextManager.js — Central intelligence layer for context gathering.
// Every user request passes through here before reaching the LLM.
//
// Workflow:  user message → ContextManager.gatherContext()
//              → intent analysis
//              → VS Code editor state
//              → SearchManager (if needed)
//              → projectKnowledge (metadata/stats)
//              → structured context → promptBuilder → LLM
//
// Future extensions:
//   - LLM-based intent classification
//   - Symbol-aware context retrieval
//   - Import graph traversal
//   - Diagnostic-aware context
//   - Learning-based relevance scoring

import * as vscode from 'vscode';
import * as path from 'path';
import * as projectKnowledge from './projectKnowledge.js';
import * as searchManager from './searchManager.js';
import * as planningManager from './planningManager.js';
import * as learningManager from './learningManager.js';
import * as timelineManager from './timelineManager.js';
import * as checkpointManager from './checkpointManager.js';

// ========================================================
// PUBLIC API
// ========================================================

/**
 * Gather context for a user prompt.
 * This is the ONLY function callers need.
 *
 * @param {string} userPrompt - The user's message
 * @param {string} workspace  - Absolute workspace path
 * @returns {Promise<ContextResult>} Structured context
 */
export async function gatherContext(userPrompt, workspace) {
  var intent = analyzeIntent(userPrompt);
  var editor = getEditorContext();
  var project = getProjectMetadata();
  var relevantFiles = [];
  var suggestedTools = [];

  // If intent requires exploration, search for relevant files
  if (intent.needsFiles && project.indexed) {
    relevantFiles = await searchRelevantFiles(userPrompt, workspace);
  }

  // Suggest tools based on intent
  suggestedTools = suggestTools(intent, project.indexed);

  // Build the knowledge object (backward-compatible with promptBuilder)
  var knowledge = buildKnowledge(project, editor, relevantFiles, intent);

  return {
    intent: intent,
    editor: editor,
    project: project,
    relevantFiles: relevantFiles,
    suggestedTools: suggestedTools,
    knowledge: knowledge
  };
}

// ========================================================
// INTENT ANALYSIS
// ========================================================

/**
 * Detect user intent from the prompt text.
 * Uses keyword matching — can be upgraded to LLM-based classification.
 * Returns { type, description, needsFiles, needsContent }.
 */
function analyzeIntent(prompt) {
  var lower = prompt.toLowerCase();

  // Code generation / creation
  if (lower.includes('create') || lower.includes('generate') || lower.includes('add') ||
      lower.includes('implement') || lower.includes('write') || lower.includes('new file') ||
      lower.includes('component') || lower.includes('function that')) {
    return {
      type: 'code_generation',
      description: 'User wants to generate or create new code',
      needsFiles: true,
      needsContent: false
    };
  }

  // Refactoring / modification
  if (lower.includes('refactor') || lower.includes('rename') || lower.includes('change') ||
      lower.includes('update') || lower.includes('fix') || lower.includes('modify') ||
      lower.includes('improve') || lower.includes('migrate') || lower.includes('convert')) {
    return {
      type: 'refactoring',
      description: 'User wants to modify existing code',
      needsFiles: true,
      needsContent: true
    };
  }

  // Debugging / troubleshooting
  if (lower.includes('debug') || lower.includes('error') || lower.includes('bug') ||
      lower.includes('issue') || lower.includes('not working') || lower.includes('failing') ||
      lower.includes('broken') || lower.includes('wrong') || lower.includes('incorrect')) {
    return {
      type: 'debugging',
      description: 'User wants to diagnose an issue',
      needsFiles: true,
      needsContent: true
    };
  }

  // Exploration / understanding
  if (lower.includes('what') || lower.includes('how') || lower.includes('explain') ||
      lower.includes('where') || lower.includes('find') || lower.includes('search') ||
      lower.includes('show me') || lower.includes('list') || lower.includes('tell me about') ||
      lower.includes('understand') || lower.includes('structure')) {
    return {
      type: 'exploration',
      description: 'User wants to understand the codebase',
      needsFiles: true,
      needsContent: true
    };
  }

  // Testing
  if (lower.includes('test') || lower.includes('coverage') || lower.includes('lint') ||
      lower.includes('validate') || lower.includes('verify') || lower.includes('check')) {
    return {
      type: 'testing',
      description: 'User wants to run or write tests',
      needsFiles: true,
      needsContent: false
    };
  }

  // Build / terminal
  if (lower.includes('build') || lower.includes('compile') || lower.includes('install') ||
      lower.includes('run') || lower.includes('deploy') || lower.includes('npm') ||
      lower.includes('gradle') || lower.includes('maven') || lower.includes('docker')) {
    return {
      type: 'build',
      description: 'User wants to build, install, or run commands',
      needsFiles: false,
      needsContent: false
    };
  }

  // General / knowledge
  if (lower.includes('compare') || lower.includes('difference') || lower.includes('vs ') ||
      lower.includes('versus') || lower.includes('best practice') || lower.includes('recommend') ||
      lower.includes('should i use')) {
    return {
      type: 'general',
      description: 'General knowledge or comparison question',
      needsFiles: false,
      needsContent: false
    };
  }

  // Default: exploration
  return {
    type: 'general',
    description: 'General user request',
    needsFiles: false,
    needsContent: false
  };
}

// ========================================================
// VS CODE EDITOR CONTEXT
// ========================================================

function getEditorContext() {
  var result = {
    activeFile: '',
    cursorLine: 0,
    cursorColumn: 0,
    selectedText: '',
    openEditors: []
  };

  try {
    // Active editor
    var editor = vscode.window.activeTextEditor;
    if (editor) {
      result.activeFile = editor.document.uri.fsPath || '';
      var selection = editor.selection;
      if (selection) {
        result.cursorLine = selection.active.line + 1;
        result.cursorColumn = selection.active.character + 1;
        if (!selection.isEmpty) {
          result.selectedText = editor.document.getText(selection);
        }
      }
    }

    // Open editors (tabs)
    var tabs = vscode.window.tabGroups ? vscode.window.tabGroups.all : [];
    var seen = {};
    for (var g = 0; g < tabs.length; g++) {
      var tabGroup = tabs[g];
      for (var t = 0; t < tabGroup.tabs.length; t++) {
        var tab = tabGroup.tabs[t];
        var input = tab.input;
        if (input && input.uri && input.uri.fsPath) {
          var fp = input.uri.fsPath;
          if (!seen[fp]) {
            seen[fp] = true;
            result.openEditors.push(fp);
          }
        }
      }
    }
  } catch (_) {}

  return result;
}

// ========================================================
// PROJECT METADATA
// ========================================================

function getProjectMetadata() {
  var meta = projectKnowledge.getProjectMetadata();
  var status = projectKnowledge.getIndexStatus ? projectKnowledge.getIndexStatus() : { ready: false, indexed: false };
  var stats = projectKnowledge.getStats();
  return {
    name: meta ? meta.name : 'unknown',
    path: meta ? meta.path : '',
    fileCount: stats.tables && stats.tables.files ? Number(stats.tables.files) : 0,
    ready: status.ready,
    indexed: status.indexed
  };
}

// ========================================================
// RELEVANT FILE SEARCH
// ========================================================

/**
 * Find files that are likely relevant to the user's query.
 * Extracts keywords from the prompt and searches the index.
 */
async function searchRelevantFiles(prompt, workspace) {
  var relevant = [];

  // Extract important keywords (skip common words)
  var keywords = extractKeywords(prompt);
  if (!keywords.length) return [];

  // Search for each keyword, collect results
  var seen = {};
  var maxResults = 10;

  for (var k = 0; k < keywords.length && relevant.length < maxResults; k++) {
    try {
      var results = projectKnowledge.searchByGlob('%' + keywords[k] + '%', '');
      if (results && results.length) {
        for (var r = 0; r < results.length; r++) {
          if (!seen[results[r]]) {
            seen[results[r]] = true;
            relevant.push(results[r]);
            if (relevant.length >= maxResults) break;
          }
        }
      }
    } catch (_) {}

    // Also try content search if we need more files
    if (relevant.length < 3) {
      try {
        var contentResults = projectKnowledge.searchChunks(keywords[k]);
        if (contentResults && contentResults.length) {
          for (var cr = 0; cr < contentResults.length; cr++) {
            if (!seen[contentResults[cr].path]) {
              seen[contentResults[cr].path] = true;
              relevant.push(contentResults[cr].path);
              if (relevant.length >= maxResults) break;
            }
          }
        }
      } catch (_) {}
    }
  }

  return relevant.slice(0, maxResults);
}

/**
 * Extract meaningful keywords from a prompt.
 * Filters out stop words and short tokens.
 */
function extractKeywords(text) {
  var words = text.toLowerCase().split(/[^a-zA-Z0-9_]+/).filter(Boolean);
  var STOP_WORDS = {
    'the':1,'a':1,'an':1,'is':1,'are':1,'was':1,'were':1,'be':1,'been':1,
    'being':1,'have':1,'has':1,'had':1,'do':1,'does':1,'did':1,'will':1,
    'would':1,'could':1,'should':1,'may':1,'might':1,'can':1,'shall':1,
    'to':1,'of':1,'in':1,'for':1,'on':1,'with':1,'at':1,'by':1,'from':1,
    'as':1,'into':1,'through':1,'during':1,'before':1,'after':1,'above':1,
    'below':1,'up':1,'down':1,'out':1,'off':1,'over':1,'under':1,'again':1,
    'further':1,'then':1,'once':1,'here':1,'there':1,'when':1,'where':1,
    'why':1,'how':1,'all':'1','each':1,'every':1,'both':1,'few':1,'more':1,
    'most':1,'other':1,'some':1,'such':1,'no':1,'nor':1,'not':1,'only':1,
    'own':1,'same':1,'so':1,'than':1,'too':1,'very':1,'just':1,'also':1,
    'because':1,'but':1,'and':1,'or':1,'if':1,'while':1,'that':1,'this':1,
    'these':1,'those':1,'it':1,'its':1,'my':1,'your':1,'our':1,'their':1,
    'me':1,'you':1,'we':1,'they':1,'he':1,'she':1,'him':1,'her':1,'them':1,
    'about':1,'which':1,'who':1,'what':1,'please':1,'help':1,'need':1,'want':1,
    'like':1,'make':1,'get':1,'use':1,'using':1,'used':1,'see':1,'look':1,
    'tell':1,'let':1,'know':1,'think':1,'try':1,'going':1,'go':1,'come':1,
    'take':1,'give':1,'find':1,'new':1,'any':1,'something':1,'thing':1,
    'file':1,'code':1,'function':1,'class':1,'method':1,'variable':1,
    'project':1,'workspace':1,'folder':1,'directory':1
  };

  var result = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (w.length < 3) continue;
    if (w.length > 30) continue;
    if (STOP_WORDS[w]) continue;
    // Skip pure numbers
    if (/^\d+$/.test(w)) continue;
    result.push(w);
  }

  // Remove duplicates, keep max 5
  var unique = [];
  var seen = {};
  for (var j = 0; j < result.length && unique.length < 5; j++) {
    if (!seen[result[j]]) {
      seen[result[j]] = true;
      unique.push(result[j]);
    }
  }

  return unique;
}

// ========================================================
// TOOL SUGGESTIONS
// ========================================================

function suggestTools(intent, isIndexed) {
  var tools = [];

  if (intent.needsFiles && isIndexed) {
    tools.push('search_files (use the project index)');
    tools.push('find_in_files (search file contents)');
  }

  if (intent.needsFiles && !isIndexed) {
    tools.push('search_files (filesystem fallback — index not yet ready)');
    tools.push('list_directory (explore project structure)');
  }

  if (intent.type === 'build') {
    tools.push('run_terminal');
  }

  if (intent.type === 'testing') {
    tools.push('run_terminal');
    tools.push('find_in_files (find test files)');
  }

  return tools;
}

// ========================================================
// KNOWLEDGE OBJECT BUILDER
// ========================================================

/**
 * Build the knowledge object consumed by promptBuilder.
 * This ensures backward compatibility with the existing promptBuilder API.
 */
function buildKnowledge(project, editor, relevantFiles, intent) {
  var knowledge = {};

  // Project metadata
  knowledge.projectMetadata = {
    name: project.name,
    path: project.path || '',
    fileCount: project.fileCount,
    ready: project.ready
  };

  knowledge.fileCount = project.fileCount;
  knowledge.fileContext = project.indexed;

  // Relevant files section
  if (relevantFiles && relevantFiles.length) {
    knowledge.relevantFiles = relevantFiles;
  }

  // Editor context (new)
  if (editor.activeFile) {
    var editorLines = ['## OPEN EDITOR'];
    editorLines.push('- Active file: ' + editor.activeFile);
    editorLines.push('- Cursor: line ' + editor.cursorLine + ', column ' + editor.cursorColumn);

    if (editor.selectedText) {
      var selPreview = editor.selectedText.substring(0, 200);
      editorLines.push('- Selected text: "' + selPreview + '"');
    }

    if (editor.openEditors && editor.openEditors.length > 1) {
      editorLines.push('- Open tabs:');
      for (var e = 0; e < editor.openEditors.length; e++) {
        editorLines.push('  - ' + editor.openEditors[e]);
      }
    }

    knowledge.editorContext = editorLines.join('\n');
  }

  // Intent context (new)
  var intentLines = ['## INTENT ANALYSIS'];
  intentLines.push('- Type: ' + intent.type);
  intentLines.push('- Description: ' + intent.description);
  if (intent.needsFiles) {
    intentLines.push('- The user likely needs to work with specific files');
  }
  if (intent.needsContent) {
    intentLines.push('- The user likely needs to understand or modify code contents');
  }
  knowledge.intentContext = intentLines.join('\n');

  // Suggested tools
  var suggestedToolsList = suggestTools(intent, project.indexed);
  if (suggestedToolsList.length) {
    var toolLines = ['## SUGGESTED TOOLS'];
    for (var t = 0; t < suggestedToolsList.length; t++) {
      toolLines.push('- ' + suggestedToolsList[t]);
    }
    knowledge.suggestedTools = toolLines.join('\n');
  }

  // Active plans context (from Planning Engine)
  try {
    var planContext = planningManager.getActivePlansContext();
    if (planContext) {
      knowledge.activePlans = planContext;
    }
  } catch (_) {}

  // Learning context (from Learning Engine)
  try {
    var learningContext = learningManager.getLearningContext();
    if (learningContext) {
      knowledge.learningContext = learningContext;
    }
  } catch (_) {}

  // Trigger learning initialization in background (idempotent — runs once)
  try {
    var meta = projectKnowledge.getProjectMetadata();
    if (meta && meta.path) {
      learningManager.initialize(meta.path);
    }
  } catch (_) {}

  // Timeline context (from Timeline Engine)
  try {
    var timelineCtx = timelineManager.getRecentContext(6);
    if (timelineCtx) {
      knowledge.timeline = timelineCtx;
    }
  } catch (_) {
    knowledge.timeline = '';
  }

  // Checkpoint context (from Checkpoint Engine)
  try {
    var cpCtx = checkpointManager.getCheckpointContext(3);
    if (cpCtx) {
      knowledge.checkpointContext = cpCtx;
    }
  } catch (_) {}

  // Stubs for future phases (empty strings — backward compatible)
  knowledge.projectMemory = '';
  knowledge.dependencyGraph = '';

  return knowledge;
}
