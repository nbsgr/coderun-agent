// vscodeBrowserTools.js — Tool implementations for VS Code Integrated Browser
// Each tool is an async generator conforming to CodeRun's tool engine contract.
// Pure functions, traditional function declarations only. Zero arrow functions, zero classes.

import * as browserManager from '../manager/vscodeBrowserToolsManager.js';
import { getVscodeBrowserToolDefinitions, getVscodeBrowserToolAliases } from './vscodeBrowserToolsDefinitions.js';

// ==========================================
// REGISTRATION HELPER
// ==========================================

export function registerVscodeBrowserTools(reg) {
  var defs = getVscodeBrowserToolDefinitions();
  var handlers = {
    'openBrowserPage': openBrowserPage,
    'navigatePage': navigatePage,
    'readPage': readPage,
    'screenshotPage': screenshotPage,
    'clickElement': clickElement,
    'typeInPage': typeInPage,
    'hoverElement': hoverElement,
    'dragElement': dragElement,
    'handleDialog': handleDialog,
    'runPlaywrightCode': runPlaywrightCode
  };

  for (var i = 0; i < defs.length; i++) {
    var def = defs[i];
    var fn = handlers[def.name];
    if (fn) {
      reg(def.name, fn, {
        category: def.category || 'browser',
        dangerous: def.dangerous || false,
        needsPermission: def.dangerous || false,
        readOnly: def.readOnly || false,
        description: def.description,
        parameters: def.parameters,
        required: def.required
      });
    }
  }

  // Register user-friendly aliases
  var aliases = getVscodeBrowserToolAliases();
  for (var alias in aliases) {
    var canonical = aliases[alias];
    var targetFn = handlers[canonical];
    if (targetFn) {
      reg(alias, targetFn, {
        category: 'browser',
        hidden: true,
        description: 'Alias for ' + canonical,
        parameters: {},
        required: []
      });
    }
  }
}

// ==========================================
// TOOL 1: openBrowserPage
// ==========================================

export async function* openBrowserPage(args, context) {
  var url = args && args.url ? String(args.url).trim() : '';
  var forceNew = args && args.forceNew ? Boolean(args.forceNew) : false;

  yield { type: 'action', action: 'Connecting to browser page: ' + (url || 'Active shared tab') };

  try {
    var result = await browserManager.openPage(url, forceNew);
    var backendLabel = result.backend === 'cdp' ? 'separate CodeRun Chromium session' : 'VS Code integrated browser';
    var summaryText = 'Connected to ' + backendLabel + '.\nURL: ' + result.url + '\nTitle: ' + result.title;
    if (result.pageId) {
      summaryText += '\nPage ID: ' + result.pageId;
    }
    if (result.previewOpened === true) {
      summaryText += '\nVS Code Browser Tab: Opened as a separate preview (' + (result.previewCommand || 'workbench.action.browser.open') + '); automation remains in the CDP session.';
    } else if (result.previewOpened === false) {
      summaryText += '\nVS Code Browser Tab: Not opened yet (open or navigate to an http/https/file URL to view it inside VS Code)';
    }
    if (result.summary) {
      summaryText += '\n\nPage Summary:\n' + result.summary;
    }
    yield {
      type: 'result',
      result: summaryText
    };
  } catch (err) {
    yield { type: 'error', error: 'Failed to open browser page: ' + err.message };
  }
}

// ==========================================
// TOOL 2: navigatePage
// ==========================================

export async function* navigatePage(args, context) {
  var url = args && args.url ? String(args.url).trim() : '';
  if (!url) {
    yield { type: 'error', error: 'Missing required parameter: url' };
    return;
  }

  yield { type: 'action', action: 'Navigating browser page to: ' + url };

  try {
    var result = await browserManager.navigate(url, {
      pageId: args && args.pageId,
      type: args && args.type
    });
    var navMsg = 'Navigated ' + (result.backend === 'cdp' ? 'the separate CDP browser session' : 'the VS Code integrated browser') + ' to ' + result.url;
    if (result.backend === 'cdp' && result.previewOpened === true) {
      navMsg += ' (VS Code opened a separate preview via ' + (result.previewCommand || 'workbench.action.browser.open') + ')';
    } else if (result.backend === 'cdp' && result.previewOpened === false) {
      navMsg += ' (VS Code preview unavailable)';
    }
    yield {
      type: 'result',
      result: navMsg
    };
  } catch (err) {
    yield { type: 'error', error: 'Failed to navigate page: ' + err.message };
  }
}

// ==========================================
// TOOL 3: readPage
// ==========================================

export async function* readPage(args, context) {
  var pageId = args && args.pageId ? String(args.pageId).trim() : null;
  var includeConsole = args && args.includeConsole !== undefined ? Boolean(args.includeConsole) : true;
  var maxElements = args && args.maxElements ? Number(args.maxElements) : 50;

  yield { type: 'action', action: 'Reading browser page DOM and live state...' };

  try {
    var data = await browserManager.readPageContent(pageId, includeConsole, maxElements);
    var summary = 'Page Title: ' + data.title + '\nURL: ' + data.url + '\n';
    if (data.backend) {
      summary += 'Backend: ' + (data.backend === 'cdp' ? 'separate CDP browser session' : 'VS Code integrated browser') + '\n';
    }
    if (data.pageId) {
      summary += 'Page ID: ' + data.pageId + '\n';
    }
    summary += '\n';

    if (data.bodyText) {
      summary += 'Content / Accessibility Tree:\n' + data.bodyText + '\n\n';
    }

    if (data.elements && data.elements.length > 0) {
      summary += 'Interactive Elements (' + data.elements.length + '):\n';
      for (var i = 0; i < data.elements.length; i++) {
        var el = data.elements[i];
        summary += ' - [' + el.refId + '] <' + el.tag + '> ' + (el.text ? ('"' + el.text + '"') : '') + (el.id ? (' id=' + el.id) : '') + '\n';
      }
      summary += '\n';
    }

    if (data.consoleLogs && data.consoleLogs.length > 0) {
      summary += 'Recent Console Messages:\n' + data.consoleLogs.join('\n') + '\n';
    }

    yield {
      type: 'result',
      result: summary.trim()
    };
  } catch (err) {
    yield { type: 'error', error: 'Failed to read page content: ' + err.message };
  }
}

// ==========================================
// TOOL 4: screenshotPage
// ==========================================

export async function* screenshotPage(args, context) {
  var fullPage = args && args.fullPage ? Boolean(args.fullPage) : false;
  var pageId = args && args.pageId ? String(args.pageId).trim() : null;

  yield { type: 'action', action: 'Capturing screenshot of browser page...' };

  try {
    var sessionId = (context && context.sessionId) ? context.sessionId : 'browser';
    var shot = await browserManager.captureScreenshot(fullPage, pageId, sessionId);
    yield {
      type: 'result',
      result: 'Screenshot captured successfully.\nFile: ' + shot.filePath + '\nMarkdown: ![Browser Screenshot](' + shot.filePath + ')',
      media: {
        type: 'image',
        filePath: shot.filePath,
        filename: shot.filename,
        url: null
      }
    };
  } catch (err) {
    yield { type: 'error', error: 'Failed to capture screenshot: ' + err.message };
  }
}

// ==========================================
// TOOL 5: clickElement
// ==========================================

export async function* clickElement(args, context) {
  var selector = args && (args.selector || args.ref) ? String(args.selector || args.ref).trim() : '';
  if (!selector) {
    yield { type: 'error', error: 'Missing required parameter: selector or ref' };
    return;
  }

  yield { type: 'action', action: 'Clicking element: ' + selector };

  try {
    var result = await browserManager.click(selector, {
      element: args && args.element,
      ref: args && args.ref,
      pageId: args && args.pageId,
      dblClick: args && args.dblClick,
      button: args && args.button
    });
    yield {
      type: 'result',
      result: result.message
    };
  } catch (err) {
    yield { type: 'error', error: 'Failed to click element: ' + err.message };
  }
}

// ==========================================
// TOOL 6: typeInPage
// ==========================================

export async function* typeInPage(args, context) {
  var selector = args && (args.selector || args.ref) ? String(args.selector || args.ref).trim() : '';
  var text = args && args.text !== undefined ? String(args.text) : '';
  if (!selector) {
    yield { type: 'error', error: 'Missing required parameter: selector or ref' };
    return;
  }

  yield { type: 'action', action: 'Typing into element: ' + selector };

  try {
    var result = await browserManager.typeText(selector, text, {
      ref: args && args.ref,
      pageId: args && args.pageId,
      clearFirst: args && args.clearFirst !== undefined ? Boolean(args.clearFirst) : true,
      submit: args && args.submit
    });
    yield {
      type: 'result',
      result: result.message
    };
  } catch (err) {
    yield { type: 'error', error: 'Failed to type in page: ' + err.message };
  }
}

// ==========================================
// TOOL 7: hoverElement
// ==========================================

export async function* hoverElement(args, context) {
  var selector = args && (args.selector || args.ref) ? String(args.selector || args.ref).trim() : '';
  if (!selector) {
    yield { type: 'error', error: 'Missing required parameter: selector or ref' };
    return;
  }

  yield { type: 'action', action: 'Hovering over element: ' + selector };

  try {
    var result = await browserManager.hover(selector, {
      ref: args && args.ref,
      pageId: args && args.pageId
    });
    yield {
      type: 'result',
      result: result.message
    };
  } catch (err) {
    yield { type: 'error', error: 'Failed to hover element: ' + err.message };
  }
}

// ==========================================
// TOOL 8: dragElement
// ==========================================

export async function* dragElement(args, context) {
  var sourceSelector = args && args.sourceSelector ? String(args.sourceSelector).trim() : '';
  var targetSelector = args && args.targetSelector ? String(args.targetSelector).trim() : '';
  if (!sourceSelector || !targetSelector) {
    yield { type: 'error', error: 'Missing required parameters: sourceSelector and targetSelector' };
    return;
  }

  yield { type: 'action', action: 'Dragging element: ' + sourceSelector + ' to ' + targetSelector };

  try {
    var result = await browserManager.drag(sourceSelector, targetSelector, args && args.pageId);
    yield {
      type: 'result',
      result: result.message
    };
  } catch (err) {
    yield { type: 'error', error: 'Failed to drag element: ' + err.message };
  }
}

// ==========================================
// TOOL 9: handleDialog
// ==========================================

export async function* handleDialog(args, context) {
  var action = args && args.action ? String(args.action).trim() : 'accept';
  var promptText = args && args.promptText ? String(args.promptText) : '';

  yield { type: 'action', action: 'Handling browser dialog: ' + action };

  try {
    var result = await browserManager.handleDialogAction(action, promptText, args && args.pageId);
    yield {
      type: 'result',
      result: result.message
    };
  } catch (err) {
    yield { type: 'error', error: 'Failed to handle dialog: ' + err.message };
  }
}

// ==========================================
// TOOL 10: runPlaywrightCode
// ==========================================

export async function* runPlaywrightCode(args, context) {
  var code = args && args.code ? String(args.code).trim() : '';
  if (!code) {
    yield { type: 'error', error: 'Missing required parameter: code' };
    return;
  }

  yield { type: 'action', action: 'Executing Playwright automation snippet...' };

  try {
    var sessionId = (context && context.sessionId) ? context.sessionId : 'browser';
    var result = await browserManager.evaluateCode(code, args && args.pageId, sessionId);
    yield {
      type: 'result',
      result: typeof result.evalResult === 'string' ? result.evalResult : JSON.stringify(result.evalResult, null, 2)
    };
  } catch (err) {
    yield { type: 'error', error: 'Failed to execute Playwright code: ' + err.message };
  }
}
