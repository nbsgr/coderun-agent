// browser-cards.js (UI side)
// Renders interactive in-chat cards for slider CAPTCHA solving and session expired recovery.
// Strict traditional function declarations only.

function renderCaptchaCard(botBody, captchaUrl) {
  if (!botBody) return;
  var existing = document.getElementById('cr-active-captcha-card');
  if (existing) {
    existing.removeAttribute('id');
  }

  var card = document.createElement('div');
  card.className = 'cr-auth-card cr-captcha-card';
  card.id = 'cr-active-captcha-card';
  card.innerHTML =
    '<div class="cr-auth-card-inner">' +
      '<div class="cr-auth-card-icon">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>' +
      '</div>' +
      '<div class="cr-auth-card-content">' +
        '<div class="cr-auth-card-title">Security Verification Required</div>' +
        '<div class="cr-auth-card-desc">Alibaba Cloud requires a quick one-time slider puzzle before sending messages.</div>' +
        '<div class="cr-auth-card-actions">' +
          '<button id="crCaptchaSolveBtn" class="cr-auth-btn-primary">🛡️ Complete Slider Verification</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  var btn = card.querySelector('#crCaptchaSolveBtn');
  if (btn) {
    function onSolveClick() {
      btn.disabled = true;
      btn.innerHTML = '⏳ Opening verification window...';
      if (window.VSCODE_API && typeof window.VSCODE_API.postMessage === 'function') {
        window.VSCODE_API.postMessage({
          type: 'solveQwenCaptcha',
          captchaUrl: captchaUrl || 'https://chat.qwen.ai'
        });
      }
    }
    btn.onclick = onSolveClick;
  }

  botBody.appendChild(card);
}

function renderAuthErrorCard(botBody) {
  if (!botBody) return;
  var existing = document.getElementById('cr-active-auth-card');
  if (existing) {
    existing.removeAttribute('id');
  }

  var card = document.createElement('div');
  card.className = 'cr-auth-card';
  card.id = 'cr-active-auth-card';
  card.innerHTML =
    '<div class="cr-auth-card-inner">' +
      '<div class="cr-auth-card-icon">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>' +
      '</div>' +
      '<div class="cr-auth-card-content">' +
        '<div class="cr-auth-card-title">Qwen Session Expired</div>' +
        '<div class="cr-auth-card-desc">Your Qwen browser session has expired. Sign in again to continue your conversation.</div>' +
        '<div class="cr-auth-card-actions">' +
          '<button id="crAuthSignInBtn" class="cr-auth-btn-primary">🚀 1-Click Sign In with Qwen</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  var btn = card.querySelector('#crAuthSignInBtn');
  if (btn) {
    function onSignInClick() {
      btn.disabled = true;
      btn.innerHTML = '⏳ Opening login window...';
      if (window.VSCODE_API && typeof window.VSCODE_API.postMessage === 'function') {
        window.VSCODE_API.postMessage({ type: 'startQwenBrowserLogin' });
      }
    }
    btn.onclick = onSignInClick;
  }

  botBody.appendChild(card);
}

if (typeof window !== 'undefined') {
  window.renderCaptchaCard = renderCaptchaCard;
  window.renderAuthErrorCard = renderAuthErrorCard;
}
