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
  var lookupName = name;
  var mappedArgs = args || {};
  
  var lowerName = (name || '').toLowerCase();
  
  // Alias execute_command and bash to run_terminal for model compatibility
  if (lowerName === 'execute_command' || lowerName === 'bash') {
    lookupName = 'run_terminal';
    mappedArgs = {
      command: args.command || args.text || args.code || args.commandLine || args.cmd || '',
      timeout: args.timeout || 30,
      background: args.background || false
    };
  } else if (lowerName === 'read') {
    lookupName = 'read_file';
  } else if (lowerName === 'write') {
    lookupName = 'write_file';
  } else if (lowerName === 'edit') {
    lookupName = 'edit_file';
  }

  var fn = get(lookupName);
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
  return fn(mappedArgs, workspace);
}

export function clear() {
  registry = {};
}