// toolRegistry.js — Production-grade Unified Tool Registry
//
// SINGLE source of truth for all tools. Consolidates:
//   - Old toolRegistry.js (name→fn map)
//   - Old toolDefinitions.js (LLM schemas)
//   - Old toolExecutor.js (result formatting)

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
  if (descriptor.metadata.hidden === undefined) descriptor.metadata.hidden = descriptor.hidden || false;
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

function sortMiddleware(a, b) {
  return a.priority - b.priority;
}

function removeMiddleware(entry) {
  var idx = _middleware.indexOf(entry);
  if (idx !== -1) _middleware.splice(idx, 1);
}

export function use(fn, priority) {
  priority = priority || 10;
  var entry = { fn: fn, priority: priority };
  _middleware.push(entry);
  _middleware.sort(sortMiddleware);
  function unsubscribe() {
    removeMiddleware(entry);
  }
  return unsubscribe;
}

// ═══════════════════════════════════════════════════════════
// EXECUTION
// ═══════════════════════════════════════════════════════════

export function execute(name, args, context) {
  if (typeof context === 'string') {
    context = { workspace: context };
  }
  context = context || {};
  args = args || {};

  var canonicalName = resolveAlias(name);
  if (!canonicalName) return notFoundGenerator(name);

  var tool = _tools[canonicalName];
  if (!tool) return notFoundGenerator(name);

  if (tool.hidden || (tool.metadata && (tool.metadata.hidden || tool.metadata.internalOnly))) {
    if (!context.allowInternal) {
      return validationErrorGenerator(canonicalName, ['Tool ' + canonicalName + ' is internal and cannot be invoked as an agent tool call.']);
    }
  }

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
  if (category) {
    var filtered = [];
    for (var i = 0; i < names.length; i++) {
      if (_tools[names[i]].metadata.category === category) {
        filtered.push(names[i]);
      }
    }
    return filtered;
  }
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
  var schemaParams = tool.parameters || {};

  for (var i = 0; i < required.length; i++) {
    var key = required[i];
    var val = args[key];
    if (val === undefined || val === null || val === '') {
      errors.push('Missing required argument: ' + key);
    }
  }

  for (var paramKey in schemaParams) {
    var paramVal = args[paramKey];
    if (paramVal !== undefined && paramVal !== null) {
      var expectedType = schemaParams[paramKey].type;
      if (expectedType === 'string' && typeof paramVal !== 'string') {
        errors.push("Invalid type for parameter '" + paramKey + "': expected string, got " + typeof paramVal);
      } else if (expectedType === 'integer') {
        if (typeof paramVal !== 'number' || !Number.isInteger(paramVal)) {
          errors.push("Invalid type for parameter '" + paramKey + "': expected integer, got " + (typeof paramVal === 'number' ? 'decimal' : typeof paramVal));
        }
      } else if (expectedType === 'number') {
        if (typeof paramVal !== 'number' || isNaN(paramVal)) {
          errors.push("Invalid type for parameter '" + paramKey + "': expected number, got " + typeof paramVal);
        }
      } else if (expectedType === 'boolean' && typeof paramVal !== 'boolean') {
        errors.push("Invalid type for parameter '" + paramKey + "': expected boolean, got " + typeof paramVal);
      } else if (expectedType === 'array') {
        if (!Array.isArray(paramVal)) {
          errors.push("Invalid type for parameter '" + paramKey + "': expected array, got " + typeof paramVal);
        } else if (schemaParams[paramKey].items) {
          var itemSchema = schemaParams[paramKey].items;
          for (var ai = 0; ai < paramVal.length; ai++) {
            var itemVal = paramVal[ai];
            if (itemSchema.type === 'object') {
              if (typeof itemVal !== 'object' || itemVal === null || Array.isArray(itemVal)) {
                errors.push("Invalid item type at index " + ai + " in '" + paramKey + "': expected object, got " + (itemVal === null ? 'null' : typeof itemVal));
              } else if (itemSchema.required) {
                for (var ri = 0; ri < itemSchema.required.length; ri++) {
                  var reqProp = itemSchema.required[ri];
                  if (itemVal[reqProp] === undefined || itemVal[reqProp] === null) {
                    errors.push("Missing required field '" + reqProp + "' in item #" + (ai + 1) + " of '" + paramKey + "'");
                  }
                }
              }
            }
          }
        }
      } else if (expectedType === 'object' && (typeof paramVal !== 'object' || Array.isArray(paramVal))) {
        errors.push("Invalid type for parameter '" + paramKey + "': expected object, got " + typeof paramVal);
      }
    }
  }

  return { valid: errors.length === 0, errors: errors, error: errors.join('; ') };
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
    if (_tools[name].metadata && _tools[name].metadata.hidden) {
      continue;
    }
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
  var formatted = [];
  for (var i = 0; i < toolCalls.length; i++) {
    var tc = toolCalls[i];
    formatted.push({
      id: tc.id || tc.function?.name || 'call_' + Date.now(),
      type: 'function',
      function: {
        name: tc.function?.name || tc.name,
        arguments: tc.function?.arguments || tc.arguments || {}
      }
    });
  }
  return formatted;
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

  if (res.plan !== undefined && res.plan !== null) {
    var plan = res.plan;
    if (typeof plan === 'string') {
      parts.push('Plan:\n' + plan);
    } else {
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

function createNextBound(nxt, n, a, w) {
  function nextBound(on, oa, ow) {
    return nxt(on || n, oa || a, ow !== undefined ? ow : w);
  }
  return nextBound;
}

function executeMiddlewareStep(mwf, nxt, n, a, w) {
  var nextBound = createNextBound(nxt, n, a, w);
  return mwf(n, a, { workspace: w }, nextBound);
}

function createToolExecutor(tool) {
  function toolExecutor(n, a, w) {
    return tool.handler(a, w);
  }
  return toolExecutor;
}

function wrapMiddlewareStep(mwf, nxt) {
  function wrapped(n, a, w) {
    return executeMiddlewareStep(mwf, nxt, n, a, w);
  }
  return wrapped;
}

function executeWithMiddleware(canonicalName, tool, args, context) {
  var workspace = (typeof context === 'object' && context !== null) ? context.workspace : context;

  if (!_middleware.length) {
    return tool.handler(args, workspace);
  }

  var executeFn = createToolExecutor(tool);

  for (var i = _middleware.length - 1; i >= 0; i--) {
    var mw = _middleware[i];
    executeFn = wrapMiddlewareStep(mw.fn, executeFn);
  }

  return executeFn(canonicalName, args, workspace);
}

export function clear() {
  _tools = {}; _aliasMap = {}; _definitions = []; _dirty = true; _middleware = [];
}

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