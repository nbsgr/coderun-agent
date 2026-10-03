// browserLoginManager.js — Automated 1-Click Browser Sign-In via Chrome DevTools Protocol (CDP)
// Launches system Chromium browser (Chrome/Edge/Brave) in standalone app mode,
// automatically detects session cookies, saves them, and closes the browser window.
// Strict traditional function declarations only.

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

var activeBrowserProc = null;
var activeWs = null;
var activeTempDir = null;
var activePollTimer = null;

export function detectSystemBrowser() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
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
    if (fs.existsSync(candidates[i])) {
      return candidates[i];
    }
  }
  return '';
}

function sleep(ms) {
  function sleepPromise(resolve) {
    function onTimeout() {
      resolve();
    }
    setTimeout(onTimeout, ms);
  }
  return new Promise(sleepPromise);
}

function cleanupActiveSession() {
  if (activePollTimer) {
    clearInterval(activePollTimer);
    activePollTimer = null;
  }
  if (activeWs) {
    try {
      activeWs.close();
    } catch (_) { void 0; }
    activeWs = null;
  }
  if (activeBrowserProc) {
    try {
      activeBrowserProc.kill();
    } catch (_) { void 0; }
    activeBrowserProc = null;
  }
  if (activeTempDir) {
    var dirToRemove = activeTempDir;
    activeTempDir = null;
    function cleanupDelayed() {
      try {
        fs.rmSync(dirToRemove, { recursive: true, force: true });
      } catch (_) { void 0; }
    }
    setTimeout(cleanupDelayed, 1500);
  }
}

export function cancelBrowserLogin() {
  cleanupActiveSession();
}

export async function startBrowserLogin(options, onSuccess, onError, onCancel) {
  cleanupActiveSession();

  options = options || {};
  var targetUrl = options.url || 'https://chat.qwen.ai';
  var targetCookieName = options.cookieName || 'token';

  var browserPath = detectSystemBrowser();
  if (!browserPath) {
    if (typeof onError === 'function') {
      onError(new Error('No compatible Chromium browser (Chrome, Edge, Brave) was found on your system.'));
    }
    return;
  }

  var port = 9335;
  activeTempDir = path.join(os.tmpdir(), 'coderun_qwen_login_' + Date.now());
  try {
    fs.mkdirSync(activeTempDir, { recursive: true });
  } catch (dirErr) {
    if (typeof onError === 'function') onError(dirErr);
    return;
  }

  var args = [
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + activeTempDir,
    '--app=' + targetUrl,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=560,740'
  ];

  console.log('[BROWSER LOGIN] Spawning browser:', browserPath, 'port:', port);
  var proc = spawn(browserPath, args, { stdio: 'ignore' });
  activeBrowserProc = proc;

  var userClosedNormally = false;

  function handleProcessClose() {
    activeBrowserProc = null;
    if (!userClosedNormally) {
      cleanupActiveSession();
      if (typeof onCancel === 'function') {
        onCancel();
      }
    }
  }

  proc.on('close', handleProcessClose);

  var wsUrl = '';
  for (var attempt = 0; attempt < 25; attempt++) {
    if (!activeBrowserProc) return;
    await sleep(400);
    try {
      var targetsRes = await fetch('http://127.0.0.1:' + port + '/json');
      if (targetsRes.ok) {
        var targets = await targetsRes.json();
        for (var tIdx = 0; tIdx < targets.length; tIdx++) {
          var t = targets[tIdx];
          if (t.type === 'page' && t.webSocketDebuggerUrl) {
            wsUrl = t.webSocketDebuggerUrl;
            break;
          }
        }
      }
    } catch (_) { void 0; }
    if (!wsUrl) {
      try {
        var verRes = await fetch('http://127.0.0.1:' + port + '/json/version');
        if (verRes.ok) {
          var verData = await verRes.json();
          if (verData && verData.webSocketDebuggerUrl) {
            wsUrl = verData.webSocketDebuggerUrl;
          }
        }
      } catch (_) { void 0; }
    }
    if (wsUrl) break;
  }

  if (!wsUrl) {
    cleanupActiveSession();
    if (typeof onError === 'function') {
      onError(new Error('Failed to establish DevTools connection to the browser login window.'));
    }
    return;
  }

  console.log('[BROWSER LOGIN] Connected to CDP DevTools endpoint:', wsUrl);
  var ws = new WebSocket(wsUrl);
  activeWs = ws;

  function onWsOpen(resolve) {
    resolve();
  }
  function onWsError(reject) {
    reject(new Error('WebSocket connection failed'));
  }
  function wsOpenPromise(resolve, reject) {
    function wsOpened() {
      onWsOpen(resolve);
    }
    function wsErrored() {
      onWsError(reject);
    }
    ws.onopen = wsOpened;
    ws.onerror = wsErrored;
  }
  await new Promise(wsOpenPromise);

  var reqCounter = 1;
  var isCompleted = false;
  var tokenDetectedTime = 0;
  var detectedTokenValue = '';
  var detectedBxUa = '';
  var detectedBxUmidtoken = '';
  var cookieMap = {};
  var fullLocalStorage = null;

  ws.send(JSON.stringify({ id: 99, method: 'Network.enable' }));

  function requestCookies() {
    if (isCompleted || !activeWs || activeWs.readyState !== WebSocket.OPEN) return;
    var id1 = reqCounter++;
    activeWs.send(JSON.stringify({ id: id1, method: 'Network.getAllCookies' }));
    var id2 = reqCounter++;
    activeWs.send(JSON.stringify({ id: id2, method: 'Storage.getCookies' }));
    var id3 = reqCounter++;
    activeWs.send(JSON.stringify({
      id: id3,
      method: 'Runtime.evaluate',
      params: {
        expression: 'JSON.stringify(Object.assign({}, localStorage))',
        returnByValue: true
      }
    }));
  }

  function handleWsMessage(event) {
    if (isCompleted) return;
    try {
      var msg = JSON.parse(event.data);
      if (msg) {
        // Intercept real Baxia anti-bot security headers from active browser requests
        if (msg.method === 'Network.requestWillBeSent' && msg.params && msg.params.request && msg.params.request.headers) {
          var reqHeaders = msg.params.request.headers;
          if (reqHeaders['bx-ua']) detectedBxUa = reqHeaders['bx-ua'];
          if (reqHeaders['bx-umidtoken']) detectedBxUmidtoken = reqHeaders['bx-umidtoken'];
        }

        // Handle cookies from Network.getAllCookies or Storage.getCookies
        if (msg.result && Array.isArray(msg.result.cookies)) {
          var cookies = msg.result.cookies;
          for (var i = 0; i < cookies.length; i++) {
            var c = cookies[i];
            if (c.domain && (c.domain.indexOf('qwen.ai') !== -1 || c.domain.indexOf('aliyun.com') !== -1 || c.domain.indexOf('kimi.ai') !== -1 || c.domain.indexOf('chatgpt.com') !== -1)) {
              cookieMap[c.name] = c.value;
              if (c.name === targetCookieName || c.name === 'active_token' || c.name === 'token') {
                if (c.value && c.value.length > 20) {
                  detectedTokenValue = c.value;
                }
              }
            }
          }
        }

        // Handle complete localStorage evaluation from Runtime.evaluate
        if (msg.result && msg.result.result && typeof msg.result.result.value === 'string') {
          try {
            var parsedLs = JSON.parse(msg.result.result.value);
            if (parsedLs && typeof parsedLs === 'object') {
              fullLocalStorage = parsedLs;
              var tVal = parsedLs.active_token || parsedLs.token;
              if (tVal && tVal.length > 20) {
                detectedTokenValue = tVal;
              }
            }
          } catch (_) {
            var lsVal = msg.result.result.value;
            if (lsVal && lsVal.length > 20) {
              detectedTokenValue = lsVal;
            }
          }
        }

        // When a valid token is found, wait 2.5 seconds to capture all remaining security/session cookies
        if (detectedTokenValue && detectedTokenValue.length > 20) {
          if (!tokenDetectedTime) {
            tokenDetectedTime = Date.now();
            console.log('[BROWSER LOGIN] Token found, waiting 2.5s to capture all messaging & security cookies...');
            return;
          }

          var elapsed = Date.now() - tokenDetectedTime;
          if (elapsed >= 2500) {
            isCompleted = true;
            userClosedNormally = true;
            console.log('[BROWSER LOGIN] All cookies captured successfully! Total cookies:', Object.keys(cookieMap).length);

            var cookiePairs = [];
            var keys = Object.keys(cookieMap);
            for (var k = 0; k < keys.length; k++) {
              var keyName = keys[k];
              cookiePairs.push(keyName + '=' + cookieMap[keyName]);
            }

            var fullCookieStr = cookiePairs.join('; ');
            if (fullCookieStr.indexOf(targetCookieName + '=') === -1) {
              fullCookieStr = targetCookieName + '=' + detectedTokenValue + (fullCookieStr ? '; ' + fullCookieStr : '');
            }
            if (fullCookieStr.indexOf('active_token=') === -1) {
              fullCookieStr = 'active_token=' + detectedTokenValue + (fullCookieStr ? '; ' + fullCookieStr : '');
            }
            if (detectedBxUa && fullCookieStr.indexOf('bx_ua=') === -1) {
              fullCookieStr = 'bx_ua=' + detectedBxUa + (fullCookieStr ? '; ' + fullCookieStr : '');
            }
            if (detectedBxUmidtoken && fullCookieStr.indexOf('bx_umidtoken=') === -1) {
              fullCookieStr = 'bx_umidtoken=' + detectedBxUmidtoken + (fullCookieStr ? '; ' + fullCookieStr : '');
            }

            // Also attach key localStorage tokens (_l_KPLiPs, _bx_storage__, auyst, _ETAG__CNA_ID__)
            if (fullLocalStorage) {
              var lsKeys = Object.keys(fullLocalStorage);
              for (var l = 0; l < lsKeys.length; l++) {
                var lk = lsKeys[l];
                var lv = fullLocalStorage[lk];
                if (typeof lv === 'string' && lv.length > 0 && lv.length < 500) {
                  if (fullCookieStr.indexOf(lk + '=') === -1) {
                    cookiePairs.push(lk + '=' + lv);
                  }
                }
              }
              fullCookieStr = cookiePairs.join('; ');
            }

            cleanupActiveSession();

            if (typeof onSuccess === 'function') {
              onSuccess(fullCookieStr, detectedTokenValue, fullLocalStorage);
            }
          }
        }
      }
    } catch (_) { void 0; }
  }

  ws.onmessage = handleWsMessage;

  // Poll cookies and localStorage every 1 second
  requestCookies();
  activePollTimer = setInterval(requestCookies, 1000);
}

export async function startCaptchaVerification(options, onSuccess, onError, onCancel) {
  cleanupActiveSession();

  options = options || {};
  var targetUrl = options.url || 'https://chat.qwen.ai';
  var existingCookie = options.existingCookie || '';

  var browserPath = detectSystemBrowser();
  if (!browserPath) {
    if (typeof onError === 'function') {
      onError(new Error('No compatible Chromium browser (Chrome, Edge, Brave) was found on your system.'));
    }
    return;
  }

  var port = 9336;
  activeTempDir = path.join(os.tmpdir(), 'coderun_qwen_captcha_' + Date.now());
  try {
    fs.mkdirSync(activeTempDir, { recursive: true });
  } catch (dirErr) {
    if (typeof onError === 'function') onError(dirErr);
    return;
  }

  var args = [
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + activeTempDir,
    '--app=about:blank',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=650,750'
  ];

  console.log('[CAPTCHA MANAGER] Spawning browser for slider verification:', browserPath, 'port:', port);
  var proc = spawn(browserPath, args, { stdio: 'ignore' });
  activeBrowserProc = proc;

  var userClosedNormally = false;

  function handleProcessClose() {
    activeBrowserProc = null;
    if (!userClosedNormally) {
      cleanupActiveSession();
      if (typeof onCancel === 'function') {
        onCancel();
      }
    }
  }

  proc.on('close', handleProcessClose);

  function isPageTarget(t) {
    return t && t.type === 'page';
  }

  var pageWsUrl = '';
  for (var attempt = 0; attempt < 25; attempt++) {
    if (!activeBrowserProc) return;
    await sleep(400);
    try {
      var targetsRes = await fetch('http://127.0.0.1:' + port + '/json');
      if (targetsRes.ok) {
        var targets = await targetsRes.json();
        var pageTarget = targets.find(isPageTarget);
        if (pageTarget && pageTarget.webSocketDebuggerUrl) {
          pageWsUrl = pageTarget.webSocketDebuggerUrl;
          break;
        }
      }
    } catch (_) { void 0; }
  }

  if (!pageWsUrl) {
    cleanupActiveSession();
    if (typeof onError === 'function') {
      onError(new Error('Failed to establish DevTools connection to verification window.'));
    }
    return;
  }

  var ws = new WebSocket(pageWsUrl);
  activeWs = ws;

  function onCaptchaWsOpen(resolve) {
    resolve();
  }
  function onCaptchaWsError(reject) {
    reject(new Error('WebSocket connection failed'));
  }
  function captchaWsPromise(resolve, reject) {
    function onOpen() {
      onCaptchaWsOpen(resolve);
    }
    function onErrorEvent() {
      onCaptchaWsError(reject);
    }
    ws.onopen = onOpen;
    ws.onerror = onErrorEvent;
  }
  await new Promise(captchaWsPromise);

  // Inject existing cookies into browser session BEFORE navigating to prevent Taobao redirects
  if (existingCookie) {
    var parts = existingCookie.split(';');
    for (var cIdx = 0; cIdx < parts.length; cIdx++) {
      var part = parts[cIdx].trim();
      var eqIdx = part.indexOf('=');
      if (eqIdx !== -1) {
        var cName = part.substring(0, eqIdx).trim();
        var cVal = part.substring(eqIdx + 1).trim();
        if (cName && cVal) {
          ws.send(JSON.stringify({
            id: 200 + cIdx,
            method: 'Network.setCookie',
            params: {
              name: cName,
              value: cVal,
              domain: '.qwen.ai',
              path: '/',
              secure: true
            }
          }));
        }
      }
    }
  }

  // Navigate to verification target URL
  ws.send(JSON.stringify({
    id: 999,
    method: 'Page.navigate',
    params: { url: targetUrl }
  }));

  var reqCounter = 600;
  var isCompleted = false;

  function requestCookies() {
    if (isCompleted || !activeWs || activeWs.readyState !== WebSocket.OPEN) return;
    var id1 = reqCounter++;
    activeWs.send(JSON.stringify({ id: id1, method: 'Network.getAllCookies' }));
    var id2 = reqCounter++;
    activeWs.send(JSON.stringify({ id: id2, method: 'Storage.getCookies' }));
  }

  function handleCaptchaWsMessage(event) {
    if (isCompleted) return;
    try {
      var msg = JSON.parse(event.data);
      if (msg && msg.result && Array.isArray(msg.result.cookies)) {
        var cookies = msg.result.cookies;
        var hasX5sec = false;
        var cookiePairs = [];

        for (var i = 0; i < cookies.length; i++) {
          var c = cookies[i];
          if (c.domain && (c.domain.indexOf('qwen.ai') !== -1 || c.domain.indexOf('aliyun.com') !== -1 || c.domain.indexOf('taobao.com') !== -1)) {
            cookiePairs.push(c.name + '=' + c.value);
            if (c.name === 'x5sec' && c.value && c.value.length > 5) {
              hasX5sec = true;
            }
          }
        }

        if (hasX5sec) {
          isCompleted = true;
          userClosedNormally = true;
          console.log('[CAPTCHA MANAGER] x5sec cookie received! Slider solved.');
          var fullCookieStr = cookiePairs.join('; ');
          cleanupActiveSession();
          if (typeof onSuccess === 'function') {
            onSuccess(fullCookieStr);
          }
        }
      }
    } catch (_) { void 0; }
  }

  ws.onmessage = handleCaptchaWsMessage;

  requestCookies();
  activePollTimer = setInterval(requestCookies, 1000);
}
