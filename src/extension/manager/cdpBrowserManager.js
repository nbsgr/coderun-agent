// cdpBrowserManager.js — Zero-Dependency Chrome DevTools Protocol (CDP) Browser Manager
// Drives system Chromium (Chrome/Edge/Brave) directly without calling vscode.lm.invokeTool,
// avoiding VS Code modal confirmation dialogs while enforcing CodeRun Layer 1 permissions.
// Pure functions, traditional function declarations only. Zero arrow functions, zero classes.

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { detectSystemBrowser } from '../browser/browserLoginManager.js';
import * as mediaManager from '../media/mediaManager.js';

var _browserProc = null;
var _browserPort = 0;
var _tempUserDir = null;
var _pages = {};
var _activePageId = null;

function sleep(ms) {
  function sleepPromise(resolve) {
    function onTimer() {
      resolve();
    }
    setTimeout(onTimer, ms);
  }
  return new Promise(sleepPromise);
}

function findFreePort() {
  function portPromise(resolve, reject) {
    var server = net.createServer();
    function onListening() {
      var addr = server.address();
      var chosenPort = addr && typeof addr === 'object' ? addr.port : 9338;
      server.close(function onClosed() {
        resolve(chosenPort);
      });
    }
    function onError(err) {
      reject(err);
    }
    server.on('error', onError);
    server.listen(0, '127.0.0.1', onListening);
  }
  return new Promise(portPromise);
}

export function isAllowedBrowserUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  var trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (trimmed === 'about:blank') return true;
  var lower = trimmed.toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('file://');
}

export function getActivePageId() {
  return _activePageId;
}

export function getCurrentUrl() {
  if (_activePageId && _pages[_activePageId]) {
    return _pages[_activePageId].url || '';
  }
  return '';
}

export function isBrowserOpen() {
  return Boolean(_activePageId && _pages[_activePageId] && _browserProc);
}

async function isPortResponsive(port) {
  if (!port) return false;
  try {
    var res = await fetch('http://127.0.0.1:' + port + '/json/version');
    return Boolean(res && res.ok);
  } catch (err) {
    console.debug('[CDP BROWSER] Port check failed:', err ? err.message : err);
    return false;
  }
}

async function ensureBrowserRunning(headless) {
  if (_browserProc && _browserPort && await isPortResponsive(_browserPort)) {
    return _browserPort;
  }

  await disposeBrowser();

  var browserPath = detectSystemBrowser();
  if (!browserPath) {
    throw new Error('No compatible Chromium browser (Chrome, Edge, or Brave) was found on your system.');
  }

  var port = await findFreePort();
  var userDir = path.join(os.tmpdir(), 'coderun_cdp_browser_' + Date.now());
  fs.mkdirSync(userDir, { recursive: true });
  _tempUserDir = userDir;

  var args = [
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + userDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-popup-blocking',
    '--window-size=1280,800'
  ];

  if (headless !== false) {
    args.push('--headless=new');
    args.push('--disable-gpu');
  }
  args.push('about:blank');

  var proc = spawn(browserPath, args, { stdio: 'ignore' });
  _browserProc = proc;
  _browserPort = port;

  proc.on('exit', function onBrowserExit() {
    if (_browserProc === proc) {
      _browserProc = null;
      _browserPort = 0;
      _pages = {};
      _activePageId = null;
    }
  });

  var ready = false;
  for (var i = 0; i < 30; i++) {
    if (!_browserProc) break;
    await sleep(200);
    if (await isPortResponsive(port)) {
      ready = true;
      break;
    }
  }

  if (!ready) {
    await disposeBrowser();
    throw new Error('Failed to start Chromium CDP browser session on port ' + port);
  }

  return port;
}

function sendCdpCommand(pageState, method, params, timeoutMs) {
  if (!pageState || !pageState.ws || pageState.ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('CDP page WebSocket is not connected.'));
  }

  var id = ++pageState.nextCmdId;
  var limit = timeoutMs || 15000;

  function cmdPromise(resolve, reject) {
    var timer = setTimeout(function onCdpTimeout() {
      if (pageState.pendingCmds[id]) {
        delete pageState.pendingCmds[id];
        reject(new Error('CDP command timed out: ' + method));
      }
    }, limit);

    pageState.pendingCmds[id] = {
      resolve: resolve,
      reject: reject,
      timer: timer
    };

    try {
      pageState.ws.send(JSON.stringify({
        id: id,
        method: method,
        params: params || {}
      }));
    } catch (sendErr) {
      clearTimeout(timer);
      delete pageState.pendingCmds[id];
      reject(sendErr);
    }
  }

  return new Promise(cmdPromise);
}

async function attachTarget(targetInfo) {
  if (!targetInfo || !targetInfo.webSocketDebuggerUrl) {
    throw new Error('Missing webSocketDebuggerUrl for CDP target.');
  }

  var pageId = targetInfo.id || ('page_' + Date.now());
  if (_pages[pageId] && _pages[pageId].ws && _pages[pageId].ws.readyState === WebSocket.OPEN) {
    return _pages[pageId];
  }

  var ws = new WebSocket(targetInfo.webSocketDebuggerUrl);
  var pageState = {
    id: pageId,
    targetId: targetInfo.id || pageId,
    ws: ws,
    url: targetInfo.url || 'about:blank',
    title: targetInfo.title || '',
    consoleLogs: [],
    pendingDialog: null,
    pendingCmds: {},
    nextCmdId: 0
  };

  function connectPromise(resolve, reject) {
    var settled = false;
    var connTimer = setTimeout(function onConnTimeout() {
      if (!settled) {
        settled = true;
        reject(new Error('Timed out connecting to CDP target WebSocket.'));
      }
    }, 8000);

    ws.onopen = function onWsOpen() {
      if (!settled) {
        settled = true;
        clearTimeout(connTimer);
        resolve();
      }
    };
    ws.onerror = function onWsError() {
      if (!settled) {
        settled = true;
        clearTimeout(connTimer);
        reject(new Error('Failed connecting to CDP target WebSocket.'));
      }
    };
  }

  ws.onmessage = function onWsMessage(evt) {
    try {
      var msg = JSON.parse(evt.data);
      if (msg.id !== undefined && pageState.pendingCmds[msg.id]) {
        var entry = pageState.pendingCmds[msg.id];
        delete pageState.pendingCmds[msg.id];
        clearTimeout(entry.timer);
        if (msg.error) {
          entry.reject(new Error(msg.error.message || 'CDP error'));
        } else {
          entry.resolve(msg.result || {});
        }
        return;
      }

      if (msg.method === 'Runtime.consoleAPICalled' && msg.params) {
        var logArgs = Array.isArray(msg.params.args) ? msg.params.args : [];
        var parts = [];
        for (var ai = 0; ai < logArgs.length; ai++) {
          var arg = logArgs[ai];
          parts.push(arg.value !== undefined ? String(arg.value) : (arg.description || ''));
        }
        var level = msg.params.type || 'log';
        pageState.consoleLogs.push('[' + level + '] ' + parts.join(' '));
        if (pageState.consoleLogs.length > 100) {
          pageState.consoleLogs.shift();
        }
      } else if (msg.method === 'Runtime.exceptionThrown' && msg.params && msg.params.exceptionDetails) {
        var det = msg.params.exceptionDetails;
        var excText = (det.exception && det.exception.description) || det.text || 'Uncaught exception';
        pageState.consoleLogs.push('[error] ' + excText);
        if (pageState.consoleLogs.length > 100) {
          pageState.consoleLogs.shift();
        }
      } else if (msg.method === 'Page.frameNavigated' && msg.params && msg.params.frame && !msg.params.frame.parentId) {
        if (msg.params.frame.url) {
          pageState.url = msg.params.frame.url;
        }
      } else if (msg.method === 'Page.javascriptDialogOpening' && msg.params) {
        pageState.pendingDialog = {
          type: msg.params.type || 'alert',
          message: msg.params.message || '',
          defaultPrompt: msg.params.defaultPrompt || ''
        };
      } else if (msg.method === 'Page.javascriptDialogClosed') {
        pageState.pendingDialog = null;
      }
    } catch (parseErr) {
      console.debug('[CDP BROWSER] Non-fatal message parse error:', parseErr ? parseErr.message : parseErr);
    }
  };

  ws.onclose = function onWsClose() {
    for (var cmdId in pageState.pendingCmds) {
      var p = pageState.pendingCmds[cmdId];
      clearTimeout(p.timer);
      p.reject(new Error('CDP page closed.'));
    }
    pageState.pendingCmds = {};
    if (_pages[pageId] === pageState) {
      delete _pages[pageId];
    }
    if (_activePageId === pageId) {
      var keys = Object.keys(_pages);
      _activePageId = keys.length > 0 ? keys[0] : null;
    }
  };

  await new Promise(connectPromise);
  _pages[pageId] = pageState;
  _activePageId = pageId;

  await sendCdpCommand(pageState, 'Page.enable');
  await sendCdpCommand(pageState, 'Runtime.enable');
  await sendCdpCommand(pageState, 'DOM.enable');

  return pageState;
}

async function listPageTargets(port) {
  var res = await fetch('http://127.0.0.1:' + port + '/json/list');
  if (!res.ok) return [];
  var list = await res.json();
  var out = [];
  if (Array.isArray(list)) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].type === 'page') {
        out.push(list[i]);
      }
    }
  }
  return out;
}

async function createTarget(port, url) {
  var targetUrl = url || 'about:blank';
  var endpoint = 'http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(targetUrl);
  var res = await fetch(endpoint, { method: 'PUT' });
  if (!res.ok) {
    res = await fetch(endpoint, { method: 'GET' });
  }
  if (!res.ok) {
    throw new Error('Failed to create browser tab (HTTP ' + res.status + ').');
  }
  return await res.json();
}

async function waitForPageReady(pageState, timeoutMs) {
  var maxMs = timeoutMs || 6000;
  var start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      var evalRes = await sendCdpCommand(pageState, 'Runtime.evaluate', {
        expression: 'JSON.stringify({ readyState: document.readyState, title: document.title || "", url: window.location.href || "" })',
        returnByValue: true
      }, 3000);
      var val = evalRes && evalRes.result && evalRes.result.value ? JSON.parse(evalRes.result.value) : null;
      if (val) {
        pageState.title = val.title || pageState.title;
        pageState.url = val.url || pageState.url;
        if (val.readyState === 'complete' || val.readyState === 'interactive') {
          return val;
        }
      }
    } catch (waitErr) {
      console.debug('[CDP BROWSER] Waiting for load:', waitErr ? waitErr.message : waitErr);
    }
    await sleep(150);
  }
  return { title: pageState.title, url: pageState.url };
}

function getPageStateOrThrow(pageId) {
  var targetId = pageId || _activePageId;
  if (!targetId || !_pages[targetId]) {
    throw new Error('No active browser page. Call openBrowserPage first.');
  }
  return _pages[targetId];
}

export function buildElementResolutionExpression(selector, ref) {
  var selJson = JSON.stringify(selector || '');
  var refJson = JSON.stringify(ref || '');
  return '(function(){' +
    'var sel=' + selJson + ',ref=' + refJson + ';' +
    'function findEl(){' +
      'if(ref){var cleanRef=String(ref).replace(/^aria-ref=/,"");var r=document.querySelector("[data-coderun-ref=\\""+cleanRef+"\\"]");if(r)return r;}' +
      'if(sel){' +
        'if(sel.indexOf("aria-ref=")===0||sel.indexOf("elem_")===0){var c=sel.replace(/^aria-ref=/,"");var r2=document.querySelector("[data-coderun-ref=\\""+c+"\\"]");if(r2)return r2;}' +
        'try{var q=document.querySelector(sel);if(q)return q;}catch(_e){}' +
        'var lower=sel.toLowerCase();' +
        'var cands=document.querySelectorAll("a,button,input,select,textarea,[role=button],[role=link]");' +
        'for(var i=0;i<cands.length;i++){var t=(cands[i].innerText||cands[i].value||cands[i].getAttribute("aria-label")||cands[i].getAttribute("placeholder")||"").trim().toLowerCase();if(t&&t.indexOf(lower)!==-1)return cands[i];}' +
      '}' +
      'return null;' +
    '}' +
    'var el=findEl();' +
    'if(!el)return JSON.stringify({found:false});' +
    'el.scrollIntoView({block:"center",inline:"center"});' +
    'var rect=el.getBoundingClientRect();' +
    'return JSON.stringify({found:true,tag:el.tagName.toLowerCase(),x:rect.left+rect.width/2,y:rect.top+rect.height/2,width:rect.width,height:rect.height});' +
  '})()';
}

export async function openPage(url, forceNew, options) {
  options = options || {};
  var requestedUrl = url ? String(url).trim() : '';
  if (requestedUrl && !isAllowedBrowserUrl(requestedUrl)) {
    throw new Error('Unsupported browser URL scheme. Only http://, https://, file://, or about:blank are supported.');
  }

  var port = await ensureBrowserRunning(options.headless !== false);
  var shouldForceNew = Boolean(forceNew);
  var pageState = null;

  if (!shouldForceNew && _activePageId && _pages[_activePageId]) {
    pageState = _pages[_activePageId];
  } else {
    var existingTargets = await listPageTargets(port);
    if (!shouldForceNew && existingTargets.length > 0) {
      pageState = await attachTarget(existingTargets[0]);
    } else {
      var created = await createTarget(port, requestedUrl || 'about:blank');
      pageState = await attachTarget(created);
    }
  }

  if (requestedUrl && requestedUrl !== pageState.url) {
    pageState.consoleLogs = [];
    await sendCdpCommand(pageState, 'Page.navigate', { url: requestedUrl }, 15000);
    await waitForPageReady(pageState, 6000);
  } else {
    await waitForPageReady(pageState, 3000);
  }

  var readSummary = await readPageContent(pageState.id, true, 35);
  return {
    status: 200,
    url: pageState.url || requestedUrl || 'about:blank',
    title: pageState.title || pageState.url || 'Integrated Browser',
    pageId: pageState.id,
    summary: readSummary ? readSummary.bodyText : '',
    message: 'Connected to CDP browser page (' + (pageState.url || 'about:blank') + ').'
  };
}

export async function navigate(url, options) {
  options = options || {};
  var pageState = getPageStateOrThrow(options.pageId);
  var navType = options.type || 'url';

  if (navType === 'back') {
    await sendCdpCommand(pageState, 'Runtime.evaluate', { expression: 'window.history.back()', returnByValue: true });
    await waitForPageReady(pageState, 4000);
  } else if (navType === 'forward') {
    await sendCdpCommand(pageState, 'Runtime.evaluate', { expression: 'window.history.forward()', returnByValue: true });
    await waitForPageReady(pageState, 4000);
  } else if (navType === 'reload') {
    await sendCdpCommand(pageState, 'Page.reload', { ignoreCache: false });
    await waitForPageReady(pageState, 5000);
  } else {
    if (!isAllowedBrowserUrl(url)) {
      throw new Error('Unsupported navigation URL: ' + url);
    }
    pageState.consoleLogs = [];
    await sendCdpCommand(pageState, 'Page.navigate', { url: url }, 15000);
    await waitForPageReady(pageState, 6000);
  }

  return {
    status: 200,
    url: pageState.url,
    title: pageState.title,
    pageId: pageState.id,
    result: 'Navigated to ' + pageState.url
  };
}

export async function readPageContent(pageId, includeConsole, maxElements) {
  if (typeof pageId === 'boolean') {
    maxElements = includeConsole;
    includeConsole = pageId;
    pageId = null;
  }

  var targetId = pageId || _activePageId;
  if (!targetId || !_pages[targetId]) {
    return {
      title: 'Integrated Browser',
      url: 'about:blank',
      pageId: null,
      elements: [],
      bodyText: 'No browser page is open yet. Call openBrowserPage first.',
      consoleLogs: []
    };
  }

  var pageState = _pages[targetId];
  var limit = maxElements || 50;
  var script = '(function(){' +
    'var maxN=' + Number(limit) + ';' +
    'var nodes=document.querySelectorAll("a,button,input,select,textarea,[role=button],[role=link]");' +
    'var elems=[];' +
    'for(var i=0;i<nodes.length&&elems.length<maxN;i++){' +
      'var el=nodes[i];' +
      'var refId="elem_"+(elems.length+1);' +
      'el.setAttribute("data-coderun-ref",refId);' +
      'elems.push({' +
        'refId:refId,' +
        'tag:el.tagName.toLowerCase(),' +
        'type:el.getAttribute("type")||"",' +
        'id:el.id||null,' +
        'text:(el.innerText||el.value||el.getAttribute("aria-label")||el.getAttribute("placeholder")||"").trim().slice(0,120)' +
      '});' +
    '}' +
    'var text=(document.body&&document.body.innerText?document.body.innerText:"").trim().slice(0,4000);' +
    'return JSON.stringify({title:document.title||"",url:window.location.href||"",bodyText:text,elements:elems});' +
  '})()';

  var evalRes = await sendCdpCommand(pageState, 'Runtime.evaluate', {
    expression: script,
    returnByValue: true
  }, 8000);

  var parsed = evalRes && evalRes.result && evalRes.result.value ? JSON.parse(evalRes.result.value) : {};
  pageState.title = parsed.title || pageState.title;
  pageState.url = parsed.url || pageState.url;

  return {
    title: pageState.title || pageState.url || 'Integrated Browser',
    url: pageState.url || 'about:blank',
    pageId: pageState.id,
    elements: Array.isArray(parsed.elements) ? parsed.elements : [],
    bodyText: parsed.bodyText || '',
    consoleLogs: includeConsole !== false ? pageState.consoleLogs.slice(-20) : []
  };
}

export async function captureScreenshot(fullPage, pageId, sessionId) {
  var pageState = getPageStateOrThrow(pageId);
  var shotParams = { format: 'png' };

  if (fullPage) {
    try {
      var metrics = await sendCdpCommand(pageState, 'Page.getLayoutMetrics', {});
      var cs = metrics && (metrics.contentSize || metrics.cssContentSize);
      if (cs && cs.width > 0 && cs.height > 0) {
        shotParams.clip = {
          x: 0,
          y: 0,
          width: Math.ceil(cs.width),
          height: Math.ceil(cs.height),
          scale: 1
        };
        shotParams.captureBeyondViewport = true;
      }
    } catch (metricErr) {
      console.debug('[CDP BROWSER] Layout metrics fallback:', metricErr ? metricErr.message : metricErr);
    }
  }

  var shotRes = await sendCdpCommand(pageState, 'Page.captureScreenshot', shotParams, 15000);
  if (!shotRes || !shotRes.data) {
    throw new Error('CDP Page.captureScreenshot returned empty image data.');
  }

  var saved = await mediaManager.saveMediaFromDataOrUrl(null, sessionId || 'browser', 'data:image/png;base64,' + shotRes.data, 'png');
  var outPath = saved && saved.filePath ? saved.filePath : '';
  if (!outPath) {
    var fallbackName = 'coderun_browser_' + Date.now() + '.png';
    outPath = path.join(os.tmpdir(), fallbackName);
    await fs.promises.writeFile(outPath, Buffer.from(shotRes.data, 'base64'));
  }

  return {
    status: 200,
    filePath: outPath,
    filename: path.basename(outPath),
    url: pageState.url,
    message: 'Screenshot captured via CDP browser: ' + outPath
  };
}

export async function click(selector, options) {
  if (!selector && !(options && options.ref)) {
    throw new Error('selector or ref is required');
  }
  options = options || {};
  var pageState = getPageStateOrThrow(options.pageId);
  var evalRes = await sendCdpCommand(pageState, 'Runtime.evaluate', {
    expression: buildElementResolutionExpression(selector, options.ref),
    returnByValue: true
  }, 6000);

  var box = evalRes && evalRes.result && evalRes.result.value ? JSON.parse(evalRes.result.value) : { found: false };
  if (!box.found) {
    throw new Error('Element not found: ' + (selector || options.ref));
  }

  var btn = options.button || 'left';
  var clickCount = options.dblClick ? 2 : 1;
  await sendCdpCommand(pageState, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  for (var ci = 1; ci <= clickCount; ci++) {
    await sendCdpCommand(pageState, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: box.x,
      y: box.y,
      button: btn,
      clickCount: ci
    });
    await sendCdpCommand(pageState, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: box.x,
      y: box.y,
      button: btn,
      clickCount: ci
    });
  }
  await sleep(120);
  return { message: 'Clicked ' + (selector || options.ref) };
}

export async function typeText(selector, text, options) {
  if (!selector && !(options && options.ref)) {
    throw new Error('selector or ref is required');
  }
  options = options || {};
  if (typeof options === 'boolean') {
    options = { clearFirst: options };
  }
  var pageState = getPageStateOrThrow(options.pageId);
  var shouldClear = options.clearFirst !== false;
  var valueText = text !== undefined && text !== null ? String(text) : '';

  var evalRes = await sendCdpCommand(pageState, 'Runtime.evaluate', {
    expression: buildElementResolutionExpression(selector, options.ref),
    returnByValue: true
  }, 6000);
  var box = evalRes && evalRes.result && evalRes.result.value ? JSON.parse(evalRes.result.value) : { found: false };
  if (!box.found) {
    throw new Error('Input element not found: ' + (selector || options.ref));
  }

  await sendCdpCommand(pageState, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sendCdpCommand(pageState, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });

  if (shouldClear) {
    var clearExpr = '(function(){' +
      'var el=document.activeElement;' +
      'if(el&&"value"in el){el.value="";el.dispatchEvent(new Event("input",{bubbles:true}));}' +
    '})()';
    await sendCdpCommand(pageState, 'Runtime.evaluate', { expression: clearExpr, returnByValue: true });
  }

  if (valueText) {
    await sendCdpCommand(pageState, 'Input.insertText', { text: valueText });
  }

  if (options.submit) {
    await sendCdpCommand(pageState, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sendCdpCommand(pageState, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }

  return { message: 'Typed into ' + (selector || options.ref) };
}

export async function hover(selector, options) {
  if (!selector && !(options && options.ref)) {
    throw new Error('selector or ref is required');
  }
  options = options || {};
  var pageState = getPageStateOrThrow(options.pageId);
  var evalRes = await sendCdpCommand(pageState, 'Runtime.evaluate', {
    expression: buildElementResolutionExpression(selector, options.ref),
    returnByValue: true
  }, 6000);
  var box = evalRes && evalRes.result && evalRes.result.value ? JSON.parse(evalRes.result.value) : { found: false };
  if (!box.found) {
    throw new Error('Element not found for hover: ' + (selector || options.ref));
  }
  await sendCdpCommand(pageState, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  return { message: 'Hovered over ' + (selector || options.ref) };
}

export async function drag(sourceSelector, targetSelector, pageId) {
  if (!sourceSelector || !targetSelector) {
    throw new Error('sourceSelector and targetSelector are required');
  }
  var pageState = getPageStateOrThrow(pageId);
  var srcEval = await sendCdpCommand(pageState, 'Runtime.evaluate', {
    expression: buildElementResolutionExpression(sourceSelector, ''),
    returnByValue: true
  }, 6000);
  var dstEval = await sendCdpCommand(pageState, 'Runtime.evaluate', {
    expression: buildElementResolutionExpression(targetSelector, ''),
    returnByValue: true
  }, 6000);

  var srcBox = srcEval && srcEval.result && srcEval.result.value ? JSON.parse(srcEval.result.value) : { found: false };
  var dstBox = dstEval && dstEval.result && dstEval.result.value ? JSON.parse(dstEval.result.value) : { found: false };
  if (!srcBox.found || !dstBox.found) {
    throw new Error('Drag source or target element not found.');
  }

  await sendCdpCommand(pageState, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: srcBox.x, y: srcBox.y });
  await sendCdpCommand(pageState, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: srcBox.x, y: srcBox.y, button: 'left', clickCount: 1 });
  await sendCdpCommand(pageState, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: dstBox.x, y: dstBox.y });
  await sendCdpCommand(pageState, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: dstBox.x, y: dstBox.y, button: 'left', clickCount: 1 });
  return { message: 'Dragged ' + sourceSelector + ' to ' + targetSelector };
}

export async function handleDialogAction(action, promptText, pageId) {
  var pageState = getPageStateOrThrow(pageId);
  var accept = String(action || 'accept').toLowerCase() !== 'dismiss';
  await sendCdpCommand(pageState, 'Page.handleJavaScriptDialog', {
    accept: accept,
    promptText: promptText || ''
  }, 5000);
  pageState.pendingDialog = null;
  return { status: 200, action: accept ? 'accept' : 'dismiss', message: 'Dialog ' + (accept ? 'accepted' : 'dismissed') };
}

export async function evaluateCode(code, pageId, sessionId) {
  if (!code) throw new Error('code is required');
  var pageState = getPageStateOrThrow(pageId);

  var pageShim = {
    goto: async function gotoPage(u) { return await navigate(u, { pageId: pageState.id }); },
    click: async function clickSel(sel, opts) { return await click(sel, Object.assign({ pageId: pageState.id }, opts || {})); },
    fill: async function fillSel(sel, val) { return await typeText(sel, val, { pageId: pageState.id, clearFirst: true }); },
    type: async function typeSel(sel, val, opts) { return await typeText(sel, val, Object.assign({ pageId: pageState.id, clearFirst: false }, opts || {})); },
    hover: async function hoverSel(sel) { return await hover(sel, { pageId: pageState.id }); },
    title: async function getTitle() {
      var r = await sendCdpCommand(pageState, 'Runtime.evaluate', { expression: 'document.title || ""', returnByValue: true });
      return r && r.result ? r.result.value : '';
    },
    url: function getUrl() { return pageState.url || ''; },
    content: async function getContent() {
      var r = await sendCdpCommand(pageState, 'Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true });
      return r && r.result ? r.result.value : '';
    },
    evaluate: async function evalInPage(fnOrStr, arg) {
      var expr = typeof fnOrStr === 'function' ? ('(' + fnOrStr.toString() + ')(' + JSON.stringify(arg) + ')') : String(fnOrStr);
      var r = await sendCdpCommand(pageState, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      return r && r.result ? r.result.value : undefined;
    },
    waitForSelector: async function waitForSel(sel, opts) {
      var maxWait = (opts && opts.timeout) || 5000;
      var t0 = Date.now();
      while (Date.now() - t0 < maxWait) {
        var chk = await sendCdpCommand(pageState, 'Runtime.evaluate', {
          expression: buildElementResolutionExpression(sel, ''),
          returnByValue: true
        });
        var box = chk && chk.result && chk.result.value ? JSON.parse(chk.result.value) : { found: false };
        if (box.found) return true;
        await sleep(150);
      }
      throw new Error('Timeout waiting for selector: ' + sel);
    },
    screenshot: async function takeShot(opts) {
      return await captureScreenshot(Boolean(opts && opts.fullPage), pageState.id, sessionId);
    }
  };

  async function noopAsync() {}
  var AsyncFunction = Object.getPrototypeOf(noopAsync).constructor;
  var runner = new AsyncFunction('page', code);
  var out = await runner(pageShim);
  return { evalResult: out !== undefined ? out : 'Executed Playwright snippet successfully.' };
}

export async function disposeBrowser() {
  var pageIds = Object.keys(_pages);
  for (var i = 0; i < pageIds.length; i++) {
    var ps = _pages[pageIds[i]];
    if (ps && ps.ws) {
      try {
        ps.ws.close();
      } catch (wsErr) {
        console.debug('[CDP BROWSER] Error closing WebSocket:', wsErr ? wsErr.message : wsErr);
      }
    }
  }
  _pages = {};
  _activePageId = null;

  if (_browserProc) {
    try {
      _browserProc.kill();
    } catch (killErr) {
      console.debug('[CDP BROWSER] Error killing browser process:', killErr ? killErr.message : killErr);
    }
    _browserProc = null;
  }
  _browserPort = 0;

  if (_tempUserDir) {
    var dirToClean = _tempUserDir;
    _tempUserDir = null;
    try {
      fs.rmSync(dirToClean, { recursive: true, force: true });
    } catch (rmErr) {
      console.debug('[CDP BROWSER] Deferred temp dir cleanup notice:', rmErr ? rmErr.message : rmErr);
    }
  }
}
