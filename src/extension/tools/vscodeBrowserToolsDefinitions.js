// vscodeBrowserToolsDefinitions.js — Schemas and definitions for VS Code Integrated Browser Tools
// Matches official VS Code browser tools specification (code.visualstudio.com/docs/agents/run/browser-tools)
// Pure functions, traditional function declarations only. Zero arrow functions, zero classes.

// ==========================================
// TOOL DEFINITIONS LIST
// ==========================================

export function getVscodeBrowserToolDefinitions() {
  return [
    {
      name: 'openBrowserPage',
      category: 'browser',
      dangerous: true,
      readOnly: false,
      description: 'Open a URL in the VS Code integrated browser, or connect to an existing tab shared with the agent ("Sharing with Agent"). Returns the page ID, title, and initial DOM summary.',
      parameters: {
        url: {
          type: 'string',
          description: 'The HTTP or HTTPS URL to load. If omitted, connects to the current active shared tab.'
        },
        forceNew: {
          type: 'boolean',
          description: 'Whether to force opening a new page even if an existing tab for this site is already open. Defaults to false.'
        }
      },
      required: []
    },
    {
      name: 'navigatePage',
      category: 'browser',
      dangerous: true,
      readOnly: false,
      description: 'Navigate the current integrated browser page to a new URL, route, or perform history navigation (back/forward/reload).',
      parameters: {
        url: {
          type: 'string',
          description: 'The target destination URL or route (e.g. /dashboard, http://localhost:3000/login)'
        },
        pageId: {
          type: 'string',
          description: 'Optional browser page ID acquired from openBrowserPage or readPage.'
        },
        type: {
          type: 'string',
          enum: ['url', 'back', 'forward', 'reload'],
          description: 'Navigation type. Defaults to "url".'
        }
      },
      required: ['url']
    },
    {
      name: 'readPage',
      category: 'browser',
      dangerous: false,
      readOnly: true,
      description: 'Read the webpage content, accessible interactive elements, and recent console logs from the active shared browser tab ("Sharing with Agent").',
      parameters: {
        pageId: {
          type: 'string',
          description: 'Optional browser page ID acquired from openBrowserPage. Defaults to the active shared page.'
        },
        includeConsole: {
          type: 'boolean',
          description: 'Whether to include recent console logs and runtime error messages. Defaults to true.'
        },
        maxElements: {
          type: 'number',
          description: 'Maximum number of interactive elements to extract. Defaults to 50.'
        }
      },
      required: []
    },
    {
      name: 'screenshotPage',
      category: 'browser',
      dangerous: false,
      readOnly: true,
      description: 'Capture a visual screenshot of the current integrated browser page. Saves to persistent storage and returns the image path.',
      parameters: {
        pageId: {
          type: 'string',
          description: 'Optional browser page ID acquired from openBrowserPage. Defaults to active shared page.'
        },
        fullPage: {
          type: 'boolean',
          description: 'Whether to capture the entire scrollable height or only the visible viewport. Defaults to false.'
        }
      },
      required: []
    },
    {
      name: 'clickElement',
      category: 'browser',
      dangerous: true,
      readOnly: false,
      description: 'Click an interactive button, link, or component on the webpage using an element reference (ref) or CSS selector.',
      parameters: {
        selector: {
          type: 'string',
          description: 'CSS selector or element ref ID (e.g. "#submit-btn", "aria-ref=12", "submit")'
        },
        element: {
          type: 'string',
          description: 'Human-readable description of the element to click (e.g. "Login button", "Hall ticket link")'
        },
        ref: {
          type: 'string',
          description: 'Aria element reference number from readPage summary'
        },
        pageId: {
          type: 'string',
          description: 'Optional browser page ID'
        },
        dblClick: {
          type: 'boolean',
          description: 'Whether to perform a double click'
        },
        button: {
          type: 'string',
          enum: ['left', 'right', 'middle'],
          description: 'Mouse button to click with. Defaults to left.'
        }
      },
      required: ['selector']
    },
    {
      name: 'typeInPage',
      category: 'browser',
      dangerous: true,
      readOnly: false,
      description: 'Enter text into an input field, textarea, or search box on the active browser page.',
      parameters: {
        selector: {
          type: 'string',
          description: 'CSS selector or element ref ID of the input field'
        },
        text: {
          type: 'string',
          description: 'The text value to type into the targeted element'
        },
        ref: {
          type: 'string',
          description: 'Aria element reference number from readPage summary'
        },
        pageId: {
          type: 'string',
          description: 'Optional browser page ID'
        },
        clearFirst: {
          type: 'boolean',
          description: 'Whether to clear existing text before typing. Defaults to true.'
        },
        submit: {
          type: 'boolean',
          description: 'Whether to press Enter after typing'
        }
      },
      required: ['selector', 'text']
    },
    {
      name: 'hoverElement',
      category: 'browser',
      dangerous: false,
      readOnly: false,
      description: 'Hover mouse cursor over a webpage element to trigger hover states, CSS tooltips, or dropdown navigation menus.',
      parameters: {
        selector: {
          type: 'string',
          description: 'CSS selector or element ref ID to hover over'
        },
        ref: {
          type: 'string',
          description: 'Aria element reference number'
        },
        pageId: {
          type: 'string',
          description: 'Optional browser page ID'
        }
      },
      required: ['selector']
    },
    {
      name: 'dragElement',
      category: 'browser',
      dangerous: true,
      readOnly: false,
      description: 'Drag an element and drop it onto another element or specific destination coordinate.',
      parameters: {
        sourceSelector: {
          type: 'string',
          description: 'CSS selector or element ref ID of the element to drag'
        },
        targetSelector: {
          type: 'string',
          description: 'CSS selector or element ref ID of the drop target'
        },
        pageId: {
          type: 'string',
          description: 'Optional browser page ID'
        }
      },
      required: ['sourceSelector', 'targetSelector']
    },
    {
      name: 'handleDialog',
      category: 'browser',
      dangerous: true,
      readOnly: false,
      description: 'Handle a pending browser dialog popup (alert, confirm, or prompt).',
      parameters: {
        action: {
          type: 'string',
          description: 'Action to take: "accept" or "dismiss"'
        },
        promptText: {
          type: 'string',
          description: 'Optional text to enter when responding to a prompt() dialog'
        },
        pageId: {
          type: 'string',
          description: 'Optional browser page ID'
        }
      },
      required: ['action']
    },
    {
      name: 'runPlaywrightCode',
      category: 'browser',
      dangerous: true,
      readOnly: false,
      description: 'Execute a Playwright-style script snippet against the integrated browser page for multi-step automation.',
      parameters: {
        code: {
          type: 'string',
          description: 'JavaScript code snippet interacting with page (e.g. await page.click("#btn");)'
        },
        pageId: {
          type: 'string',
          description: 'Optional browser page ID'
        }
      },
      required: ['code']
    }
  ];
}

// ==========================================
// TOOL ALIAS MAP
// ==========================================

export function getVscodeBrowserToolAliases() {
  return {
    'open_browser_page': 'openBrowserPage',
    'open_browser': 'openBrowserPage',
    'read_page': 'readPage',
    'read_browser': 'readPage',
    'screenshot_page': 'screenshotPage',
    'browser_screenshot': 'screenshotPage',
    'click_element': 'clickElement',
    'browser_click': 'clickElement',
    'type_in_page': 'typeInPage',
    'browser_type': 'typeInPage',
    'navigate_page': 'navigatePage',
    'browser_navigate': 'navigatePage',
    'hover_element': 'hoverElement',
    'drag_element': 'dragElement',
    'handle_dialog': 'handleDialog',
    'run_playwright_code': 'runPlaywrightCode',
    'playwright_code': 'runPlaywrightCode'
  };
}
