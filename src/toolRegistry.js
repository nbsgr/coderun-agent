// toolRegistry.js — Production-grade Unified Tool Registry
//
// SINGLE source of truth for all tools. Consolidates:
//   - Old toolRegistry.js (name→fn map)
//   - Old toolDefinitions.js (LLM schemas)
//   - Old toolExecutor.js (result formatting)
//
// Capabilities:
//   - Registration with full metadata (category, aliases, permissions, timeout)
//   - LLM function-calling schema generation (getDefinitions)
//   - Execution with alias resolution, validation, error wrapping
//   - Result formatting for LLM consumption
//   - Discovery: list(), get(), listByCategory()
//   - Pre-execution validation
//   - Middleware/interceptor hooks
//
// Tool Descriptor shape:
//   {
//     name:        'read_file',         // canonical name
//     aliases:     ['read'],             // alternative names
//     category:    'filesystem',         // group for discovery
//     description: '...',
//     parameters:  { file_path: { type: "string", ... } },
//     required:    ['file_path'],
//     handler:     async function*(args, context) { ... },
//     metadata: { dangerous, timeout, needsPermission, category }
//   }

var _tools = {};
var _aliasMap = {};
var _definitions = [];
var _dirty = true;
var _middleware = [];

// ═══════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════

export function register(descriptor) {
  if (!descriptor || !descriptor.name) throw new Error('[TR] Tool must have a name');
  if (!descriptor.handler) throw new Error('[TR] Tool ' + descriptor.name + ' must have a handler');

  var name = descriptor.name;
  if (_tools[name]) throw new Error('[TR] Tool "' + name + '" is already registered');

  if (!descriptor.metadata) descriptor.metadata = {};
  if (descriptor.metadata.dangerous === undefined) descriptor.metadata.dangerous = descriptor.dangerous || false;
  if (descriptor.metadata.needsPermission === undefined) descriptor.metadata.needsPermission = descriptor.metadata.dangerous;
  if (!descriptor.metadata.category) descriptor.metadata.category = descriptor.category || 'utility';
  if (!descriptor.metadata.timeout) descriptor.metadata.timeout = 30000;

  _tools[name] = descriptor;
  _aliasMap[name] = name;

  var aliases = descriptor.aliases || [];
  for (var i = 0; i < aliases.length; i++) {
    var alias = aliases[i];
    if (_aliasMap[alias] && _aliasMap[alias] !== name) {
      console.warn('[TR] Alias "' + alias + '" already maps to "' + _aliasMap[alias] + '" — skipping');
      continue;
    }
    _aliasMap[alias] = name;
  }

  _dirty = true;
  return true;
}

// ═══════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════

export function use(fn, priority) {
  priority = priority || 10;
  var entry = { fn: fn, priority: priority };
  _middleware.push(entry);
  _middleware.sort(function(a, b) { return a.priority - b.priority; });
  return function() {
    var idx = _middleware.indexOf(entry);
    if (idx !== -1) _middleware.splice(idx, 1);
  };
}

// ═══════════════════════════════════════════════════════════
// EXECUTION
// ═══════════════════════════════════════════════════════════

export function execute(name, args, context) {
  // Backward compat: if context is a string (workspace path), wrap to object
  if (typeof context === 'string') {
    context = { workspace: context };
  }
  context = context || {};
  args = args || {};

  var canonicalName = resolveAlias(name);
  if (!canonicalName) return notFoundGenerator(name);

  var tool = _tools[canonicalName];
  if (!tool) return notFoundGenerator(name);

  var validation = validate(canonicalName, args);
  if (!validation.valid) return validationErrorGenerator(canonicalName, validation.errors);

  return executeWithMiddleware(canonicalName, tool, args, context);
}

export function get(name) {
  var canonical = resolveAlias(name);
  return canonical ? _tools[canonical] : null;
}

export function has(name) {
  return !!resolveAlias(name);
}

export function list(category) {
  var names = Object.keys(_tools);
  if (category) return names.filter(function(n) { return _tools[n].metadata.category === category; });
  return names;
}

export function listCategories() {
  var cats = {};
  for (var name in _tools) {
    cats[_tools[name].metadata.category] = true;
  }
  return Object.keys(cats).sort();
}

export function listByCategory() {
  var grouped = {};
  for (var name in _tools) {
    var cat = _tools[name].metadata.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(name);
  }
  return grouped;
}

export function resolveAlias(name) {
  if (!name) return null;
  return _aliasMap[name] || (_aliasMap[name.toLowerCase ? name.toLowerCase() : name]) || null;
}

// ═══════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════

export function validate(name, args) {
  var tool = _tools[name];
  if (!tool) return { valid: false, errors: ['Tool not found: ' + name] };

  var errors = [];
  var required = tool.required || [];

  for (var i = 0; i < required.length; i++) {
    var key = required[i];
    var val = args[key];
    if (val === undefined || val === null || val === '') {
      errors.push('Missing required argument: ' + key);
    }
  }

  return { valid: errors.length === 0, errors: errors };
}

export function isDangerous(name) {
  var tool = get(name);
  return tool ? !!tool.metadata.dangerous : false;
}

export function needsPermission(name) {
  var tool = get(name);
  return tool ? !!tool.metadata.needsPermission : false;
}

// ═══════════════════════════════════════════════════════════
// LLM SCHEMAS
// ═══════════════════════════════════════════════════════════

export function getDefinitions() {
  if (_dirty) rebuildDefinitions();
  return _definitions;
}

export function getDefinition(name) {
  var canonical = resolveAlias(name);
  if (!canonical) return null;
  var tool = _tools[canonical];
  if (!tool) return null;
  return buildDefinition(tool);
}

function rebuildDefinitions() {
  _definitions = [];
  for (var name in _tools) {
    _definitions.push(buildDefinition(_tools[name]));
  }
  _dirty = false;
}

function buildDefinition(tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: {
        type: 'object',
        properties: tool.parameters || {},
        required: tool.required || []
      }
    }
  };
}

// ═══════════════════════════════════════════════════════════
// RESULT FORMATTING
// ═══════════════════════════════════════════════════════════

export function formatResult(toolName, result) {
  var tool = get(toolName);
  if (tool && tool.formatResult) return tool.formatResult(result);
  return defaultFormatResult(toolName, result);
}

export function formatToolCallsForHistory(toolCalls) {
  return toolCalls.map(function(tc) {
    return {
      id: tc.id || tc.function?.name || 'call_' + Date.now(),
      type: 'function',
      function: {
        name: tc.function?.name || tc.name,
        arguments: tc.function?.arguments || tc.arguments || {}
      }
    };
  });
}

function defaultFormatResult(toolName, result) {
  var res = result || {};
  var parts = ['Tool: ' + toolName];
  parts.push('Success: ' + (res.success !== false));
  if (res.status !== undefined && res.status !== 'completed' && res.status !== 'failed') {
    parts.push('Status: ' + res.status);
  }
  if (res.waiting_for_input === true || res.interactive === true) {
    parts.push('Interactive: ' + (res.interactive === true));
    parts.push('Waiting For Input: ' + (res.waiting_for_input === true));
    if (res.prompt_detected === true) parts.push('Prompt Detected: true');
  }
  if (res.content !== undefined) parts.push('Content:' + res.content);
  if (res.stdout !== undefined && res.stdout) parts.push('Stdout:\n' + res.stdout);
  if (res.output !== undefined) parts.push('Output:' + res.output);
  if (res.message !== undefined) parts.push('Message: ' + res.message);
  if (res.entries !== undefined) parts.push('Entries: ' + JSON.stringify(res.entries));
  if (res.matches !== undefined) parts.push('Matches: ' + JSON.stringify(res.matches));
  if (res.info !== undefined) parts.push('Info: ' + JSON.stringify(res.info));
  if (res.datetime !== undefined) parts.push('Datetime: ' + res.datetime);
  // Plan data: serialize structured plan for LLM to see IDs
  if (res.plan !== undefined && res.plan !== null) {
    var plan = res.plan;
    parts.push('Plan ID: ' + (plan.id || 'unknown'));
    parts.push('Goal: ' + (plan.goal || plan.summary || ''));
    parts.push('Status: ' + (plan.status || 'unknown'));
    parts.push('Complexity: ' + ((plan.complexity && plan.complexity.label) || 'unknown'));
    if (plan.phases && plan.phases.length) {
      parts.push('Phases:');
      for (var pi = 0; pi < plan.phases.length; pi++) {
        var ph = plan.phases[pi];
        parts.push('  Phase ' + (pi + 1) + ': ' + ph.name + ' [' + ph.status + ']');
        if (ph.tasks && ph.tasks.length) {
          for (var ti = 0; ti < ph.tasks.length; ti++) {
            var t = ph.tasks[ti];
            parts.push('    Task ' + t.id + ': ' + t.description + ' [' + t.status + ']' +
              (t.dependsOn && t.dependsOn.length ? ' (depends: ' + t.dependsOn.join(',') + ')' : '') +
              (t.parallelWith && t.parallelWith.length ? ' (parallel: ' + t.parallelWith.join(',') + ')' : ''));
          }
        }
      }
    }
    if (plan.executionGraph && plan.executionGraph.entryPoints) {
      parts.push('Entry Points: ' + plan.executionGraph.entryPoints.join(', '));
    }
    if (plan.executionGraph && plan.executionGraph.criticalPath) {
      parts.push('Critical Path: ' + plan.executionGraph.criticalPath.join(' -> '));
    }
  }
  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════
// INTERNAL
// ═══════════════════════════════════════════════════════════

function* notFoundGenerator(name) {
  console.warn('[TR] Tool not found: ' + name);
  yield {
    type: 'tool_result', tool: name, success: false,
    message: 'Tool "' + name + '" is not available. Available: ' + list().join(', ')
  };
}

function* validationErrorGenerator(name, errors) {
  yield {
    type: 'tool_result', tool: name, success: false,
    message: 'Validation failed: ' + errors.join('; ')
  };
}

function executeWithMiddleware(canonicalName, tool, args, context) {
  // Backward compat: handlers expect (args, workspaceString)
  var workspace = (typeof context === 'object' && context !== null) ? context.workspace : context;

  // No middleware — call handler directly
  if (!_middleware.length) {
    return tool.handler(args, workspace);
  }

  // Chain middleware — each mw fn: async function*(name, args, ctx, next)
  var executeFn = function(n, a, w) { return tool.handler(a, w); };

  for (var i = _middleware.length - 1; i >= 0; i--) {
    var mw = _middleware[i];
    var nextFn = executeFn;
    executeFn = function(mwf, nxt, n, a, w) {
      return mwf(n, a, { workspace: w }, function(on, oa, ow) {
        return nxt(on || n, oa || a, ow !== undefined ? ow : w);
      });
    }.bind(null, mw.fn, nextFn, canonicalName, args);
  }

  return executeFn(canonicalName, args, workspace);
}

export function clear() {
  _tools = {}; _aliasMap = {}; _definitions = []; _dirty = true; _middleware = [];
}

/**
 * Alias for clear() — backward compat with toolDefinitions consumers.
 */
export function clearDefinitions() {
  clear();
}

export function count() { return Object.keys(_tools).length; }

export function dump() {
  var out = {};
  for (var name in _tools) {
    var t = _tools[name];
    out[name] = {
      aliases: t.aliases || [],
      category: t.metadata.category,
      dangerous: t.metadata.dangerous,
      timeout: t.metadata.timeout,
      required: t.required || []
    };
  }
  return out;
}