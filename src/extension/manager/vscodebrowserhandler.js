// vscodebrowserhandler.js (extension side)
// Coordinates VS Code integrated browser requests between UI, tools, and browser manager.
// Pure functions, traditional function declarations only. Zero arrow functions, zero classes.

import * as browserManager from './vscodeBrowserToolsManager.js';

// ==========================================
// HANDLERS
// ==========================================

export async function handleOpenBrowser(message, postMessageFn) {
  var url = message && message.url ? String(message.url).trim() : 'about:blank';
  try {
    var res = await browserManager.openPage(url);
    if (typeof postMessageFn === 'function') {
      postMessageFn({
        type: 'vscodeBrowserState',
        success: true,
        url: res.url,
        title: res.title
      });
    }
  } catch (err) {
    if (typeof postMessageFn === 'function') {
      postMessageFn({
        type: 'vscodeBrowserState',
        success: false,
        error: err.message || String(err)
      });
    }
  }
}

export async function handleGetBrowserState(message, postMessageFn) {
  if (typeof postMessageFn === 'function') {
    postMessageFn({
      type: 'vscodeBrowserState',
      isOpen: browserManager.isBrowserOpen(),
      url: browserManager.getCurrentUrl()
    });
  }
}
