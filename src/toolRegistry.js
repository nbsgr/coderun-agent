// toolRegistry.js — Maps tool names to their implementations

var registry = {};

export function register(name, fn) {
  registry[name] = fn;
}

export function get(name) {
  return registry[name] || null;
}

export function has(name) {
  return !!registry[name];
}

export function list() {
  return Object.keys(registry);
}

export function execute(name, args, workspace) {
  var fn = get(name);
  if (!fn) {
    return (async function*() {
      yield {
        type: 'tool_result',
        tool: name,
        success: false,
        message: 'Tool ' + name + ' is not implemented.'
      };
    })();
  }
  return fn(args, workspace);
}

export function clear() {
  registry = {};
}