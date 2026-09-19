// mcpClient.js — Production-grade Model Context Protocol (MCP) Client
// Communicates with MCP servers via JSON-RPC 2.0 over stdio or SSE/HTTP.

import * as child_process from 'child_process';
import * as readline from 'readline';
import * as http from 'http';

function noopRequestCallback() {}
import * as https from 'https';
import { URL } from 'url';

function parseJsonSafe(str) {
  try {
    return JSON.parse(str);
  } catch (_) {
    return null;
  }
}

export function createMcpClient(serverConfig) {
  var config = serverConfig || {};
  var serverName = config.name || config.id || 'unnamed-server';
  var transport = config.transport || 'stdio';

  var proc = null;
  var readlineInterface = null;
  var nextRequestId = 1;
  var pendingRequests = {};
  var stderrBuffer = [];
  var isConnected = false;
  var serverCapabilities = null;
  var sseReq = null;
  var sseMessageEndpoint = null;

  function recordStderr(data) {
    if (!data) return;
    var text = String(data).trim();
    if (!text) return;
    stderrBuffer.push(text);
    if (stderrBuffer.length > 30) {
      stderrBuffer.shift();
    }
  }

  function getRecentStderr() {
    return stderrBuffer.join('\n');
  }

  function handleServerLine(line) {
    var trimmed = String(line || '').trim();
    if (!trimmed) return;

    var msg = parseJsonSafe(trimmed);
    if (!msg || typeof msg !== 'object') return;

    if (msg.id !== undefined && pendingRequests[msg.id]) {
      var req = pendingRequests[msg.id];
      delete pendingRequests[msg.id];
      if (req.timer) {
        clearTimeout(req.timer);
      }

      if (msg.error) {
        var errMsg = msg.error.message || 'MCP error ' + (msg.error.code || '');
        req.reject(new Error(errMsg));
      } else {
        req.resolve(msg.result);
      }
    }
  }

  function handleProcessExit(code, signal) {
    isConnected = false;
    var exitReason = 'MCP server "' + serverName + '" exited with code ' + code + ' (signal: ' + signal + ')';
    var recentErrors = getRecentStderr();
    if (recentErrors) {
      exitReason += '\nProcess stderr:\n' + recentErrors;
    }

    var keys = Object.keys(pendingRequests);
    for (var i = 0; i < keys.length; i++) {
      var req = pendingRequests[keys[i]];
      if (req.timer) clearTimeout(req.timer);
      req.reject(new Error(exitReason));
    }
    pendingRequests = {};
  }

  function handleProcessError(err) {
    isConnected = false;
    var errorMsg = 'MCP server process error [' + serverName + ']: ' + (err.message || String(err));
    var keys = Object.keys(pendingRequests);
    for (var i = 0; i < keys.length; i++) {
      var req = pendingRequests[keys[i]];
      if (req.timer) clearTimeout(req.timer);
      req.reject(new Error(errorMsg));
    }
    pendingRequests = {};
  }

  function sendRpcRequest(method, params, timeoutMs) {
    timeoutMs = timeoutMs || 45000;

    function requestExecutor(resolve, reject) {
      if (transport === 'stdio') {
        if (!proc || !proc.stdin || !proc.stdin.writable) {
          reject(new Error('MCP server "' + serverName + '" is not running or stdin is closed'));
          return;
        }

        var id = nextRequestId++;
        var payload = JSON.stringify({
          jsonrpc: '2.0',
          id: id,
          method: method,
          params: params || {}
        }) + '\n';

        var timer = setTimeout(function onRpcTimeout() {
          if (pendingRequests[id]) {
            delete pendingRequests[id];
            var details = getRecentStderr();
            reject(new Error('MCP request "' + method + '" to "' + serverName + '" timed out after ' + timeoutMs + 'ms' + (details ? '\nStderr: ' + details : '')));
          }
        }, timeoutMs);

        pendingRequests[id] = { resolve: resolve, reject: reject, timer: timer };
        proc.stdin.write(payload);
      } else if (transport === 'sse' || transport === 'http') {
        sendHttpRequest(method, params, timeoutMs, resolve, reject);
      } else {
        reject(new Error('Unsupported MCP transport: ' + transport));
      }
    }

    return new Promise(requestExecutor);
  }

  function sendRpcNotification(method, params) {
    if (transport === 'stdio') {
      if (!proc || !proc.stdin || !proc.stdin.writable) return;
      var payload = JSON.stringify({
        jsonrpc: '2.0',
        method: method,
        params: params || {}
      }) + '\n';
      proc.stdin.write(payload);
    } else if (transport === 'sse' || transport === 'http') {
      sendHttpRequest(method, params, 10000, noopRequestCallback, noopRequestCallback);
    }
  }

  function sendHttpRequest(method, params, timeoutMs, resolve, reject) {
    var targetUrl = (transport === 'http') ? config.url : (sseMessageEndpoint || config.url);
    if (!targetUrl) {
      reject(new Error('No URL specified for MCP HTTP/SSE transport'));
      return;
    }

    var id = nextRequestId++;
    var postData = JSON.stringify({
      jsonrpc: '2.0',
      id: id,
      method: method,
      params: params || {}
    });

    var parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (parseErr) {
      reject(new Error('Invalid MCP URL: ' + targetUrl + ' (' + parseErr.message + ')'));
      return;
    }

    var isHttps = parsedUrl.protocol === 'https:';
    var clientLib = isHttps ? https : http;

    var reqHeaders = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    };

    if (config.headers) {
      for (var h in config.headers) {
        reqHeaders[h] = config.headers[h];
      }
    }

    var reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: reqHeaders,
      timeout: timeoutMs
    };

    var req = clientLib.request(reqOptions, function handleResponse(res) {
      var chunks = [];
      res.on('data', function handleChunk(chunk) {
        chunks.push(chunk);
      });

      res.on('end', function handleEnd() {
        var body = Buffer.concat(chunks).toString('utf8');
        var parsed = parseJsonSafe(body);
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error('MCP server returned HTTP ' + res.statusCode + ': ' + body));
          return;
        }

        if (parsed && typeof parsed === 'object') {
          if (parsed.error) {
            reject(new Error(parsed.error.message || 'MCP Error'));
          } else {
            resolve(parsed.result !== undefined ? parsed.result : parsed);
          }
        } else {
          resolve(body);
        }
      });
    });

    req.on('timeout', function handleTimeout() {
      req.destroy();
      reject(new Error('MCP HTTP request to "' + serverName + '" timed out'));
    });

    req.on('error', function handleError(err) {
      reject(err);
    });

    req.write(postData);
    req.end();
  }

  function startStdio() {
    function stdioPromise(resolve, reject) {
      try {
        var cmd = config.command;
        if (!cmd) {
          reject(new Error('No command specified for stdio MCP server "' + serverName + '"'));
          return;
        }

        var rawArgs = config.args || [];
        var args = Array.isArray(rawArgs) ? rawArgs : [String(rawArgs)];

        var mergedEnv = Object.assign({}, process.env, config.env || {});

        var isWin = process.platform === 'win32';
        var useShell = false;
        if (isWin && (cmd === 'npx' || cmd === 'npm' || cmd === 'yarn' || cmd === 'pnpm' || cmd === 'uvx')) {
          useShell = true;
        }

        proc = child_process.spawn(cmd, args, {
          env: mergedEnv,
          shell: useShell,
          windowsHide: true
        });

        proc.stderr.on('data', recordStderr);
        proc.on('error', handleProcessError);
        proc.on('exit', handleProcessExit);

        readlineInterface = readline.createInterface({
          input: proc.stdout,
          terminal: false
        });

        readlineInterface.on('line', handleServerLine);

        // Perform MCP Protocol Handshake
        sendRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'CodeRun-Agent',
            version: '1.5.8'
          }
        }, 30000).then(function onInitSuccess(initResult) {
          isConnected = true;
          serverCapabilities = initResult ? initResult.capabilities : null;

          // Send initialized notification as required by MCP spec
          sendRpcNotification('notifications/initialized', {});
          resolve(initResult);
        }).catch(function onInitFail(err) {
          isConnected = false;
          var stderrOutput = getRecentStderr();
          var fullErr = 'Failed to initialize MCP server "' + serverName + '": ' + (err.message || String(err));
          if (stderrOutput) {
            fullErr += '\nStderr output:\n' + stderrOutput;
          }
          stop();
          reject(new Error(fullErr));
        });
      } catch (err) {
        reject(err);
      }
    }

    return new Promise(stdioPromise);
  }

  function startSse() {
    function ssePromise(resolve, reject) {
      var sseUrl = config.url;
      if (!sseUrl) {
        reject(new Error('No URL specified for SSE MCP server "' + serverName + '"'));
        return;
      }

      var parsedUrl;
      try {
        parsedUrl = new URL(sseUrl);
      } catch (err) {
        reject(new Error('Invalid SSE URL for "' + serverName + '": ' + err.message));
        return;
      }

      var isHttps = parsedUrl.protocol === 'https:';
      var clientLib = isHttps ? https : http;

      var reqHeaders = {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache'
      };

      if (config.headers) {
        for (var h in config.headers) {
          reqHeaders[h] = config.headers[h];
        }
      }

      var reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: reqHeaders
      };

      sseReq = clientLib.request(reqOptions, function handleSseResponse(res) {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error('SSE endpoint returned HTTP ' + res.statusCode));
          return;
        }

        isConnected = true;
        var sseBuffer = '';

        res.on('data', function handleSseChunk(chunk) {
          sseBuffer += chunk.toString('utf8');
          var lines = sseBuffer.split('\n');
          sseBuffer = lines.pop(); // Keep partial line in buffer

          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.startsWith('event: endpoint')) {
              // Wait for data line
            } else if (line.startsWith('data:')) {
              var dataContent = line.slice(5).trim();
              if (dataContent.startsWith('/') || dataContent.startsWith('http')) {
                // Endpoint event payload
                if (dataContent.startsWith('http')) {
                  sseMessageEndpoint = dataContent;
                } else {
                  sseMessageEndpoint = parsedUrl.origin + dataContent;
                }
              } else {
                handleServerLine(dataContent);
              }
            }
          }
        });

        res.on('end', function handleSseEnd() {
          isConnected = false;
        });

        res.on('error', function handleSseErr(err) {
          isConnected = false;
          recordStderr(err.message);
        });

        // Send MCP initialize over HTTP
        sendRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'CodeRun-Agent',
            version: '1.5.8'
          }
        }, 30000).then(function onSseInitSuccess(initResult) {
          serverCapabilities = initResult ? initResult.capabilities : null;
          sendRpcNotification('notifications/initialized', {});
          resolve(initResult);
        }).catch(function onSseInitFail(err) {
          isConnected = false;
          stop();
          reject(err);
        });
      });

      sseReq.on('error', function handleInitialReqError(err) {
        reject(err);
      });

      sseReq.end();
    }

    return new Promise(ssePromise);
  }

  function startHttp() {
    function httpPromise(resolve, reject) {
      var httpUrl = config.url;
      if (!httpUrl) {
        reject(new Error('No URL specified for HTTP MCP server "' + serverName + '"'));
        return;
      }
      try {
        new URL(httpUrl);
      } catch (err) {
        reject(new Error('Invalid HTTP URL for "' + serverName + '": ' + err.message));
        return;
      }
      isConnected = true;
      resolve();
    }
    return new Promise(httpPromise);
  }

  function start() {
    stderrBuffer = [];
    if (transport === 'stdio') {
      return startStdio();
    } else if (transport === 'sse') {
      return startSse();
    } else if (transport === 'http') {
      return startHttp();
    }
    return Promise.reject(new Error('Unknown transport: ' + transport));
  }

  function listTools() {
    return sendRpcRequest('tools/list', {}, 30000);
  }

  function callTool(toolName, args) {
    return sendRpcRequest('tools/call', {
      name: toolName,
      arguments: args || {}
    }, 60000);
  }

  function stop() {
    isConnected = false;
    if (readlineInterface) {
      try {
        readlineInterface.close();
      } catch (_) {}
      readlineInterface = null;
    }

    if (proc) {
      try {
        proc.stdin.end();
        proc.kill();
      } catch (_) {}
      proc = null;
    }

    if (sseReq) {
      try {
        sseReq.destroy();
      } catch (_) {}
      sseReq = null;
    }

    var keys = Object.keys(pendingRequests);
    for (var i = 0; i < keys.length; i++) {
      var req = pendingRequests[keys[i]];
      if (req.timer) clearTimeout(req.timer);
      req.reject(new Error('MCP server was stopped'));
    }
    pendingRequests = {};
  }

  function getStatus() {
    return {
      name: serverName,
      transport: transport,
      connected: isConnected,
      capabilities: serverCapabilities,
      recentStderr: getRecentStderr()
    };
  }

  function getServerName() {
    return serverName;
  }

  return {
    start: start,
    listTools: listTools,
    callTool: callTool,
    stop: stop,
    getStatus: getStatus,
    getServerName: getServerName
  };
}
