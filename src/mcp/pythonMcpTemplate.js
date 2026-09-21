// pythonMcpTemplate.js — Isolated Python MCP Template definitions & UI markup for CodeRun
// Pure JavaScript module exporting template configurations across runtimes and vector assets.

export function getPythonSvgIcon() {
  return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none">' +
    '<path d="M11.914 2C9.28 2 7.64 3.16 7.64 5.37v2.49h4.36v.62H5.56C3.35 8.48 2 10.12 2 12.75c0 2.64 1.54 4.14 4.04 4.14h1.56v-2.18c0-2.49 1.7-4.36 4.36-4.36h4.35V7.86c0-2.21-1.78-5.86-4.4-5.86zm-1.25 1.56a.93.93 0 1 1 0 1.87.93.93 0 0 1 0-1.87z" fill="#387eb8"/>' +
    '<path d="M12.086 22c2.634 0 4.274-1.16 4.274-3.37v-2.49H12v-.62h6.44c2.21 0 3.56-1.64 3.56-4.27 0-2.64-1.54-4.14-4.04-4.14h-1.56v2.18c0 2.49-1.7 4.36-4.36 4.36H7.74v2.49c0 2.21 1.78 5.86 4.346 5.86zm1.25-1.56a.93.93 0 1 1 0-1.87.93.93 0 0 1 0 1.87z" fill="#ffe052"/>' +
  '</svg>';
}

export function getPythonTemplateCardHtml() {
  return '<div class="cr-mcp-template-card" data-template="python">' +
    '<div class="cr-mcp-template-icon">' +
      getPythonSvgIcon() +
    '</div>' +
    '<span class="cr-mcp-template-name">Python</span>' +
  '</div>';
}

export function getPythonTemplateValues() {
  return {
    name: 'python-server',
    command: 'python',
    args: '-u server.py',
    transport: 'stdio',
    tip: 'Runs isolated with automatic unbuffered output (PYTHONUNBUFFERED=1)'
  };
}

export function getMcpTemplateConfig(templateName, runtime) {
  var isPy = (runtime === 'python');
  var t = templateName ? String(templateName).toLowerCase() : 'custom';

  if (t === 'github') {
    return {
      name: 'github',
      command: isPy ? 'uvx' : 'npx',
      args: isPy ? 'mcp-server-github' : '-y @modelcontextprotocol/server-github',
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'your_token_here' }
    };
  }

  if (t === 'web-fetch') {
    return {
      name: 'web-fetch',
      command: isPy ? 'uvx' : 'npx',
      args: isPy ? 'mcp-server-fetch' : '-y @infoinlet/mcp-fetch',
      env: {}
    };
  }

  if (t === 'memory') {
    return {
      name: 'memory',
      command: isPy ? 'uvx' : 'npx',
      args: isPy ? 'mcp-server-memory' : '-y @modelcontextprotocol/server-memory',
      env: {}
    };
  }

  if (t === 'postgres') {
    return {
      name: 'postgres',
      command: isPy ? 'python' : 'npx',
      args: isPy ? '-u -m mcp_server_postgres postgresql://localhost/mydb' : '-y @modelcontextprotocol/server-postgres postgresql://localhost/mydb',
      env: {}
    };
  }

  if (t === 'mysql') {
    return {
      name: 'mysql',
      command: isPy ? 'python' : 'npx',
      args: isPy ? '-u -m mcp_server_mysql mysql://root:password@localhost:3306/mydb' : '-y @modelcontextprotocol/server-mysql mysql://root:password@localhost:3306/mydb',
      env: {}
    };
  }

  if (t === 'python') {
    return {
      name: 'python-server',
      command: 'python',
      args: '-u server.py',
      env: {}
    };
  }

  // Custom
  return {
    name: '',
    command: isPy ? 'python' : 'npx',
    args: isPy ? '-u server.py' : '',
    env: {}
  };
}
