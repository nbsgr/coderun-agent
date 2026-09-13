// mcpManager.js — Production-grade MCP Server Manager
// Manages MCP server configurations, lifecycles, and tool registration in toolRegistry.

import * as fs from 'fs/promises';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import * as toolRegistry from '../tools/toolRegistry.js';
import { createMcpClient } from './mcpClient.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var BUILTIN_FETCH_SERVER = path.join(__dirname, 'builtinServers', 'fetchServer.cjs');

var CONFIG_DIR = path.join(os.homedir(), '.coderun');
var CONFIG_FILE = path.join(CONFIG_DIR, 'mcp_servers.json');

var BUILTIN_SERVERS = {
  'web-fetch': {
    id: 'web-fetch',
    name: 'Web Fetcher',
    description: 'Fetch web pages, convert HTML to markdown, and extract content (100% Free)',
    transport: 'stdio',
    command: 'node',
    args: [BUILTIN_FETCH_SERVER],
    enabled: false,
    builtin: true,
    alwaysAllow: false,
    disabledTools: []
  },
  'memory': {
    id: 'memory',
    name: 'Memory Graph',
    description: 'Persistent knowledge graph memory across sessions and conversations (100% Free)',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    enabled: false,
    builtin: true,
    alwaysAllow: false,
    disabledTools: []
  },
  'puppeteer': {
    id: 'puppeteer',
    name: 'Puppeteer Browser',
    description: 'Headless browser automation, website navigation, and screenshots (100% Free)',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    enabled: false,
    builtin: true,
    alwaysAllow: false,
    disabledTools: []
  }
};

var activeClients = {}; // id -> client instance
var serverStatusMap = {}; // id -> status object { connected, error, tools, toolCount }
var isInitialized = false;

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    try {
      mkdirSync(CONFIG_DIR, { recursive: true });
    } catch (_) {
      // Intentionally ignore if directory creation already exists
    }
  }
}

export async function loadConfig() {
  ensureConfigDir();
  var parsed = { servers: {} };
  if (existsSync(CONFIG_FILE)) {
    try {
      var content = await fs.readFile(CONFIG_FILE, 'utf8');
      var loaded = JSON.parse(content);
      if (loaded && typeof loaded === 'object' && loaded.servers) {
        parsed = loaded;
      }
    } catch (err) {
      console.warn('[MCP MANAGER] Error loading config:', err.message);
    }
  }

  var modified = false;
  for (var bId in BUILTIN_SERVERS) {
    if (!parsed.servers[bId]) {
      parsed.servers[bId] = Object.assign({}, BUILTIN_SERVERS[bId]);
      modified = true;
    } else {
      parsed.servers[bId].builtin = true;
      if (!parsed.servers[bId].description && BUILTIN_SERVERS[bId].description) {
        parsed.servers[bId].description = BUILTIN_SERVERS[bId].description;
      }
      if (!parsed.servers[bId].disabledTools) {
        parsed.servers[bId].disabledTools = [];
      }
    }
  }

  if (parsed.servers['web-fetch'] && (parsed.servers['web-fetch'].command === 'uvx' || !parsed.servers['web-fetch'].args || parsed.servers['web-fetch'].args[0] === 'mcp-server-fetch')) {
    parsed.servers['web-fetch'].command = 'node';
    parsed.servers['web-fetch'].args = [BUILTIN_FETCH_SERVER];
    modified = true;
  }

  if (!parsed.disabledBuiltinTools) {
    parsed.disabledBuiltinTools = [];
  }
  toolRegistry.setDisabledBuiltinTools(parsed.disabledBuiltinTools);

  if (modified || !existsSync(CONFIG_FILE)) {
    try {
      await saveConfig(parsed);
    } catch (_) {}
  }

  return parsed;
}

export async function saveConfig(cfg) {
  ensureConfigDir();
  try {
    var data = JSON.stringify(cfg || { servers: {} }, null, 2);
    await fs.writeFile(CONFIG_FILE, data, 'utf8');
    return true;
  } catch (err) {
    console.warn('[MCP MANAGER] Error saving config:', err.message);
    return false;
  }
}

function formatMcpContent(result) {
  if (!result) return 'Done (no output)';
  if (typeof result === 'string') return result;
  if (Array.isArray(result.content)) {
    var out = [];
    for (var i = 0; i < result.content.length; i++) {
      var item = result.content[i];
      if (item && typeof item.text === 'string') {
        out.push(item.text);
      } else if (item && item.type === 'image') {
        out.push('[Image data: ' + (item.mimeType || 'binary') + ']');
      } else if (item && item.type === 'resource') {
        out.push('[Resource: ' + (item.resource && item.resource.uri ? item.resource.uri : 'unknown') + ']');
      } else {
        out.push(JSON.stringify(item));
      }
    }
    return out.join('\n');
  }
  return JSON.stringify(result, null, 2);
}

function createMcpHandler(client, rawToolName, serverId) {
  var namespacedName = 'mcp__' + serverId + '__' + rawToolName;
  async function* mcpToolGenerator(args, context) {
    var tcId = (context && context.toolCallId) || undefined;
    yield {
      type: 'action',
      action: namespacedName,
      tool: namespacedName,
      toolCallId: tcId,
      message: 'Invoking MCP tool "' + rawToolName + '" on server "' + serverId + '"',
      details: 'Invoking MCP tool "' + rawToolName + '" on server "' + serverId + '"'
    };

    try {
      var result = await client.callTool(rawToolName, args);
      var formatted = formatMcpContent(result);
      var isError = !!(result && result.isError);

      if (isError && formatted.indexOf('Could not find Chrome') !== -1) {
        formatted += '\n\nTip: CodeRun auto-detects installed Chrome, Edge, and Brave. If no Chromium browser is installed on your system, please run `npx puppeteer browsers install chrome` in a terminal to install one.';
      }

      yield {
        type: 'tool_result',
        tool: namespacedName,
        toolCallId: tcId,
        content: formatted,
        message: formatted,
        success: !isError
      };
    } catch (callErr) {
      var errText = callErr.message || String(callErr);
      if (errText.indexOf('Could not find Chrome') !== -1) {
        errText += '\n\nTip: CodeRun auto-detects installed Chrome, Edge, and Brave. If no Chromium browser is installed on your system, please run `npx puppeteer browsers install chrome` in a terminal to install one.';
      }
      yield {
        type: 'tool_result',
        tool: namespacedName,
        toolCallId: tcId,
        content: errText,
        message: errText,
        success: false
      };
    }
  }
  return mcpToolGenerator;
}

export async function registerServerTools(client, serverConfig) {
  var serverId = serverConfig.id || serverConfig.name;
  toolRegistry.unregisterMcpServer(serverId);

  var listResult = await client.listTools();
  var rawTools = (listResult && listResult.tools) || [];
  var discoveredTools = [];

  var alwaysAllow = !!serverConfig.alwaysAllow;
  var disabledMap = {};
  var disabledArr = serverConfig.disabledTools || [];
  for (var d = 0; d < disabledArr.length; d++) {
    disabledMap[disabledArr[d]] = true;
  }

  for (var i = 0; i < rawTools.length; i++) {
    var t = rawTools[i];
    var namespacedName = 'mcp__' + serverId + '__' + t.name;
    var inputSchema = t.inputSchema || {};
    var props = inputSchema.properties || {};
    var req = inputSchema.required || [];

    var toolDesc = '[' + (serverConfig.name || serverId) + '] ' + (t.description || '');
    var isToolDisabled = !!disabledMap[t.name];

    var descriptor = {
      name: namespacedName,
      aliases: [t.name, serverId + '_' + t.name, serverId + '__' + t.name],
      description: toolDesc,
      parameters: props,
      required: req,
      category: 'mcp',
      metadata: {
        category: 'mcp',
        mcpServer: serverId,
        dangerous: !alwaysAllow,
        needsPermission: !alwaysAllow
      },
      handler: createMcpHandler(client, t.name, serverId)
    };

    if (!isToolDisabled) {
      toolRegistry.register(descriptor);
    }

    discoveredTools.push({
      name: t.name,
      namespacedName: namespacedName,
      description: t.description || '',
      parameters: props,
      required: req,
      enabled: !isToolDisabled,
      descriptor: descriptor
    });
  }

  serverStatusMap[serverId] = {
    connected: true,
    error: null,
    tools: discoveredTools,
    toolCount: discoveredTools.length
  };

  return discoveredTools;
}

function findCoderunBrowserExecutable() {
  var browserDir = path.join(os.homedir(), '.coderun', 'browser');
  if (!existsSync(browserDir)) return '';

  function searchDir(dir, depth) {
    if (depth > 5) return '';
    try {
      var entries = readdirSync(dir, { withFileTypes: true });
      for (var i = 0; i < entries.length; i++) {
        var ent = entries[i];
        var full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          var found = searchDir(full, depth + 1);
          if (found) return found;
        } else if (ent.isFile()) {
          if (process.platform === 'win32' && (ent.name.toLowerCase() === 'chrome.exe' || ent.name.toLowerCase() === 'chromium.exe')) {
            return full;
          }
          if (process.platform !== 'win32' && (ent.name === 'chrome' || ent.name === 'chromium')) {
            return full;
          }
        }
      }
    } catch (_) {}
    return '';
  }

  return searchDir(browserDir, 0);
}

export function detectSystemBrowser() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // Check user-accessible local browser cache first
  var localBrowser = findCoderunBrowserExecutable();
  if (localBrowser) {
    return localBrowser;
  }

  var candidates = [];
  if (process.platform === 'win32') {
    candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
    ];
  } else if (process.platform === 'darwin') {
    candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ];
  } else {
    candidates = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/usr/bin/brave-browser',
      '/snap/bin/chromium'
    ];
  }
  for (var i = 0; i < candidates.length; i++) {
    if (existsSync(candidates[i])) {
      return candidates[i];
    }
  }
  return '';
}

var browserInstallPromise = null;

export function ensureLocalBrowserInstalled() {
  var existing = detectSystemBrowser();
  if (existing) {
    return Promise.resolve(existing);
  }

  if (browserInstallPromise) {
    return browserInstallPromise;
  }

  browserInstallPromise = new Promise(function setupBrowser(resolve) {
    var browserDir = path.join(os.homedir(), '.coderun', 'browser');
    try {
      if (!existsSync(browserDir)) {
        mkdirSync(browserDir, { recursive: true });
      }
    } catch (_) {}

    console.log('[MCP MANAGER] No system browser detected. Installing Chromium into ' + browserDir + ' in background...');
    var npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    var child = spawn(npxCmd, ['@puppeteer/browsers', 'install', 'chrome@stable', '--path', browserDir], {
      shell: true,
      stdio: 'ignore'
    });

    function onChildClose() {
      var installed = findCoderunBrowserExecutable();
      if (installed) {
        console.log('[MCP MANAGER] Successfully installed local Chromium to: ' + installed);
        resolve(installed);
      } else {
        console.warn('[MCP MANAGER] Local Chromium installation completed but executable not found.');
        resolve('');
      }
    }

    function onChildError(err) {
      console.warn('[MCP MANAGER] Failed to install local Chromium:', err.message);
      resolve('');
    }

    child.on('close', onChildClose);
    child.on('error', onChildError);
  });

  return browserInstallPromise;
}

export async function startServer(serverConfig) {
  var serverId = serverConfig.id || serverConfig.name;

  if (serverId === 'puppeteer') {
    serverConfig.env = serverConfig.env || {};
    if (!serverConfig.env.PUPPETEER_EXECUTABLE_PATH && !process.env.PUPPETEER_EXECUTABLE_PATH) {
      var detectedBrowser = detectSystemBrowser();
      if (detectedBrowser) {
        serverConfig.env.PUPPETEER_EXECUTABLE_PATH = detectedBrowser;
      }
    }
  }

  if (activeClients[serverId]) {
    try {
      activeClients[serverId].stop();
    } catch (_) {}
    delete activeClients[serverId];
  }

  var client = createMcpClient(serverConfig);
  activeClients[serverId] = client;

  try {
    serverStatusMap[serverId] = {
      connected: false,
      connecting: true,
      error: null,
      tools: [],
      toolCount: 0
    };

    await client.start();
    var tools = await registerServerTools(client, serverConfig);
    return { success: true, tools: tools };
  } catch (err) {
    serverStatusMap[serverId] = {
      connected: false,
      connecting: false,
      error: err.message || String(err),
      tools: [],
      toolCount: 0
    };
    return { success: false, error: err.message || String(err) };
  }
}

export function stopServer(serverId) {
  if (activeClients[serverId]) {
    try {
      activeClients[serverId].stop();
    } catch (_) {}
    delete activeClients[serverId];
  }
  toolRegistry.unregisterMcpServer(serverId);
  if (serverStatusMap[serverId]) {
    serverStatusMap[serverId].connected = false;
    serverStatusMap[serverId].connecting = false;
  }
}

export async function addServer(serverData) {
  if (!serverData || !serverData.name) {
    throw new Error('Server name is required');
  }

  var id = serverData.id || serverData.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  serverData.id = id;
  if (serverData.enabled === undefined) {
    serverData.enabled = true;
  }
  if (!serverData.disabledTools) {
    serverData.disabledTools = [];
  }

  var cfg = await loadConfig();
  cfg.servers[id] = serverData;
  await saveConfig(cfg);

  var result = await startServer(serverData);
  return {
    id: id,
    server: serverData,
    result: result
  };
}

export async function removeServer(serverId) {
  var cfg = await loadConfig();
  if (cfg.servers && cfg.servers[serverId] && cfg.servers[serverId].builtin) {
    throw new Error('Built-in server "' + serverId + '" cannot be removed. You can disable it instead.');
  }

  stopServer(serverId);
  delete serverStatusMap[serverId];

  if (cfg.servers && cfg.servers[serverId]) {
    delete cfg.servers[serverId];
    await saveConfig(cfg);
  }
  return true;
}

export async function toggleServer(serverId, enabled) {
  var cfg = await loadConfig();
  if (!cfg.servers || !cfg.servers[serverId]) {
    throw new Error('Server not found: ' + serverId);
  }

  cfg.servers[serverId].enabled = !!enabled;
  await saveConfig(cfg);

  if (enabled) {
    return await startServer(cfg.servers[serverId]);
  } else {
    stopServer(serverId);
    return { success: true, disabled: true };
  }
}

export async function toggleServerTool(serverId, toolName, enabled) {
  var cfg = await loadConfig();
  if (!cfg.servers || !cfg.servers[serverId]) {
    throw new Error('Server not found: ' + serverId);
  }

  var s = cfg.servers[serverId];
  s.disabledTools = s.disabledTools || [];

  if (enabled) {
    var newDisabled = [];
    for (var i = 0; i < s.disabledTools.length; i++) {
      if (s.disabledTools[i] !== toolName) {
        newDisabled.push(s.disabledTools[i]);
      }
    }
    s.disabledTools = newDisabled;
  } else {
    var exists = false;
    for (var j = 0; j < s.disabledTools.length; j++) {
      if (s.disabledTools[j] === toolName) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      s.disabledTools.push(toolName);
    }
  }

  await saveConfig(cfg);

  var status = serverStatusMap[serverId];
  var namespacedName = 'mcp__' + serverId + '__' + toolName;
  if (status && status.tools) {
    for (var k = 0; k < status.tools.length; k++) {
      if (status.tools[k].name === toolName) {
        status.tools[k].enabled = !!enabled;
        if (enabled) {
          if (status.tools[k].descriptor) {
            toolRegistry.register(status.tools[k].descriptor);
          }
        } else {
          toolRegistry.unregister(namespacedName);
        }
        break;
      }
    }
  }

  return { success: true, serverId: serverId, toolName: toolName, enabled: !!enabled };
}

export async function refreshServer(serverId) {
  var cfg = await loadConfig();
  if (!cfg.servers || !cfg.servers[serverId]) {
    throw new Error('Server not found: ' + serverId);
  }
  return await startServer(cfg.servers[serverId]);
}

export async function toggleBuiltinTool(toolName, enabled) {
  var cfg = await loadConfig();
  cfg.disabledBuiltinTools = cfg.disabledBuiltinTools || [];

  if (enabled) {
    var newArr = [];
    for (var i = 0; i < cfg.disabledBuiltinTools.length; i++) {
      if (cfg.disabledBuiltinTools[i] !== toolName) {
        newArr.push(cfg.disabledBuiltinTools[i]);
      }
    }
    cfg.disabledBuiltinTools = newArr;
  } else {
    var exists = false;
    for (var j = 0; j < cfg.disabledBuiltinTools.length; j++) {
      if (cfg.disabledBuiltinTools[j] === toolName) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      cfg.disabledBuiltinTools.push(toolName);
    }
  }

  await saveConfig(cfg);
  toolRegistry.setDisabledBuiltinTools(cfg.disabledBuiltinTools);
  return { success: true, toolName: toolName, enabled: !!enabled };
}

export async function toggleAllBuiltinTools(enabled) {
  var cfg = await loadConfig();
  if (enabled) {
    cfg.disabledBuiltinTools = [];
  } else {
    var allTools = toolRegistry.listBuiltinTools();
    var allNames = [];
    for (var i = 0; i < allTools.length; i++) {
      allNames.push(allTools[i].name);
    }
    cfg.disabledBuiltinTools = allNames;
  }
  await saveConfig(cfg);
  toolRegistry.setDisabledBuiltinTools(cfg.disabledBuiltinTools);
  return { success: true, enabled: !!enabled };
}

export function getBuiltinAgentTools() {
  return toolRegistry.listBuiltinTools();
}

export async function getServersSummary() {
  var cfg = await loadConfig();
  var servers = cfg.servers || {};
  var summary = [];

  for (var id in servers) {
    var s = servers[id];
    var status = serverStatusMap[id] || {
      connected: false,
      connecting: false,
      error: null,
      tools: [],
      toolCount: 0
    };

    var cleanTools = [];
    if (status.tools) {
      for (var ti = 0; ti < status.tools.length; ti++) {
        var tObj = status.tools[ti];
        cleanTools.push({
          name: tObj.name,
          namespacedName: tObj.namespacedName,
          description: tObj.description,
          parameters: tObj.parameters,
          required: tObj.required,
          enabled: tObj.enabled !== false
        });
      }
    }

    summary.push({
      id: id,
      name: s.name || id,
      description: s.description || '',
      builtin: !!s.builtin,
      transport: s.transport || 'stdio',
      command: s.command || '',
      args: s.args || [],
      url: s.url || '',
      env: s.env || {},
      enabled: s.enabled !== false,
      alwaysAllow: !!s.alwaysAllow,
      disabledTools: s.disabledTools || [],
      connected: status.connected,
      connecting: status.connecting || false,
      error: status.error,
      tools: cleanTools,
      toolCount: cleanTools.length
    });
  }

  return summary;
}

export async function initMcpManager() {
  if (isInitialized) return;
  isInitialized = true;

  var cfg = await loadConfig();
  var servers = cfg.servers || {};

  for (var id in servers) {
    var s = servers[id];
    if (s && s.enabled !== false) {
      startServer(s).catch(function onStartErr(err) {
        console.warn('[MCP MANAGER] Startup error for ' + id + ':', err.message);
      });
    }
  }
}

export function getMcpPromptContext() {
  var lines = [];
  for (var id in serverStatusMap) {
    var status = serverStatusMap[id];
    if (status && status.connected && status.tools && status.tools.length > 0) {
      lines.push('### MCP Server: ' + id);
      for (var i = 0; i < status.tools.length; i++) {
        var t = status.tools[i];
        if (t.enabled !== false) {
          lines.push('- `' + t.namespacedName + '`: ' + (t.description || t.name));
        }
      }
    }
  }
  return lines.join('\n');
}

export function stopAllServers() {
  for (var id in activeClients) {
    try {
      activeClients[id].stop();
    } catch (_) {}
    toolRegistry.unregisterMcpServer(id);
  }
  activeClients = {};
  serverStatusMap = {};
  isInitialized = false;
}
