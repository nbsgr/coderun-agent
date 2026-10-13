// browser-auth-manager.js (UI side)
// Manages UI interactions for 1-Click Chrome login, status indicators, and IPC events.
// Strict traditional function declarations only.

function escCookieHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseTokenFromCookie(cookieStr) {
  if (!cookieStr || typeof cookieStr !== 'string') return '';
  var trimmed = cookieStr.trim();
  if (trimmed.startsWith('eyJ')) return trimmed;
  if (trimmed.startsWith('Bearer ')) return trimmed.substring(7).trim();

  var stateMatch = cookieStr.match(/(?:^|;\s*)qwen_access_token_state=([^;]+)/i);
  if (stateMatch && stateMatch[1]) {
    try {
      var rawState = stateMatch[1].trim();
      if (rawState.indexOf('%') !== -1) {
        try { rawState = decodeURIComponent(rawState); } catch (_) { void 0; }
      }
      var stateObj = JSON.parse(rawState);
      if (stateObj && typeof stateObj === 'object' && stateObj.token && typeof stateObj.token === 'string' && stateObj.token.length > 20) {
        return stateObj.token.trim();
      }
    } catch (_) {
      var innerMatch = stateMatch[1].match(/"token":\s*"([^"]+)"/);
      if (innerMatch && innerMatch[1] && innerMatch[1].length > 20) {
        return innerMatch[1].trim();
      }
    }
  }

  var parts = cookieStr.split(';');
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (part.startsWith('token=')) return part.substring(6);
    if (part.startsWith('active_token=')) return part.substring(13);
    if (part.startsWith('access_token=')) return part.substring(13);
  }
  for (var j = 0; j < parts.length; j++) {
    var p = parts[j].trim();
    var eqIdx = p.indexOf('=');
    if (eqIdx !== -1) {
      var kName = p.substring(0, eqIdx).toLowerCase();
      var kVal = p.substring(eqIdx + 1);
      if ((kName === 'token' || kName === 'active_token' || kName === 'access_token') && kVal.length > 20) {
        return kVal;
      }
    }
  }

  var refreshMatch = cookieStr.match(/(?:^|;\s*)refresh_token=([^;]+)/i);
  if (refreshMatch && refreshMatch[1] && refreshMatch[1].trim().length > 20) {
    return refreshMatch[1].trim();
  }

  var anyJsonMatch = cookieStr.match(/"token":\s*"(ey[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+)"/);
  if (anyJsonMatch && anyJsonMatch[1]) {
    return anyJsonMatch[1].trim();
  }

  return '';
}

function parseJwtPayload(tokenStr) {
  if (!tokenStr || typeof tokenStr !== 'string') return null;
  var tokenVal = parseTokenFromCookie(tokenStr) || tokenStr.trim();
  if (tokenVal.startsWith('Bearer ')) {
    tokenVal = tokenVal.substring(7).trim();
  }
  var parts = tokenVal.split('.');
  if (parts.length < 2) return null;
  var base64Url = parts[1];
  var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  var jsonStr = '';
  if (typeof atob === 'function') {
    try {
      jsonStr = atob(base64);
    } catch (_) { jsonStr = ''; }
  } else if (typeof Buffer !== 'undefined') {
    try {
      jsonStr = Buffer.from(base64, 'base64').toString('utf8');
    } catch (_) { jsonStr = ''; }
  }
  if (!jsonStr) return null;
  try {
    return JSON.parse(jsonStr);
  } catch (_) {
    return null;
  }
}

function isQwenTokenExpired(cookieStr) {
  var payload = parseJwtPayload(cookieStr);
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  if (typeof payload.exp === 'number') {
    var nowSec = Math.floor(Date.now() / 1000);
    return nowSec >= payload.exp;
  }
  return false;
}

function hasValidQwenToken(cookieStr) {
  if (!cookieStr || typeof cookieStr !== 'string') return false;
  var token = parseTokenFromCookie(cookieStr);
  if (!token || token.length < 20) return false;
  if (isQwenTokenExpired(token)) return false;
  return true;
}

function renderQwenSettingsCard(container, hasKey, cookie) {
  if (!container) return;

  var currentCookie = cookie || (typeof localStorage !== 'undefined' ? localStorage.getItem('coderun_qwen_cookie') : '') || (window.activeQwenCookie || '');
  var hasToken = hasValidQwenToken(currentCookie);
  var isExpired = isQwenTokenExpired(currentCookie);
  var payload = parseJwtPayload(currentCookie);
  var isActive = Boolean(hasKey && hasToken && !isExpired);

  var statusText = 'Not Connected';
  var dotClass = 'cr-qwen-dot offline';
  var authActionHtml = '';

  if (isActive) {
    statusText = 'Browser Session Active';
    dotClass = 'cr-qwen-dot';
    var expInfo = '';
    if (payload && payload.exp) {
      try {
        var expDate = new Date(payload.exp * 1000);
        expInfo = ' (Expires ' + expDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ')';
      } catch (_) { void 0; }
    }
    authActionHtml =
      '<div class="cr-qwen-signed-badge" id="qwenSignedInBadge">' +
        '<span style="font-size: 15px;">✓</span>' +
        '<span>Sign In Complete (Active' + escCookieHtml(expInfo) + ')</span>' +
      '</div>' +
      '<button id="qwen1ClickLoginBtn" class="cr-auth-btn-secondary" style="width: 100%; justify-content: center;">' +
        '🔄 Re-authenticate / Switch Account' +
      '</button>';
  } else if (isExpired) {
    statusText = 'Session Token Expired';
    dotClass = 'cr-qwen-dot offline';
    var expiredDateStr = '';
    if (payload && payload.exp) {
      try {
        expiredDateStr = new Date(payload.exp * 1000).toLocaleString();
      } catch (_) { void 0; }
    }
    authActionHtml =
      '<div style="font-size: 11.5px; color: #ef4444; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; line-height: 1.4;">' +
        '⚠️ <strong>Session Token Expired' + (expiredDateStr ? ' (' + escCookieHtml(expiredDateStr) + ')' : '') + '</strong><br>' +
        'Your Qwen session has expired. Click 1-Click Sign In to renew automatically.' +
      '</div>' +
      '<button id="qwen1ClickLoginBtn" class="cr-auth-btn-primary" style="width: 100%; justify-content: center; padding: 10px; font-size: 13px;">' +
        '🚀 Sign In with Qwen (1-Click)' +
      '</button>';
  } else {
    var warningHtml = '';
    if (currentCookie && !hasToken) {
      warningHtml =
        '<div style="font-size: 11.5px; color: #f59e0b; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 6px; padding: 6px 10px; margin-bottom: 10px; line-height: 1.4;">' +
          '⚠️ Active cookie is missing access token (token=eyJ...). Click 1-Click Sign In to authenticate automatically.' +
        '</div>';
    }
    authActionHtml =
      warningHtml +
      '<button id="qwen1ClickLoginBtn" class="cr-auth-btn-primary" style="width: 100%; justify-content: center; padding: 10px; font-size: 13px;">' +
        '🚀 Sign In with Qwen (1-Click)' +
      '</button>';
  }

  if (isExpired) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('coderun_qwen_cookie');
      }
    } catch (_) { void 0; }
    if (typeof window !== 'undefined') {
      window.activeQwenCookie = '';
    }
  }

  var cookieValueForInput = isExpired ? '' : currentCookie;
  var detailsOpenAttr = (cookieValueForInput && !isExpired) ? ' open' : '';
  var html =
    '<div class="cr-qwen-settings-box" id="crQwenSettingsBox">' +
      '<div class="cr-qwen-settings-status">' +
        '<span class="' + dotClass + '" id="qwenStatusDot"></span>' +
        '<span id="qwenStatusText">' + statusText + '</span>' +
      '</div>' +
      '<p style="margin: 0 0 12px 0; font-size: 12px; color: var(--text-secondary); line-height: 1.45;">' +
        'Connect your Qwen account via a standalone browser window. Native Web Search & Image Generation are always active at full capacity.' +
      '</p>' +
      authActionHtml +
      '<div id="qwenLoginWaitingBox" style="display: none; padding: 10px 0; flex-direction: column; gap: 8px; align-items: center;">' +
        '<div style="display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #818cf8; font-weight: 500;">' +
          '<span class="cr-loading-spinner" style="display: inline-block; width: 14px; height: 14px; border: 2px solid #818cf8; border-top-color: transparent; border-radius: 50%; animation: crSpin 0.8s linear infinite;"></span>' +
          '<span id="qwenLoginWaitingMsg">Opening browser window...</span>' +
        '</div>' +
        '<button id="qwenCancelLoginBtn" style="padding: 4px 10px; font-size: 11px; background: transparent; border: 1px solid var(--border); color: var(--text-secondary); border-radius: 4px; cursor: pointer;">Cancel</button>' +
      '</div>' +
      '<details' + detailsOpenAttr + ' style="margin-top: 12px; font-size: 12px; color: var(--text-secondary); cursor: pointer;">' +
        '<summary style="user-select: none; font-weight: 600;">Manual Cookie Entry (Fallback)</summary>' +
        '<div style="margin-top: 8px; display: flex; flex-direction: column; gap: 8px;">' +
          '<p style="margin: 0; font-size: 11px; line-height: 1.4;">Paste your session cookie string (or token starting with eyJ...):</p>' +
          '<textarea id="qwenManualCookieInput" rows="3" style="width: 100%; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; padding: 6px; color: var(--text-primary); font-family: monospace; font-size: 11px; box-sizing: border-box; resize: vertical;" placeholder="token=eyJ...">' + escCookieHtml(cookieValueForInput) + '</textarea>' +
          '<button id="qwenSaveManualCookieBtn" class="cr-auth-btn-primary" style="background: #10b981; justify-content: center; padding: 7px;">Save Cookie</button>' +
        '</div>' +
      '</details>' +
      '<div id="qwenAuthFeedback" style="margin-top: 8px; font-size: 12px; min-height: 16px; font-weight: 500; text-align: center;"></div>' +
    '</div>';

  container.innerHTML = html;

  var loginBtn = document.getElementById('qwen1ClickLoginBtn');
  if (loginBtn) {
    function onStartLogin() {
      var feedback = document.getElementById('qwenAuthFeedback');
      if (feedback) feedback.textContent = '';
      var signedBadge = document.getElementById('qwenSignedInBadge');
      if (signedBadge) signedBadge.style.display = 'none';
      if (loginBtn) loginBtn.style.display = 'none';
      var waitBox = document.getElementById('qwenLoginWaitingBox');
      if (waitBox) waitBox.style.display = 'flex';
      if (window.VSCODE_API && typeof window.VSCODE_API.postMessage === 'function') {
        window.VSCODE_API.postMessage({ type: 'startQwenBrowserLogin' });
      }
    }
    loginBtn.onclick = onStartLogin;
  }

  var cancelBtn = document.getElementById('qwenCancelLoginBtn');
  if (cancelBtn) {
    function onCancelLogin() {
      var signedBadge = document.getElementById('qwenSignedInBadge');
      if (signedBadge) signedBadge.style.display = 'flex';
      var lBtn = document.getElementById('qwen1ClickLoginBtn');
      if (lBtn) lBtn.style.display = '';
      var waitBox = document.getElementById('qwenLoginWaitingBox');
      if (waitBox) waitBox.style.display = 'none';
      if (window.VSCODE_API && typeof window.VSCODE_API.postMessage === 'function') {
        window.VSCODE_API.postMessage({ type: 'cancelQwenBrowserLogin' });
      }
    }
    cancelBtn.onclick = onCancelLogin;
  }

  var manualBtn = document.getElementById('qwenSaveManualCookieBtn');
  if (manualBtn) {
    function onSaveManualCookie() {
      var input = document.getElementById('qwenManualCookieInput');
      var val = input ? input.value.trim() : '';
      var feedback = document.getElementById('qwenAuthFeedback');
      if (!val) {
        if (feedback) {
          feedback.style.color = '#ef4444';
          feedback.textContent = 'Please paste a valid cookie or token.';
        }
        return;
      }
      var isExpiredVal = isQwenTokenExpired(val);
      if (isExpiredVal) {
        if (feedback) {
          feedback.style.color = '#ef4444';
          var payloadExp = parseJwtPayload(val);
          var expTimeStr = (payloadExp && payloadExp.exp) ? new Date(payloadExp.exp * 1000).toLocaleString() : '';
          feedback.textContent = '❌ Error: Pasted token is expired' + (expTimeStr ? ' (' + expTimeStr + ')' : '') + '. Please sign in for a fresh token.';
        }
        return;
      }
      var isTokenValid = hasValidQwenToken(val);
      if (!isTokenValid) {
        if (feedback) {
          feedback.style.color = '#f59e0b';
          feedback.textContent = '⚠️ Notice: Pasted text lacks token=eyJ... Use 1-Click Sign In for full automatic capture.';
        }
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('coderun_qwen_cookie', val);
      }
      window.activeQwenCookie = val;
      if (typeof window.setDashboardQwenCookie === 'function') {
        window.setDashboardQwenCookie(val);
      }
      if (window.VSCODE_API && typeof window.VSCODE_API.postMessage === 'function') {
        window.VSCODE_API.postMessage({
          type: 'saveApiKey',
          provider: 'qwen',
          apiKey: val
        });
        if (isTokenValid && feedback) {
          feedback.style.color = '#10b981';
          feedback.textContent = 'Cookie saved! Refreshing...';
        }
      }
    }
    manualBtn.onclick = onSaveManualCookie;
  }
}

function handleBrowserAuthMessage(message) {
  if (!message) return;
  var msgType = message.type;

  if (msgType === 'qwenLoginWaiting') {
    var btn = document.getElementById('qwen1ClickLoginBtn');
    var waitBox = document.getElementById('qwenLoginWaitingBox');
    var waitMsg = document.getElementById('qwenLoginWaitingMsg');
    var signedBadge = document.getElementById('qwenSignedInBadge');
    if (signedBadge) signedBadge.style.display = 'none';
    if (btn) btn.style.display = 'none';
    if (waitBox) waitBox.style.display = 'flex';
    if (waitMsg && message.message) waitMsg.textContent = message.message;
  } else if (msgType === 'qwenAuthState') {
    if (message.cookie) {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('coderun_qwen_cookie', message.cookie);
      }
      window.activeQwenCookie = message.cookie;
      if (typeof window.setDashboardQwenCookie === 'function') {
        window.setDashboardQwenCookie(message.cookie);
      }
    }
    if (message.authenticated) {
      var activeAuthCard = document.getElementById('cr-active-auth-card');
      if (activeAuthCard) {
        activeAuthCard.innerHTML =
          '<div class="cr-auth-card-inner" style="color: #10b981;">' +
            '<span>✓</span>' +
            '<span style="font-weight: 600; font-size: 13px;">Successfully signed in with Qwen! Ready to chat.</span>' +
          '</div>';
        function removeAuthCardDelayed() {
          if (activeAuthCard && activeAuthCard.parentNode) {
            activeAuthCard.parentNode.removeChild(activeAuthCard);
          }
        }
        setTimeout(removeAuthCardDelayed, 2500);
      }
    }
    var box = document.getElementById('crQwenSettingsBox');
    if (box && box.parentNode) {
      renderQwenSettingsCard(box.parentNode, !!message.authenticated, message.cookie || '');
      var feedback = document.getElementById('qwenAuthFeedback');
      if (feedback) {
        if (message.authenticated) {
          feedback.style.color = '#10b981';
          feedback.textContent = 'Signed in successfully!';
        } else if (message.error) {
          feedback.style.color = '#ef4444';
          feedback.textContent = message.error;
        }
      }
      return;
    }
  } else if (msgType === 'qwenCaptchaWaiting') {
    var captchaBtn = document.getElementById('crCaptchaSolveBtn');
    if (captchaBtn) {
      captchaBtn.disabled = true;
      captchaBtn.innerHTML = '⏳ Waiting for slider puzzle completion...';
    }
  } else if (msgType === 'qwenCaptchaResolved') {
    var activeCard = document.getElementById('cr-active-captcha-card');
    if (activeCard) {
      activeCard.innerHTML =
        '<div class="cr-auth-card-inner" style="color: #10b981;">' +
          '<span>✓</span>' +
          '<span style="font-weight: 600; font-size: 13px;">Security verification completed! Continuing...</span>' +
        '</div>';
      function removeResolvedCard() {
        if (activeCard && activeCard.parentNode) {
          activeCard.parentNode.removeChild(activeCard);
        }
      }
      setTimeout(removeResolvedCard, 2000);
    }
  } else if (msgType === 'qwenCaptchaFailed') {
    var captchaBtn2 = document.getElementById('crCaptchaSolveBtn');
    if (captchaBtn2) {
      captchaBtn2.disabled = false;
      captchaBtn2.innerHTML = '🛡️ Complete Slider Verification';
    }
  }
}

if (typeof window !== 'undefined') {
  window.parseTokenFromCookie = parseTokenFromCookie;
  window.parseJwtPayload = parseJwtPayload;
  window.isQwenTokenExpired = isQwenTokenExpired;
  window.hasValidQwenToken = hasValidQwenToken;
  window.renderQwenSettingsCard = renderQwenSettingsCard;
  window.handleBrowserAuthMessage = handleBrowserAuthMessage;
}
