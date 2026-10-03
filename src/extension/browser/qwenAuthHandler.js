// qwenAuthHandler.js (extension side)
// Coordinates IPC messages between UI Webview and browserLoginManager for 1-Click login & slider CAPTCHA.
// Strict traditional function declarations only.

import * as vscode from 'vscode';
import * as config from '../agents/config.js';
import { startBrowserLogin, cancelBrowserLogin, startCaptchaVerification } from './browserLoginManager.js';
import { refreshAllProviderModels } from '../manager/modelshandler.js';
import * as providerQwen from './providerQwen.js';

export function handleStartQwenBrowserLogin(webview, extensionContext, statusBarItem) {
  if (webview && typeof webview.postMessage === 'function') {
    webview.postMessage({
      type: 'qwenLoginWaiting',
      message: 'Opening browser window... Please sign in to your Qwen account.'
    });
  }

  function onLoginSuccess(fullCookieStr, tokenValue, fullLocalStorage) {
    console.log('[QWEN AUTH] Browser login succeeded! Saving cookie & storage...');
    try {
      providerQwen.setLastCookie(fullCookieStr);
    } catch (_) { void 0; }

    config.setApiKey(extensionContext, fullCookieStr, 'qwen').then(function afterSaveKey() {
      var existingCfg = config.getSavedProviderConfig(extensionContext, 'qwen') || {};
      config.saveProviderConfig(extensionContext, 'qwen', {
        baseUrl: 'https://chat.qwen.ai',
        model: existingCfg.model || 'qwen3.8-max',
        apiType: 'openai'
      }).then(function afterSaveConfig() {
        if (webview && typeof webview.postMessage === 'function') {
          webview.postMessage({
            type: 'qwenAuthState',
            authenticated: true,
            cookie: fullCookieStr
          });
        }
        vscode.window.showInformationMessage('CodeRun: Successfully signed in with Qwen!');
        if (extensionContext) {
          refreshAllProviderModels(webview, extensionContext, statusBarItem);
        }
      });
    });
  }

  function onLoginError(err) {
    console.error('[QWEN AUTH] Browser login error:', err ? err.message : err);
    if (webview && typeof webview.postMessage === 'function') {
      webview.postMessage({
        type: 'qwenAuthState',
        authenticated: false,
        error: err ? err.message : 'Unknown login error'
      });
    }
    vscode.window.showErrorMessage('CodeRun Qwen Login Error: ' + (err ? err.message : 'Unknown error'));
  }

  function onLoginCancel() {
    console.log('[QWEN AUTH] Browser login window was closed or cancelled.');
    if (webview && typeof webview.postMessage === 'function') {
      webview.postMessage({
        type: 'qwenAuthState',
        authenticated: false,
        error: 'Login window was closed.'
      });
    }
  }

  startBrowserLogin({
    url: 'https://chat.qwen.ai',
    cookieName: 'token'
  }, onLoginSuccess, onLoginError, onLoginCancel);
}

export function handleCancelQwenBrowserLogin(webview) {
  cancelBrowserLogin();
  if (webview && typeof webview.postMessage === 'function') {
    webview.postMessage({
      type: 'qwenAuthState',
      authenticated: false,
      error: 'Login cancelled.'
    });
  }
}

export function handleSolveQwenCaptcha(message, webview, extensionContext) {
  var captchaUrl = (message && message.captchaUrl) || 'https://chat.qwen.ai';
  if (webview && typeof webview.postMessage === 'function') {
    webview.postMessage({
      type: 'qwenCaptchaWaiting',
      message: 'Opening verification window... Please complete the slider puzzle.'
    });
  }

  function onCaptchaSuccess(fullCookieStr) {
    console.log('[QWEN AUTH] Captcha solved! Saving updated cookies with x5sec...');
    config.setApiKey(extensionContext, fullCookieStr, 'qwen').then(function afterCookieSave() {
      if (webview && typeof webview.postMessage === 'function') {
        webview.postMessage({
          type: 'qwenCaptchaResolved',
          message: 'Security verification completed! You can now continue your chat.'
        });
      }
      vscode.window.showInformationMessage('CodeRun: Qwen security verification completed!');
    });
  }

  function onCaptchaError(err) {
    console.error('[QWEN AUTH] Captcha verification error:', err ? err.message : err);
    if (webview && typeof webview.postMessage === 'function') {
      webview.postMessage({
        type: 'qwenCaptchaFailed',
        error: err ? err.message : 'Verification failed'
      });
    }
    vscode.window.showErrorMessage('CodeRun Verification Error: ' + (err ? err.message : 'Verification failed'));
  }

  function onCaptchaCancel() {
    console.log('[QWEN AUTH] Verification window was closed.');
    if (webview && typeof webview.postMessage === 'function') {
      webview.postMessage({
        type: 'qwenCaptchaFailed',
        error: 'Verification window was closed.'
      });
    }
  }

  config.getApiKey(extensionContext, 'qwen').then(function withExistingCookie(existingCookie) {
    startCaptchaVerification({
      url: captchaUrl,
      existingCookie: existingCookie || ''
    }, onCaptchaSuccess, onCaptchaError, onCaptchaCancel);
  });
}
