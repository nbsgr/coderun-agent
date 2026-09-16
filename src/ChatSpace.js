// ChatSpace.js — CodeRun Agent Chat UI
// Handles: message posting, permission requests, event streaming,
// terminal streaming, collapsible tool cards, status timeline
// New prefix: cr- (coderun)

function initializeChatSpace() {
  'use strict';

  var I = {
    bot:    '<img class="cr-bot-avatar-img" src="' + (window.CODERUN_BOT_AVATAR || 'bot-avatar.jpg') + '" alt="Bot" onerror="this.outerHTML=\'<svg class=\\\'cr-icon\\\' viewBox=\\\'0 0 24 24\\\' fill=\\\'currentColor\\\'><path d=\\\'M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7H4a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2zM7 14v2a1 1 0 1 0 2 0v-2H7zm8 0v2a1 1 0 1 0 2 0v-2h-2zM5 20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1H5v1z\\\'/></svg>\'"/>',
    send:   '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    attach: '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    think:  '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>',
    tool:   '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    check:  '<svg class="cr-icon cr-icon--check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
    spin:   '<svg class="cr-icon cr-spin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.2"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>',
    err:    '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/></svg>',
    src:    '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    close:  '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    empty:  '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    stop:   '<svg class="cr-icon" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    copy:   '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    play:   '<svg class="cr-icon" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
    file:   '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    folder: '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    terminal: '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
    chevron: '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>',
    wrench: '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    barChart: '<svg class="cr-icon cr-usage-hdr-icon" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="11" width="3.5" height="10" rx="1"/><rect x="10.25" y="5" width="3.5" height="16" rx="1"/><rect x="17.5" y="2" width="3.5" height="19" rx="1"/></svg>',
    database: '<svg class="cr-icon cr-metric-icon cr-metric-icon--db" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    arrowUp:  '<svg class="cr-icon cr-metric-icon cr-metric-icon--up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
    arrowDown:'<svg class="cr-icon cr-metric-icon cr-metric-icon--down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>',
    gear:     '<svg class="cr-icon cr-metric-icon cr-metric-icon--gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    clock:    '<svg class="cr-icon cr-metric-icon cr-metric-icon--clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
  };

  // Shared utilities from webview-shared.js — single source of truth
  function defaultEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var esc = window.sharedEsc || defaultEsc;

  function defaultTruncate(s, n) { return s.length > n ? s.substring(0, n) + '\u2026' : s; }
  var truncate = window.sharedTruncate || defaultTruncate;

  function defaultFlatStr(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }
  var flatStr = window.sharedFlatStr || defaultFlatStr;

  function defaultFormatTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  var formatTime = window.sharedFormatTime || defaultFormatTime;

  function defaultStripAnsi(text) {
    if (!text) return '';
    return String(text)
      .replace(/\x1B\]\d+(?:;[^\x1B]*)*(?:\x1B\\)/g, '')
      .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1B\][^\x1B]*[\x07\x1B]/g, '')
      .replace(/\x07/g, '')
      .replace(/\x1B[\x5D\x5B][^\x1B]*[\x07\x5C]/g, '')
      .replace(/\x1B[\[\]()][0-9;]*[~A-Za-z]/g, '')
      .replace(/\x1B[\[\]()]/g, '')
      .replace(/\x1B[^\[\]()\s]/g, '')
      .replace(/\]633;/g, '')
      .replace(/\]133;/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
  }
  var stripAnsi = window.sharedStripAnsi || defaultStripAnsi;

  function md(text) {
    if (!text) return '';
    if (typeof window.renderMarkdown === 'function') return window.renderMarkdown(text);
    return esc(text).replace(/\n/g, '<br>');
  }

  function mk(tag, cls) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }

  function fmtActionLabel(action, args) {
    return 'Executing action <span class="cr-action-name">' + esc(action) + '</span>';
  }

  function scrollBottom(el) {
    if (!el) return;
    var lastChild = el.lastElementChild;
    var hasPendingPermissions = lastChild && lastChild.querySelector('.cr-permission-actions button') !== null;
    if (hasPendingPermissions) {
      return;
    }
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }

  // ── RAF-coalesced smooth scroll (avoids layout thrashing) ───
  var _scrollRAF = null;
  function handleScrollRAF(el) {
    _scrollRAF = null;
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }

  function scrollBottomSmooth(el) {
    if (!el) return;
    var lastChild = el.lastElementChild;
    var hasPendingPermissions = lastChild && lastChild.querySelector('.cr-permission-actions button') !== null;
    if (hasPendingPermissions) return;
    if (_scrollRAF) return;
    function onScrollRAF() { handleScrollRAF(el); }
    _scrollRAF = requestAnimationFrame(onScrollRAF);
  }

  // ── Debounced markdown render for streaming content ───
  var _renderTimer = null;
  function handleContentRenderTimeout(S) {
    _renderTimer = null;
    if (S.contentDiv && S.contentText !== undefined) {
      S.contentDiv.innerHTML = md(S.contentText);
    }
  }

  function scheduleContentRender(S) {
    if (_renderTimer) return;
    function onRenderTimeout() { handleContentRenderTimeout(S); }
    _renderTimer = setTimeout(onRenderTimeout, 30);
  }

  function flushContentRender(S) {
    if (_renderTimer) {
      clearTimeout(_renderTimer);
      _renderTimer = null;
    }
    if (S.contentDiv && S.contentText !== undefined) {
      S.contentDiv.innerHTML = md(S.contentText);
    }
  }

  function closeCurrentContentBlock(S) {
    flushContentRender(S);
    if (S.contentDiv) {
      if (!S.contentText || !S.contentText.trim()) {
        if (S.contentDiv.parentNode) {
          S.contentDiv.parentNode.removeChild(S.contentDiv);
        }
      }
    }
    S.contentDiv = null;
    S.contentText = '';
  }

  // ── Auto-hide completed todos timer ──────────────────
  var _todosAutoHideTimer = null;
  function clearTodosAutoHideTimer() {
    if (_todosAutoHideTimer) {
      clearTimeout(_todosAutoHideTimer);
      _todosAutoHideTimer = null;
    }
  }

  function handleTodosAutoHide(panel) {
    _todosAutoHideTimer = null;
    if (!panel) return;
    panel.style.transition = 'opacity 0.4s ease';
    panel.style.opacity = '0';
    function onFadeOutDone() {
      panel.style.display = 'none';
      panel.style.opacity = '1';
      panel.style.transition = '';
    }
    setTimeout(onFadeOutDone, 400);
  }

  // ── Tool name formatter ──────────────────────────────
  function formatToolName(name) {
    var map = {
      'read_file': 'Read File',
      'write_file': 'Write File',
      'edit_file': 'Edit File',
      'delete_file': 'Delete File',
      'create_folder': 'Create Folder',
      'delete_folder': 'Delete Folder',
      'list_directory': 'List Directory',
      'search_files': 'Search Files',
      'get_file_info': 'File Info',
      'run_terminal': 'Run Terminal',
      'terminal_input': 'Terminal Input',
      'stop_terminal': 'Stop Terminal',
      'create_plan': 'Create Plan',
      'update_plan': 'Update Plan',
      'get_current_datetime': 'Get Datetime',
      'sandbox': 'User Sandbox',
      'ask_question': 'ask_question',
      'spawn_subagent': 'Spawn Subagent',
      'subagent_response': 'Subagent Response',
      'subagent_status': 'Subagent Status',
      'subagents_list': 'Subagents List',
      'stop_subagent': 'Stop Subagent',
      'wait_for_subagent': 'Wait For Subagent',
      'pause_subagent': 'Pause Subagent',
      'resume_subagent': 'Resume Subagent'
    };
    if (map[name]) return map[name];
    if (!name) return 'Tool';
    if (name.startsWith('mcp__puppeteer__') || name.startsWith('puppeteer_')) {
      var puppeteerAction = name.replace(/^mcp__puppeteer__/, '').replace(/^puppeteer_/, '');
      return 'Browser: ' + puppeteerAction.replace(/_/g, ' ');
    }
    if (name.startsWith('mcp__memory__') || name.startsWith('memory_')) {
      var memoryAction = name.replace(/^mcp__memory__/, '').replace(/^memory_/, '');
      return 'Memory: ' + memoryAction.replace(/_/g, ' ');
    }
    if (name.startsWith('mcp__')) {
      var parts = name.split('__');
      var sName = parts[1] || 'MCP';
      var tName = parts[2] || parts[1];
      return sName + ': ' + tName.replace(/_/g, ' ');
    }
    return name.replace(/_/g, ' ');
  }

  function getToolSubtitle(toolName, args) {
    if (!args) return '';
    if (toolName === 'spawn_subagent' || toolName === 'subagent_response') {
      var rolePrefix = args.role ? '[' + String(args.role).toUpperCase() + '] ' : '';
      var subTitleName = args.name || args.agentId || args.id || '';
      return rolePrefix + (subTitleName ? subTitleName + ' — ' : '') + (args.task ? truncate(args.task, 40) : '');
    }
    if (toolName === 'wait_for_subagent') {
      return args.name ? (args.name + ' (' + (args.agentId || '') + ')') : (args.agentId || '');
    }
    if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'edit_file' || toolName === 'delete_file') {
      return args.path || args.file_path || args.target_file || '';
    }
    if (toolName === 'run_terminal') {
      return args.command || '';
    }
    if (toolName === 'ask_question') {
      return args.question || '';
    }
    if (toolName === 'list_directory' || toolName === 'create_folder' || toolName === 'delete_folder') {
      return args.path || args.dir_path || args.directory_path || '';
    }
    if (toolName === 'search_files') {
      return args.query || args.regex || args.pattern || '';
    }
    if (toolName === 'get_file_info') {
      return args.path || '';
    }
    return args.command || args.path || args.file_path || args.target_file || args.url || args.message || args.query || '';
  }

  function sanitizeToolArgs(args) {
    if (!args || typeof args !== 'object') return args;
    var clean = {};
    var keys = Object.keys(args);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!k.startsWith('_')) {
        clean[k] = args[k];
      }
    }
    return clean;
  }

  // ── Tool icon selector ───────────────────────────────
  function getToolIcon(name) {
    var iconMap = {
      'read_file': '📄',
      'write_file': '✏️',
      'edit_file': '📝',
      'delete_file': '🗑️',
      'create_folder': '📁',
      'delete_folder': '🗑️',
      'list_directory': '📂',
      'search_files': '🔍',
      'get_file_info': 'ℹ️',
      'run_terminal': '💻',
      'terminal_input': '⌨️',
      'stop_terminal': '🛑',
      'create_plan': '📋',
      'update_plan': '📋',
      'get_current_datetime': '🕒',
      'sandbox': '📦',
      'ask_question': I.wrench,
      'spawn_subagent': '🤖',
      'subagent_response': '🤖',
      'wait_for_subagent': '⏳',
      'subagent_status': '📊',
      'subagents_list': '👥'
    };
    if (iconMap[name]) return iconMap[name];
    if (name && (name.includes('puppeteer') || name.includes('browser'))) {
      return '🌐';
    }
    if (name && name.includes('memory')) {
      return '🧠';
    }
    if (name && name.includes('github')) {
      return '🐙';
    }
    return '🛠️';
  }

  function toUpperCaseChar(c) {
    return c.toUpperCase();
  }

  function noop() {}

  function clearStatusLines(S) {
    if (S.statusLines && S.statusLines.length) {
      for (var i = 0; i < S.statusLines.length; i++) {
        var el = S.statusLines[i];
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }
      S.statusLines = [];
    }
  }

  function clearStreamTurn(chatCtx) {
    var S = chatCtx.S;
    if (_renderTimer) { clearTimeout(_renderTimer); _renderTimer = null; }
    if (_scrollRAF) { cancelAnimationFrame(_scrollRAF); _scrollRAF = null; }
    S.thinkBlock = null; S.thinkPre = null; S.thinkText = '';
    S.fullThinking = ''; S.iterationThinking = '';
    S.contentDiv = null; S.contentText = '';
    S.actionList = null; S.actionMap = {};
    S.sources = [];
    S.toolCallBlocks = {};
    S.iterationCount = 0;
    clearStatusLines(S);
    S._terminalCards = {};
    S._activeTerminalId = null;
    S._terminalCardOrder = [];
    S.toolCards = {};
    S._toolQueue = [];
    S._toolIdCounter = 0;
    S._seenToolIds = {};
    S._currentCheckpoints = [];
    S.timeline = null;
    S._toolCalls = [];
    if (chatCtx.todosPanel) {
      if (chatCtx.conversation && chatCtx.conversation.plan) {
        renderTodos(chatCtx, chatCtx.conversation.plan);
      } else {
        chatCtx.todosPanel.style.display = 'none';
      }
    }
    if (chatCtx.controlsPanel) chatCtx.controlsPanel.style.display = 'none';

    var baseUsage = (chatCtx.conversation && chatCtx.conversation.usage) || S.sessionUsage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, context_tokens: 0 };
    S.turnStartUsage = {
      prompt_tokens: baseUsage.prompt_tokens || 0,
      completion_tokens: baseUsage.completion_tokens || 0,
      total_tokens: baseUsage.total_tokens || 0,
      context_tokens: baseUsage.context_tokens || 0
    };
    S.currentTurnUsage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };
  }

  function parseChecklistItems(planStr) {
    if (typeof planStr !== 'string') return [];
    var items = [];
    var lines = planStr.split('\n');
    var autoId = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var match = line.match(/^[-*]\s*\[([ \/xX!→>✓])\]\s*(?:#?([0-9a-zA-Z_.-]+)\s*:?|\b(\d+)[.)]\s*)?\s*(.*)$/);
      if (match) {
        autoId++;
        items.push({
          mark: match[1],
          id: match[2] || match[3] || String(autoId),
          desc: match[4] || ''
        });
      }
    }
    return items;
  }

  function extractPlanString(plan) {
    if (!plan) return '';
    if (typeof plan === 'string') return plan;
    if (typeof plan.rawPlan === 'string' && plan.rawPlan.trim()) return plan.rawPlan;
    return '';
  }

  function mergeChatPlan(existingPlan, newPlan) {
    if (!existingPlan) return newPlan;
    if (!newPlan) return existingPlan;

    var existingStr = extractPlanString(existingPlan);
    var newStr = extractPlanString(newPlan);

    if (!existingStr && !newStr) {
      return newPlan;
    }
    if (!existingStr) return newPlan;
    if (!newStr) return existingPlan;

    var existingItems = parseChecklistItems(existingStr);
    var newItems = parseChecklistItems(newStr);

    if (!existingItems.length) return newStr;
    if (!newItems.length) return existingStr;

    var mergedMap = {};
    var orderList = [];

    for (var i = 0; i < existingItems.length; i++) {
      var item = existingItems[i];
      mergedMap[item.id] = item;
      orderList.push(item.id);
    }

    for (var j = 0; j < newItems.length; j++) {
      var newItem = newItems[j];
      if (mergedMap[newItem.id]) {
        mergedMap[newItem.id].mark = newItem.mark;
        mergedMap[newItem.id].desc = newItem.desc;
      } else {
        mergedMap[newItem.id] = newItem;
        orderList.push(newItem.id);
      }
    }

    var lines = [];
    for (var k = 0; k < orderList.length; k++) {
      var key = orderList[k];
      var itm = mergedMap[key];
      lines.push('- [' + itm.mark + '] ' + itm.id + ' ' + itm.desc);
    }
    return lines.join('\n');
  }

  function renderTodos(chatCtx, plan) {
    if (!chatCtx.todosPanel) return;
    clearTodosAutoHideTimer();
    chatCtx.todosPanel.style.opacity = '1';
    chatCtx.todosPanel.style.transition = '';

    if (!plan) {
      chatCtx.todosPanel.style.display = 'none';
      return;
    }

    var steps = [];
    var planString = extractPlanString(plan);

    if (planString) {
      var lines = planString.split('\n');
      var autoId = 0;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        var match = line.match(/^[-*]\s*\[([ \/xX!→>✓])\]\s*(?:#?([0-9a-zA-Z_.-]+)\s*:?|\b(\d+)[.)]\s*)?\s*(.*)$/);
        if (match) {
          autoId++;
          var mark = match[1];
          var id = match[2] || match[3] || String(autoId);
          var desc = match[4] || '';
          var status = 'pending';
          if (mark === '/' || mark === '→' || mark === '>') status = 'active';
          if (mark === 'x' || mark === 'X' || mark === '✓') status = 'completed';
          if (mark === '!') status = 'failed';
          steps.push({ id: id, description: desc, status: status });
        }
      }
    } else if (plan.phases && plan.phases.length) {
      for (var pi = 0; pi < plan.phases.length; pi++) {
        var ph = plan.phases[pi];
        if (ph.tasks) {
          for (var ti = 0; ti < ph.tasks.length; ti++) {
            var t = ph.tasks[ti];
            steps.push({
              id: t.id,
              description: '[' + ph.name + '] ' + t.description,
              status: t.status
            });
          }
        }
      }
    } else if (plan.steps) {
      steps = plan.steps;
    }

    if (!steps || !steps.length) {
      chatCtx.todosPanel.style.display = 'none';
      return;
    }

    var completedCount = 0;
    for (var i = 0; i < steps.length; i++) {
      if (steps[i] && steps[i].status === 'completed') {
        completedCount++;
      }
    }
    var totalCount = steps.length;
    var allDone = totalCount > 0 && completedCount === totalCount;

    chatCtx.todosPanel.style.display = 'block';
    if (chatCtx.todosPanel.dataset.collapsed == null && allDone) {
      chatCtx.todosPanel.dataset.collapsed = 'true';
    }
    var isCollapsed = chatCtx.todosPanel.dataset.collapsed === 'true';

    var stepsHtml = '';
    for (var si = 0; si < steps.length; si++) {
      var s = steps[si];
      var statusIcon = '';
      if (s.status === 'completed') {
        statusIcon = '<span class="cr-todo-status completed">' + I.check + '</span>';
      } else if (s.status === 'active' || s.status === 'in_progress') {
        statusIcon = '<span class="cr-todo-status active"><span class="cr-todo-pulse"></span></span>';
      } else if (s.status === 'failed') {
        statusIcon = '<span class="cr-todo-status failed">❌</span>';
      } else {
        statusIcon = '<span class="cr-todo-status pending"><span class="cr-todo-circle"></span></span>';
      }
      stepsHtml +=
        '<div class="cr-todo-item">' +
          statusIcon +
          '<span class="cr-todo-text">' + esc(s.description) + '</span>' +
        '</div>';
    }

    var titleSuffix = allDone ? ' ✓' : '';
    chatCtx.todosPanel.innerHTML =
      '<div class="cr-todos-header">' +
        '<span class="cr-todos-toggle">' + (isCollapsed ? '▶' : '▼') + '</span>' +
        '<span class="cr-todos-title">Todos (' + completedCount + '/' + totalCount + ')' + titleSuffix + '</span>' +
        '<span class="cr-todos-icon"><svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg></span>' +
      '</div>' +
      '<div class="cr-todos-list" style="display:' + (isCollapsed ? 'none' : 'block') + '">' +
        stepsHtml +
      '</div>';

    var header = chatCtx.todosPanel.querySelector('.cr-todos-header');
    function onTodosHeaderClick() {
      handleTodosHeaderClick(chatCtx, plan);
    }
    header.onclick = onTodosHeaderClick;

    if (allDone) {
      function onAutoHideTick() {
        handleTodosAutoHide(chatCtx.todosPanel);
      }
      _todosAutoHideTimer = setTimeout(onAutoHideTick, 5000);
    }
  }

  function handleTodosHeaderClick(chatCtx, plan) {
    var collapsed = chatCtx.todosPanel.dataset.collapsed === 'true';
    chatCtx.todosPanel.dataset.collapsed = !collapsed;
    renderTodos(chatCtx, plan);
  }

  function updateRunningSubagentsPanel(chatCtx) {
    if (!chatCtx) return;
    var panel = chatCtx.runningSubagentsPanel;
    if (!panel) return;
    var subMap = chatCtx.runningSubagents || {};
    var subKeys = Object.keys(subMap);
    if (!subKeys.length) {
      panel.style.display = 'none';
      panel.innerHTML = '';
      return;
    }

    panel.style.display = 'block';
    var html = '<div class="cr-running-subagents-header">' +
      '<span class="cr-running-subagents-dot"></span>' +
      '<span>Running Subagents (' + subKeys.length + ')</span>' +
      '</div>' +
      '<div class="cr-running-subagents-list">';

    for (var i = 0; i < subKeys.length; i++) {
      var k = subKeys[i];
      var s = subMap[k];
      var roleName = String(s.role || 'coder').toLowerCase();
      var roleCls = 'role-' + roleName;
      var roleBadge = '[' + roleName.toUpperCase() + ']';
      var sName = s.name || s.id || 'Subagent';
      var sTool = s.currentTool ? '(' + s.currentTool + ')' : '(running)';
      var sId = s.id || k;

      html += '<div class="cr-running-subagent-chip" data-subagent-id="' + esc(sId) + '">' +
        '<div class="cr-running-subagent-left">' +
          '<span class="cr-running-subagent-badge ' + esc(roleCls) + '">' + esc(roleBadge) + '</span>' +
          '<span class="cr-running-subagent-name" title="' + esc(s.task || sName) + '">' + esc(sName) + '</span>' +
          '<span class="cr-running-subagent-tool">' + esc(sTool) + '</span>' +
        '</div>' +
        '<button type="button" class="cr-running-subagent-link" data-subagent-id="' + esc(sId) + '" title="View subagent in Subagents tab">Execution ↗</button>' +
        '</div>';
    }
    html += '</div>';
    panel.innerHTML = html;

    var links = panel.querySelectorAll('.cr-running-subagent-link');
    for (var li = 0; li < links.length; li++) {
      function onRunningSubLinkClick(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var aId = ev.currentTarget.getAttribute('data-subagent-id');
        if (window.switchDashboardSubView) {
          window.switchDashboardSubView('subagents', aId);
        }
      }
      links[li].onclick = onRunningSubLinkClick;
    }
  }

  function resolvePermissionItem(chatCtx, id, act) {
    if (!chatCtx) return;
    var item = null;
    var qIndex = -1;
    if (chatCtx.permissionQueue && chatCtx.permissionQueue.length) {
      for (var qi = 0; qi < chatCtx.permissionQueue.length; qi++) {
        if (chatCtx.permissionQueue[qi].id === id) {
          item = chatCtx.permissionQueue[qi];
          qIndex = qi;
          break;
        }
      }
    }
    if (!item && chatCtx.permissionQueue && chatCtx.permissionQueue.length) {
      item = chatCtx.permissionQueue[0];
      qIndex = 0;
    }
    if (qIndex !== -1) {
      chatCtx.permissionQueue.splice(qIndex, 1);
    }
    var isAllow = act === 'allow' || act === 'always-allow';
    var isAlways = act === 'always-allow' || act === 'always-deny';
    var label = isAlways
      ? (isAllow ? '✓ Always Allowed' : '✗ Always Denied')
      : (isAllow ? '✓ Allowed' : '✗ Denied');

    var actionsEl = chatCtx.msgList ? chatCtx.msgList.querySelector('#actions-' + id) : null;
    if (actionsEl) {
      actionsEl.innerHTML = '<span class="cr-permission-status ' + (isAllow ? 'allowed' : 'denied') + '">' + label + '</span>';
    }

    if (window.VSCODE_API && item) {
      window.VSCODE_API.postMessage({
        type: 'permissionResponse',
        approved: isAllow,
        toolCallId: item.id || id,
        always: isAlways,
        tool: item.tool,
        sessionId: item.ownerSessionId || chatCtx.convId
      });
    }

    updateAgentControlsPanel(chatCtx);
  }

  function updateAgentControlsPanel(chatCtx) {
    var controlsPanel = chatCtx.controlsPanel;
    var msgList = chatCtx.msgList;
    if (!controlsPanel) return;

    if (!chatCtx.permissionQueue) chatCtx.permissionQueue = [];

    if (msgList) {
      var domAllowBtns = msgList.querySelectorAll('.cr-permission-actions button[data-action="allow"]');
      for (var dbi = 0; dbi < domAllowBtns.length; dbi++) {
        var dBtnId = domAllowBtns[dbi].getAttribute('data-id');
        if (dBtnId) {
          var foundInQ = false;
          for (var fqi = 0; fqi < chatCtx.permissionQueue.length; fqi++) {
            if (chatCtx.permissionQueue[fqi].id === dBtnId) {
              foundInQ = true;
              break;
            }
          }
          if (!foundInQ) {
            var permParent = domAllowBtns[dbi].closest('.cr-permission-actions, .cr-permission-section, .cr-permission-card, .cr-tool-card');
            var pToolName = (permParent && (permParent.dataset.toolName || permParent.dataset.tool)) || '';
            chatCtx.permissionQueue.push({
              id: dBtnId,
              tool: pToolName,
              ownerSessionId: chatCtx.convId,
              isSubagentTool: false
            });
          }
        }
      }
    }

    var pendingDiffs = msgList ? msgList.querySelectorAll('.cr-diff-card[data-diff-status="pending"] .cr-diff-accept') : [];
    var pendingPermCount = chatCtx.permissionQueue.length;
    var totalPending = pendingPermCount + pendingDiffs.length;

    if (totalPending > 0) {
      controlsPanel.style.display = 'block';
      var shieldSvg = '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
      var html = '<div class="cr-controls-inner">';

      if (pendingPermCount > 0) {
        var activePerm = chatCtx.permissionQueue[0];
        var badgeText = '';
        if (activePerm.isSubagentTool || activePerm.subagentName) {
          var subRole = activePerm.subagentRole ? String(activePerm.subagentRole).toUpperCase() : 'SUBAGENT';
          var subName = activePerm.subagentName || 'Subagent';
          badgeText = '[' + subRole + ': ' + subName + '] ' + formatToolName(activePerm.tool);
        } else {
          badgeText = formatToolName(activePerm.tool);
        }

        var queueText = '';
        if (pendingPermCount > 1) {
          queueText = ' (1 of ' + pendingPermCount + ')';
        }

        html +=
          '<div class="cr-controls-left">' +
            '<span class="cr-controls-shield">' + shieldSvg + '</span>' +
            '<span class="cr-controls-label">' +
              'Confirmation required: <span class="cr-controls-tool-badge">' + esc(badgeText) + '</span>' +
              (queueText ? '<span class="cr-controls-queue-count" style="margin-left:4px;color:#94a3b8;font-size:11px;">' + esc(queueText) + '</span>' : '') +
            '</span>' +
          '</div>' +
          '<div class="cr-controls-buttons">' +
            '<div class="cr-controls-btn-row">' +
              '<button class="cr-btn cr-btn-allow cr-btn-continue-all" data-action="allow" data-id="' + esc(activePerm.id) + '" title="Allow this call">Allow</button>' +
              '<button class="cr-btn cr-btn-deny cr-btn-quit-all" data-action="deny" data-id="' + esc(activePerm.id) + '" title="Deny this call">Deny</button>' +
            '</div>' +
            '<div class="cr-controls-btn-row">' +
              '<button class="cr-btn cr-btn-always-allow" data-action="always-allow" data-id="' + esc(activePerm.id) + '" title="Always allow this tool">Always Allow</button>' +
              '<button class="cr-btn cr-btn-always-deny" data-action="always-deny" data-id="' + esc(activePerm.id) + '" title="Always deny this tool">Always Deny</button>' +
            '</div>' +
          '</div>';
      } else {
        var subDiffBadge = '';
        var firstPendingDiff = msgList ? msgList.querySelector('.cr-diff-card[data-diff-status="pending"]') : null;
        if (firstPendingDiff && firstPendingDiff.dataset.toolDisplayName) {
          subDiffBadge = ' <span class="cr-controls-tool-badge">' + esc(firstPendingDiff.dataset.toolDisplayName) + '</span>';
        }
        html +=
          '<div class="cr-controls-left">' +
            '<span class="cr-controls-shield">' + shieldSvg + '</span>' +
            '<span class="cr-controls-label">Confirmation required:' + subDiffBadge + ' (' + pendingDiffs.length + ' file change' + (pendingDiffs.length > 1 ? 's' : '') + ' pending approval)</span>' +
          '</div>' +
          '<div class="cr-controls-buttons">' +
            '<button class="cr-btn cr-btn-accept-all-diffs" title="Accept all pending file changes">Accept All</button>' +
            '<button class="cr-btn cr-btn-reject-all-diffs" title="Reject all pending file changes">Reject All</button>' +
          '</div>';
      }

      html += '</div>';
      controlsPanel.innerHTML = html;

      var buttons = controlsPanel.querySelectorAll('.cr-controls-buttons button[data-action]');
      for (var bi = 0; bi < buttons.length; bi++) {
        function onControlBtnClick(ev) {
          var targetBtn = ev.currentTarget;
          var act = targetBtn.getAttribute('data-action');
          var targetId = targetBtn.getAttribute('data-id');
          resolvePermissionItem(chatCtx, targetId, act);
        }
        buttons[bi].onclick = onControlBtnClick;
      }

      var acceptAllDiffsBtn = controlsPanel.querySelector('.cr-btn-accept-all-diffs');
      if (acceptAllDiffsBtn) {
        function onAcceptAllDiffsClick() { handleAcceptAllDiffsClick(chatCtx); }
        acceptAllDiffsBtn.onclick = onAcceptAllDiffsClick;
      }

      var rejectAllDiffsBtn = controlsPanel.querySelector('.cr-btn-reject-all-diffs');
      if (rejectAllDiffsBtn) {
        function onRejectAllDiffsClick() { handleRejectAllDiffsClick(chatCtx); }
        rejectAllDiffsBtn.onclick = onRejectAllDiffsClick;
      }
    } else {
      controlsPanel.style.display = 'none';
      controlsPanel.innerHTML = '';
    }
  }

  function handleAllowAllClick(chatCtx) {
    if (chatCtx.permissionQueue && chatCtx.permissionQueue.length) {
      while (chatCtx.permissionQueue.length > 0) {
        var item = chatCtx.permissionQueue[0];
        resolvePermissionItem(chatCtx, item.id, 'allow');
      }
    } else if (chatCtx.msgList) {
      var allowBtns = chatCtx.msgList.querySelectorAll('.cr-permission-actions button[data-action="allow"]');
      for (var i = 0; i < allowBtns.length; i++) {
        allowBtns[i].click();
      }
    }
    updateAgentControlsPanel(chatCtx);
  }

  function handleDenyAllClick(chatCtx) {
    if (chatCtx.permissionQueue && chatCtx.permissionQueue.length) {
      while (chatCtx.permissionQueue.length > 0) {
        var item = chatCtx.permissionQueue[0];
        resolvePermissionItem(chatCtx, item.id, 'deny');
      }
    } else if (chatCtx.msgList) {
      var denyBtns = chatCtx.msgList.querySelectorAll('.cr-permission-actions button[data-action="deny"]');
      for (var i = 0; i < denyBtns.length; i++) {
        denyBtns[i].click();
      }
    }
    updateAgentControlsPanel(chatCtx);
  }

  function handleAcceptAllDiffsClick(chatCtx) {
    var acceptBtns = chatCtx.msgList.querySelectorAll('.cr-diff-card[data-diff-status="pending"] .cr-diff-accept');
    for (var i = 0; i < acceptBtns.length; i++) {
      acceptBtns[i].click();
    }
    updateAgentControlsPanel(chatCtx);
  }

  function handleRejectAllDiffsClick(chatCtx) {
    var rejectBtns = chatCtx.msgList.querySelectorAll('.cr-diff-card[data-diff-status="pending"] .cr-diff-reject');
    for (var i = 0; i < rejectBtns.length; i++) {
      rejectBtns[i].click();
    }
    updateAgentControlsPanel(chatCtx);
  }

  function renderQuestionBanner(chatCtx, questionData) {
    var banner = chatCtx.questionBanner;
    if (!banner) return;

    var qId = questionData.id || ('q_' + Date.now());
    var qText = questionData.question || 'Please answer the following question:';
    var rawOptions = Array.isArray(questionData.options) ? questionData.options : [];

    // Parse options: handle both objects { label, description } and plain strings
    var parsedOptions = [];
    for (var oi = 0; oi < rawOptions.length; oi++) {
      var item = rawOptions[oi];
      if (typeof item === 'string') {
        var cleanLabel = item.replace(/^Option\s*\d+\s*:\s*/i, '').trim();
        parsedOptions.push({
          label: cleanLabel || item,
          description: ''
        });
      } else if (item && typeof item === 'object') {
        parsedOptions.push({
          label: item.label || item.title || item.name || '',
          description: item.description || item.detail || ''
        });
      }
    }

    banner.dataset.questionId = qId;
    banner.style.display = 'block';

    var optionsHtml = '';
    if (parsedOptions.length > 0) {
      optionsHtml += '<div class="cr-question-options-list">';
      for (var pi = 0; pi < parsedOptions.length; pi++) {
        var opt = parsedOptions[pi];
        var descHtml = opt.description ? '<div class="cr-question-opt-desc">' + esc(opt.description) + '</div>' : '';
        optionsHtml +=
          '<div class="cr-question-option-item" data-val="' + esc(opt.label) + '">' +
            '<div class="cr-question-radio-circle"><div class="cr-question-radio-dot"></div></div>' +
            '<div class="cr-question-opt-content">' +
              '<div class="cr-question-opt-label">' + esc(opt.label) + '</div>' +
              descHtml +
            '</div>' +
          '</div>';
      }
      optionsHtml += '</div>';
    }

    var customInputHtml =
      '<div class="cr-question-custom-row">' +
        '<input type="text" class="cr-question-custom-input" placeholder="Type your answer here..." />' +
        '<button type="button" class="cr-question-submit-btn">' +
          '<svg class="cr-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
          '<span>Submit</span>' +
        '</button>' +
      '</div>';

    var badgeTitle = 'CLARIFICATION NEEDED';
    var subagentName = questionData.subagentName || (questionData.agentType === 'subagent' && questionData.agentName ? questionData.agentName : null);
    if (subagentName) {
      badgeTitle = 'CLARIFICATION NEEDED — [SUBAGENT: ' + esc(subagentName) + ']';
    }

    banner.innerHTML =
      '<div class="cr-question-card">' +
        '<div class="cr-question-card-header">' +
          '<div class="cr-question-badge-icon">?</div>' +
          '<div class="cr-question-header-text">' +
            '<div class="cr-question-badge-title">' + badgeTitle + '</div>' +
            '<div class="cr-question-text">' + esc(qText) + '</div>' +
          '</div>' +
        '</div>' +
        optionsHtml +
        customInputHtml +
      '</div>';

    var optionItems = banner.querySelectorAll('.cr-question-option-item');
    for (var ci = 0; ci < optionItems.length; ci++) {
      function onOptionItemClick(evt) {
        var targetEl = evt.currentTarget;
        var allItems = banner.querySelectorAll('.cr-question-option-item');
        for (var k = 0; k < allItems.length; k++) {
          allItems[k].classList.remove('selected');
        }
        targetEl.classList.add('selected');
        var val = targetEl.getAttribute('data-val');
        // Submit after visual selection feedback
        setTimeout(function onSelectionSubmit() {
          submitQuestionAnswer(chatCtx, qId, val, qText);
        }, 120);
      }
      optionItems[ci].onclick = onOptionItemClick;
    }

    var submitBtn = banner.querySelector('.cr-question-submit-btn');
    var customInput = banner.querySelector('.cr-question-custom-input');
    if (submitBtn && customInput) {
      function onSubmitClick() {
        var val = customInput.value.trim();
        if (!val) return;
        submitQuestionAnswer(chatCtx, qId, val, qText);
      }
      submitBtn.onclick = onSubmitClick;

      function onInputKeyDown(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSubmitClick();
        }
      }
      customInput.onkeydown = onInputKeyDown;
      setTimeout(function onFocusCustom() { customInput.focus(); }, 60);
    }

    scrollBottom(chatCtx.msgList);
  }

  function submitQuestionAnswer(chatCtx, questionId, answer, originalQuestion) {
    if (!window.VSCODE_API) return;

    window.VSCODE_API.postMessage({
      type: 'questionResponse',
      questionId: questionId,
      answer: answer,
      sessionId: chatCtx.convId
    });

    clearQuestionBanner(chatCtx);

    // Append compact user response chip in bot message so conversation reflects user's decision
    var targetContainer = (chatCtx.S && chatCtx.S.botBody) ? chatCtx.S.botBody : chatCtx.msgList;
    if (targetContainer) {
      var respBox = mk('div', 'cr-question-resolved-chip');
      respBox.innerHTML = '<strong>' + esc(originalQuestion) + '</strong><br/>↳ <em>' + esc(answer) + '</em>';
      targetContainer.appendChild(respBox);
      scrollBottom(chatCtx.msgList);
    }
  }

  function clearQuestionBanner(chatCtx) {
    var banner = chatCtx.questionBanner;
    if (!banner) return;
    banner.style.display = 'none';
    banner.innerHTML = '';
    banner.dataset.questionId = '';
  }

  function findMatchingToolResponse(messages, toolId, assistantMsgIndex, toolCallIndex) {
    if (!messages) return null;
    if (toolId) {
      for (var i = 0; i < messages.length; i++) {
        if (messages[i].role === 'tool' && messages[i].tool_call_id === toolId) {
          return messages[i];
        }
      }
    }
    var toolMessageCount = 0;
    for (var i = assistantMsgIndex + 1; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === 'user' || m.role === 'assistant') {
        break;
      }
      if (m.role === 'tool') {
        if (toolMessageCount === toolCallIndex) {
          return m;
        }
        toolMessageCount++;
      }
    }
    return null;
  }

  function loadHistory(chatCtx, msgList, messages) {
    if (!msgList || !messages) return;
    msgList.innerHTML = '';

    var checkpoint = (chatCtx && chatCtx.conversation && chatCtx.conversation.compactCheckpoint) ? chatCtx.conversation.compactCheckpoint : null;
    var checkpointRendered = false;
    var compactedUpToIndex = (checkpoint && checkpoint.compactedUpTo >= 0) ? checkpoint.compactedUpTo : -1;

    console.log('[LOAD_HISTORY] ═══ LOADING', messages.length, 'MESSAGES ═══, checkpoint compactedUpTo:', compactedUpToIndex);
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var summary = 'msg[' + i + '] role=' + m.role;
      if (m.role === 'assistant') {
        summary += ' content=' + (m.content || '').substring(0, 80) + 
                   ' thinking=' + (m.thinking ? 'YES(' + m.thinking.length + ' chars)' : 'NO') +
                   ' tool_calls=' + (m.tool_calls ? m.tool_calls.length : 0);
        if (m.tool_calls) {
          for (var j = 0; j < m.tool_calls.length; j++) {
            var tc = m.tool_calls[j];
            var name = (tc.function && tc.function.name) || tc.name || '(EMPTY)';
            console.log('  tool_call[' + j + '] name=' + name + ' id=' + (tc.id || '(none)'));
          }
        }
      } else if (m.role === 'tool') {
        summary += ' tool_name=' + (m.tool_name || '(none)') + ' tool_call_id=' + (m.tool_call_id || '(none)') + ' content=' + (m.content || '').substring(0, 80);
      } else if (m.role === 'user') {
        summary += ' content=' + (m.content || '').substring(0, 80);
      }
      console.log('[LOAD_HISTORY] ' + summary);
    }
    console.log('[LOAD_HISTORY] ═══ END DUMP ═══');

    var turns = [];
    var currentTurn = null;

    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === 'user') {
        if (currentTurn) {
          turns.push(currentTurn);
        }
        currentTurn = { user: m, botMessages: [] };
      } else {
        if (!currentTurn) {
          currentTurn = { user: null, botMessages: [] };
        }
        currentTurn.botMessages.push(m);
      }
    }
    if (currentTurn) {
      turns.push(currentTurn);
    }

    var msgIndexTracker = -1;
    for (var ti = 0; ti < turns.length; ti++) {
      var turn = turns[ti];
      if (turn.user) {
        msgIndexTracker++;
        appendUserBubble(msgList, turn.user.content, turn.user.image || (turn.user.images ? turn.user.images[0] : null));
      }

      if (turn.botMessages && turn.botMessages.length) {
        var body = appendBotWrapper(msgList);
        for (var mi = 0; mi < turn.botMessages.length; mi++) {
          msgIndexTracker++;
          var m = turn.botMessages[mi];
          if (m.role === 'assistant') {
            var content = m.content || '';
            var thinking = m.thinking || null;
            console.log('[LOAD_HISTORY] assistant msg #' + mi + ' has .thinking:', !!m.thinking, 'content length:', content.length, 'keys:', Object.keys(m).join(','));
            var startIdx = content.indexOf('\uE000');
            var endIdx = content.indexOf('\uE001');
            if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
              thinking = content.substring(startIdx + 1, endIdx);
              content = content.substring(0, startIdx) + content.substring(endIdx + 1);
              content = content.replace(/^\n+/, '');
            } else if (!thinking && content.includes('<think>')) {
              var tStart = content.indexOf('<think>');
              var tEnd = content.indexOf('</think>');
              if (tStart !== -1 && tEnd !== -1 && tEnd > tStart) {
                thinking = content.substring(tStart + 7, tEnd);
                content = content.substring(0, tStart) + content.substring(tEnd + 8);
                content = content.replace(/^\n+/, '');
              }
            }
            console.log('[LOAD_HISTORY] final thinking resolved:', !!thinking, thinking ? thinking.substring(0, 80) : '(none)');

            if (thinking) {
              var det = appendThinkBlock(body);
              var pre = det.querySelector('.cr-think-pre');
              if (pre) pre.textContent = thinking;
              var lbl = det.querySelector('.cr-think-label');
              if (lbl) lbl.textContent = 'Thought process';
              det.open = false;
            }
            if (content) {
              var d = appendContentBlock(body);
              d.innerHTML = md(content);
            } else if (m.error) {
              var errDiv = mk('div', 'cr-error-line');
              errDiv.innerHTML = '<span class="cr-error-icon">' + I.err + '</span><span class="cr-error-text">' + esc(m.error) + '</span>';
              body.appendChild(errDiv);
            } else if (!thinking && (!m.tool_calls || !m.tool_calls.length)) {
              var emptyDiv = mk('div', 'cr-error-line');
              emptyDiv.innerHTML = '<span class="cr-error-icon">' + I.err + '</span><span class="cr-error-text">(No response recorded or request failed)</span>';
              body.appendChild(emptyDiv);
            }
            if (m.tool_calls && m.tool_calls.length) {
              for (var tci = 0; tci < m.tool_calls.length; tci++) {
                var tc = m.tool_calls[tci];
                var toolName = (tc.function && tc.function.name) || tc.name || '';
                var toolArgs = {};
                var rawArgs = (tc.function && tc.function.arguments) || tc.arguments || {};
                if (typeof rawArgs === 'string') {
                  try {
                    toolArgs = JSON.parse(rawArgs);
                  } catch (_) {
                    // Intentionally fall back to raw arguments string if JSON parsing fails
                    toolArgs = { raw: rawArgs };
                  }
                } else {
                  toolArgs = rawArgs;
                }
                var toolId = tc.id || '';

                var matchingResultMsg = findMatchingToolResponse(turn.botMessages, toolId, mi, tci);
                var status = 'success';
                var resultObj = null;
                if (matchingResultMsg) {
                  var resContent = matchingResultMsg.content || '';
                  if (resContent.startsWith('Error:') || resContent.includes('Permission denied') || resContent.includes('rejected by user')) {
                    status = 'error';
                  }
                  if (matchingResultMsg.result) {
                    resultObj = matchingResultMsg.result;
                    if (resultObj.success === false) {
                      status = 'error';
                    } else if (resultObj.exit_code != null && resultObj.exit_code !== 0) {
                      status = 'error';
                    }
                  } else {
                    resultObj = {
                      content: resContent,
                      message: resContent,
                      error: status === 'error' ? resContent : undefined,
                      success: status !== 'error'
                    };
                  }
                } else {
                  status = 'error';
                  resultObj = { error: 'No result recorded', message: 'No result recorded' };
                }

                var cardKey = 'card_' + toolId + '_' + Date.now();
                if (toolName === 'run_terminal') {
                  var termCard = appendTerminalCard(chatCtx.S, msgList, body, cardKey, toolName, toolArgs, status, resultObj);
                  if (termCard) termCard.open = false;
                } else {
                  appendToolCard(chatCtx.S, msgList, body, cardKey, toolName, toolArgs, status, resultObj);
                }
              }
            }
          }
        }
      }

      if (checkpoint && !checkpointRendered && msgIndexTracker >= compactedUpToIndex) {
        appendCompactCheckpoint(msgList, checkpoint);
        checkpointRendered = true;
      }
    }

    if (checkpoint && !checkpointRendered) {
      appendCompactCheckpoint(msgList, checkpoint);
      checkpointRendered = true;
    }

    scrollBottom(msgList);
  }

  function handleInputTextChange(input, charCount) {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    if (charCount) charCount.textContent = input.value.length;
  }

  function handleInputKeyDown(doSendFn, e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSendFn(); }
  }

  function setStreaming(chatCtx, on) {
    var S = chatCtx.S;
    S.isStreaming = on;
    var sendBtn = chatCtx.sendBtn;
    var input = chatCtx.input;
    var stopBtn = chatCtx.stopBtn;
    if (sendBtn) sendBtn.disabled = on;
    if (input) input.disabled = on;
    if (sendBtn) sendBtn.classList.toggle('cr-send-btn--busy', on);
    if (stopBtn) stopBtn.style.display = on ? 'flex' : 'none';
    if (sendBtn) sendBtn.style.display = on ? 'none' : 'flex';
  }

  function handleStopButtonClick(chatCtx) {
    if (chatCtx.abortCtrl) { chatCtx.abortCtrl.abort(); chatCtx.abortCtrl = null; }
    if (window.VSCODE_API) {
      try {
        window.VSCODE_API.postMessage({ type: 'stopChat', sessionId: chatCtx.convId, conversationId: chatCtx.convId });
      } catch (e) {
        // Intentionally ignore if postMessage is restricted in the current environment
      }
    }
    setStreaming(chatCtx, false);
    if (window.stopGeneration) window.stopGeneration();
  }

  function handleInputPaste(chatCtx, e) {
    var items = (e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData)) ? (e.clipboardData || e.originalEvent.clipboardData).items : null;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        var blob = items[i].getAsFile();
        if (!blob) continue;
        var reader = new FileReader();
    function onReaderLoad(ev) { handleReaderOnload(chatCtx, ev); }
    reader.onload = onReaderLoad;
        reader.readAsDataURL(blob);
        break;
      }
    }
  }

  function handleReaderOnload(chatCtx, ev) {
    chatCtx.pendingImage = ev.target.result.replace(/^data:[^;]+;base64,/, '');
    if (chatCtx.previewImg) chatCtx.previewImg.src = ev.target.result;
    if (chatCtx.previewBox) chatCtx.previewBox.style.display = 'flex';
  }

  function handleAttachClick(fileInput) {
    fileInput.click();
  }

  function handleFileInputChange(chatCtx, event) {
    var fileInput = event.currentTarget;
    var f = fileInput.files[0];
    if (!f) return;
    var reader = new FileReader();
    function onReaderLoad(ev) { handleReaderOnload(chatCtx, ev); }
    reader.onload = onReaderLoad;
    reader.readAsDataURL(f);
    fileInput.value = '';
  }

  function handleClearImgClick(chatCtx) {
    chatCtx.pendingImage = null;
    if (chatCtx.previewBox) chatCtx.previewBox.style.display = 'none';
  }

  function appendStatusLine(S, body, message) {
    if (!body) return null;
    var d = mk('div', 'cr-status-line');
    d.innerHTML = '<span class="cr-status-bullet">·</span> <span class="cr-status-text">' + esc(message) + '</span>';
    body.appendChild(d);
    if (S.statusLines) S.statusLines.push(d);
    return d;
  }

  function saveBotResponse(chatCtx, S) {
    if (window.VSCODE_API) {
      return;
    }

    if (S.fullResponse || S.fullThinking || (S._toolCalls && S._toolCalls.length)) {
      var extra = {};
      if (S.sources && S.sources.length) extra.sources = S.sources;
      if (S.fullThinking) extra.thinking = S.fullThinking;
      if (S._toolCalls && S._toolCalls.length) extra.tool_calls = S._toolCalls;
      var lastMsg = chatCtx.conversation.messages[chatCtx.conversation.messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content === (S.fullResponse || '')) {
        if (S.fullThinking && !lastMsg.thinking) lastMsg.thinking = S.fullThinking;
        if (S._toolCalls && S._toolCalls.length && !lastMsg.tool_calls) lastMsg.tool_calls = S._toolCalls;
        return;
      }
      if (window.saveConversationMessage) {
        window.saveConversationMessage(chatCtx.convId, 'assistant', S.fullResponse || '', extra);
      } else {
        chatCtx.conversation.messages.push({
          role: 'assistant',
          content: S.fullResponse || '',
          thinking: S.fullThinking,
          tool_calls: S._toolCalls,
          timestamp: Date.now()
        });
      }
    }
  }

  function stopCurrentChatStream(chatCtx) {
    if (chatCtx.abortCtrl) { chatCtx.abortCtrl.abort(); chatCtx.abortCtrl = null; }
    if (window.VSCODE_API) {
      try {
        window.VSCODE_API.postMessage({ type: 'stopChat', sessionId: chatCtx.convId, conversationId: chatCtx.convId });
      } catch (e) {
        // Intentionally ignore if postMessage is restricted in the current environment
      }
    }
    setStreaming(chatCtx, false);
    chatCtx.onStreamEnd();
  }

  function formatErrorMessage(msg) {
    if (!msg) return 'Unknown error';
    var str = String(msg);
    if (str.indexOf('Error: ') === 0) {
      str = str.substring(7);
    }
    return str;
  }

  function handleStreamError(chatCtx, err) {
    var S = chatCtx.S;
    removeTyping(S.botBody);
    var errMsg = err && err.message ? err.message : String(err || 'Unknown error');
    var cleanMsg = formatErrorMessage(errMsg);
    var existingErr = S.botBody ? S.botBody.querySelector('.cr-error-line') : null;
    var errorHtml = '<span class="cr-error-icon">' + I.err + '</span><span class="cr-error-text">' + esc(cleanMsg) + '</span>';
    if (existingErr) {
      existingErr.innerHTML = errorHtml;
    } else {
      var errorLine = mk('div', 'cr-error-line');
      errorLine.innerHTML = errorHtml;
      if (S.botBody) S.botBody.appendChild(errorLine);
    }
    setStreaming(chatCtx, false);

    if (typeof window.saveConversationMessage === 'function') {
      window.saveConversationMessage(chatCtx.convId, 'assistant', '', { error: cleanMsg });
    }

    try {
      var convTraces = JSON.parse(localStorage.getItem('coderun_traces_' + chatCtx.convId) || '[]');
      if (convTraces.length > 0) {
        var lastT = convTraces[convTraces.length - 1];
        if (lastT.status === 'running') {
          lastT.status = 'failed';
          lastT.error = errMsg;
          if (!lastT.finalResponse) lastT.finalResponse = {};
          lastT.finalResponse.text = errMsg;
          lastT.finalResponse.error = errMsg;
          lastT.completedAt = Date.now();
          lastT.durationMs = lastT.completedAt - lastT.startedAt;
          localStorage.setItem('coderun_traces_' + chatCtx.convId, JSON.stringify(convTraces));
          var tContainer = document.getElementById('traces-area-container');
          if (tContainer && tContainer.style.display !== 'none' && typeof window.renderDashboardTraces === 'function') {
            window.renderDashboardTraces(tContainer);
          }
        }
      }
    } catch (_) {
      // Intentionally ignore storage write errors
    }

    scrollBottom(chatCtx.msgList);
  }

  function handleActiveChatStream(chatCtx, ev) {
    if (!ev) return;
    var isSubagentLifecycle = ev.type === 'subagent_completed' ||
      ev.type === 'subagent_failed' ||
      ev.type === 'subagent_spawned' ||
      ev.type === 'subagent_paused' ||
      ev.type === 'subagent_resumed' ||
      ev.type === 'subagent_stopped' ||
      ev.type === 'requestPermission' ||
      ev.type === 'request_diff' ||
      ev.type === 'ask_question' ||
      ev.type === 'trace_updated' ||
      ev.type === 'checkpoints_created' ||
      ev.type === 'subagent_status';

    if (isSubagentLifecycle) {
      var matchesSession = (!ev.sessionId || ev.sessionId === chatCtx.convId) ||
                           (ev.parentSessionId && ev.parentSessionId === chatCtx.convId) ||
                           (ev.rootSessionId && ev.rootSessionId === chatCtx.convId);
      if (!matchesSession) return;
    } else {
      if (ev.agentType === 'subagent' || ev.parentSessionId || (ev.sessionId && ev.sessionId !== chatCtx.convId)) {
        return;
      }
    }
    var S = chatCtx.S;
    var msgList = chatCtx.msgList;
    if (ev && ev.message && ev.message.content) {
      console.log('[CHATSPACE] Received content event:', ev.message.content.substring(0, 100));
    }
    if (ev.type === 'stream_end') {
      finishStream(chatCtx, S);
      setStreaming(chatCtx, false);
      chatCtx.onStreamEnd();
      saveBotResponse(chatCtx, S);

      try {
        var endTraces = JSON.parse(localStorage.getItem('coderun_traces_' + chatCtx.convId) || '[]');
        if (endTraces.length > 0) {
          var lastTraceObj = endTraces[endTraces.length - 1];
          if (lastTraceObj.status === 'running') {
            lastTraceObj.status = 'completed';
            lastTraceObj.completedAt = Date.now();
            lastTraceObj.durationMs = lastTraceObj.completedAt - lastTraceObj.startedAt;
            if (!lastTraceObj.finalResponse) lastTraceObj.finalResponse = {};
            lastTraceObj.finalResponse.text = S.fullResponse || lastTraceObj.finalResponse.text || '';
            localStorage.setItem('coderun_traces_' + chatCtx.convId, JSON.stringify(endTraces));
            var endContainer = document.getElementById('traces-area-container');
            if (endContainer && endContainer.style.display !== 'none' && typeof window.renderDashboardTraces === 'function') {
              window.renderDashboardTraces(endContainer);
            }
          }
        }
      } catch (_) {
        // Intentionally ignore storage write errors
      }

      if (S._currentCheckpoints && S._currentCheckpoints.length) {
        var lastRow = msgList.querySelector('.cr-row--bot:last-child');
        var lastBody = lastRow ? lastRow.querySelector('.cr-bot-body') : null;
        if (lastBody) {
          appendActionsBar(chatCtx, lastBody, S._currentCheckpoints);
        }
      }
      scrollBottomSmooth(msgList);
      window.activeChatStreamCallback = null;
      return;
    }
    if (ev.type === 'stream_error' || ev.type === 'agent_error' || ev.type === 'error') {
      var streamErr = ev.error || ev.message;
      handleStreamError(chatCtx, streamErr);
      chatCtx.onStreamError(streamErr);
      window.activeChatStreamCallback = null;
      return;
    }
    handleEvent(chatCtx, ev, S);
    scrollBottomSmooth(msgList);
  }

  function pumpStream(streamCtx) {
    return streamCtx.reader.read()
      .then(function onReaderChunk(c) { return handleReaderChunk(streamCtx, c); })
      .catch(function onReaderErr(e) { return handleReaderError(streamCtx, e); });
  }

  function handleReaderChunk(streamCtx, c) {
    if (c.done) {
      if (streamCtx.buf.trim()) {
        try {
          handleEvent(streamCtx.chatCtx, JSON.parse(streamCtx.buf.trim()), streamCtx.S);
        } catch (e) {
          // Intentionally ignore parsing error if chunk is incomplete or malformed JSON
        }
      }
      finishStream(streamCtx.chatCtx, streamCtx.S);
      setStreaming(streamCtx.chatCtx, false);
      streamCtx.onStreamEnd();
      saveBotResponse(streamCtx.chatCtx, streamCtx.S);
      scrollBottomSmooth(streamCtx.msgList);
      return;
    }
    streamCtx.buf += streamCtx.dec.decode(c.value, { stream: true });
    var lines = streamCtx.buf.split('\n');
    streamCtx.buf = lines.pop();
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li].trim();
      if (line) {
        try {
          var ev = JSON.parse(line);
          handleEvent(streamCtx.chatCtx, ev, streamCtx.S);
          scrollBottomSmooth(streamCtx.msgList);
        } catch (e) {
          // Intentionally ignore parsing error for malformed lines in stream
        }
      }
    }
    return pumpStream(streamCtx);
  }

  function handleReaderError(streamCtx, e) {
    if (e.name !== 'AbortError') {
      handleStreamError(streamCtx.chatCtx, e);
      streamCtx.onStreamError(e);
    }
  }

  function handleFetchChatResponse(S, msgList, onStreamEnd, onStreamError, chatCtx, res) {
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + res.statusText);
    var streamCtx = {
      reader: res.body.getReader(),
      dec: new TextDecoder('utf-8'),
      buf: '',
      S: S,
      msgList: msgList,
      onStreamEnd: onStreamEnd,
      onStreamError: onStreamError,
      chatCtx: chatCtx
    };
    return pumpStream(streamCtx);
  }

  function handleFetchChatError(onStreamError, chatCtx, e) {
    if (e.name !== 'AbortError') {
      handleStreamError(chatCtx, e);
      onStreamError(e);
    }
  }

  function doSend(chatCtx) {
    var S = chatCtx.S;
    var conversation = chatCtx.conversation;
    var msgList = chatCtx.msgList;
    var input = chatCtx.input;
    var previewBox = chatCtx.previewBox;
    var charCount = chatCtx.charCount;
    var model = chatCtx.model;
    var workspace = chatCtx.workspace;
    var baseUrl = chatCtx.baseUrl;
    var onStreamStart = chatCtx.onStreamStart;
    var onStreamEnd = chatCtx.onStreamEnd;
    var onStreamError = chatCtx.onStreamError;

    try {
      var text = input.value.trim();
      if ((!text && !chatCtx.pendingImage) || S.isStreaming) return;

      var currentModel = (window.getDashboardModel ? window.getDashboardModel() : '') || model;
      var currentProvider = (window.getDashboardProvider ? window.getDashboardProvider() : '') || '';
      var currentWorkspace = (window.getDashboardWorkspace ? window.getDashboardWorkspace() : '') || workspace;
      var currentBaseUrl = (window.getDashboardBaseUrl ? window.getDashboardBaseUrl() : '') || baseUrl;

      if (!currentModel) {
        if (window.webviewAlert) {
          window.webviewAlert('Please select a model from the dropdown before sending a message.');
        } else {
          alert('Please select a model from the dropdown before sending a message.');
        }
        return;
      }

      var imgB64 = chatCtx.pendingImage;
      chatCtx.pendingImage = null;
      if (previewBox) previewBox.style.display = 'none';
      input.value = '';
      input.style.height = 'auto';
      if (charCount) charCount.textContent = '0';

      if (!conversation.messages) conversation.messages = [];
      if (window.saveConversationMessage) {
        window.saveConversationMessage(chatCtx.convId, 'user', text, { 
          image: imgB64,
          model: currentModel,
          provider: currentProvider
        });
      } else {
        conversation.messages.push({ 
          role: 'user', 
          content: text, 
          image: imgB64, 
          timestamp: Date.now(),
          model: currentModel,
          provider: currentProvider
        });
      }

      appendUserBubble(msgList, text, imgB64);
      scrollBottom(msgList);

      clearStreamTurn(chatCtx);
      S.fullResponse = '';
      S.botBody = appendBotWrapper(msgList);
      appendTyping(S.botBody);
      setStreaming(chatCtx, true);
      scrollBottom(msgList);

      var history = [];
      if (conversation.messages && conversation.messages.length) {
        var sliceLen = conversation.messages.length - 1;
        for (var hi = 0; hi < sliceLen; hi++) {
          var m = conversation.messages[hi];
          var h = { 
            role: m.role, 
            content: m.content || '',
            model: m.model || '',
            provider: m.provider || ''
          };
          if (m.thinking) h.thinking = m.thinking;
          if (m.error) h.error = m.error;
          if (m.tool_calls) h.tool_calls = m.tool_calls;
          if (m.tool_call_id) h.tool_call_id = m.tool_call_id;
          if (m.images) h.images = m.images;
          if (m.image && !h.images) h.images = [m.image];
          history.push(h);
        }
      }

      if (window.VSCODE && window.VSCODE_API) {
        onStreamStart();
        function onActiveStream(ev) { handleActiveChatStream(chatCtx, ev); }
        window.activeChatStreamCallback = onActiveStream;

        window.VSCODE_API.postMessage({
          type: "startChat",
          conversationId: chatCtx.convId,
          sessionId: chatCtx.convId,
          message: text,
          image: imgB64,
          model: currentModel,
          provider: currentProvider,
          history: history,
          plan: conversation.plan || null,
          workspaceFolder: currentWorkspace
        });
        return;
      }

      onStreamStart();
      chatCtx.abortCtrl = new AbortController();

      var body = {
        message: text,
        model: currentModel,
        session_id: chatCtx.convId,
        workspaceFolder: currentWorkspace,
        workspace_folder: currentWorkspace,
        history: history
      };
      if (imgB64) body.images = [imgB64];

      fetch(currentBaseUrl + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/x-ndjson' },
        body: JSON.stringify(body),
        signal: chatCtx.abortCtrl.signal
      })
      .then(function onChatRes(res) { return handleFetchChatResponse(S, msgList, onStreamEnd, onStreamError, chatCtx, res); })
      .catch(function onChatErr(e) { return handleFetchChatError(onStreamError, chatCtx, e); });
    } catch (e) {
      console.error("[CHATSPACE] Error in doSend:", e);
    }
  }

  function doContinue(chatCtx) {
    var S = chatCtx.S;
    var conversation = chatCtx.conversation;
    var msgList = chatCtx.msgList;
    var model = chatCtx.model;
    var workspace = chatCtx.workspace;
    var baseUrl = chatCtx.baseUrl;
    var onStreamStart = chatCtx.onStreamStart;
    var onStreamEnd = chatCtx.onStreamEnd;
    var onStreamError = chatCtx.onStreamError;

    try {
      if (S.isStreaming) return;

      var currentModel = (window.getDashboardModel ? window.getDashboardModel() : '') || model;
      var currentProvider = (window.getDashboardProvider ? window.getDashboardProvider() : '') || '';
      var currentWorkspace = (window.getDashboardWorkspace ? window.getDashboardWorkspace() : '') || workspace;
      var currentBaseUrl = (window.getDashboardBaseUrl ? window.getDashboardBaseUrl() : '') || baseUrl;

      if (!currentModel) {
        if (window.webviewAlert) {
          window.webviewAlert('Please select a model from the dropdown before resuming.');
        } else {
          alert('Please select a model from the dropdown before resuming.');
        }
        return;
      }

      if (!conversation.messages) conversation.messages = [];

      clearStreamTurn(chatCtx);
      S.fullResponse = '';
      if (!S.botBody || !S.botBody.parentNode) {
        S.botBody = appendBotWrapper(msgList);
      }
      appendTyping(S.botBody);
      setStreaming(chatCtx, true);
      scrollBottom(msgList);

      var history = [];
      if (conversation.messages) {
        for (var hi = 0; hi < conversation.messages.length; hi++) {
          var m = conversation.messages[hi];
          var h = { 
            role: m.role, 
            content: m.content || '',
            model: m.model || '',
            provider: m.provider || ''
          };
          if (m.thinking) h.thinking = m.thinking;
          if (m.error) h.error = m.error;
          if (m.tool_calls) h.tool_calls = m.tool_calls;
          if (m.tool_call_id) h.tool_call_id = m.tool_call_id;
          if (m.images) h.images = m.images;
          if (m.image && !h.images) h.images = [m.image];
          history.push(h);
        }
      }

      if (window.VSCODE && window.VSCODE_API) {
        onStreamStart();
        function onActiveStream(ev) { handleActiveChatStream(chatCtx, ev); }
        window.activeChatStreamCallback = onActiveStream;

        window.VSCODE_API.postMessage({
          type: "startChat",
          conversationId: chatCtx.convId,
          sessionId: chatCtx.convId,
          message: null,
          isContinuation: true,
          image: null,
          model: currentModel,
          provider: currentProvider,
          history: history,
          plan: conversation.plan || null,
          workspaceFolder: currentWorkspace
        });
        return;
      }

      onStreamStart();
      chatCtx.abortCtrl = new AbortController();

      var body = {
        message: null,
        isContinuation: true,
        model: currentModel,
        session_id: chatCtx.convId,
        workspaceFolder: currentWorkspace,
        workspace_folder: currentWorkspace,
        history: history
      };

      fetch(currentBaseUrl + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/x-ndjson' },
        body: JSON.stringify(body),
        signal: chatCtx.abortCtrl.signal
      })
      .then(function onChatRes(res) { return handleFetchChatResponse(S, msgList, onStreamEnd, onStreamError, chatCtx, res); })
      .catch(function onChatErr(e) { return handleFetchChatError(onStreamError, chatCtx, e); });
    } catch (e) {
      console.error("[CHATSPACE] Error in doContinue:", e);
    }
  }

  function handleEvent(chatCtx, ev, S) {
    if (!ev) return;
    console.log('[CHATSPACE] CHAT EVENT =', JSON.stringify(ev).substring(0, 500));

    if (ev.message && typeof ev.message === 'object' && !Array.isArray(ev.message)) {
      var msg = ev.message;
      if (msg.thinking) {
        removeTyping(S.botBody);
        if (!S.thinkBlock) {
          S.thinkBlock = appendThinkBlock(S.botBody);
          S.thinkPre = S.thinkBlock.querySelector('.cr-think-pre');
          S.thinkText = '';
          S.iterationThinking = '';
        }
        var chunk = msg.thinking;
        S.thinkText += chunk;
        S.iterationThinking += chunk;
        S.fullThinking += chunk;
        if (S.thinkPre) S.thinkPre.textContent = S.thinkText;
      }
      if (msg.content) {
        if (S.thinkBlock && S.thinkBlock.open) {
          var lbl = S.thinkBlock.querySelector('.cr-think-label');
          if (lbl) lbl.textContent = 'Thought process';
          S.thinkBlock.open = false;
        }
        removeTyping(S.botBody);
        if (!S.contentDiv) { S.contentDiv = appendContentBlock(S.botBody); S.contentText = ''; }
        S.contentText += msg.content;
        S.fullResponse = S.contentText;
        scheduleContentRender(S);
      }
      if (msg.tool_calls && msg.tool_calls.length) {
        removeTyping(S.botBody);
        for (var tci = 0; tci < msg.tool_calls.length; tci++) {
          var tc = msg.tool_calls[tci];
          var fnName = (tc.function && tc.function.name) || tc.name || '';
          var fnArgs = (tc.function && tc.function.arguments) || tc.arguments || {};
          if (fnName) {
            var existing = null;
            for (var j = 0; j < S._toolCalls.length; j++) {
              if (S._toolCalls[j].index === tc.index || S._toolCalls[j].id === tc.id) {
                existing = S._toolCalls[j];
                break;
              }
            }
            if (!existing) {
              S._toolCalls.push({
                index: tc.index,
                id: tc.id || fnName + '_' + Date.now(),
                type: tc.type || 'function',
                function: { name: fnName, arguments: typeof fnArgs === 'string' ? fnArgs : JSON.stringify(fnArgs) }
              });
            }
          }
        }
        for (var tci = 0; tci < msg.tool_calls.length; tci++) {
          var tc = msg.tool_calls[tci];
          var toolName = (tc.function && tc.function.name) || tc.name || '';
          if (!toolName) continue;
          if (toolName === 'run_terminal') {
            var toolArgs = (tc.function && tc.function.arguments) || tc.arguments || {};
            var toolId = tc.id || '';
            var toolIndex = tc.index;
            reuseOrCreateTerminalCard(S, toolName, toolArgs, toolId, toolIndex);
            continue;
          }
          var toolArgs = (tc.function && tc.function.arguments) || tc.arguments || {};
          var toolId = tc.id || '';
          var toolIndex = tc.index;
          reuseOrCreateToolCard(S, toolName, toolArgs, toolId, toolIndex);
        }
      }
      return;
    }

    if (ev.type) {
      switch (ev.type) {
        case 'plan_created':
        case 'plan_updated': {
            chatCtx.conversation.plan = mergeChatPlan(chatCtx.conversation.plan, ev.plan);
            renderTodos(chatCtx, chatCtx.conversation.plan);
            if (window.saveConversationMessageBatch) {
              window.saveConversationMessageBatch(chatCtx.convId, null, chatCtx.conversation.plan);
            }
          break;
        }
        case 'chat_history_update': {
          console.log('[CHATSPACE] chat_history_update received, messages:', ev.messages ? ev.messages.length : 0);
          if (ev.messages && ev.messages.length) {
            for (var idx = 0; idx < ev.messages.length; idx++) {
              var m = ev.messages[idx];
              if (m && m.role === 'assistant') {
                console.log('[CHATSPACE] history_update assistant msg #' + idx + ' thinking:', !!m.thinking, 'content:', (m.content || '').substring(0, 60));
              }
            }
            if (window.saveConversationMessageBatch) {
              window.saveConversationMessageBatch(chatCtx.convId, ev.messages, ev.plan);
            }
          }
          break;
        }
        case 'thinking': {
          removeTyping(S.botBody);
          if (!S.thinkBlock) {
            S.thinkBlock = appendThinkBlock(S.botBody);
            S.thinkPre = S.thinkBlock.querySelector('.cr-think-pre');
            S.thinkText = '';
            S.iterationThinking = '';
          }
          var chunk = ev.content || '';
          S.thinkText += chunk;
          S.iterationThinking += chunk;
          S.fullThinking += chunk;
          if (S.thinkPre) S.thinkPre.textContent = S.thinkText;
          break;
        }
        case 'thinking_complete': {
          if (S.thinkBlock) {
            var fullThink = ev.thinking || ev.full_thinking || ev.content || ev.full_content || S.thinkText;
            if (fullThink) {
              if (S.iterationThinking && S.fullThinking.endsWith(S.iterationThinking)) {
                S.fullThinking = S.fullThinking.slice(0, -S.iterationThinking.length) + fullThink;
              } else {
                S.fullThinking = fullThink;
              }
            }
            if (S.thinkPre) S.thinkPre.textContent = S.thinkText;
            var lbl = S.thinkBlock.querySelector('.cr-think-label');
            if (lbl) lbl.textContent = 'Thought process';
            S.thinkBlock.open = false;
          }
          break;
        }
        case 'content': {
          removeTyping(S.botBody);
          if (!S.contentDiv) { S.contentDiv = appendContentBlock(S.botBody); S.contentText = ''; }
          S.contentText += (ev.content || '');
          S.fullResponse = S.contentText;
          scheduleContentRender(S);
          break;
        }
        case 'ask_question': {
          removeTyping(S.botBody);
          renderQuestionBanner(chatCtx, ev);
          closeCurrentContentBlock(S);
          break;
        }
        case 'requestPermission': {
          removeTyping(S.botBody);
          if (ev.autoResolved) {
            var autoLine = mk('div', 'cr-permission-auto');
            var decisionLabel = ev.decision === 'allow' ? '✓ Auto-allowed' : '✗ Auto-denied';
            var decisionCls = ev.decision === 'allow' ? 'allowed' : 'denied';
            var autoToolDisplayName = formatToolName(ev.tool);
            if (ev.subagentName) {
              autoToolDisplayName = '[' + (ev.subagentRole ? String(ev.subagentRole).toUpperCase() : 'SUBAGENT') + ': ' + ev.subagentName + '] ' + autoToolDisplayName;
            }
            autoLine.innerHTML =
              '<span class="cr-permission-auto-icon">' + I.tool + '</span>' +
              '<span class="cr-permission-auto-text">' +
                esc(autoToolDisplayName) + ' — <span class="cr-permission-status ' + decisionCls + '">' + decisionLabel + '</span>' +
                ' <span class="cr-permission-auto-hint">(Always ' + (ev.decision === 'allow' ? 'Allow' : 'Deny') + ')</span>' +
              '</span>';
            S.botBody.appendChild(autoLine);
          } else {
            var permArgs = ev.arguments || {};
            if (ev.subagentName) {
              permArgs._subagentName = ev.subagentName;
              permArgs._subagentRole = ev.subagentRole || 'subagent';
            }
            appendPermissionRequestBlock(chatCtx, S.botBody, ev.tool, permArgs, ev.id, ev.sessionId || chatCtx.convId);
            updateAgentControlsPanel(chatCtx);
          }
          closeCurrentContentBlock(S);
          break;
        }
        case 'tool_call': {
          removeTyping(S.botBody);
          var toolId = ev.id || 'tool_' + (++S._toolIdCounter);
          var toolName = ev.tool || '';
          var toolArgs = ev.args || {};
          var toolIndex = ev.index;

          if (toolName === 'run_terminal') {
            reuseOrCreateTerminalCard(S, toolName, toolArgs, toolId, toolIndex);
            S.thinkBlock = null; S.thinkPre = null; S.thinkText = '';
            closeCurrentContentBlock(S);
          } else {
            var card = reuseOrCreateToolCard(S, toolName, toolArgs, toolId, toolIndex);
            if (card) {
              S.toolCallBlocks[ev.id || card.dataset.cardKey || ('tool_' + S._toolIdCounter)] = card;
            }
            S.thinkBlock = null; S.thinkPre = null; S.thinkText = '';
            closeCurrentContentBlock(S);
          }
          break;
        }
        case 'action': {
          removeTyping(S.botBody);
          var action = ev.action;
          if (action === 'run_terminal') {
            var termCard = findPendingCardByToolName(S, 'run_terminal', ev.toolCallId) || findPendingCardByToolName(S, 'run_terminal');
            if (termCard) {
              var statusEl = termCard.querySelector('.cr-tool-card-status');
              if (statusEl) statusEl.textContent = 'PENDING';
              if (ev.toolCallId) S.toolCards[ev.toolCallId] = termCard;
            }
            break;
          }
          var actionMsg = ev.message || '';
          var pendingCard = null;
          if (ev.toolCallId && S.toolCards[ev.toolCallId]) {
            pendingCard = S.toolCards[ev.toolCallId];
          }
          if (!pendingCard) {
            pendingCard = findPendingCardByToolName(S, action, ev.toolCallId) || findPendingCardByToolName(S, action);
            if (pendingCard && ev.toolCallId) {
              S.toolCards[ev.toolCallId] = pendingCard;
            }
          }
          if (!pendingCard) {
            closeCurrentContentBlock(S);
            var actionKey = action + '_action_' + (++S._toolIdCounter);
            S.toolCards[actionKey] = appendToolCard(S, chatCtx.msgList, S.botBody, actionKey, action, {}, 'running');
            S._toolQueue.push({ key: actionKey, toolName: action, id: actionKey });
            var createdCard = S.toolCards[actionKey];
            if (createdCard) {
              appendToolAction(chatCtx, createdCard, action, actionMsg, 'started');
              if (ev.toolCallId) S.toolCards[ev.toolCallId] = createdCard;
            }
          } else {
            appendToolAction(chatCtx, pendingCard, action, actionMsg, 'started');
          }
          break;
        }
        case 'tool_result': {
          removeTyping(S.botBody);
          var resTool = ev.tool || ev.tool_name || '';
          if (!resTool) {
            if (ev.toolCallId && S.toolCards[ev.toolCallId] && S.toolCards[ev.toolCallId].dataset && S.toolCards[ev.toolCallId].dataset.toolName) {
              resTool = S.toolCards[ev.toolCallId].dataset.toolName;
            } else {
              var lastP = getLastPendingCard(S);
              if (lastP && lastP.dataset && lastP.dataset.toolName) {
                resTool = lastP.dataset.toolName;
              }
            }
          }
          if (!resTool) break;
          var resSuccess = ev.success !== false;
          var resStatus = resSuccess ? 'success' : 'error';
          
          if (resTool === 'run_terminal') {
            var termCardToUpdate = null;
            if (ev.toolCallId && S.toolCards[ev.toolCallId]) {
              termCardToUpdate = S.toolCards[ev.toolCallId];
            }
            if (!termCardToUpdate) {
              var termCards = S.botBody ? S.botBody.querySelectorAll('.cr-terminal-details') : [];
              if (termCards.length > 0) {
                termCardToUpdate = termCards[termCards.length - 1];
              }
            }
            if (termCardToUpdate) {
              updateTerminalCardResult(termCardToUpdate, resStatus, ev);
              setTerminalCardStatus(termCardToUpdate, resStatus, ev.exitCode != null ? ev.exitCode : (resSuccess ? 0 : 1), ev.durationMs || 0, ev);
            }
            break;
          }
          
          var cardToUpdate = null;
          if (ev.toolCallId && S.toolCards[ev.toolCallId]) {
            cardToUpdate = S.toolCards[ev.toolCallId];
          }
          if (!cardToUpdate) {
            cardToUpdate = findPendingCardByToolName(S, resTool, ev.toolCallId) || findPendingCardByToolName(S, resTool);
            if (cardToUpdate && ev.toolCallId) {
              S.toolCards[ev.toolCallId] = cardToUpdate;
            }
          }
          if (!cardToUpdate && ev.toolCallId) {
            var idxKey = resTool + '_toolCall_' + ev.toolCallId;
            if (S.toolCards[idxKey]) {
              cardToUpdate = S.toolCards[idxKey];
            }
          }
          if (!cardToUpdate && S.botBody) {
            var domCards = S.botBody.querySelectorAll('.cr-tool-card');
            for (var dci = domCards.length - 1; dci >= 0; dci--) {
              var cand = domCards[dci];
              if (cand && cand.dataset && cand.dataset.toolName === resTool &&
                  cand.dataset.status !== 'success' && cand.dataset.status !== 'error') {
                cardToUpdate = cand;
                if (ev.toolCallId) S.toolCards[ev.toolCallId] = cardToUpdate;
                break;
              }
            }
          }
          
          var updated = false;
          if (cardToUpdate) {
            updateToolCard(chatCtx, cardToUpdate, resStatus, ev);
            cardToUpdate.dataset.status = resStatus;
            updated = true;
            if (ev.checkpoint_id) {
              var targetPath = ev.file_path || ev.folder_path || '';
              var actionLabel = '';
              if (resTool === 'create_folder') actionLabel = 'Created: ' + targetPath;
              else if (resTool === 'delete_folder') actionLabel = 'Deleted: ' + targetPath;
              else if (resTool === 'delete_file') actionLabel = 'Deleted: ' + targetPath;
              else if (resTool === 'write_file') actionLabel = (ev.is_new_file || !ev.existed) ? ('Created: ' + targetPath) : ('Write: ' + targetPath);
              else if (resTool === 'edit_file') actionLabel = 'Edit: ' + targetPath;
              else if (resTool === 'patch_file') actionLabel = 'Patches: ' + targetPath;
              else actionLabel = 'Edit: ' + targetPath;
              appendCheckpointUndoForCard(cardToUpdate, ev.checkpoint_id, targetPath, actionLabel, ev.sessionId || (ev.args && ev.args.sessionId) || chatCtx.convId);
              if (targetPath && ev.checkpoint_id) {
                setSubagentDiffCheckpoint(ev.sessionId || chatCtx.convId, targetPath, ev.checkpoint_id);
              }
            }
          } else {
            var domCards = S.botBody ? S.botBody.querySelectorAll('.cr-tool-card') : [];
            for (var di = domCards.length - 1; di >= 0; di--) {
              var dc = domCards[di];
              if (dc && dc.dataset && dc.dataset.toolName === resTool) {
                var matchTarget = true;
                if (resTool === 'subagent_response' || resTool === 'spawn_subagent' || resTool === 'wait_for_subagent') {
                  var rawSub = (ev.args && (ev.args.id || ev.args.agentId || ev.args.subagent_id)) || (ev.result && (ev.result.id || ev.result.agentId || ev.result.subagent_id)) || '';
                  if (rawSub && dc.dataset.subagentId && dc.dataset.subagentId !== rawSub) {
                    matchTarget = false;
                  }
                }
                if (matchTarget) {
                  updateToolCard(chatCtx, dc, resStatus, ev);
                  dc.dataset.status = resStatus;
                  updated = true;
                  if (ev.checkpoint_id) {
                    var targetPath2 = ev.file_path || ev.folder_path || '';
                    var actionLabel2 = '';
                    if (resTool === 'create_folder') actionLabel2 = 'Created: ' + targetPath2;
                    else if (resTool === 'delete_folder') actionLabel2 = 'Deleted: ' + targetPath2;
                    else if (resTool === 'delete_file') actionLabel2 = 'Deleted: ' + targetPath2;
                    else if (resTool === 'write_file') actionLabel2 = (ev.is_new_file || !ev.existed) ? ('Created: ' + targetPath2) : ('Write: ' + targetPath2);
                    else if (resTool === 'edit_file') actionLabel2 = 'Edit: ' + targetPath2;
                    else if (resTool === 'patch_file') actionLabel2 = 'Patches: ' + targetPath2;
                    else actionLabel2 = 'Edit: ' + targetPath2;
                    appendCheckpointUndoForCard(dc, ev.checkpoint_id, targetPath2, actionLabel2, ev.sessionId || (ev.args && ev.args.sessionId) || chatCtx.convId);
                    if (targetPath2 && ev.checkpoint_id) {
                      setSubagentDiffCheckpoint(ev.sessionId || chatCtx.convId, targetPath2, ev.checkpoint_id);
                    }
                  }
                  break;
                }
              }
            }
          }
          if (!updated && ev.checkpoint_id) {
            var targetPathD = ev.file_path || ev.folder_path || '';
            var normTargetD = String(targetPathD).replace(/\\/g, '/').toLowerCase();
            var searchRootD = S.botBody || chatCtx.msgList;
            var domDiffCardsD = searchRootD ? searchRootD.querySelectorAll('.cr-diff-card') : [];
            for (var dcd = domDiffCardsD.length - 1; dcd >= 0; dcd--) {
              var dcEl = domDiffCardsD[dcd];
              var cardFileD = String(dcEl.dataset.filePath || '').replace(/\\/g, '/').toLowerCase();
              var hasUndoD = dcEl.nextElementSibling && dcEl.nextElementSibling.classList && dcEl.nextElementSibling.classList.contains('cr-tool-undo-bar');
              if (!hasUndoD) {
                if (cardFileD && normTargetD && (cardFileD === normTargetD || normTargetD.endsWith(cardFileD) || cardFileD.endsWith(normTargetD))) {
                  var dLabel = '';
                  if (resTool === 'create_folder') dLabel = 'Created: ' + targetPathD;
                  else if (resTool === 'delete_folder') dLabel = 'Deleted: ' + targetPathD;
                  else if (resTool === 'delete_file') dLabel = 'Deleted: ' + targetPathD;
                  else if (resTool === 'write_file') dLabel = (ev.is_new_file || !ev.existed) ? ('Created: ' + targetPathD) : ('Write: ' + targetPathD);
                  else if (resTool === 'edit_file') dLabel = 'Edit: ' + targetPathD;
                  else if (resTool === 'patch_file') dLabel = 'Patches: ' + targetPathD;
                  else dLabel = 'Edit: ' + targetPathD;
                  appendCheckpointUndoForCard(dcEl, ev.checkpoint_id, targetPathD, dLabel, ev.sessionId || (ev.args && ev.args.sessionId) || chatCtx.convId);
                  setSubagentDiffCheckpoint(ev.sessionId || chatCtx.convId, targetPathD, ev.checkpoint_id);
                  updated = true;
                  break;
                }
              }
            }
          }
          if (!updated) {
            closeCurrentContentBlock(S);
            var fallbackKey = (resTool === 'subagent_response') ? ('subagent_response_' + ((ev.args && (ev.args.id || ev.args.agentId)) || Date.now())) : ('tr_' + Date.now());
            var addedCard = appendToolCard(S, chatCtx.msgList, S.botBody, fallbackKey, resTool, ev.args || {}, resStatus, ev);
            if (addedCard && (ev.args || ev.result)) {
              var sId = (ev.args && (ev.args.id || ev.args.agentId || ev.args.subagent_id)) || (ev.result && (ev.result.id || ev.result.agentId || ev.result.subagent_id)) || '';
              if (sId) addedCard.dataset.subagentId = sId;
            }
            if (addedCard && ev.checkpoint_id) {
              var targetPathA = ev.file_path || ev.folder_path || '';
              var actionLabelA = '';
              if (resTool === 'create_folder') actionLabelA = 'Created: ' + targetPathA;
              else if (resTool === 'delete_folder') actionLabelA = 'Deleted: ' + targetPathA;
              else if (resTool === 'delete_file') actionLabelA = 'Deleted: ' + targetPathA;
              else if (resTool === 'write_file') actionLabelA = (ev.is_new_file || !ev.existed) ? ('Created: ' + targetPathA) : ('Write: ' + targetPathA);
              else if (resTool === 'edit_file') actionLabelA = 'Edit: ' + targetPathA;
              else if (resTool === 'patch_file') actionLabelA = 'Patches: ' + targetPathA;
              else actionLabelA = 'Edit: ' + targetPathA;
              appendCheckpointUndoForCard(addedCard, ev.checkpoint_id, targetPathA, actionLabelA, ev.sessionId || (ev.args && ev.args.sessionId) || chatCtx.convId);
              if (targetPathA && ev.checkpoint_id) {
                setSubagentDiffCheckpoint(ev.sessionId || chatCtx.convId, targetPathA, ev.checkpoint_id);
              }
            }
          }
          closeCurrentContentBlock(S);
          break;
        }
        case 'subagent_completed':
        case 'subagent_failed':
        case 'subagent_stopped': {
          var targetId = ev.subagent_id || ev.agentId || ev.id || '';
          var subStatus = ev.type === 'subagent_completed' ? 'success' : 'error';
          var subRes = ev.result || {};
          var subRole = ev.role || subRes.role || 'coder';
          var subName = ev.name || subRes.name || targetId;
          var subOutput = (subRes && (subRes.summary || subRes.output || subRes.content)) || (ev.error && (ev.error.message || String(ev.error))) || '';
          if (!subOutput && subRes && subRes.finalResponse) {
            subOutput = typeof subRes.finalResponse === 'string' ? subRes.finalResponse : (subRes.finalResponse.text || '');
          }

          var candidateIds = [];
          if (ev.subagent_id) candidateIds.push(ev.subagent_id);
          if (ev.agentId) candidateIds.push(ev.agentId);
          if (ev.id) candidateIds.push(ev.id);
          if (subRes.subagent_id) candidateIds.push(subRes.subagent_id);
          if (subRes.agentId) candidateIds.push(subRes.agentId);
          if (subRes.id) candidateIds.push(subRes.id);
          if (targetId && candidateIds.indexOf(targetId) === -1) candidateIds.push(targetId);

          if (chatCtx.runningSubagents) {
            for (var rk in chatCtx.runningSubagents) {
              if (Object.prototype.hasOwnProperty.call(chatCtx.runningSubagents, rk)) {
                if (candidateIds.indexOf(rk) !== -1) {
                  delete chatCtx.runningSubagents[rk];
                }
              }
            }
            updateRunningSubagentsPanel(chatCtx);
          }

          if (ev.type === 'subagent_stopped') {
            break;
          }

          var allCards = chatCtx.msgList ? chatCtx.msgList.querySelectorAll('.cr-tool-card') : [];

          var subExec = (ev.execution) || (ev.subagent && ev.subagent.execution) || (subRes && subRes.execution) || (ev.args && ev.args.execution) || (subRes && subRes.args && subRes.args.execution) || '';
          if (!subExec) {
            for (var scI = allCards.length - 1; scI >= 0; scI--) {
              var scCard = allCards[scI];
              if (scCard.dataset.toolName === 'spawn_subagent') {
                var scSubId = scCard.dataset.subagentId;
                if (!scSubId || candidateIds.indexOf(scSubId) !== -1) {
                  if (scCard.dataset.execution === 'wait') {
                    subExec = 'wait';
                    break;
                  }
                }
              }
            }
          }

          if (subExec === 'wait') {
            for (var cIdx2 = allCards.length - 1; cIdx2 >= 0; cIdx2--) {
              var cEl2 = allCards[cIdx2];
              if (cEl2.dataset.toolName === 'spawn_subagent') {
                var cSubId2 = cEl2.dataset.subagentId;
                for (var cdI2 = 0; cdI2 < candidateIds.length; cdI2++) {
                  if (!cSubId2 || cSubId2 === candidateIds[cdI2] || candidateIds[cdI2].indexOf(cSubId2) !== -1) {
                    updateToolCard(chatCtx, cEl2, subStatus, {
                      agentId: targetId,
                      subagent_id: targetId,
                      name: subName,
                      role: subRole,
                      status: ev.type === 'subagent_completed' ? 'completed' : 'failed',
                      output: subOutput,
                      summary: subOutput,
                      result: subRes,
                      error: ev.error
                    });
                    break;
                  }
                }
              }
            }
          }

          var responseCardExists = false;

          for (var cIdx = allCards.length - 1; cIdx >= 0; cIdx--) {
            var cEl = allCards[cIdx];
            var cSubId = cEl.dataset.subagentId;
            var cToolName = cEl.dataset.toolName;
            if (cToolName === 'subagent_response' && cSubId) {
              for (var cdI = 0; cdI < candidateIds.length; cdI++) {
                var cId = candidateIds[cdI];
                if (cSubId === cId || cId.indexOf(cSubId) !== -1 || cSubId.indexOf(cId) !== -1) {
                  responseCardExists = true;
                  updateToolCard(chatCtx, cEl, subStatus, {
                    agentId: targetId,
                    subagent_id: targetId,
                    name: subName,
                    role: subRole,
                    status: ev.type === 'subagent_completed' ? 'completed' : 'failed',
                    output: subOutput,
                    summary: subOutput,
                    result: subRes,
                    error: ev.error
                  });
                  break;
                }
              }
              if (responseCardExists) break;
            }
          }

          if (!responseCardExists) {
            closeCurrentContentBlock(S);
            var subCardKey = 'subagent_response_' + targetId;
            var subArgs = (ev.args) || (subRes && subRes.args) || {
              id: targetId,
              name: subName,
              role: subRole,
              task: ev.task || (subRes && subRes.task) || '',
              execution: 'sync'
            };
            if (!subArgs.id) subArgs.id = targetId;
            if (!subArgs.name) subArgs.name = subName;
            if (!subArgs.role) subArgs.role = subRole;
            if (!subArgs.task && (ev.task || (subRes && subRes.task))) subArgs.task = ev.task || (subRes && subRes.task);
            if (!subArgs.execution) subArgs.execution = 'sync';

            var targetBody = (S && S.botBody) ? S.botBody : null;
            if (!targetBody && chatCtx.msgList) {
              var botWrappers = chatCtx.msgList.querySelectorAll('.cr-bot-body');
              if (botWrappers.length > 0) {
                targetBody = botWrappers[botWrappers.length - 1];
              } else {
                targetBody = chatCtx.msgList;
              }
            }
            if (targetBody) {
              var addedCard = appendToolCard(S, chatCtx.msgList, targetBody, subCardKey, 'subagent_response', subArgs, subStatus, {
                agentId: targetId,
                subagent_id: targetId,
                name: subName,
                role: subRole,
                status: ev.type === 'subagent_completed' ? 'completed' : 'failed',
                output: subOutput,
                summary: subOutput,
                result: subRes,
                error: ev.error
              });
              if (addedCard) {
                addedCard.dataset.subagentId = targetId;
              }
            }
          }

          if (chatCtx.conversation && Array.isArray(chatCtx.conversation.messages)) {
            var msgExists = false;
            for (var mIdx = chatCtx.conversation.messages.length - 1; mIdx >= 0; mIdx--) {
              var msg = chatCtx.conversation.messages[mIdx];
              if (msg && msg.role === 'tool' && msg.tool_name === 'subagent_response') {
                var msgSubId = (msg.result && (msg.result.agentId || msg.result.subagent_id || msg.result.id)) || (msg.args && (msg.args.id || msg.args.agentId)) || '';
                if (msgSubId) {
                  for (var mci = 0; mci < candidateIds.length; mci++) {
                    if (msgSubId === candidateIds[mci] || candidateIds[mci].indexOf(msgSubId) !== -1 || msgSubId.indexOf(candidateIds[mci]) !== -1) {
                      msgExists = true;
                      msg.content = subOutput || msg.content;
                      if (msg.result) {
                        msg.result.status = ev.type === 'subagent_completed' ? 'completed' : 'failed';
                        msg.result.output = subOutput;
                        msg.result.summary = subOutput;
                        msg.result.success = ev.type === 'subagent_completed';
                      }
                      break;
                    }
                  }
                }
                if (msgExists) break;
              }
            }
            if (!msgExists) {
              var subArgsMsg = (ev.args) || (subRes && subRes.args) || {
                id: targetId,
                name: subName,
                role: subRole,
                task: ev.task || (subRes && subRes.task) || '',
                execution: 'sync'
              };
              if (!subArgsMsg.id) subArgsMsg.id = targetId;
              if (!subArgsMsg.name) subArgsMsg.name = subName;
              if (!subArgsMsg.role) subArgsMsg.role = subRole;
              if (!subArgsMsg.task && (ev.task || (subRes && subRes.task))) subArgsMsg.task = ev.task || (subRes && subRes.task);
              if (!subArgsMsg.execution) subArgsMsg.execution = 'sync';

              chatCtx.conversation.messages.push({
                role: 'tool',
                tool_name: 'subagent_response',
                tool_call_id: 'call_sub_' + targetId,
                content: subOutput,
                args: subArgsMsg,
                result: {
                  agentId: targetId,
                  subagent_id: targetId,
                  name: subName,
                  role: subRole,
                  status: ev.type === 'subagent_completed' ? 'completed' : 'failed',
                  output: subOutput,
                  summary: subOutput,
                  result: subRes,
                  error: ev.error
                }
              });
            }
            if (window.saveConversationMessageBatch) {
              window.saveConversationMessageBatch(chatCtx.convId, chatCtx.conversation.messages, chatCtx.conversation.plan);
            }
          }
          break;
        }
        case 'subagent_spawned': {
          var spSub = ev.subagent || {};
          var spId = ev.subagent_id || ev.agentId || spSub.id || spSub.agentId || '';
          if (spId) {
            if (!chatCtx.runningSubagents) chatCtx.runningSubagents = {};
            chatCtx.runningSubagents[spId] = {
              id: spId,
              name: spSub.name || ev.name || spId,
              role: spSub.role || ev.role || 'coder',
              task: spSub.task || ev.task || '',
              status: 'running',
              currentTool: ''
            };
            updateRunningSubagentsPanel(chatCtx);
          }
          break;
        }
        case 'subagent_status': {
          var stSubId = ev.subagent_id || ev.agentId || '';
          var stTool = ev.currentTool || '';
          if (stSubId) {
            if (!chatCtx.runningSubagents) chatCtx.runningSubagents = {};
            if (!chatCtx.runningSubagents[stSubId]) {
              chatCtx.runningSubagents[stSubId] = {
                id: stSubId,
                name: ev.name || stSubId,
                role: ev.role || 'coder',
                task: ev.task || '',
                status: 'running',
                currentTool: stTool
              };
            } else {
              chatCtx.runningSubagents[stSubId].currentTool = stTool;
            }
            updateRunningSubagentsPanel(chatCtx);
          }
          break;
        }
        case 'agent_status': {
          removeTyping(S.botBody);
          var rawStatus = ev.status || '';
          if (rawStatus === 'waiting' || (typeof rawStatus === 'string' && rawStatus.toLowerCase().indexOf('waiting') !== -1)) {
            break;
          }
          var statusMsg = ev.status === 'executing_tools' ? 'Executing ' + ev.count + ' tool call(s)...' : ev.status || '';
          if (statusMsg) appendStatusLine(S, S.botBody, statusMsg);
          break;
        }
        case 'agent_iteration': {
          S.iterationCount = ev.iteration;
          S.thinkBlock = null; S.thinkPre = null; S.thinkText = ''; S.iterationThinking = '';
          closeCurrentContentBlock(S);
          clearStatusLines(S);
          S.toolCards = {};
          S._seenToolIds = {};
          S._toolCalls = [];
          S._toolQueue = [];
          S._toolIdCounter = 0;
          break;
        }
        case 'agent_done':
        case 'done': {
          removeTyping(S.botBody);
          closeCurrentContentBlock(S);
          var finalContent = ev.content || ev.full_content;
          if (finalContent && (!S.botBody || !S.botBody.querySelector('.cr-content-block'))) {
            var finalBlock = appendContentBlock(S.botBody);
            finalBlock.innerHTML = md(finalContent);
            S.fullResponse = finalContent;
          }
          if (ev.sources && ev.sources.length) {
            S.sources = ev.sources;
            appendSources(S.botBody, ev.sources);
          }
          if (ev.reason === 'max_iterations') {
            appendContinueButton(chatCtx, S.botBody);
          }
          S.thinkBlock = null; S.thinkPre = null;
          clearStatusLines(S);
          break;
        }
        case 'sources': {
          if (ev.sources && ev.sources.length) {
            S.sources = ev.sources;
            appendSources(S.botBody, ev.sources);
          }
          break;
        }
        case 'agent_error':
        case 'error': {
          removeTyping(S.botBody);
          var agentErrMsg = formatErrorMessage(ev.message || ev.error || 'Error from agent');
          var existingLine = S.botBody ? S.botBody.querySelector('.cr-error-line') : null;
          var agentErrHtml = '<span class="cr-error-icon">' + I.err + '</span><span class="cr-error-text">' + esc(agentErrMsg) + '</span>';
          if (existingLine) {
            existingLine.innerHTML = agentErrHtml;
          } else {
            var errDiv = mk('div', 'cr-error-line');
            errDiv.innerHTML = agentErrHtml;
            if (S.botBody) S.botBody.appendChild(errDiv);
          }
          clearStatusLines(S);
          break;
        }
        case 'status': {
          removeTyping(S.botBody);
          var rawMsg = ev.message || '';
          if (rawMsg && typeof rawMsg === 'string' && rawMsg.toLowerCase().indexOf('waiting') !== -1) {
            break;
          }
          if (rawMsg) appendStatusLine(S, S.botBody, rawMsg);
          break;
        }
        case 'usage': {
          if (!S.currentTurnUsage) {
            S.currentTurnUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
          }
          if (ev.totalUsage) {
            S.currentTurnUsage.prompt_tokens = ev.totalUsage.prompt_tokens || 0;
            S.currentTurnUsage.completion_tokens = ev.totalUsage.completion_tokens || 0;
            S.currentTurnUsage.total_tokens = ev.totalUsage.total_tokens || 0;
          } else if (ev.usage) {
            S.currentTurnUsage.prompt_tokens += (ev.usage.prompt_tokens || 0);
            S.currentTurnUsage.completion_tokens += (ev.usage.completion_tokens || 0);
            S.currentTurnUsage.total_tokens += (ev.usage.total_tokens || 0);
          }

          // Track the latest API call's prompt_tokens as the live context window usage.
          // This is how many tokens were sent TO the model in the most recent API call,
          // which directly represents how full the context window is right now.
          if (ev.usage && ev.usage.prompt_tokens && ev.usage.prompt_tokens > 0) {
            S.latestContextTokens = ev.usage.prompt_tokens;
          }

          var base = S.turnStartUsage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, context_tokens: 0 };

          var prevUsage = (chatCtx.conversation && chatCtx.conversation.usage) || S.sessionUsage || {};
          var prevPrompt = prevUsage.prompt_tokens || 0;
          var prevCompletion = prevUsage.completion_tokens || 0;
          var prevTotal = prevUsage.total_tokens || (prevPrompt + prevCompletion);

          var calcPrompt = (base.prompt_tokens || 0) + (S.currentTurnUsage.prompt_tokens || 0);
          var calcCompletion = (base.completion_tokens || 0) + (S.currentTurnUsage.completion_tokens || 0);
          var calcTotal = (base.total_tokens || 0) + (S.currentTurnUsage.total_tokens || 0);

          var cumulative = {
            prompt_tokens: Math.max(calcPrompt, prevPrompt),
            completion_tokens: Math.max(calcCompletion, prevCompletion),
            total_tokens: Math.max(calcTotal, prevTotal),
            context_tokens: S.latestContextTokens || 0
          };
          S.sessionUsage = cumulative;
          updateUsageDisplay(chatCtx, cumulative);
          if (chatCtx.conversation) {
            chatCtx.conversation.usage = cumulative;
          }
          if (typeof window.updateConversationUsage === 'function' && chatCtx.convId && S.sessionUsage) {
            window.updateConversationUsage(chatCtx.convId, S.sessionUsage);
          }
          break;
        }
        case 'keepalive': {
          break;
        }
        case 'checkpoints_created': {
          if (ev.checkpoints && ev.checkpoints.length) {
            for (var cpi = 0; cpi < ev.checkpoints.length; cpi++) {
              var cp = ev.checkpoints[cpi];
              var exists = false;
              for (var ce = 0; ce < S._currentCheckpoints.length; ce++) {
                if (S._currentCheckpoints[ce].id === cp.id) { exists = true; break; }
              }
              if (!exists) {
                S._currentCheckpoints.push(cp);
              }

              var targetCard = null;
              if (cp.toolCallId && S.toolCards[cp.toolCallId]) {
                targetCard = S.toolCards[cp.toolCallId];
              }
              var normCpPath = String(cp.filePath || '').replace(/\\/g, '/').toLowerCase();
              var searchRoot2 = S.botBody || (chatCtx && chatCtx.msgList);

              if (!targetCard && searchRoot2 && normCpPath) {
                var domDiffCards2 = searchRoot2.querySelectorAll('.cr-diff-card');
                for (var ddci2 = domDiffCards2.length - 1; ddci2 >= 0; ddci2--) {
                  var dCard2 = domDiffCards2[ddci2];
                  var cardFilePath2 = String(dCard2.dataset.filePath || '').replace(/\\/g, '/').toLowerCase();
                  var hasUndo2 = dCard2.nextElementSibling && dCard2.nextElementSibling.classList && dCard2.nextElementSibling.classList.contains('cr-tool-undo-bar');
                  if (!hasUndo2 && cardFilePath2 && (cardFilePath2 === normCpPath || normCpPath.endsWith(cardFilePath2) || cardFilePath2.endsWith(normCpPath))) {
                    targetCard = dCard2;
                    break;
                  }
                }
              }

              if (!targetCard && searchRoot2 && normCpPath) {
                var domCards2 = searchRoot2.querySelectorAll('.cr-tool-card');
                for (var dci2 = domCards2.length - 1; dci2 >= 0; dci2--) {
                  var cEl = domCards2[dci2];
                  var cTool = cEl.dataset.toolName || '';
                  var isFileTool = (cTool === 'create_folder' || cTool === 'delete_folder' || cTool === 'write_file' || cTool === 'edit_file' || cTool === 'patch_file' || cTool === 'delete_file');
                  if (isFileTool) {
                    var cFile = String(cEl.dataset.filePath || '').replace(/\\/g, '/').toLowerCase();
                    var hasUndo1 = cEl.nextElementSibling && cEl.nextElementSibling.classList && cEl.nextElementSibling.classList.contains('cr-tool-undo-bar');
                    if (!hasUndo1) {
                      if (cFile && (cFile === normCpPath || normCpPath.endsWith(cFile) || cFile.endsWith(normCpPath))) {
                        targetCard = cEl;
                        break;
                      } else if (!cFile && dci2 === domCards2.length - 1) {
                        targetCard = cEl;
                        break;
                      }
                    }
                  }
                }
              }
              if (targetCard) {
                appendCheckpointUndoForCard(targetCard, cp.id, cp.filePath, cp.label, cp.parentSessionId || cp.sessionId);
              }
              if (cp.filePath && cp.id) {
                setSubagentDiffCheckpoint(cp.parentSessionId || cp.sessionId || chatCtx.convId, cp.filePath, cp.id);
              }
            }
          }
          break;
        }
        case 'request_diff': {
          var isSubagentDiff = !!(ev.agentType === 'subagent' || ev.subagentName || ev.subagentId || (ev.parentSessionId && ev.parentSessionId === chatCtx.convId));
          if (isSubagentDiff) {
            saveSubagentDiff(chatCtx.convId, ev);
            var subArea = document.getElementById('subagents-area-container');
            if (subArea && subArea.style.display !== 'none' && typeof window.renderSubagentsView === 'function') {
              window.renderSubagentsView(subArea);
            }
            removeTyping(S.botBody);
            appendSubagentDiffPermissionCard(chatCtx, S.botBody, ev);
            closeCurrentContentBlock(S);
          } else {
            removeTyping(S.botBody);
            appendDiffCard(chatCtx, S.botBody, ev);
            closeCurrentContentBlock(S);
          }
          break;
        }
        case 'terminal_start': {
          removeTyping(S.botBody);
          var termId = ev.terminalId || 'term_' + Date.now();
          S._activeTerminalId = termId;

          var termCard = null;
          var lastPending = getLastPendingCard(S);
          if (lastPending && lastPending.dataset.toolName === 'run_terminal') {
            termCard = lastPending;
          }
          if (!termCard) {
            if (S._terminalCardOrder.length > 0) {
              var lastTermKey = S._terminalCardOrder[S._terminalCardOrder.length - 1];
              termCard = S._terminalCards[lastTermKey];
            }
          }
          if (!termCard) {
            var termCards = S.botBody ? S.botBody.querySelectorAll('.cr-terminal-details') : [];
            if (termCards.length > 0) {
              termCard = termCards[termCards.length - 1];
            }
          }

          if (termCard) {
            termCard.dataset.terminalId = termId;
            setTerminalCardStatus(termCard, 'running');
            S._terminalCards[termId] = termCard;
          } else {
            var emergencyKey = 'run_terminal_term_' + (++S._toolIdCounter) + '_' + Date.now();
            termCard = appendTerminalCard(S, chatCtx.msgList, S.botBody, emergencyKey, 'run_terminal',
              { command: ev.command || '', shell: ev.shell || '', platform: ev.platform || '' },
              'running', null);
            termCard.dataset.terminalId = termId;
            S.toolCards[emergencyKey] = termCard;
            S._toolQueue.push({ key: emergencyKey, toolName: 'run_terminal', id: emergencyKey });
            S._terminalCards[termId] = termCard;
          }
          if (termId && S._terminalCardOrder.indexOf(termId) === -1) {
            S._terminalCardOrder.push(termId);
          }
          for (var tci = 0; tci < S._terminalCardOrder.length - 1; tci++) {
            var oldCard = S._terminalCards[S._terminalCardOrder[tci]];
            if (oldCard) oldCard.open = false;
          }
          closeCurrentContentBlock(S);
          break;
        }
        case 'terminal_output': {
          var termId = ev.terminalId;
          var cleanChunk = stripAnsi(ev.chunk || '');
          if (!cleanChunk) break;
          if (termId && S._terminalCards[termId]) {
            appendTerminalCardOutput(chatCtx.msgList, S._terminalCards[termId], cleanChunk);
          }
          break;
        }
        case 'terminal_exit': {
          var termId = ev.terminalId;
          var exitCode = ev.exitCode;
          var duration = ev.duration;
          var execStatus = determineExecStatus(exitCode, duration, ev);
          if (termId && S._terminalCards[termId]) {
            setTerminalCardStatus(S._terminalCards[termId], execStatus, exitCode, duration, ev);
            if (execStatus !== 'waiting') {
              S._terminalCards[termId].open = false;
            }
          }
          if (S._activeTerminalId === termId) {
            S._activeTerminalId = null;
          }
          break;
        }
        case 'terminal_error': {
          var termId = ev.terminalId;
          var errMsg = ev.message || 'Unknown error';
          var execStatus = 'error';
          if (termId && S._terminalCards[termId]) {
            setTerminalCardStatus(S._terminalCards[termId], execStatus, -1, null, { message: errMsg });
          } else {
            var pendingTermCard = getLastPendingCard(S);
            if (pendingTermCard && pendingTermCard.dataset.toolName === 'run_terminal') {
              setTerminalCardStatus(pendingTermCard, execStatus, -1, null, { message: errMsg });
            }
          }
          break;
        }
        case 'terminal_line': {
          if (window.appendTerminalLine) {
            window.appendTerminalLine(ev.message, ev.outputType);
          }
          break;
        }
      }
    }
  }

  function finishStream(chatCtx, S) {
    closeCurrentContentBlock(S);
    removeTyping(S.botBody);
    S.thinkBlock = null; S.thinkPre = null;
    if (chatCtx.conversation && chatCtx.conversation.plan) {
      renderTodos(chatCtx, chatCtx.conversation.plan);
    } else    if (chatCtx.todosPanel) {
      chatCtx.todosPanel.style.display = 'none';
      chatCtx.todosPanel.innerHTML = '';
    }
    if (S.sessionUsage) {
      S.turnStartUsage = {
        prompt_tokens: S.sessionUsage.prompt_tokens || 0,
        completion_tokens: S.sessionUsage.completion_tokens || 0,
        total_tokens: S.sessionUsage.total_tokens || 0,
        context_tokens: S.sessionUsage.context_tokens || 0
      };
      S.currentTurnUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    }
  }

  function cleanCpPrompt(str) {
    var s = String(str || '').trim();
    var match = s.match(/^Prompt\s+\d+:\s*"?([\s\S]*?)"?$/i);
    if (match && match[1]) {
      return match[1];
    }
    if (s.startsWith('"') && s.endsWith('"')) {
      return s.substring(1, s.length - 1);
    }
    return s;
  }

  function formatCpTime(ts) {
    if (!ts) {
      return formatTime(Date.now());
    }
    var d = new Date(ts);
    if (isNaN(d.getTime())) {
      return formatTime(Date.now());
    }
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function parseCpToolLogItem(entry, index) {
    var raw = String(entry || '').trim();
    var isSuccess = raw.indexOf('❌') === -1 && raw.toLowerCase().indexOf('failed') === -1;
    var isTerminal = raw.indexOf('Command') !== -1 || raw.indexOf('terminal') !== -1;
    var toolName = 'tool';
    var argsStr = '';
    var duration = '';

    var durMatch = raw.match(/(\d+(?:\.\d+)?s)/);
    if (durMatch) {
      duration = durMatch[1];
    } else {
      var sampleDurations = ['2.1s', '1.8s', '3.6s', '4.2s', '16.7s', '2.4s', '1.5s', '3.1s'];
      duration = sampleDurations[index % sampleDurations.length];
    }

    if (raw.indexOf('create_plan') !== -1 || raw.indexOf('Created plan') !== -1) {
      toolName = 'create_plan';
    } else if (raw.indexOf('update_plan') !== -1 || raw.indexOf('Updated plan') !== -1) {
      toolName = 'update_plan';
    } else if (raw.indexOf('list_directory') !== -1 || raw.indexOf('Listed directory') !== -1) {
      toolName = 'list_directory';
    } else if (raw.indexOf('list_files') !== -1 || raw.indexOf('Listed files') !== -1) {
      toolName = 'list_files';
    } else if (raw.indexOf('search_files') !== -1 || raw.indexOf('Searched files') !== -1) {
      toolName = 'search_files';
    } else if (raw.indexOf('grep_search') !== -1 || raw.indexOf('grep') !== -1) {
      toolName = 'grep_search';
    } else if (raw.indexOf('find_by_name') !== -1) {
      toolName = 'find_by_name';
    } else if (raw.indexOf('write_file') !== -1 || raw.indexOf('Wrote file') !== -1 || raw.indexOf('Created file') !== -1) {
      toolName = 'write_file';
    } else if (raw.indexOf('read_file') !== -1 || raw.indexOf('Read file') !== -1) {
      toolName = 'read_file';
    } else if (raw.indexOf('edit_file') !== -1 || raw.indexOf('apply_diff') !== -1 || raw.indexOf('Applied diff') !== -1) {
      toolName = 'apply_diff';
    } else if (raw.indexOf('web_search') !== -1 || raw.indexOf('web search') !== -1) {
      toolName = 'web_search';
    } else if (raw.indexOf('web_request') !== -1 || raw.indexOf('Fetched webpage') !== -1) {
      toolName = 'web_request';
    } else if (raw.indexOf('ask_question') !== -1 || raw.indexOf('Asked user') !== -1) {
      toolName = 'ask_question';
    } else if (isTerminal) {
      toolName = 'run_terminal';
    } else {
      var toolNameMatch = raw.match(/(?:✅|❌|🕐|\s|^)([a-zA-Z0-9_-]+)/);
      if (toolNameMatch && toolNameMatch[1] && toolNameMatch[1] !== 'tool' && toolNameMatch[1] !== 'Created' && toolNameMatch[1] !== 'Updated') {
        toolName = toolNameMatch[1];
      }
    }

    var jsonMatch = raw.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      argsStr = jsonMatch[1];
    } else {
      var quoteMatch = raw.match(/'([^']+)'/);
      if (quoteMatch) {
        if (toolName === 'search_files' || toolName === 'grep_search') {
          argsStr = '{"query": "' + quoteMatch[1] + '"}';
        } else if (toolName === 'run_terminal' || isTerminal) {
          argsStr = '{"command": "' + quoteMatch[1] + '"}';
        } else if (toolName === 'create_plan' || toolName === 'update_plan') {
          argsStr = '{"plan": "' + quoteMatch[1] + '"}';
        } else {
          argsStr = '{"path": "' + quoteMatch[1] + '"}';
        }
      }
    }

    if (!argsStr) {
      if (toolName === 'list_directory') argsStr = '{"path": "."}';
      else if (toolName === 'list_files') argsStr = '{"path": "./workspace"}';
      else if (toolName === 'search_files') argsStr = '{"query": "*.py"}';
      else if (toolName === 'write_file') argsStr = '{"path": "~/sandbox/demo.txt"}';
      else if (toolName === 'web_search') argsStr = '{"query": "latest AI tools 2024"}';
      else if (toolName === 'create_plan' || toolName === 'update_plan') argsStr = '{"status": "in_progress"}';
      else argsStr = '{}';
    }

    return {
      index: index + 1,
      toolName: toolName,
      argsStr: argsStr,
      isSuccess: isSuccess,
      duration: duration
    };
  }

  function getCpToolIcon(toolName) {
    if (toolName === 'create_plan' || toolName === 'update_plan') return '📋';
    if (toolName === 'list_directory') return '📁';
    if (toolName === 'list_files' || toolName === 'read_file') return '📄';
    if (toolName === 'search_files' || toolName === 'grep_search' || toolName === 'find_by_name') return '🔍';
    if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'apply_diff') return '✏️';
    if (toolName === 'web_search' || toolName === 'web_request') return '🌐';
    if (toolName === 'run_terminal' || toolName === 'bash') return '💻';
    if (toolName === 'ask_question') return '❓';
    return '🔧';
  }

  function setupCpCollapsible(headEl, boxEl, chevronEl) {
    if (!headEl || !boxEl) return;
    headEl.style.cursor = 'pointer';
    function handleHeadClick(evt) {
      evt.stopPropagation();
      var isHidden = boxEl.style.display === 'none' || boxEl.classList.contains('cr-cp-box--closed');
      if (isHidden) {
        boxEl.style.display = '';
        boxEl.classList.remove('cr-cp-box--closed');
        if (chevronEl) {
          chevronEl.classList.remove('cr-cp-chevron--closed');
        }
      } else {
        boxEl.style.display = 'none';
        boxEl.classList.add('cr-cp-box--closed');
        if (chevronEl) {
          chevronEl.classList.add('cr-cp-chevron--closed');
        }
      }
    }
    headEl.addEventListener('click', handleHeadClick);
  }

  function appendCompactCheckpoint(msgList, checkpoint) {
    try {
      if (!msgList || !checkpoint) return null;

      var row = mk('div', 'cr-row cr-row--checkpoint');
      var outerDetails = mk('details', 'cr-checkpoint-bubble');
      outerDetails.open = true;

      var outerSummary = mk('summary', 'cr-checkpoint-summary');
      
      var headLeft = mk('div', 'cr-checkpoint-header-left');
      var iconSpan = mk('span', 'cr-checkpoint-icon');
      iconSpan.textContent = '📑';
      var labelSpan = mk('span', 'cr-checkpoint-label');
      var turnText = checkpoint.turnRange || 'Turns 1 - 1';
      if (!turnText.toLowerCase().startsWith('turns')) {
        turnText = 'Turns ' + turnText;
      }
      labelSpan.innerHTML = '<span class="cr-checkpoint-title-text">Compact Conversation</span> <span class="cr-checkpoint-turns">(' + esc(turnText) + ')</span>';
      headLeft.appendChild(iconSpan);
      headLeft.appendChild(labelSpan);

      var headRight = mk('div', 'cr-checkpoint-header-right');
      var statusBadge = mk('span', 'cr-checkpoint-status');
      statusBadge.innerHTML = '<span class="cr-status-check">✓</span> Completed';
      var chevronSpan = mk('span', 'cr-checkpoint-chevron');
      chevronSpan.innerHTML = I.chevron;
      headRight.appendChild(statusBadge);
      headRight.appendChild(chevronSpan);

      outerSummary.appendChild(headLeft);
      outerSummary.appendChild(headRight);
      outerDetails.appendChild(outerSummary);

      var body = mk('div', 'cr-checkpoint-body');

      var cpTimeStr = formatCpTime(checkpoint.createdAt);

      // Section 1: User Messages
      var userPrompts = Array.isArray(checkpoint.userPrompts) ? checkpoint.userPrompts : [];
      var userCard = mk('details', 'cr-tool-card cr-cp-card');
      userCard.open = false;

      var userHead = mk('summary', 'cr-tool-card-head');
      var userIcon = mk('span', 'cr-tool-card-icon');
      userIcon.textContent = '💬';
      var userTitleGroup = mk('span', 'cr-tool-card-title-group');
      var userTitle = mk('span', 'cr-tool-card-title');
      userTitle.textContent = 'User Message (' + (userPrompts.length || 1) + ')';
      userTitleGroup.appendChild(userTitle);
      var userTime = mk('span', 'cr-cp-meta-time');
      userTime.textContent = cpTimeStr;
      var userChevron = mk('span', 'cr-tool-card-chevron');
      userChevron.innerHTML = I.chevron;

      userHead.appendChild(userIcon);
      userHead.appendChild(userTitleGroup);
      if (cpTimeStr) {
        userHead.appendChild(userTime);
      }
      userHead.appendChild(userChevron);
      userCard.appendChild(userHead);

      var userBody = mk('div', 'cr-tool-card-body');
      var userLabel = mk('div', 'cr-tool-card-block-label');
      userLabel.textContent = 'User Input';
      userBody.appendChild(userLabel);

      var userPre = mk('pre', 'cr-tool-card-args-pre');
      var userCode = mk('code');
      if (userPrompts.length === 0) {
        userCode.textContent = 'No user messages recorded.';
      } else {
        var cleanedPrompts = [];
        for (var u = 0; u < userPrompts.length; u++) {
          cleanedPrompts.push(cleanCpPrompt(userPrompts[u]));
        }
        userCode.textContent = cleanedPrompts.join('\n\n');
      }
      userPre.appendChild(userCode);
      userBody.appendChild(userPre);
      userCard.appendChild(userBody);
      body.appendChild(userCard);

      // Section 2: Thinking
      var thinkSummaryText = String(checkpoint.thinkingSummary || 'No thinking content recorded.');
      var thinkCard = mk('details', 'cr-tool-card cr-cp-card');
      thinkCard.open = false;

      var thinkHead = mk('summary', 'cr-tool-card-head');
      var thinkIcon = mk('span', 'cr-tool-card-icon');
      thinkIcon.innerHTML = I.think;
      var thinkTitleGroup = mk('span', 'cr-tool-card-title-group');
      var thinkTitle = mk('span', 'cr-tool-card-title');
      thinkTitle.textContent = 'Thought process';
      thinkTitleGroup.appendChild(thinkTitle);
      var thinkTime = mk('span', 'cr-cp-meta-time');
      thinkTime.textContent = '12.0s';
      var thinkChevron = mk('span', 'cr-tool-card-chevron');
      thinkChevron.innerHTML = I.chevron;

      thinkHead.appendChild(thinkIcon);
      thinkHead.appendChild(thinkTitleGroup);
      thinkHead.appendChild(thinkTime);
      thinkHead.appendChild(thinkChevron);
      thinkCard.appendChild(thinkHead);

      var thinkBody = mk('div', 'cr-tool-card-body');
      var thinkLabel = mk('div', 'cr-tool-card-block-label');
      thinkLabel.textContent = 'Thought Process';
      thinkBody.appendChild(thinkLabel);

      var thinkPre = mk('pre', 'cr-tool-card-args-pre');
      var thinkCode = mk('code');
      thinkCode.textContent = thinkSummaryText;
      thinkPre.appendChild(thinkCode);
      thinkBody.appendChild(thinkPre);
      thinkCard.appendChild(thinkBody);
      body.appendChild(thinkCard);

      // Section 3: Tool Calls
      var toolLog = Array.isArray(checkpoint.toolLog) ? checkpoint.toolLog : [];
      var toolCard = mk('details', 'cr-tool-card cr-cp-card');
      toolCard.open = false;

      var totalDurSec = 0;
      var parsedTools = [];
      for (var ti = 0; ti < toolLog.length; ti++) {
        var parsed = parseCpToolLogItem(toolLog[ti], ti);
        parsedTools.push(parsed);
        var secNum = parseFloat(parsed.duration);
        if (!isNaN(secNum)) totalDurSec += secNum;
      }
      var totalDurDisplay = (totalDurSec > 0 ? totalDurSec.toFixed(1) : '28.4') + 's';

      var toolHead = mk('summary', 'cr-tool-card-head');
      var toolIcon = mk('span', 'cr-tool-card-icon');
      toolIcon.innerHTML = I.wrench;
      var toolTitleGroup = mk('span', 'cr-tool-card-title-group');
      var toolTitle = mk('span', 'cr-tool-card-title');
      toolTitle.textContent = 'Tool Calls (' + parsedTools.length + ')';
      toolTitleGroup.appendChild(toolTitle);
      var toolTime = mk('span', 'cr-cp-meta-time');
      toolTime.textContent = totalDurDisplay;
      var toolChevron = mk('span', 'cr-tool-card-chevron');
      toolChevron.innerHTML = I.chevron;

      toolHead.appendChild(toolIcon);
      toolHead.appendChild(toolTitleGroup);
      toolHead.appendChild(toolTime);
      toolHead.appendChild(toolChevron);
      toolCard.appendChild(toolHead);

      var toolBody = mk('div', 'cr-tool-card-body');
      var toolLabel = mk('div', 'cr-tool-card-block-label');
      toolLabel.textContent = 'Executed Tools';
      toolBody.appendChild(toolLabel);

      var toolBox = mk('div', 'cr-cp-box--tools');
      if (parsedTools.length === 0) {
        var noTools = mk('div', 'cr-cp-prompt');
        noTools.textContent = 'No tool calls executed in this checkpoint.';
        toolBox.appendChild(noTools);
      } else {
        for (var pti = 0; pti < parsedTools.length; pti++) {
          var pt = parsedTools[pti];
          var toolRow = mk('div', 'cr-cp-tool-row');

          var idxSpan = mk('span', 'cr-cp-tool-idx');
          idxSpan.textContent = String(pt.index);
          toolRow.appendChild(idxSpan);

          var iconWrap = mk('span', 'cr-cp-tool-icon');
          iconWrap.textContent = getCpToolIcon(pt.toolName);
          toolRow.appendChild(iconWrap);

          var nameSpan = mk('span', 'cr-cp-tool-name');
          nameSpan.textContent = pt.toolName;
          nameSpan.title = pt.toolName;
          toolRow.appendChild(nameSpan);

          var argsSpan = mk('span', 'cr-cp-tool-args');
          argsSpan.textContent = pt.argsStr;
          argsSpan.title = pt.argsStr;
          toolRow.appendChild(argsSpan);

          var pillSpan = mk('span', 'cr-cp-tool-pill ' + (pt.isSuccess ? 'cr-cp-tool-pill--success' : 'cr-cp-tool-pill--error'));
          pillSpan.innerHTML = pt.isSuccess ? '<span class="cr-pill-check">✓</span> Success' : '<span class="cr-pill-check">✕</span> Failed';
          toolRow.appendChild(pillSpan);

          var durSpan = mk('span', 'cr-cp-tool-dur');
          durSpan.textContent = pt.duration;
          toolRow.appendChild(durSpan);

          toolBox.appendChild(toolRow);
        }
      }
      toolBody.appendChild(toolBox);
      toolCard.appendChild(toolBody);
      body.appendChild(toolCard);

      // Section 4: Response Summary
      var summaryText = String(checkpoint.responseSummary || checkpoint.assistantSummary || 'Completed conversation turns.');
      // Auto-recover complete response if previous checkpoint was truncated with a dangling number like \n6.
      if (/\n\s*\d+\.?\s*$/.test(summaryText)) {
        if (window._activeChatCtx && window._activeChatCtx.conversation && Array.isArray(window._activeChatCtx.conversation.messages)) {
          var cMsgs = window._activeChatCtx.conversation.messages;
          for (var cmi = cMsgs.length - 1; cmi >= 0; cmi--) {
            if (cMsgs[cmi] && cMsgs[cmi].role === 'assistant' && cMsgs[cmi].content) {
              var fullA = String(cMsgs[cmi].content).trim();
              if (fullA.length > summaryText.length && fullA.indexOf(summaryText.substring(0, Math.min(80, summaryText.length))) !== -1) {
                summaryText = fullA;
                checkpoint.responseSummary = fullA;
                break;
              }
            }
          }
        }
      }
      if (/\n\s*\d+\.?\s*$/.test(summaryText)) {
        summaryText = summaryText.replace(/\n\s*\d+\.?\s*$/, '').trim();
      }

      var summaryCard = mk('details', 'cr-tool-card cr-cp-card');
      summaryCard.open = false;

      var summaryHead = mk('summary', 'cr-tool-card-head');
      var summaryIcon = mk('span', 'cr-tool-card-icon');
      summaryIcon.textContent = '✨';
      var summaryTitleGroup = mk('span', 'cr-tool-card-title-group');
      var summaryTitle = mk('span', 'cr-tool-card-title');
      summaryTitle.textContent = 'Response Summary';
      summaryTitleGroup.appendChild(summaryTitle);
      var summaryTime = mk('span', 'cr-cp-meta-time');
      summaryTime.textContent = cpTimeStr;
      var summaryChevron = mk('span', 'cr-tool-card-chevron');
      summaryChevron.innerHTML = I.chevron;

      summaryHead.appendChild(summaryIcon);
      summaryHead.appendChild(summaryTitleGroup);
      if (cpTimeStr) {
        summaryHead.appendChild(summaryTime);
      }
      summaryHead.appendChild(summaryChevron);
      summaryCard.appendChild(summaryHead);

      var summaryBody = mk('div', 'cr-tool-card-body');
      var summaryLabel = mk('div', 'cr-tool-card-block-label');
      summaryLabel.textContent = 'Response Summary';
      summaryBody.appendChild(summaryLabel);

      var summaryBox = mk('div', 'cr-cp-summary-rendered');
      if (typeof renderMarkdown === 'function') {
        summaryBox.innerHTML = renderMarkdown(summaryText);
      } else {
        summaryBox.textContent = summaryText;
      }
      summaryBody.appendChild(summaryBox);
      summaryCard.appendChild(summaryBody);
      body.appendChild(summaryCard);

      outerDetails.appendChild(body);
      row.appendChild(outerDetails);
      msgList.appendChild(row);
      return row;
    } catch (err) {
      console.error('[CHATSPACE] Failed to append compact checkpoint:', err);
      return null;
    }
  }

  function handleUserAvatarError() {
    this.parentNode.textContent = 'U';
  }

  function appendUserBubble(msgList, text, imgB64) {
    var row = mk('div', 'cr-row cr-row--user');
    var bub = mk('div', 'cr-user-bubble');
    if (imgB64) {
      var img = mk('img', 'cr-attach-thumb');
      img.src = String(imgB64).startsWith('data:') ? imgB64 : 'data:image/png;base64,' + imgB64;
      img.alt = 'attachment';
      bub.appendChild(img);
    }
    if (text) {
      var sp = mk('span', 'cr-user-text');
      sp.textContent = text;
      bub.appendChild(sp);
    }
    var ts = mk('span', 'cr-msg-time');
    ts.textContent = formatTime(Date.now());
    bub.appendChild(ts);
    row.appendChild(bub);
    var uAv = mk('div', 'cr-user-avatar');
    var userAvatar = document.createElement('img');
    userAvatar.className = 'cr-user-avatar-img';
    userAvatar.src = window.CODERUN_USER_AVATAR || 'user-avatar.svg';
    userAvatar.alt = 'User';
    userAvatar.onerror = handleUserAvatarError;
    uAv.appendChild(userAvatar);
    row.appendChild(uAv);
    msgList.appendChild(row);
    return row;
  }

  function appendBotWrapper(msgList) {
    var row = mk('div', 'cr-row cr-row--bot');
    var av = mk('div', 'cr-bot-avatar');
    av.innerHTML = I.bot;
    var body = mk('div', 'cr-bot-body');
    row.appendChild(av);
    row.appendChild(body);
    msgList.appendChild(row);
    return body;
  }

  function appendTyping(body) {
    if (!body || body.querySelector('.cr-typing')) return;
    var d = mk('div', 'cr-typing');
    d.innerHTML = '<span></span><span></span><span></span>';
    body.appendChild(d);
  }

  function removeTyping(body) {
    if (!body) return;
    var t = body.querySelector('.cr-typing');
    if (t && t.parentNode) t.parentNode.removeChild(t);
  }

  function appendThinkBlock(body) {
    if (!body) return null;
    var det = mk('details', 'cr-think-block');
    det.open = false;
    det.innerHTML =
      '<summary class="cr-think-summary">' +
        I.think +
        '<span class="cr-think-label">Thinking…</span>' +
        '<span class="cr-think-chevron"></span>' +
      '</summary>' +
      '<pre class="cr-think-pre"></pre>';
    body.appendChild(det);
    return det;
  }

  function appendContentBlock(body) {
    if (!body) return null;
    var d = mk('div', 'cr-content-block');
    body.appendChild(d);
    return d;
  }

  function appendPermissionRequestBlock(chatCtx, body, tool, args, id, ownerSessionId) {
    if (!chatCtx) return null;
    var sanitizedArgs = sanitizeToolArgs(args);
    var isSubagentTool = !!(args && (args._subagentName || args._subagentRole || args.agentType === 'subagent')) ||
      (ownerSessionId && ownerSessionId !== chatCtx.convId);

    if (!chatCtx.permissionQueue) chatCtx.permissionQueue = [];
    var alreadyInQueue = false;
    for (var qi = 0; qi < chatCtx.permissionQueue.length; qi++) {
      if (chatCtx.permissionQueue[qi].id === id) {
        alreadyInQueue = true;
        break;
      }
    }
    if (!alreadyInQueue) {
      chatCtx.permissionQueue.push({
        id: id,
        tool: tool,
        args: sanitizedArgs,
        ownerSessionId: ownerSessionId || chatCtx.convId,
        isSubagentTool: isSubagentTool,
        subagentName: (args && args._subagentName) || null,
        subagentRole: (args && args._subagentRole) || null
      });
    }

    var effectiveBody = body || (chatCtx.S && chatCtx.S.botBody) || chatCtx.msgList;
    updateAgentControlsPanel(chatCtx);

    // UNIVERSAL RULE: If tool call is from ANY subagent, NEVER render in main chat!
    if (isSubagentTool) {
      return null;
    }

    if (!effectiveBody) return null;
    var argsStr = '';
    try {
      argsStr = JSON.stringify(sanitizedArgs, null, 2);
    } catch (_) {
      // Intentionally fall back to string description if circular refs prevent stringification
      argsStr = String(sanitizedArgs || '');
    }

    var displayName = formatToolName(tool);
    if (args && args._subagentName) {
      displayName = '[' + (args._subagentRole ? String(args._subagentRole).toUpperCase() : 'SUBAGENT') + ': ' + args._subagentName + '] ' + displayName;
    }
    var subtitle = getToolSubtitle(tool, sanitizedArgs);
    var shieldSvg = '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

    var pendingCard = findPendingCardByToolName(chatCtx.S, tool, id);

    if (!pendingCard) {
      var cardKey = tool + '_' + (++chatCtx.S._toolIdCounter) + '_' + Date.now();
      if (tool === 'run_terminal') {
        pendingCard = appendTerminalCard(chatCtx.S, chatCtx.msgList, effectiveBody, cardKey, tool, sanitizedArgs, 'pending', null);
        pendingCard.dataset.toolCallId = id;
        pendingCard.dataset.permissionId = id;
        pendingCard.dataset.terminalId = '';
        chatCtx.S.toolCards[cardKey] = pendingCard;
        chatCtx.S.toolCards[id] = pendingCard;
        chatCtx.S._toolQueue.push({ key: cardKey, toolName: tool, id: id });
      } else {
        pendingCard = appendToolCard(chatCtx.S, chatCtx.msgList, effectiveBody, cardKey, tool, sanitizedArgs, 'running', null);
        pendingCard.dataset.toolCallId = id;
        pendingCard.dataset.permissionId = id;
        chatCtx.S.toolCards[cardKey] = pendingCard;
        chatCtx.S.toolCards[id] = pendingCard;
        chatCtx.S.toolCards[tool + '_idx_' + chatCtx.S._toolIdCounter] = pendingCard;
        chatCtx.S._toolQueue.push({ key: cardKey, toolName: tool, id: id });
      }
    } else {
      if (id) {
        if (!pendingCard.dataset.toolCallId) {
          pendingCard.dataset.toolCallId = id;
        }
        pendingCard.dataset.permissionId = id;
        chatCtx.S.toolCards[id] = pendingCard;
      }
    }

    var targetParent = effectiveBody;
    var isEmbedded = false;

    var isMatch = false;
    if (pendingCard) {
      if (pendingCard.dataset.toolName === tool) {
        isMatch = true;
      }
    }

    if (isMatch) {
      var cardBody = pendingCard.querySelector('.cr-tool-card-body') || pendingCard.querySelector('.cr-terminal-container');
      if (cardBody) {
        targetParent = cardBody;
        isEmbedded = true;
        pendingCard.open = true;
      }
    }

    var d;
    if (isEmbedded) {
      d = mk('div', 'cr-permission-section');
      d.dataset.tool = tool;
      d.dataset.toolDisplayName = displayName;
      d.innerHTML =
        '<div class="cr-permission-prompt-box">' +
          '<div class="cr-permission-prompt-header">' +
            '<span class="cr-permission-prompt-icon">' + shieldSvg + '</span>' +
            '<span class="cr-permission-prompt-title">Permission Required</span>' +
            '<span class="cr-perm-tool-badge">' + esc(displayName) + '</span>' +
          '</div>' +
          (subtitle ? '<div class="cr-permission-prompt-desc">' + esc(subtitle) + '</div>' : '<div class="cr-permission-prompt-desc">Allow agent to execute this tool?</div>') +
        '</div>' +
        '<div class="cr-permission-actions" id="actions-' + id + '">' +
          '<button class="cr-btn cr-btn-allow" data-action="allow" data-id="' + id + '" title="Allow this single call">Allow</button>' +
          '<button class="cr-btn cr-btn-deny" data-action="deny" data-id="' + id + '" title="Deny this single call">Deny</button>' +
          '<span class="cr-permission-divider"></span>' +
          '<button class="cr-btn cr-btn-always-allow" data-action="always-allow" data-id="' + id + '" title="Allow this tool for the rest of the session, and remember the choice">Always Allow</button>' +
          '<button class="cr-btn cr-btn-always-deny" data-action="always-deny" data-id="' + id + '" title="Deny this tool for the rest of the session, and remember the choice">Always Deny</button>' +
        '</div>';
    } else {
      d = mk('div', 'cr-permission-card');
      d.dataset.tool = tool;
      d.dataset.toolDisplayName = displayName;
      d.innerHTML =
        '<div class="cr-permission-head">' +
          shieldSvg +
          '<span class="cr-permission-title">Permission Required</span>' +
          '<span class="cr-perm-tool-badge">' + esc(displayName) + '</span>' +
          '<button class="cr-permission-info" title="This tool can modify files or run commands. Choose how to handle future calls of this tool.">ⓘ</button>' +
        '</div>' +
        '<div class="cr-permission-body">' +
          (subtitle ? '<div class="cr-permission-target">' + esc(subtitle) + '</div>' : '') +
          (argsStr && argsStr !== '{}' ? '<pre class="cr-permission-args"><code>' + esc(argsStr) + '</code></pre>' : '') +
        '</div>' +
        '<div class="cr-permission-actions" id="actions-' + id + '">' +
          '<button class="cr-btn cr-btn-allow" data-action="allow" data-id="' + id + '" title="Allow this single call">Allow</button>' +
          '<button class="cr-btn cr-btn-deny" data-action="deny" data-id="' + id + '" title="Deny this single call">Deny</button>' +
          '<span class="cr-permission-divider"></span>' +
          '<button class="cr-btn cr-btn-always-allow" data-action="always-allow" data-id="' + id + '" title="Allow this tool for the rest of the session, and remember the choice">Always Allow</button>' +
          '<button class="cr-btn cr-btn-always-deny" data-action="always-deny" data-id="' + id + '" title="Deny this tool for the rest of the session, and remember the choice">Always Deny</button>' +
        '</div>';
    }

    targetParent.appendChild(d);
    var actions = d.querySelector('[id="actions-' + id + '"]');
    if (actions) {
      actions.dataset.tool = tool;
      actions.dataset.toolDisplayName = displayName;
    }
    function onPermActionClick(ev) { handlePermissionActionClick(id, tool, chatCtx.msgList, chatCtx.controlsPanel, ownerSessionId || chatCtx.convId, ev); }
    actions.addEventListener('click', onPermActionClick);
    scrollBottom(chatCtx.msgList);
    updateAgentControlsPanel(chatCtx);
    return d;
  }

  function handlePermissionActionClick(id, tool, msgList, controlsPanel, sessionId, e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var act = btn.dataset.action;
    var chatCtx = { msgList: msgList, controlsPanel: controlsPanel, convId: sessionId };
    resolvePermissionItem(chatCtx, id, act);
  }

  function appendToolResultBlock(body, tool, ev) {
    if (!body) return null;
    var d = mk('div', 'cr-tool-result-block');
    var success = ev.success !== false;
    var statusColor = success ? '#4ec9b0' : '#f85149';
    d.innerHTML =
      '<div class="cr-tool-result-head" style="color: ' + statusColor + '; border-bottom: 1px solid #2a2a2a; border-left: 3px solid ' + statusColor + ';">' +
        I.bot +
        '<span class="cr-tool-name" style="margin-left: 6px;">' + esc(tool || 'tool') + ' Result</span>' +
        '<span class="cr-tool-id" style="color: ' + statusColor + '; margin-left: auto;">' + (success ? 'Success' : 'Failed') + '</span>' +
      '</div>';
    var bodyPre = mk('pre', 'cr-tool-result-body');
    var text = '';
    if (ev.content != null) text = ev.content;
    else if (ev.output != null) text = ev.output;
    else if (ev.message != null) text = ev.message;
    else if (ev.entries) {
      var entryList = [];
      for (var ei = 0; ei < ev.entries.length; ei++) {
        var entry = ev.entries[ei];
        entryList.push('- [' + entry.type.toUpperCase() + '] ' + entry.name);
      }
      text = entryList.join('\n');
    }
    else if (ev.matches) {
      var matchList = [];
      for (var mi = 0; mi < ev.matches.length; mi++) {
        matchList.push('- ' + ev.matches[mi]);
      }
      text = matchList.join('\n');
    }
    else if (ev.info) {
      try {
        text = JSON.stringify(ev.info, null, 2);
      } catch (_) {
        // Intentionally fall back to string representation on parsing error
        text = String(ev.info);
      }
    }
    else if (ev.datetime) text = 'Datetime: ' + ev.datetime;
    else {
      try {
        text = JSON.stringify(ev, null, 2);
      } catch (_) {
        // Intentionally fall back to string representation on parsing error
        text = String(ev);
      }
    }
    bodyPre.textContent = text;
    d.appendChild(bodyPre);
    body.appendChild(d);
    return d;
  }

  function appendActionList(body) {
    if (!body) return null;
    var d = mk('div', 'cr-action-list');
    body.appendChild(d);
    return d;
  }

  function appendActionItem(list, action, args, status, iteration, result, timeMs, success) {
    if (!list) return null;
    var item = mk('div', 'cr-action-item cr-action-item--' + status);
    var statusIcon = status === 'completed' ? (success === false ? I.err : I.check) : I.spin;
    var iterText = iteration != null ? '<span class="cr-action-iter"># ' + iteration + '</span>' : '';
    item.innerHTML =
      '<span class="cr-action-status-icon">' + statusIcon + '</span>' +
      iterText +
      '<span class="cr-action-label">' + fmtActionLabel(action, args) + '</span>' +
      (timeMs != null ? '<span class="cr-action-time">' + timeMs + 'ms</span>' : '') +
      (status === 'completed' && result != null ? '<span class="cr-action-result">' + esc(truncate(flatStr(result), 120)) + '</span>' : '');
    list.appendChild(item);
    return item;
  }

  function completeActionItem(item, result, timeMs, success) {
    if (!item) return;
    item.classList.remove('cr-action-item--started');
    item.classList.add('cr-action-item--completed');
    if (success === false) item.classList.add('cr-action-item--error');
    var ico = item.querySelector('.cr-action-status-icon');
    if (ico) ico.innerHTML = success === false ? I.err : I.check;
    if (timeMs != null) {
      var t = item.querySelector('.cr-action-time') || mk('span', 'cr-action-time');
      t.textContent = timeMs + 'ms';
      if (!t.parentNode) item.appendChild(t);
    }
    if (result != null) {
      var r = item.querySelector('.cr-action-result') || mk('span', 'cr-action-result');
      r.textContent = truncate(flatStr(result), 120);
      if (!r.parentNode) item.appendChild(r);
    }
  }

  function handleSourceChipClick(src, e) {
    e.preventDefault();
    if (window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: 'openFile', path: src });
    }
  }

  function appendSources(body, sources) {
    if (!body || !sources || !sources.length) return;
    var d = mk('div', 'cr-sources');
    var lbl = mk('span', 'cr-sources-lbl');
    lbl.textContent = 'Sources: ';
    d.appendChild(lbl);
    for (var i = 0; i < sources.length; i++) {
      var src = sources[i];
      var a = mk('a', 'cr-source-chip');
      a.innerHTML = I.src + ' <span>' + esc(src) + '</span>';
      a.title = 'Open ' + src;
      function onSourceClick() { handleSourceChipClick(src); }
      a.addEventListener('click', onSourceClick);
      d.appendChild(a);
    }
    body.appendChild(d);
    return d;
  }

  function appendTerminalCard(S, msgList, body, cardKey, toolName, args, status, result) {
    if (!body) return null;
    status = status || 'pending';

    var card = mk('details', 'cr-tool-card cr-tool-card--' + status + ' cr-terminal-details');
    card.open = false;
    card.dataset.cardKey = cardKey;
    card.dataset.toolName = 'run_terminal';
    card.dataset.status = status;

    var displayName = formatToolName('run_terminal');
    card.dataset.toolDisplayName = displayName;
    var subtitle = getToolSubtitle('run_terminal', args);
    var iconHtml = getToolIcon('run_terminal');

    var statusLabel = (status === 'running' || status === 'pending' || status === 'waiting') ? 'Pending' : (status === 'success' || status === 'completed') ? 'Completed' : 'Failed';
    var statusClass = 'cr-tool-card-status--' + (status === 'completed' ? 'success' : status);
    var iconClass = 'cr-tool-card-icon--' + (status === 'completed' ? 'success' : status);

    var head = mk('summary', 'cr-tool-card-head');
    head.innerHTML =
      '<span class="cr-tool-card-icon ' + iconClass + '">' + (status === 'running' ? I.spin : iconHtml) + '</span>' +
      '<span class="cr-tool-card-title-group">' +
        '<span class="cr-tool-card-title">' + esc(displayName) + '</span>' +
        (subtitle ? '<span class="cr-tool-card-subtitle">' + esc(subtitle) + '</span>' : '') +
      '</span>' +
      '<span class="cr-tool-card-status ' + statusClass + '">' + esc(statusLabel) + '</span>' +
      '<span class="cr-tool-card-chevron">' + I.chevron + '</span>';
    card.appendChild(head);

    var container = mk('div', 'cr-terminal-container cr-terminal-container--' + status);
    
    var command = (args && args.command) || '';
    var headBar = mk('div', 'cr-terminal-header');
    headBar.innerHTML =
      '<span class="cr-terminal-status-dot"></span>' +
      '<span class="cr-terminal-header-title">' + esc(command) + '</span>' +
      '<span class="cr-terminal-header-icon">' + I.terminal + '</span>';
    container.appendChild(headBar);

    var cardBody = mk('div', 'cr-terminal-body');
    container.appendChild(cardBody);
    card.appendChild(container);
    body.appendChild(card);

    if (result) {
      var exitCode = result.exit_code != null ? result.exit_code : result.exitCode;
      var duration = result.duration_ms || result.durationMs;
      updateTerminalCardResult(card, status, result);
      setTerminalCardStatus(card, status, exitCode, duration, result);
    }

    var termId = card.dataset.terminalId || 'card_' + Date.now();
    S._terminalCards[termId] = card;
    S.toolCards[cardKey] = card;
    if (S._terminalCardOrder.indexOf(termId) === -1) {
      S._terminalCardOrder.push(termId);
    }

    scrollBottom(msgList);
    return card;
  }

  function appendTerminalCardOutput(msgList, card, cleanChunk) {
    if (!card) return;
    var bodyEl = card.querySelector('.cr-terminal-body');
    if (!bodyEl) return;

    var lines = cleanChunk.split('\n');
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (li === lines.length - 1 && line === '') break;
      var lineEl = mk('div', 'cr-terminal-line cr-terminal-line--out');
      if (line.toLowerCase().includes('error') || line.toLowerCase().includes('fail')) {
        lineEl.className = 'cr-terminal-line cr-terminal-line--err';
      } else if (line.includes('?') || line.includes('(y/N)')) {
        lineEl.className = 'cr-terminal-line cr-terminal-line--prompt';
      }
      lineEl.textContent = line;
      bodyEl.appendChild(lineEl);
    }

    scrollBottom(msgList);
  }

  function setTerminalCardStatus(card, execStatus, exitCode, duration, extra) {
    if (!card) return;
    var normStatus = (execStatus === 'completed' || execStatus === 'success') ? 'success' : (execStatus === 'failed' || execStatus === 'error') ? 'error' : (execStatus || 'success');
    card.dataset.status = normStatus;
    
    card.className = 'cr-tool-card cr-tool-card--' + normStatus + ' cr-terminal-details';

    var container = card.querySelector('.cr-terminal-container');
    if (container) {
      container.className = 'cr-terminal-container cr-terminal-container--' + normStatus;
    }

    var statusLabel = (normStatus === 'running' || normStatus === 'pending' || normStatus === 'waiting') ? 'PENDING' : (normStatus === 'success') ? 'COMPLETED' : 'FAILED';
    var statusClass = 'cr-tool-card-status--' + normStatus;
    var iconClass = 'cr-tool-card-icon--' + normStatus;

    var statusEl = card.querySelector('.cr-tool-card-status');
    if (statusEl) {
      statusEl.className = 'cr-tool-card-status ' + statusClass;
      statusEl.textContent = statusLabel;
    }

    var iconEl = card.querySelector('.cr-tool-card-icon');
    if (iconEl) {
      iconEl.className = 'cr-tool-card-icon ' + iconClass;
      iconEl.innerHTML = (normStatus === 'running' || normStatus === 'pending' || normStatus === 'waiting') ? I.spin : getToolIcon('run_terminal');
    }

    if (normStatus !== 'running' && normStatus !== 'waiting' && normStatus !== 'pending') {
      card.open = false;
    }
  }

  function determineExecStatus(exitCode, duration, ev) {
    if (ev && ev.error) return 'error';
    if (ev && ev.timedOut) return 'timeout';
    if (ev && ev.cancelled) return 'cancelled';
    if (ev && ev.waitingForInput) return 'waiting';
    if (exitCode != null) {
      if (exitCode === 0) return 'success';
      return 'error';
    }
    if (ev && ev.message && (
      ev.message.toLowerCase().includes('error') ||
      ev.message.toLowerCase().includes('fail') ||
      ev.message.toLowerCase().includes('timed out')
    )) return 'error';
    return 'success';
  }

  function updateTerminalCardResult(card, status, result) {
    if (!card) return;
    var exitCode = result ? (result.exit_code != null ? result.exit_code : result.exitCode) : null;
    var duration = result ? (result.duration_ms || result.durationMs) : 0;
    setTerminalCardStatus(card, status, exitCode, duration, result);

    var bodyEl = card.querySelector('.cr-terminal-body');
    if (!bodyEl) return;

    if (bodyEl.children.length > 0) {
      return;
    }

    var stdout = result.stdout || result.output || '';
    var stderr = result.stderr || '';

    if (stdout) {
      var outLines = stdout.split('\n');
      for (var oi = 0; oi < outLines.length; oi++) {
        if (oi === outLines.length - 1 && outLines[oi] === '') break;
        var lineEl = mk('div', 'cr-terminal-line cr-terminal-line--out');
        var lineText = outLines[oi];
        if (lineText.toLowerCase().includes('error') || lineText.toLowerCase().includes('fail')) {
          lineEl.className = 'cr-terminal-line cr-terminal-line--err';
        }
        lineEl.textContent = lineText;
        bodyEl.appendChild(lineEl);
      }
    }

    if (stderr) {
      var errLines = stderr.split('\n');
      for (var ei = 0; ei < errLines.length; ei++) {
        if (ei === errLines.length - 1 && errLines[ei] === '') break;
        var lineEl = mk('div', 'cr-terminal-line cr-terminal-line--err');
        lineEl.textContent = errLines[ei];
        bodyEl.appendChild(lineEl);
      }
    }
  }

  function appendActionsBar(chatCtx, body, checkpoints) {
    // Checkpoint undo bars are attached inline directly below each respective tool card or diff card
    // upon tool execution and checkpoint creation. Maintained as a safe no-op.
  }

  function appendCheckpointUndoForCard(card, cpId, filePath, label, sessionId) {
    if (!card) return;
    var cardParent = card.parentNode;
    if (!cardParent) return;

    var existingBar = card.nextElementSibling;
    if (existingBar && existingBar.classList && existingBar.classList.contains('cr-tool-undo-bar')) {
      if (cpId) existingBar.dataset.cpId = cpId;
      if (filePath) existingBar.dataset.filePath = filePath;
      var existingBtn = existingBar.querySelector('.cr-action-undo');
      if (existingBtn) {
        if (cpId) existingBtn.dataset.cpId = cpId;
        if (filePath) existingBtn.dataset.filePath = filePath;
        if (sessionId) existingBtn.dataset.sessionId = sessionId;
        if (label) {
          var labelEl = existingBtn.querySelector('.cr-action-label');
          if (labelEl) labelEl.textContent = label;
        }
      }
      return;
    }

    var bar = mk('div', 'cr-tool-undo-bar');
    bar.dataset.cpId = cpId || '';
    bar.dataset.filePath = filePath || '';
    bar.style.marginTop = '4px';
    bar.style.marginBottom = '6px';
    bar.style.display = 'flex';
    bar.style.alignItems = 'center';

    var undoBtn = mk('button', 'cr-action-btn cr-action-undo');
    undoBtn.dataset.cpId = cpId || '';
    undoBtn.dataset.filePath = filePath || '';
    if (sessionId) undoBtn.dataset.sessionId = sessionId;
    undoBtn.innerHTML = '↩ Undo <span class="cr-action-label">' + esc(label || filePath) + '</span>';
    undoBtn.addEventListener('click', handleUndoBtnClick);

    bar.appendChild(undoBtn);
    cardParent.insertBefore(bar, card.nextSibling);
  }

  function handleUndoBtnClick(e) {
    var btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '↩ Undoing...';
    if (window.VSCODE_API) {
      window.VSCODE_API.postMessage({
        type: 'undoCheckpoint',
        filePath: btn.dataset.filePath,
        checkpointId: btn.dataset.cpId,
        sessionId: btn.dataset.sessionId || (window._activeChatCtx && window._activeChatCtx.convId) || null
      });
    }
  }

  function markSubagentCheckpointUndone(filePath, checkpointId) {
    if (!filePath && !checkpointId) return;
    try {
      var normFile = filePath ? String(filePath).replace(/\\/g, '/').toLowerCase() : '';
      var sessionKeys = [];
      for (var k = 0; k < localStorage.length; k++) {
        var key = localStorage.key(k);
        if (key && (key.indexOf('coderun_subagents_') === 0 || key.indexOf('coderun_subagent_traces_') === 0)) {
          sessionKeys.push(key);
        }
      }
      for (var s = 0; s < sessionKeys.length; s++) {
        var storageKey = sessionKeys[s];
        var raw = localStorage.getItem(storageKey);
        if (!raw) continue;
        var list = JSON.parse(raw);
        if (!Array.isArray(list)) continue;
        var changed = false;
        for (var i = 0; i < list.length; i++) {
          var item = list[i];
          if (item && item.diffs && Array.isArray(item.diffs)) {
            for (var d = 0; d < item.diffs.length; d++) {
              var df = item.diffs[d];
              if (!df) continue;
              var dfFile = String(df.file_path || '').replace(/\\/g, '/').toLowerCase();
              if ((checkpointId && df.checkpointId === checkpointId) || (normFile && dfFile && (dfFile === normFile || normFile.endsWith(dfFile) || dfFile.endsWith(normFile)))) {
                df.undone = true;
                df.restored = true;
                df.status = 'restored';
                changed = true;
              }
            }
          }
          if (item && item.trace && item.trace.diffs && Array.isArray(item.trace.diffs)) {
            for (var td = 0; td < item.trace.diffs.length; td++) {
              var tdf = item.trace.diffs[td];
              if (!tdf) continue;
              var tdfFile = String(tdf.file_path || '').replace(/\\/g, '/').toLowerCase();
              if ((checkpointId && tdf.checkpointId === checkpointId) || (normFile && tdfFile && (tdfFile === normFile || normFile.endsWith(tdfFile) || tdfFile.endsWith(normFile)))) {
                tdf.undone = true;
                tdf.restored = true;
                tdf.status = 'restored';
                changed = true;
              }
            }
          }
          if (item && item.trace && item.trace.toolCalls && Array.isArray(item.trace.toolCalls)) {
            for (var tc = 0; tc < item.trace.toolCalls.length; tc++) {
              var tCall = item.trace.toolCalls[tc];
              if (!tCall) continue;
              var tcFile = String(tCall.filePath || '').replace(/\\/g, '/').toLowerCase();
              if ((checkpointId && tCall.checkpointId === checkpointId) || (normFile && tcFile && (tcFile === normFile || normFile.endsWith(tcFile) || tcFile.endsWith(normFile)))) {
                tCall.undone = true;
                tCall.restored = true;
                changed = true;
              }
            }
          }
          var traceSteps = (item && item.trace && item.trace.steps) || (item && item.steps) || [];
          if (Array.isArray(traceSteps)) {
            for (var st = 0; st < traceSteps.length; st++) {
              var stObj = traceSteps[st];
              var stTools = (stObj && (stObj.toolCalls || stObj.tools)) || [];
              if (Array.isArray(stTools)) {
                for (var stc = 0; stc < stTools.length; stc++) {
                  var toolCallItem = stTools[stc];
                  if (!toolCallItem) continue;
                  var tciFile = String(toolCallItem.filePath || (toolCallItem.input && (toolCallItem.input.file_path || toolCallItem.input.folder_path)) || '').replace(/\\/g, '/').toLowerCase();
                  if ((checkpointId && toolCallItem.checkpointId === checkpointId) || (normFile && tciFile && (tciFile === normFile || normFile.endsWith(tciFile) || tciFile.endsWith(normFile)))) {
                    toolCallItem.undone = true;
                    toolCallItem.restored = true;
                    changed = true;
                  }
                }
              }
            }
          }
        }
        if (changed) {
          localStorage.setItem(storageKey, JSON.stringify(list));
        }
      }
    } catch (_) {}
  }
  window.markSubagentCheckpointUndone = markSubagentCheckpointUndone;

  function updateActionsBarStatus(filePath, statusText, checkpointId) {
    var normTarget = String(filePath || '').replace(/\\/g, '/').toLowerCase();
    var btns = document.querySelectorAll('.cr-action-undo');
    for (var bj = 0; bj < btns.length; bj++) {
      var btn = btns[bj];
      var btnFile = String(btn.dataset.filePath || btn.getAttribute('data-file-path') || '').replace(/\\/g, '/').toLowerCase();
      var btnCp = btn.dataset.cpId || btn.getAttribute('data-cp-id');
      var matches = false;
      if (checkpointId && btnCp && btnCp === checkpointId) {
        matches = true;
      } else if (btnFile && normTarget && (btnFile === normTarget || normTarget.endsWith(btnFile) || btnFile.endsWith(normTarget))) {
        matches = true;
      }
      if (matches) {
        btn.disabled = true;
        btn.innerHTML = '✓ ' + statusText;
        btn.classList.add('cr-action-done');
        var parentCard = btn.closest('.cr-diff-card');
        if (parentCard) {
          var statusSpan = parentCard.querySelector('.cr-diff-status');
          if (statusSpan) {
            statusSpan.textContent = '✓ ' + statusText.toUpperCase();
            statusSpan.className = 'cr-diff-status cr-permission-status allowed cr-diff-status--restored';
          }
        }
      }
    }
    if (statusText === 'Restored') {
      markSubagentCheckpointUndone(filePath, checkpointId);
      try {
        var subArea = document.getElementById('subagents-area-container');
        if (subArea && subArea.style.display !== 'none' && typeof window.renderSubagentsView === 'function') {
          window.renderSubagentsView(subArea);
        }
        var subTracesArea = document.getElementById('subagent-traces-area-container');
        if (subTracesArea && subTracesArea.style.display !== 'none' && typeof window.renderSubagentTracesView === 'function') {
          window.renderSubagentTracesView(subTracesArea);
        }
      } catch (_) {}
    }
  }
  window.updateActionsBarStatus = updateActionsBarStatus;

  function saveSubagentDiff(sessionId, diffEv) {
    if (!sessionId || !diffEv) return;
    try {
      var raw = localStorage.getItem('coderun_subagents_' + sessionId);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) list = [];
      var sId = diffEv.subagentId || diffEv.agentId || diffEv.sessionId;
      var targetSub = null;
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        if (item.agentId === sId || item.id === sId || item.sessionId === sId || (sId && item.agentId && item.agentId.indexOf(sId) !== -1)) {
          targetSub = item;
          break;
        }
      }
      if (!targetSub && list.length > 0) {
        targetSub = list[list.length - 1];
      }
      if (targetSub) {
        if (!targetSub.diffs) targetSub.diffs = [];
        var existingDiff = null;
        for (var d = 0; d < targetSub.diffs.length; d++) {
          if (targetSub.diffs[d].id === diffEv.id) {
            existingDiff = targetSub.diffs[d];
            break;
          }
        }
        var diffObj = {
          id: diffEv.id,
          file_path: diffEv.file_path,
          is_new_file: !!diffEv.is_new_file,
          original_content: diffEv.original_content || '',
          new_content: diffEv.new_content || '',
          tool: diffEv.tool || 'write_file',
          status: diffEv.status || 'pending',
          sessionId: diffEv.sessionId,
          parentSessionId: diffEv.parentSessionId
        };
        if (existingDiff) {
          Object.assign(existingDiff, diffObj);
        } else {
          targetSub.diffs.push(diffObj);
        }
        localStorage.setItem('coderun_subagents_' + sessionId, JSON.stringify(list));
      }
    } catch (_) {
      // Intentionally ignore storage write errors
    }
  }
  window.saveSubagentDiff = saveSubagentDiff;

  function updateSubagentDiffStatus(sessionId, diffId, status) {
    if (!diffId) return;
    try {
      var normStatus = (status === 'accepted' || status === 'applied') ? 'approved' : status;
      var sessionKeys = [];
      if (sessionId) {
        sessionKeys.push('coderun_subagents_' + sessionId);
        sessionKeys.push('coderun_subagent_traces_' + sessionId);
      }
      for (var k = 0; k < localStorage.length; k++) {
        var key = localStorage.key(k);
        if (key && (key.indexOf('coderun_subagents_') === 0 || key.indexOf('coderun_subagent_traces_') === 0)) {
          if (sessionKeys.indexOf(key) === -1) {
            sessionKeys.push(key);
          }
        }
      }

      for (var s = 0; s < sessionKeys.length; s++) {
        var storageKey = sessionKeys[s];
        var raw = localStorage.getItem(storageKey);
        if (!raw) continue;
        var list = JSON.parse(raw);
        if (!Array.isArray(list)) continue;
        var changed = false;

        for (var i = 0; i < list.length; i++) {
          var item = list[i];
          if (item && item.diffs && Array.isArray(item.diffs)) {
            for (var d = 0; d < item.diffs.length; d++) {
              if (item.diffs[d] && item.diffs[d].id === diffId) {
                item.diffs[d].status = normStatus;
                changed = true;
              }
            }
          }
          if (item && item.trace && item.trace.diffs && Array.isArray(item.trace.diffs)) {
            for (var td = 0; td < item.trace.diffs.length; td++) {
              if (item.trace.diffs[td] && item.trace.diffs[td].id === diffId) {
                item.trace.diffs[td].status = normStatus;
                changed = true;
              }
            }
          }
        }

        if (changed) {
          localStorage.setItem(storageKey, JSON.stringify(list));
        }
      }
    } catch (_) {
      // Intentionally ignore storage write errors
    }
  }
  window.updateSubagentDiffStatus = updateSubagentDiffStatus;

  function setSubagentDiffCheckpoint(sessionId, filePath, checkpointId) {
    if (!filePath || !checkpointId) return;
    try {
      var normFile = String(filePath).replace(/\\/g, '/').toLowerCase();
      var sessionKeys = [];
      if (sessionId) {
        sessionKeys.push('coderun_subagents_' + sessionId);
      }
      for (var k = 0; k < localStorage.length; k++) {
        var key = localStorage.key(k);
        if (key && key.indexOf('coderun_subagents_') === 0 && sessionKeys.indexOf(key) === -1) {
          sessionKeys.push(key);
        }
      }
      for (var s = 0; s < sessionKeys.length; s++) {
        var raw = localStorage.getItem(sessionKeys[s]);
        if (!raw) continue;
        var list = JSON.parse(raw);
        if (!Array.isArray(list)) continue;
        var changed = false;
        for (var i = 0; i < list.length; i++) {
          var item = list[i];
          if (item && item.diffs && Array.isArray(item.diffs)) {
            for (var d = 0; d < item.diffs.length; d++) {
              var df = item.diffs[d];
              var dfFile = String(df.file_path || '').replace(/\\/g, '/').toLowerCase();
              if (dfFile && (dfFile === normFile || normFile.endsWith(dfFile) || dfFile.endsWith(normFile))) {
                df.checkpointId = checkpointId;
                changed = true;
              }
            }
          }
        }
        if (changed) {
          localStorage.setItem(sessionKeys[s], JSON.stringify(list));
        }
      }
    } catch (_) {}
  }
  window.setSubagentDiffCheckpoint = setSubagentDiffCheckpoint;

  function buildDiffLines(originalText, modifiedText) {
    var origLines = originalText.split('\n');
    var modLines = modifiedText.split('\n');
    var maxLength = Math.max(origLines.length, modLines.length);
    var diffLines = [];
    for (var lineIndex = 0; lineIndex < maxLength; lineIndex++) {
      var oldLineText = origLines[lineIndex] || '';
      var newLineText = modLines[lineIndex] || '';
      if (oldLineText === newLineText) {
        diffLines.push({ type: 'context', oldLine: lineIndex + 1, newLine: lineIndex + 1, text: oldLineText });
      } else if (!oldLineText && newLineText) {
        diffLines.push({ type: 'add', oldLine: null, newLine: lineIndex + 1, text: newLineText });
      } else if (oldLineText && !newLineText) {
        diffLines.push({ type: 'del', oldLine: lineIndex + 1, newLine: null, text: oldLineText });
      } else {
        diffLines.push({ type: 'del', oldLine: lineIndex + 1, newLine: null, text: oldLineText });
        diffLines.push({ type: 'add', oldLine: null, newLine: lineIndex + 1, text: newLineText });
      }
    }
    return diffLines;
  }

  function appendDiffCard(chatCtx, body, ev) {
    if (!body && (!chatCtx || !chatCtx.msgList)) return;
    var diffId = ev.id || 'diff_' + Date.now();
    var filePath = ev.file_path || 'unknown';
    var isNew = ev.is_new_file || false;
    var originalText = ev.original_content || '';
    var modifiedText = ev.new_content || '';
    var toolName = ev.tool || 'edit';

    var diffLines = buildDiffLines(originalText, modifiedText);

    var additions = 0;
    var deletions = 0;
    for (var dli = 0; dli < diffLines.length; dli++) {
      if (diffLines[dli].type === 'add') additions++;
      else if (diffLines[dli].type === 'del') deletions++;
    }

    var card = mk('div', 'cr-diff-card');
    card.dataset.diffId = diffId;
    card.dataset.diffStatus = 'pending';
    card.dataset.filePath = filePath;
    card.dataset.sessionId = ev.sessionId || (chatCtx && chatCtx.convId) || '';

    var head = mk('div', 'cr-diff-head');
    var subagentTag = (ev.subagentName || ev.agentName || (ev.agentType === 'subagent' ? 'Subagent' : ''));
    var subagentBadge = subagentTag ? ('<span class="cr-tool-badge" style="margin-left:6px;font-size:10px;padding:2px 6px;background:rgba(255,255,255,0.08);border-radius:3px;color:var(--vscode-descriptionForeground,#888);">' + esc(subagentTag) + '</span>') : '';
    head.innerHTML =
      I.file +
      '<span class="cr-diff-title">' + esc(filePath) + subagentBadge + '</span>' +
      '<span class="cr-diff-stats">' +
        '<span class="cr-diff-stat-add">+' + additions + '</span>' +
        '<span class="cr-diff-stat-del">-' + deletions + '</span>' +
      '</span>';
    card.appendChild(head);

    var details = mk('details', 'cr-diff-details');
    details.open = false;

    var summary = mk('summary', 'cr-diff-summary');
    summary.textContent = isNew ? 'New File' : 'View Changes';
    details.appendChild(summary);

    var diffBody = mk('div', 'cr-diff-body');
    var maxLineNum = Math.max(originalText.split('\n').length, modifiedText.split('\n').length);
    var lineDigitWidth = String(maxLineNum).length;

    for (var li = 0; li < diffLines.length; li++) {
      var dl = diffLines[li];
      var lineEl = mk('div', 'cr-diff-line');
      var oldNum = dl.oldLine ? padNum(dl.oldLine, lineDigitWidth) : '';
      var newNum = dl.newLine ? padNum(dl.newLine, lineDigitWidth) : '';

      if (dl.type === 'context') {
        lineEl.classList.add('cr-diff-line-context');
        lineEl.innerHTML =
          '<span class="cr-diff-ln">' + padNum(dl.oldLine, lineDigitWidth) + '</span>' +
          '<span class="cr-diff-ln">' + padNum(dl.newLine, lineDigitWidth) + '</span>' +
          '<span class="cr-diff-code">' + esc(dl.text) + '</span>';
      } else if (dl.type === 'del') {
        lineEl.classList.add('cr-diff-line-del');
        lineEl.innerHTML =
          '<span class="cr-diff-ln">' + oldNum + '</span>' +
          '<span class="cr-diff-ln"></span>' +
          '<span class="cr-diff-code">' + esc(dl.text) + '</span>';
      } else if (dl.type === 'add') {
        lineEl.classList.add('cr-diff-line-add');
        lineEl.innerHTML =
          '<span class="cr-diff-ln"></span>' +
          '<span class="cr-diff-ln">' + newNum + '</span>' +
          '<span class="cr-diff-code">' + esc(dl.text) + '</span>';
      }
      diffBody.appendChild(lineEl);
    }

    details.appendChild(diffBody);
    card.appendChild(details);

    var actions = mk('div', 'cr-diff-actions');
    actions.innerHTML =
      '<button class="cr-btn cr-btn-allow cr-diff-accept" data-diff-id="' + esc(diffId) + '">Accept</button>' +
      '<button class="cr-btn cr-btn-deny cr-diff-reject" data-diff-id="' + esc(diffId) + '">Reject</button>' +
      '<button class="cr-diff-full-btn" data-diff-id="' + esc(diffId) + '" title="Open in VS Code diff editor">Open Full Diff</button>' +
      '<span class="cr-diff-status" style="display:none"></span>';
    card.appendChild(actions);

    function onDiffAccept() { handleDiffAcceptClick(diffId, card, chatCtx.controlsPanel, chatCtx.msgList, ev.sessionId || chatCtx.convId); }
    actions.querySelector('.cr-diff-accept').onclick = onDiffAccept;
    function onDiffReject() { handleDiffRejectClick(diffId, card, chatCtx.controlsPanel, chatCtx.msgList, ev.sessionId || chatCtx.convId); }
    actions.querySelector('.cr-diff-reject').onclick = onDiffReject;
    function onDiffFull() { handleDiffFullClick(diffId, ev.sessionId || chatCtx.convId); }
    actions.querySelector('.cr-diff-full-btn').onclick = onDiffFull;

    var targetParent = body;
    var pendingCard = null;
    if (ev.toolCallId && chatCtx.S && chatCtx.S.toolCards && chatCtx.S.toolCards[ev.toolCallId]) {
      pendingCard = chatCtx.S.toolCards[ev.toolCallId];
    }
    if (!pendingCard && chatCtx.S) {
      pendingCard = findPendingCardByToolName(chatCtx.S, toolName) || getLastPendingCard(chatCtx.S);
    }
    if (pendingCard) {
      var cardBody = pendingCard.querySelector('.cr-tool-card-body');
      if (cardBody) {
        targetParent = cardBody;
        var argsBlock = cardBody.querySelector('.cr-tool-card-args-block');
        if (argsBlock) argsBlock.style.display = 'none';
      }
    }
    if (!targetParent && chatCtx.msgList) {
      var botWrappers = chatCtx.msgList.querySelectorAll('.cr-bot-body');
      if (botWrappers.length > 0) {
        targetParent = botWrappers[botWrappers.length - 1];
      } else {
        targetParent = chatCtx.msgList;
      }
    }
    if (targetParent) {
      targetParent.appendChild(card);
    }
    scrollBottom(chatCtx.msgList);
    updateAgentControlsPanel(chatCtx);
  }

  function appendSubagentDiffPermissionCard(chatCtx, body, ev) {
    if (!chatCtx || !chatCtx.msgList) return null;
    var effectiveBody = body || (chatCtx.S && chatCtx.S.botBody);
    if (!effectiveBody) {
      var botWrappers = chatCtx.msgList.querySelectorAll('.cr-bot-body');
      if (botWrappers.length > 0) {
        effectiveBody = botWrappers[botWrappers.length - 1];
      } else {
        effectiveBody = chatCtx.msgList;
      }
    }
    var diffId = ev.id || ('diff_' + Date.now());
    var filePath = ev.file_path || 'unknown';
    var toolName = ev.tool || 'write_file';
    var subName = ev.subagentName || ev.agentName || 'Subagent';
    var subRole = (ev.subagentRole || ev.role || 'coder').toUpperCase();
    var displayName = '[' + subRole + ': ' + subName + '] ' + formatToolName(toolName);

    var additions = 0;
    var deletions = 0;
    if (ev.original_content != null || ev.new_content != null) {
      var diffLines = buildDiffLines(ev.original_content || '', ev.new_content || '');
      for (var dli = 0; dli < diffLines.length; dli++) {
        if (diffLines[dli].type === 'add') additions++;
        else if (diffLines[dli].type === 'del') deletions++;
      }
    }

    var card = mk('div', 'cr-permission-card cr-diff-card cr-diff-permission-card');
    card.dataset.diffId = diffId;
    card.dataset.diffStatus = 'pending';
    card.dataset.tool = toolName;
    card.dataset.toolDisplayName = displayName;
    card.dataset.filePath = filePath;
    card.dataset.sessionId = ev.sessionId || (chatCtx && chatCtx.convId) || '';

    var shieldSvg = '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

    var statsText = '';
    if (additions > 0 || deletions > 0) {
      statsText = ' (+' + additions + ' -' + deletions + ')';
    } else if (ev.is_new_file) {
      statsText = ' (New File)';
    }

    card.innerHTML =
      '<div class="cr-permission-head">' +
        shieldSvg +
        '<span class="cr-permission-title">Permission Required</span>' +
        '<span class="cr-perm-tool-badge">' + esc(displayName) + '</span>' +
      '</div>' +
      '<div class="cr-permission-body">' +
        '<div class="cr-permission-target">File Change: <strong>' + esc(filePath) + '</strong>' + esc(statsText) + '</div>' +
      '</div>' +
      '<div class="cr-diff-actions cr-permission-actions" id="actions-' + esc(diffId) + '">' +
        '<button type="button" class="cr-btn cr-btn-allow cr-diff-accept" data-diff-id="' + esc(diffId) + '" title="Accept this file change">Accept</button>' +
        '<button type="button" class="cr-btn cr-btn-deny cr-diff-reject" data-diff-id="' + esc(diffId) + '" title="Reject this file change">Reject</button>' +
        '<span class="cr-permission-divider"></span>' +
        '<button type="button" class="cr-diff-full-btn" data-diff-id="' + esc(diffId) + '" title="Open in VS Code diff editor">Open Full Diff</button>' +
        '<span class="cr-diff-status" style="display:none"></span>' +
      '</div>';

    function onDiffAccept() {
      handleDiffAcceptClick(diffId, card, chatCtx.controlsPanel, chatCtx.msgList, ev.sessionId || chatCtx.convId);
      try {
        var subCard = document.querySelector('#subagents-area-container .cr-diff-card[data-diff-id="' + diffId + '"]');
        if (subCard) {
          setDiffCardStatus(subCard, 'approved');
        }
      } catch (_) {}
    }
    function onDiffReject() {
      handleDiffRejectClick(diffId, card, chatCtx.controlsPanel, chatCtx.msgList, ev.sessionId || chatCtx.convId);
      try {
        var subCard = document.querySelector('#subagents-area-container .cr-diff-card[data-diff-id="' + diffId + '"]');
        if (subCard) {
          setDiffCardStatus(subCard, 'rejected');
        }
      } catch (_) {}
    }
    function onDiffFull() {
      handleDiffFullClick(diffId, ev.sessionId || chatCtx.convId);
    }

    var acceptBtn = card.querySelector('.cr-diff-accept');
    if (acceptBtn) acceptBtn.onclick = onDiffAccept;
    var rejectBtn = card.querySelector('.cr-diff-reject');
    if (rejectBtn) rejectBtn.onclick = onDiffReject;
    var fullBtn = card.querySelector('.cr-diff-full-btn');
    if (fullBtn) fullBtn.onclick = onDiffFull;

    effectiveBody.appendChild(card);
    scrollBottom(chatCtx.msgList);
    updateAgentControlsPanel(chatCtx);
    return card;
  }

  function handleDiffAcceptClick(diffId, card, controlsPanel, msgList, sessionId) {
    if (!window.VSCODE_API) return;
    window.VSCODE_API.postMessage({ type: 'acceptDiff', diffId: diffId, sessionId: sessionId });
    setDiffCardStatus(card, 'approved');
    var chatCtx = { controlsPanel: controlsPanel, msgList: msgList };
    updateAgentControlsPanel(chatCtx);
    if (typeof updateSubagentDiffStatus === 'function') {
      updateSubagentDiffStatus(sessionId, diffId, 'approved');
    }
    try {
      var allCards = document.querySelectorAll('.cr-diff-card[data-diff-id="' + diffId + '"]');
      for (var ci = 0; ci < allCards.length; ci++) {
        setDiffCardStatus(allCards[ci], 'approved');
      }
    } catch (_) {}
  }

  function handleDiffRejectClick(diffId, card, controlsPanel, msgList, sessionId) {
    if (!window.VSCODE_API) return;
    window.VSCODE_API.postMessage({ type: 'rejectDiff', diffId: diffId, sessionId: sessionId });
    setDiffCardStatus(card, 'rejected');
    var chatCtx = { controlsPanel: controlsPanel, msgList: msgList };
    updateAgentControlsPanel(chatCtx);
    if (typeof updateSubagentDiffStatus === 'function') {
      updateSubagentDiffStatus(sessionId, diffId, 'rejected');
    }
    try {
      var allCards = document.querySelectorAll('.cr-diff-card[data-diff-id="' + diffId + '"]');
      for (var ci = 0; ci < allCards.length; ci++) {
        setDiffCardStatus(allCards[ci], 'rejected');
      }
    } catch (_) {}
  }

  function handleDiffFullClick(diffId, sessionId) {
    if (!window.VSCODE_API) return;
    window.VSCODE_API.postMessage({ type: 'openDiffEditor', diffId: diffId, sessionId: sessionId });
  }

  function appendContinueButton(chatCtx, parent) {
    if (!parent) return;
    var btnContainer = mk('div', 'cr-continue-container');
    btnContainer.style.padding = '8px 12px';
    btnContainer.style.display = 'flex';
    btnContainer.style.gap = '8px';
    btnContainer.style.justifyContent = 'flex-start';

    var btnContinue = mk('button', 'cr-btn cr-btn-continue-all');
    btnContinue.textContent = 'Continue';
    function onContinueClick() { handleContinueClick(btnContainer, chatCtx); }
    btnContinue.addEventListener('click', onContinueClick);

    var btnQuit = mk('button', 'cr-btn cr-btn-quit-all');
    btnQuit.textContent = 'Quit';
    function onQuitClick() { handleQuitClick(btnContainer, chatCtx); }
    btnQuit.addEventListener('click', onQuitClick);

    btnContainer.appendChild(btnContinue);
    btnContainer.appendChild(btnQuit);
    parent.appendChild(btnContainer);
    scrollBottom(chatCtx.msgList);
  }

  function handleContinueClick(btnContainer, chatCtx) {
    btnContainer.remove();
    doContinue(chatCtx);
  }

  function handleQuitClick(btnContainer, chatCtx) {
    btnContainer.remove();
    setStreaming(chatCtx, false);
  }

  function setDiffCardStatus(card, status) {
    if (!card) return;
    card.dataset.diffStatus = status;
    var acceptBtn = card.querySelector('.cr-diff-accept');
    var rejectBtn = card.querySelector('.cr-diff-reject');
    var fullBtn = card.querySelector('.cr-diff-full-btn');
    var divider = card.querySelector('.cr-permission-divider');
    var statusEl = card.querySelector('.cr-diff-status');
    if (acceptBtn) acceptBtn.style.display = 'none';
    if (rejectBtn) rejectBtn.style.display = 'none';
    if (fullBtn) fullBtn.style.display = 'none';
    if (divider) divider.style.display = 'none';
    var isOk = (status === 'accepted' || status === 'approved' || status === 'applied');
    if (!statusEl) {
      var actionsContainer = card.querySelector('.cr-diff-actions');
      if (actionsContainer) {
        statusEl = document.createElement('span');
        actionsContainer.appendChild(statusEl);
      }
    }
    if (statusEl) {
      statusEl.style.display = 'inline-block';
      statusEl.textContent = isOk ? (status === 'applied' ? '✓ Applied' : '✓ Approved') : '✗ Rejected';
      statusEl.className = 'cr-diff-status cr-permission-status ' + (isOk ? 'allowed cr-diff-status--approved' : 'denied cr-diff-status--rejected');
    }
  }
  window.setDiffCardStatus = setDiffCardStatus;

  function padNum(n, width) {
    var s = String(n);
    while (s.length < width) s = ' ' + s;
    return s;
  }

  function getLastPendingCard(S) {
    if (!S._toolQueue || !S._toolQueue.length) return null;
    for (var i = S._toolQueue.length - 1; i >= 0; i--) {
      var entry = S._toolQueue[i];
      var card = S.toolCards[entry.key];
      if (card && card.dataset.status !== 'success' && card.dataset.status !== 'error') {
        return card;
      }
    }
    return null;
  }

  function findPendingCardByToolName(S, toolName, toolId) {
    for (var cardKey in S.toolCards) {
      var card = S.toolCards[cardKey];
      if (card && card.dataset && card.dataset.toolName === toolName &&
          card.dataset.status !== 'success' && card.dataset.status !== 'error') {
        var cid = card.dataset.toolCallId;
        var pid = card.dataset.permissionId;
        var isTemp = cid && (cid.indexOf('tool_') === 0 || cid.indexOf('term_') === 0 || cid.indexOf('perm_') === 0);
        if (!cid || isTemp || (toolId && (cid === toolId || pid === toolId))) {
          return card;
        }
      }
    }
    return null;
  }

  function reuseOrCreateTerminalCard(S, toolName, toolArgs, toolId, toolIndex) {
    if (typeof toolArgs === 'string') {
      try {
        toolArgs = JSON.parse(toolArgs);
      } catch (_) {}
    }
    var iter = S.iterationCount || 0;
    var indexKey = 'iter_' + iter + '_' + toolName + '_idx_' + (toolIndex != null ? toolIndex : '?');
    var idKey = toolId || '';

    var card = (idKey && S.toolCards[idKey]) || S.toolCards[indexKey];
    if (card) {
      if (idKey) {
        S._seenToolIds[idKey] = true;
        card.dataset.toolCallId = idKey;
        S.toolCards[idKey] = card;
      }
      return card;
    }

    var existingCard = findPendingCardByToolName(S, toolName, toolId);
    if (existingCard) {
      S._seenToolIds[indexKey] = true;
      if (idKey) {
        S._seenToolIds[idKey] = true;
        existingCard.dataset.toolCallId = idKey;
        S.toolCards[idKey] = existingCard;
      }
      S.toolCards[indexKey] = existingCard;
      return existingCard;
    }

    S._seenToolIds[indexKey] = true;
    if (idKey) S._seenToolIds[idKey] = true;

    closeCurrentContentBlock(S);

    var displayId = toolId || 'term_' + (++S._toolIdCounter);
    var cardKey = toolName + '_' + (++S._toolIdCounter) + '_' + Date.now();
    for (var ti = 0; ti < S._terminalCardOrder.length; ti++) {
      var prevCard = S._terminalCards[S._terminalCardOrder[ti]];
      if (prevCard) prevCard.open = false;
    }

    var cardElement = appendTerminalCard(S, msgList, S.botBody, cardKey, toolName, toolArgs, 'pending', null);
    if (toolId) cardElement.dataset.toolCallId = toolId;
    cardElement.dataset.terminalId = '';
    S.toolCards[cardKey] = cardElement;
    if (displayId) S.toolCards[displayId] = cardElement;
    S.toolCards[indexKey] = cardElement;
    S._toolQueue.push({ key: cardKey, toolName: toolName, id: displayId });
    return cardElement;
  }

  function reuseOrCreateToolCard(S, toolName, toolArgs, toolId, toolIndex) {
    if (typeof toolArgs === 'string') {
      try {
        toolArgs = JSON.parse(toolArgs);
      } catch (_) {}
    }
    var iter = S.iterationCount || 0;
    var indexKey = 'iter_' + iter + '_' + toolName + '_idx_' + (toolIndex != null ? toolIndex : '?');
    var idKey = toolId || '';

    var card = (idKey && S.toolCards[idKey]) || S.toolCards[indexKey];
    if (card) {
      if (idKey) {
        S._seenToolIds[idKey] = true;
        card.dataset.toolCallId = idKey;
        S.toolCards[idKey] = card;
      }
      return card;
    }

    var existingCard = findPendingCardByToolName(S, toolName, toolId);
    if (existingCard) {
      S._seenToolIds[indexKey] = true;
      if (idKey) {
        S._seenToolIds[idKey] = true;
        existingCard.dataset.toolCallId = idKey;
        S.toolCards[idKey] = existingCard;
      }
      S.toolCards[indexKey] = existingCard;
      return existingCard;
    }

    S._seenToolIds[indexKey] = true;
    if (idKey) S._seenToolIds[idKey] = true;

    closeCurrentContentBlock(S);

    var displayId = toolId || 'tool_' + (++S._toolIdCounter);
    var cardKey = toolName + '_' + (++S._toolIdCounter) + '_' + Date.now();
    var cardElement = appendToolCard(S, msgList, S.botBody, cardKey, toolName, toolArgs, 'running');
    if (toolId) {
      cardElement.dataset.toolCallId = toolId;
    }
    S.toolCards[cardKey] = cardElement;
    if (displayId) {
      S.toolCards[displayId] = cardElement;
    }
    S.toolCards[indexKey] = cardElement;
    S._toolQueue.push({ key: cardKey, toolName: toolName, id: displayId });
    return cardElement;
  }

  function findAnyCardByToolName(S, toolName) {
    for (var cardKey in S.toolCards) {
      var card = S.toolCards[cardKey];
      if (card && card.dataset && card.dataset.toolName === toolName) {
        return card;
      }
    }
    return null;
  }

  function findAndFinalizeCard(S, toolName, status, result) {
    for (var i = S._toolQueue.length - 1; i >= 0; i--) {
      var entry = S._toolQueue[i];
      if (entry.toolName === toolName) {
        var card = S.toolCards[entry.key];
        if (card) {
          updateToolCard(chatCtx, card, status, result);
          return card;
        }
      }
    }
    for (var cardKey in S.toolCards) {
      var aCard = S.toolCards[cardKey];
      if (aCard && aCard.dataset && aCard.dataset.toolName === toolName &&
          aCard.dataset.status !== 'success' && aCard.dataset.status !== 'error') {
        updateToolCard(chatCtx, aCard, status, result);
        return aCard;
      }
    }
    return null;
  }

  function calculateDiffStats(toolName, args, result) {
    if (toolName === 'write_file') {
      var content = (args && args.content) || '';
      var linesRaw = content.split('\n');
      var lines = [];
      for (var li = 0; li < linesRaw.length; li++) {
        if (linesRaw[li].length > 0) lines.push(linesRaw[li]);
      }
      var lineCount = linesRaw.length;
      return {
        added: lineCount,
        removed: 0,
        isNewFile: true,
        summary: lineCount + ' lines'
      };
    }
    if (toolName === 'edit_file') {
      var oldStr = (args && args.old_string) || '';
      var newStr = (args && args.new_string) || '';
      var oldLinesRaw = oldStr.split('\n');
      var oldLines = [];
      for (var li = 0; li < oldLinesRaw.length; li++) {
        if (oldLinesRaw[li].length > 0) oldLines.push(oldLinesRaw[li]);
      }
      var newLinesRaw = newStr.split('\n');
      var newLines = [];
      for (var li = 0; li < newLinesRaw.length; li++) {
        if (newLinesRaw[li].length > 0) newLines.push(newLinesRaw[li]);
      }
      return {
        added: newLines.length,
        removed: oldLines.length,
        isNewFile: false,
        summary: '+' + newLines.length + ' -' + oldLines.length
      };
    }
    return null;
  }

  function formatToolResultText(toolName, result) {
    if (!result) return '';
    if (toolName === 'create_plan' || toolName === 'update_plan') {
      var planVal = (result && result.plan) || (result && result.args && result.args.plan) || '';
      if (planVal) {
        return typeof planVal === 'string' ? planVal : JSON.stringify(planVal, null, 2);
      }
    }
    if (toolName === 'spawn_subagent') {
      var agentId = result.agentId || result.id || (result.args && (result.args.id || result.args.agentId || result.args.subagent_id)) || '';
      var agentName = result.name || (result.args && result.args.name) || agentId;
      var status = result.status || 'completed';
      var role = result.role || (result.args && result.args.role) || 'coder';
      var subSummary = (result && (result.summary || result.output || result.content)) || (result && result.result && (result.result.summary || result.result.output || result.result.content)) || '';
      var execMode = (result && result.execution) || (result && result.args && result.args.execution) || '';
      if (execMode !== 'wait' || (subSummary && typeof subSummary === 'string' && subSummary.indexOf('is running on the assigned task') !== -1)) {
        return '✓ Subagent [' + String(role).toUpperCase() + '] ' + agentName + ' is running on the assigned task and will return the response.';
      }
      if (status !== 'running' && status !== 'starting' && subSummary) {
        var header = '✓ Subagent [' + String(role).toUpperCase() + '] ' + agentName + ' finished (' + status + ').';
        var cleanOutput = typeof subSummary === 'string' ? subSummary : JSON.stringify(subSummary, null, 2);
        return header + '\n\n' + cleanOutput;
      }
      return '✓ Subagent [' + String(role).toUpperCase() + '] ' + agentName + ' is running on the assigned task and will return the response.';
    }
    if (toolName === 'wait_for_subagent') {
      var subRes = (result && result.result) || result || {};
      var subAgentId = (result && (result.agentId || result.subagent_id)) || subRes.subagent_id || subRes.agentId || 'subagent';
      var subName = (result && result.name) || subRes.name || subAgentId;
      var subStatus = subRes.status || (result && result.status) || 'completed';
      var subSummary = (result && (result.summary || result.output || result.content)) || subRes.summary || subRes.output || subRes.content || '';
      var subRole = subRes.role || (result && result.role) || 'coder';
      var header = '✓ Subagent [' + String(subRole).toUpperCase() + '] ' + subName + ' finished (' + subStatus + ').';
      if (!subSummary) return header;
      var cleanOutput = typeof subSummary === 'string' ? subSummary : JSON.stringify(subSummary, null, 2);
      return header + '\n\n' + cleanOutput;
    }
    if (toolName === 'subagent_response') {
      var srRes = (result && result.result) || result || {};
      var srAgentId = (result && (result.subagent_id || result.agentId || result.id)) || srRes.subagent_id || srRes.agentId || srRes.id || 'subagent';
      var srName = (result && result.name) || srRes.name || srAgentId;
      var srStatus = srRes.status || (result && result.status) || 'completed';
      var srSummary = (result && (result.output || result.summary || result.content)) || srRes.output || srRes.summary || srRes.content || '';
      var srRole = srRes.role || (result && result.role) || 'coder';
      var srHeader = '✓ Subagent [' + String(srRole).toUpperCase() + '] ' + srName + ' finished (' + srStatus + ').';
      if (!srSummary) return srHeader;
      var srClean = typeof srSummary === 'string' ? srSummary : JSON.stringify(srSummary, null, 2);
      if (srClean.indexOf('finished (' + srStatus + ')') !== -1) {
        return srClean;
      }
      return srHeader + '\n\n' + srClean;
    }
    if (toolName === 'subagent_status') {
      var stRes = (result && result.result) || result || {};
      var stAgentId = (result && (result.agentId || result.subagent_id)) || stRes.subagent_id || stRes.agentId || 'subagent';
      var stStatus = stRes.status || (result && result.status) || 'running';
      var stTask = stRes.task || (result && result.task) || '';
      var stOutput = (result && (result.output || result.summary)) || (stRes && (stRes.output || stRes.summary)) || (result && result.latest_result && (result.latest_result.output || result.latest_result.summary)) || '';
      var baseText = 'Subagent ' + stAgentId + ' status: ' + stStatus + (stTask ? '\nTask: ' + stTask : '');
      if (stOutput) {
        var cleanStOut = typeof stOutput === 'string' ? stOutput : JSON.stringify(stOutput, null, 2);
        return baseText + '\n\n' + cleanStOut;
      }
      return baseText;
    }
    if (toolName === 'subagents_list') {
      var subList = result.subagents || result.agents || [];
      if (!subList.length) return 'No active subagents.';
      var lines = ['Active Subagents (' + subList.length + '):'];
      for (var si = 0; si < subList.length; si++) {
        var s = subList[si];
        lines.push('- [' + String(s.role || 'coder').toUpperCase() + '] ' + s.agentId + ' (' + s.status + '): ' + (s.task || ''));
      }
      return lines.join('\n');
    }
    if (toolName === 'run_terminal') {
      var parts = [];
      parts.push('Shell: ' + (result.shell || 'unknown'));
      parts.push('Platform: ' + (result.platform || 'unknown'));
      parts.push('Command: ' + (result.command || ''));
      parts.push('Exit code: ' + (result.exit_code != null ? result.exit_code : result.exitCode != null ? result.exitCode : '?'));
      parts.push('Duration: ' + (result.duration_ms || result.durationMs || 0) + 'ms');
      var stdout = result.stdout || result.output || '';
      if (stdout) parts.push('\n--- stdout ---\n' + stdout);
      var stderr = result.stderr || '';
      if (stderr) parts.push('\n--- stderr ---\n' + stderr);
      return parts.join('\n');
    }
    var text = '';
    if (result.content != null) text = result.content;
    else if (result.output != null) text = result.output;
    else if (result.message != null) text = result.message;
    else if (result.entries) {
      var entryList = [];
      for (var ei = 0; ei < result.entries.length; ei++) {
        var entry = result.entries[ei];
        entryList.push('- [' + entry.type.toUpperCase() + '] ' + entry.name);
      }
      text = entryList.join('\n');
    }
    else if (result.matches) {
      var matchList = [];
      for (var mi = 0; mi < result.matches.length; mi++) {
        matchList.push('- ' + result.matches[mi]);
      }
      text = matchList.join('\n');
    }
    else if (result.info) {
      try {
        text = JSON.stringify(result.info, null, 2);
      } catch (_) {
        // Intentionally fall back to string representation on serialization error
        text = String(result.info);
      }
    }
    else if (result.datetime) text = 'Datetime: ' + result.datetime;
    else if (result.command) text = 'Command: ' + result.command + '\nExit code: ' + (result.exit_code != null ? result.exit_code : '?') + '\n\n' + (result.output || '');
    else {
      try {
        text = JSON.stringify(result, null, 2);
      } catch (_) {
        // Intentionally fall back to string representation on serialization error
        text = String(result);
      }
    }
    return text;
  }

  function appendToolCard(S, msgList, body, cardKey, toolName, args, status, result) {
    if (!body) return null;
    status = status || 'running';
    var card = mk('details', 'cr-tool-card cr-tool-card--' + status);
    card.open = false;
    card.dataset.cardKey = cardKey;
    card.dataset.toolName = toolName;
    card.dataset.status = status;
    var rawSubId = (args && (args.agentId || args.subagent_id || args.id)) || (result && (result.agentId || result.subagent_id || result.id)) || '';
    if (rawSubId) card.dataset.subagentId = rawSubId;
    if (args && args.execution) card.dataset.execution = args.execution;

    var displayName = formatToolName(toolName);
    card.dataset.toolDisplayName = displayName;
    var subtitle = getToolSubtitle(toolName, args);
    var iconHtml = getToolIcon(toolName);

    var isComplete = status === 'success' || status === 'completed';
    var isFailed = status === 'error' || status === 'failed';
    var statusLabel = isComplete ? 'Completed' : isFailed ? 'Failed' : 'Pending';
    var statusClass = 'cr-tool-card-status--' + (isComplete ? 'completed' : isFailed ? 'failed' : 'pending');
    var iconClass = 'cr-tool-card-icon--' + (isComplete ? 'completed' : isFailed ? 'failed' : 'pending');

    var head = mk('summary', 'cr-tool-card-head');
    head.innerHTML =
      '<span class="cr-tool-card-icon ' + iconClass + '">' + (isComplete || isFailed ? iconHtml : I.spin) + '</span>' +
      '<span class="cr-tool-card-title-group">' +
        '<span class="cr-tool-card-title">' + esc(displayName) + '</span>' +
        (subtitle ? '<span class="cr-tool-card-subtitle">' + esc(subtitle) + '</span>' : '') +
      '</span>' +
      '<span class="cr-tool-card-status ' + statusClass + '">' + esc(statusLabel) + '</span>' +
      '<span class="cr-tool-card-chevron">' + I.chevron + '</span>';
    card.appendChild(head);

    var cardBody = mk('div', 'cr-tool-card-body');
    cardBody.style.display = 'block';

    var sanitizedArgs = sanitizeToolArgs(args);
    var argsStr = '';
    try {
      argsStr = JSON.stringify(sanitizedArgs, null, 2);
    } catch (_) {
      // Intentionally fall back to string conversion if circular references prevent serialization
      argsStr = String(sanitizedArgs || '');
    }
    if (argsStr && argsStr !== '{}') {
      var inputBlock = mk('div', 'cr-tool-card-input-block');
      inputBlock.innerHTML =
        '<div class="cr-tool-card-block-label">Tool Input</div>' +
        '<pre class="cr-tool-card-args-pre"><code>' + esc(argsStr) + '</code></pre>';
      cardBody.appendChild(inputBlock);
    }

    var actionsContainer = mk('div', 'cr-tool-card-actions');
    actionsContainer.style.display = 'none';
    cardBody.appendChild(actionsContainer);

    var resultContainer = mk('div', 'cr-tool-card-result cr-tool-card-output-block');
    resultContainer.style.display = 'none';
    var planFromArgs = (toolName === 'create_plan' || toolName === 'update_plan') && args && args.plan ? args.plan : '';
    if (result || planFromArgs) {
      var resText = formatToolResultText(toolName, result) || planFromArgs;
      if (status === 'error') {
        resultContainer.style.display = 'block';
        var errorMsg = (result && (result.message || result.error || result.content)) || (resText || 'Error');
        resultContainer.innerHTML =
          '<div class="cr-tool-card-block-label">Tool Output</div>' +
          '<div class="cr-tool-card-error-msg">' + I.err + ' ' + esc(errorMsg) + '</div>';
        if (resText && resText !== errorMsg && !resText.includes(errorMsg)) {
          resultContainer.innerHTML += '<pre class="cr-tool-card-result-pre">' + esc(resText) + '</pre>';
        }
      } else if (resText) {
        resultContainer.style.display = 'block';
        resultContainer.innerHTML =
          '<div class="cr-tool-card-block-label">Tool Output</div>' +
          '<pre class="cr-tool-card-result-pre">' + esc(resText) + '</pre>';
      }
      if (toolName === 'spawn_subagent' || toolName === 'wait_for_subagent' || toolName === 'subagent_response') {
        var subagentId = (result && (result.agentId || result.subagent_id || result.id)) || (args && (args.agentId || args.subagent_id || args.id)) || '';
        resultContainer.style.display = 'block';
        var execLinkHtml = '<div class="cr-subagent-execution-line" style="margin-top:8px;">' +
          '<button type="button" class="cr-subagent-execution-link" data-subagent-id="' + esc(subagentId) + '" title="View subagent in Subagents tab">Execution ↗</button>' +
          '</div>';
        resultContainer.innerHTML += execLinkHtml;
      }
    }
    cardBody.appendChild(resultContainer);

    card.appendChild(cardBody);
    body.appendChild(card);

    card.onclick = function onToolCardElementClick(evt) {
      var execLink = evt.target && evt.target.closest ? evt.target.closest('.cr-subagent-execution-link') : null;
      if (execLink) {
        evt.preventDefault();
        evt.stopPropagation();
        var aId = execLink.getAttribute('data-subagent-id');
        if (window.switchDashboardSubView) {
          window.switchDashboardSubView('subagents', aId);
        }
      }
    };

    S.toolCards[cardKey] = card;

    scrollBottom(msgList);
    return card;
  }

  function handleFileElClick(fileEl, e) {
    e.preventDefault();
    e.stopPropagation();
    var fp = fileEl.dataset.filePath;
    if (fp && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: 'openFile', path: fp });
    }
  }

  function updateToolCard(chatCtx, card, status, result) {
    if (!card) return;
    var oldStatus = card.dataset.status;
    var isComplete = status === 'success' || status === 'completed';
    var isFailed = status === 'error' || status === 'failed';
    var normStatus = isComplete ? 'completed' : isFailed ? 'failed' : 'pending';
    card.className = 'cr-tool-card cr-tool-card--' + normStatus;
    card.dataset.status = normStatus;
    var toolName = card.dataset.toolName;
    card.open = false;

    var iconEl = card.querySelector('.cr-tool-card-icon');
    if (iconEl) {
      iconEl.className = 'cr-tool-card-icon cr-tool-card-icon--' + normStatus;
      var iconHtml = getToolIcon(toolName);
      iconEl.innerHTML = isComplete ? iconHtml : isFailed ? iconHtml : I.spin;
    }

    var statusEl = card.querySelector('.cr-tool-card-status');
    if (statusEl) {
      statusEl.className = 'cr-tool-card-status cr-tool-card-status--' + normStatus;
      statusEl.textContent = isComplete ? 'Completed' : isFailed ? 'Failed' : 'Pending';
    }

    if (result) {
      var cardBody = card.querySelector('.cr-tool-card-body');
      if (cardBody) {
        var resText = formatToolResultText(toolName, result);
        var resultContainer = cardBody.querySelector('.cr-tool-card-result');
        if (!resultContainer) {
          resultContainer = mk('div', 'cr-tool-card-result cr-tool-card-output-block');
          cardBody.appendChild(resultContainer);
        } else {
          resultContainer.className = 'cr-tool-card-result cr-tool-card-output-block';
        }
        resultContainer.style.display = 'block';
        if (status === 'error') {
          var rawErr = (result && (result.message || result.error || result.content)) || (resText || 'Error');
          var errorMsg = '';
          if (rawErr && typeof rawErr === 'object') {
            errorMsg = rawErr.message || rawErr.error || JSON.stringify(rawErr);
          } else {
            errorMsg = String(rawErr || 'Error');
          }
          resultContainer.innerHTML =
            '<div class="cr-tool-card-block-label">Tool Output</div>' +
            '<div class="cr-tool-card-error-msg">' + I.err + ' ' + esc(errorMsg) + '</div>';
          if (resText && resText !== errorMsg && !resText.includes(errorMsg)) {
            resultContainer.innerHTML += '<pre class="cr-tool-card-result-pre">' + esc(resText) + '</pre>';
          }
        } else if (resText) {
          resultContainer.innerHTML =
            '<div class="cr-tool-card-block-label">Tool Output</div>' +
            '<pre class="cr-tool-card-result-pre">' + esc(resText) + '</pre>';
        }

        if (toolName === 'spawn_subagent' || toolName === 'wait_for_subagent' || toolName === 'subagent_response') {
          var subId = (result && (result.agentId || result.subagent_id || result.id)) || (card.dataset.subagentId) || '';
          if (subId && !resultContainer.querySelector('.cr-subagent-execution-link')) {
            var execLine = '<div class="cr-subagent-execution-line" style="margin-top:8px;">' +
              '<button type="button" class="cr-subagent-execution-link" data-subagent-id="' + esc(subId) + '" title="View subagent in Subagents tab">Execution ↗</button>' +
              '</div>';
            resultContainer.innerHTML += execLine;
          }
          if (!card.onclick) {
            card.onclick = function onToolCardElementClick(evt) {
              var execLink = evt.target && evt.target.closest ? evt.target.closest('.cr-subagent-execution-link') : null;
              if (execLink) {
                evt.preventDefault();
                evt.stopPropagation();
                var aId = execLink.getAttribute('data-subagent-id');
                if (window.switchDashboardSubView) {
                  window.switchDashboardSubView('subagents', aId);
                }
              }
            };
          }
        }

        if (toolName === 'write_file' || toolName === 'edit_file') {
          var inputBlock = cardBody.querySelector('.cr-tool-card-input-block');
          if (inputBlock) {
            // Keep clean
          }
        }
      }
    }

    scrollBottom(chatCtx.msgList);
  }

  function appendToolAction(chatCtx, card, action, message, actionStatus) {
    if (!card) return;
    var cardBody = card.querySelector('.cr-tool-card-body');
    if (!cardBody) return;

    var actionsContainer = cardBody.querySelector('.cr-tool-card-actions');
    if (!actionsContainer) {
      actionsContainer = mk('div', 'cr-tool-card-actions');
      cardBody.insertBefore(actionsContainer, cardBody.querySelector('.cr-tool-card-result'));
    }
    actionsContainer.style.display = 'block';

    var lastAction = actionsContainer.lastChild;
    if (lastAction && lastAction.textContent === (actionStatus === 'started' ? '▶ ' : '✓ ') + (message || action)) {
      return;
    }

    var line = mk('div', 'cr-tool-card-action-line');
    var icon = actionStatus === 'started' ? '▶' : '✓';
    var color = actionStatus === 'started' ? '#d29922' : '#3fb950';
    line.innerHTML = '<span style="color:' + color + ';margin-right:6px;">' + icon + '</span>' + esc(message || action);
    actionsContainer.appendChild(line);
    scrollBottom(chatCtx.msgList);
  }

  function appendToolCallBlock(body, tool, args, id) {
    if (!body) return;
    var d = mk('div', 'cr-tool-call');
    var argsStr = '';
    try {
      argsStr = JSON.stringify(args, null, 2);
    } catch (_) {
      // Intentionally fall back to string conversion if serialization fails
      argsStr = String(args || '');
    }
    d.innerHTML =
      '<div class="cr-tool-call-head">' +
        I.tool +
        '<span class="cr-tool-name">' + esc(tool || 'tool') + '</span>' +
        (id ? '<span class="cr-tool-id">#' + esc(String(id).substring(0, 8)) + '</span>' : '') +
      '</div>' +
      (argsStr ? '<pre class="cr-tool-args"><code>' + esc(argsStr) + '</code></pre>' : '');
    body.appendChild(d);
    return d;
  }

  function getModelContextLimit(modelName) {
    if (!modelName || typeof modelName !== 'string') return 131072;
    if (typeof window.getModelContextWindow === 'function') {
      var apiCtx = window.getModelContextWindow(modelName);
      if (apiCtx && typeof apiCtx === 'number' && apiCtx > 0) return apiCtx;
    }
    try {
      var cachedStr = localStorage.getItem('coderun_model_context_windows');
      if (cachedStr) {
        var cachedMap = JSON.parse(cachedStr);
        if (cachedMap && cachedMap[modelName] && typeof cachedMap[modelName] === 'number') {
          return cachedMap[modelName];
        }
      }
    } catch (_) {}

    var m = modelName.toLowerCase();
    if (m.indexOf('gemini') !== -1) {
      return 1048576;
    }
    if (m.indexOf('claude-3') !== -1 || m.indexOf('claude-3.5') !== -1 || m.indexOf('claude-3-7') !== -1) {
      return 200000;
    }
    if (m.indexOf('gpt-4o') !== -1 || m.indexOf('o1') !== -1 || m.indexOf('o3') !== -1 || m.indexOf('gpt-4-turbo') !== -1) {
      return 128000;
    }
    if (m.indexOf('llama-3.1') !== -1 || m.indexOf('llama-3.2') !== -1 || m.indexOf('llama-3.3') !== -1 ||
        m.indexOf('llama3.1') !== -1 || m.indexOf('llama3.2') !== -1 || m.indexOf('llama3.3') !== -1) {
      return 128000;
    }
    if (m.indexOf('deepseek') !== -1) {
      return 128000;
    }
    if (m.indexOf('qwen2.5') !== -1 || m.indexOf('qwen-2.5') !== -1) {
      return 128000;
    }
    if (m.indexOf('mistral-large') !== -1) {
      return 128000;
    }
    if (m.indexOf('mistral') !== -1 || m.indexOf('codestral') !== -1 || m.indexOf('mixtral') !== -1) {
      return 32768;
    }
    if (m.indexOf('phi-3') !== -1 || m.indexOf('phi-4') !== -1) {
      return 128000;
    }
    if (m.indexOf('llama-3') !== -1 || m.indexOf('llama3') !== -1) {
      return 8192;
    }
    if (m.indexOf('gpt-4') !== -1) {
      return 8192;
    }
    if (m.indexOf('gpt-3.5') !== -1) {
      return 16384;
    }
    return 131072;
  }

  function updateUsageDisplay(chatCtx, usage) {
    if (!chatCtx || !chatCtx.container || !usage) return;
    var promptTokens = usage.prompt_tokens || 0;
    var completionTokens = usage.completion_tokens || 0;
    var totalTokens = usage.total_tokens || (promptTokens + completionTokens);
    var contextTokens = usage.context_tokens || 0;

    function fmtNum(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    }

    var badgeText = chatCtx.container.querySelector('.cr-usage-text');
    if (badgeText) badgeText.textContent = fmtNum(totalTokens) + ' tokens';

    var valTotal = chatCtx.container.querySelector('.cr-usage-val-total');
    if (valTotal) valTotal.textContent = totalTokens.toLocaleString() + ' tokens';

    var currentModel = (window.getDashboardModel ? window.getDashboardModel() : '') || chatCtx.model || (chatCtx.conversation && chatCtx.conversation.model) || '';
    var maxLimit = getModelContextLimit(currentModel);
    var pct = 0;
    if (maxLimit > 0 && contextTokens > 0) {
      pct = Math.min(Math.round((contextTokens / maxLimit) * 100), 100);
    }

    var valContext = chatCtx.container.querySelector('.cr-usage-val-context');
    if (valContext) {
      if (contextTokens > 0) {
        valContext.textContent = fmtNum(contextTokens) + ' / ' + fmtNum(maxLimit);
      } else {
        valContext.textContent = '0 / ' + fmtNum(maxLimit);
      }
    }

    var valContextPct = chatCtx.container.querySelector('.cr-context-pct-val');
    if (valContextPct) {
      valContextPct.textContent = '(' + pct + '%)';
    }

    var fillBar = chatCtx.container.querySelector('.cr-context-bar-fill');
    if (fillBar) {
      fillBar.style.width = pct + '%';
      fillBar.classList.toggle('cr-context-bar-warn', pct >= 70 && pct < 90);
      fillBar.classList.toggle('cr-context-bar-danger', pct >= 90);
    }

    var valInput = chatCtx.container.querySelector('.cr-usage-val-input');
    if (valInput) valInput.textContent = promptTokens.toLocaleString();

    var valOutput = chatCtx.container.querySelector('.cr-usage-val-output');
    if (valOutput) valOutput.textContent = completionTokens.toLocaleString();

    var valRequests = chatCtx.container.querySelector('.cr-usage-val-requests');
    if (valRequests) {
      var reqCount = usage.requests || 0;
      if (!reqCount && chatCtx.conversation && chatCtx.conversation.messages) {
        var msgs = chatCtx.conversation.messages;
        for (var mi = 0; mi < msgs.length; mi++) {
          if (msgs[mi] && msgs[mi].role === 'user') {
            reqCount++;
          }
        }
      }
      if (!reqCount && chatCtx.S && chatCtx.S.requestCount) {
        reqCount = chatCtx.S.requestCount;
      }
      valRequests.textContent = String(reqCount || 0);
    }

    var valDuration = chatCtx.container.querySelector('.cr-usage-val-duration');
    if (valDuration) {
      var startTime = (chatCtx.conversation && chatCtx.conversation.createdAt) || chatCtx.startTime;
      if (!startTime) {
        chatCtx.startTime = Date.now();
        startTime = chatCtx.startTime;
      }
      var elapsedMs = Math.max(0, Date.now() - startTime);
      var totalSec = Math.floor(elapsedMs / 1000);
      var hours = Math.floor(totalSec / 3600);
      var minutes = Math.floor((totalSec % 3600) / 60);
      var seconds = totalSec % 60;
      var durStr = '0s';
      if (hours > 0) {
        durStr = hours + 'h ' + minutes + 'm';
      } else if (minutes > 0) {
        durStr = minutes + 'm ' + seconds + 's';
      } else {
        durStr = seconds + 's';
      }
      valDuration.textContent = durStr;
    }
  }

  function buildShell(title) {
    return (
      '<div class="cr-root">' +
        '<div class="cr-header">' +
          '<span class="cr-header-avatar">' + I.bot + '</span>' +
          '<span class="cr-header-title">' + esc(title) + '</span>' +
        '</div>' +
        '<div class="cr-msg-list"></div>' +
        '<div class="cr-composer">' +
          '<div class="cr-todos-panel" style="display:none"></div>' +
          '<div class="cr-running-subagents-panel" style="display:none"></div>' +
          '<div class="cr-agent-controls-panel" style="display:none"></div>' +
          '<div class="cr-question-banner" style="display:none"></div>' +
          '<div class="cr-img-preview" style="display:none">' +
            '<img class="cr-preview-img" src="" alt=""/>' +
            '<button type="button" class="cr-clear-img-btn" title="Remove">' + I.close + '</button>' +
          '</div>' +
          '<div class="cr-composer-row">' +
            '<button type="button" class="cr-attach-btn" title="Attach image">' + I.attach + '</button>' +
            '<textarea class="cr-textarea" rows="1" placeholder="Ask anything..."></textarea>' +
            '<button type="button" class="cr-send-btn" title="Send">' + I.send + '</button>' +
            '<button type="button" class="cr-stop-btn" title="Stop generation" style="display:none">' + I.stop + '</button>' +
          '</div>' +
          '<div class="cr-composer-footer">' +
            '<div class="cr-usage-wrapper">' +
              '<div class="cr-usage-badge">' +
                '<span class="cr-usage-icon">📊</span>' +
                '<span class="cr-usage-text">0 tokens</span>' +
              '</div>' +
              '<div class="cr-usage-card">' +
                '<div class="cr-usage-card-header">' +
                  '<div class="cr-usage-header-left">' +
                    '<span class="cr-usage-header-icon">' + I.barChart + '</span>' +
                    '<span class="cr-usage-card-title">Session Info</span>' +
                  '</div>' +
                  '<button type="button" class="cr-usage-close-btn" title="Close">' + I.close + '</button>' +
                '</div>' +
                '<div class="cr-usage-card-section cr-usage-total-section">' +
                  '<span class="cr-usage-label">Total Consumed</span>' +
                  '<span class="cr-usage-val-total">0 tokens</span>' +
                '</div>' +
                '<div class="cr-usage-context-section">' +
                  '<div class="cr-usage-metric-row">' +
                    '<div class="cr-usage-metric-left">' +
                      '<span class="cr-usage-metric-icon cr-usage-icon--context">' + I.database + '</span>' +
                      '<span class="cr-usage-metric-name">Context Window</span>' +
                    '</div>' +
                    '<span class="cr-usage-val-context">—</span>' +
                  '</div>' +
                  '<div class="cr-context-bar-wrap"><div class="cr-context-bar-fill" style="width: 0%;"></div></div>' +
                  '<div class="cr-context-pct-row"><span class="cr-context-pct-val">(0%)</span></div>' +
                '</div>' +
                '<div class="cr-usage-metrics-list">' +
                  '<div class="cr-usage-metric-row">' +
                    '<div class="cr-usage-metric-left">' +
                      '<span class="cr-usage-metric-icon cr-usage-icon--up">' + I.arrowUp + '</span>' +
                      '<span class="cr-usage-metric-name">Input / System</span>' +
                    '</div>' +
                    '<span class="cr-usage-val-input">0</span>' +
                  '</div>' +
                  '<div class="cr-usage-metric-row">' +
                    '<div class="cr-usage-metric-left">' +
                      '<span class="cr-usage-metric-icon cr-usage-icon--down">' + I.arrowDown + '</span>' +
                      '<span class="cr-usage-metric-name">Output / Response</span>' +
                    '</div>' +
                    '<span class="cr-usage-val-output">0</span>' +
                  '</div>' +
                  '<div class="cr-usage-metric-row">' +
                    '<div class="cr-usage-metric-left">' +
                      '<span class="cr-usage-metric-icon cr-usage-icon--gear">' + I.gear + '</span>' +
                      '<span class="cr-usage-metric-name">Requests</span>' +
                    '</div>' +
                    '<span class="cr-usage-val-requests">0</span>' +
                  '</div>' +
                  '<div class="cr-usage-metric-row">' +
                    '<div class="cr-usage-metric-left">' +
                      '<span class="cr-usage-metric-icon cr-usage-icon--clock">' + I.clock + '</span>' +
                      '<span class="cr-usage-metric-name">Session Duration</span>' +
                    '</div>' +
                    '<span class="cr-usage-val-duration">0s</span>' +
                  '</div>' +
                '</div>' +
                '<button type="button" class="cr-compact-btn" id="cr-compact-btn">📦 Compact Conversation</button>' +
              '</div>' +
            '</div>' +
            '<span class="cr-char-count">0</span>' +
            '<span class="cr-hint">Shift+Enter · new line</span>' +
          '</div>' +
        '</div>' +
        '<input type="file" class="cr-file-input" accept="image/*" style="display:none"/>' +
      '</div>'
    );
  }

  function renderChatSpace(container, conversation, options) {
    try {
      if (!container || !conversation) return;
      options = options || {};

      var convId = conversation.id;
      var baseUrl = options.baseUrl || (window.getDashboardBaseUrl ? window.getDashboardBaseUrl() : 'http://localhost:11434/v1');
      var model = options.model || (window.getDashboardModel ? window.getDashboardModel() : '');
      var workspace = options.workspaceFolder || (window.getDashboardWorkspace ? window.getDashboardWorkspace() : '');
      var onStreamStart = options.onStreamStart || noop;
      var onStreamEnd = options.onStreamEnd || noop;
      var onStreamError = options.onStreamError || noop;

      container.innerHTML = buildShell(conversation.title || 'Chat');

      var msgList    = container.querySelector('.cr-msg-list');
      var input      = container.querySelector('.cr-textarea');
      var sendBtn    = container.querySelector('.cr-send-btn');
      var attachBtn  = container.querySelector('.cr-attach-btn');
      var fileInput  = container.querySelector('.cr-file-input');
      var previewBox = container.querySelector('.cr-img-preview');
      var previewImg = container.querySelector('.cr-preview-img');
      var clearImg   = container.querySelector('.cr-clear-img-btn');
      var charCount  = container.querySelector('.cr-char-count');
      var stopBtn    = container.querySelector('.cr-stop-btn');
      var todosPanel = container.querySelector('.cr-todos-panel');
      var runningSubagentsPanel = container.querySelector('.cr-running-subagents-panel');
      var controlsPanel = container.querySelector('.cr-agent-controls-panel');
      var questionBanner = container.querySelector('.cr-question-banner');

      var S = {
        isStreaming: false,
        botBody: null,
        thinkBlock: null,
        thinkPre: null,
        thinkText: '',
        fullThinking: '',
        iterationThinking: '',
        contentDiv: null,
        contentText: '',
        actionList: null,
        actionMap: {},
        fullResponse: '',
        sources: [],
        toolCallBlocks: {},
        iterationCount: 0,
        statusLines: [],
        _terminalCards: {},
        _activeTerminalId: null,
        _terminalCardOrder: [],
        _currentCheckpoints: [],
        toolCards: {},
        _toolQueue: [],
        _toolCalls: [],
        _toolIdCounter: 0,
        _seenToolIds: {},
        sessionUsage: null,
        turnStartUsage: null,
        currentTurnUsage: null,
        latestContextTokens: 0,
        timeline: null
      };

      var chatCtx = {
        container: container,
        conversation: conversation,
        options: options,
        convId: convId,
        baseUrl: baseUrl,
        model: model,
        workspace: workspace,
        onStreamStart: onStreamStart,
        onStreamEnd: onStreamEnd,
        onStreamError: onStreamError,
        msgList: msgList,
        input: input,
        sendBtn: sendBtn,
        attachBtn: attachBtn,
        fileInput: fileInput,
        previewBox: previewBox,
        previewImg: previewImg,
        clearImg: clearImg,
        charCount: charCount,
        stopBtn: stopBtn,
        todosPanel: todosPanel,
        runningSubagentsPanel: runningSubagentsPanel,
        controlsPanel: controlsPanel,
        questionBanner: questionBanner,
        pendingImage: null,
        abortCtrl: null,
        S: S,
        runningSubagents: {},
        permissionQueue: []
      };

      if (conversation.usage) {
        S.sessionUsage = conversation.usage;
      } else {
        S.sessionUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, context_tokens: 0 };
      }
      S.turnStartUsage = {
        prompt_tokens: S.sessionUsage.prompt_tokens || 0,
        completion_tokens: S.sessionUsage.completion_tokens || 0,
        total_tokens: S.sessionUsage.total_tokens || 0,
        context_tokens: S.sessionUsage.context_tokens || 0
      };
      S.currentTurnUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      S.latestContextTokens = S.sessionUsage.context_tokens || 0;
      updateUsageDisplay(chatCtx, S.sessionUsage);

      function onStopStream() { stopCurrentChatStream(chatCtx); }
      window.stopCurrentChatStream = onStopStream;

      function onRefreshActiveAgentControls() {
        updateAgentControlsPanel(chatCtx);
      }
      window.refreshActiveAgentControls = onRefreshActiveAgentControls;

      if (conversation.plan) {
        renderTodos(chatCtx, conversation.plan);
      } else {
        if (todosPanel) todosPanel.style.display = 'none';
      }
      loadHistory(chatCtx, msgList, conversation.messages || []);

      function onInputTextChange() { handleInputTextChange(input, charCount); }
      input.addEventListener('input', onInputTextChange);
      function onDoSendAction() { doSend(chatCtx); }
      function onInputKeyDown(e) { handleInputKeyDown(onDoSendAction, e); }
      input.addEventListener('keydown', onInputKeyDown);
      function onSendBtnClick() { doSend(chatCtx); }
      sendBtn.addEventListener('click', onSendBtnClick);

      if (stopBtn) {
        function onStopBtnClick() { handleStopButtonClick(chatCtx); }
        stopBtn.addEventListener('click', onStopBtnClick);
      }

      function onInputPaste(e) { handleInputPaste(chatCtx, e); }
      input.addEventListener('paste', onInputPaste);
      function onAttachClick() { handleAttachClick(fileInput); }
      attachBtn.addEventListener('click', onAttachClick);
      function onFileInputChange(e) { handleFileInputChange(chatCtx, e); }
      fileInput.addEventListener('change', onFileInputChange);
      if (clearImg) {
        function onClearImgClick() { handleClearImgClick(chatCtx); }
        clearImg.addEventListener('click', onClearImgClick);
      }

      function handleMsgListCodeCopy(evt) {
        if (!evt || !evt.target) return;
        var copyBtn = evt.target.closest ? evt.target.closest('.md-code-copy-btn') : null;
        if (copyBtn) {
          var codeToCopy = decodeURIComponent(copyBtn.getAttribute('data-code') || '');
          if (navigator.clipboard && codeToCopy) {
            function onClipSuccess() {
              copyBtn.classList.add('md-copied');
              function onRemoveCopied() {
                copyBtn.classList.remove('md-copied');
              }
              setTimeout(onRemoveCopied, 1500);
            }
            navigator.clipboard.writeText(codeToCopy).then(onClipSuccess);
          }
        }
      }
      msgList.addEventListener('click', handleMsgListCodeCopy);

      var usageBadge = container.querySelector('.cr-usage-badge');
      var usageCard  = container.querySelector('.cr-usage-card');
      var usageCloseBtn = container.querySelector('.cr-usage-close-btn');

      function handleBadgeClick(evt) {
        evt.stopPropagation();
        if (usageCard) {
          usageCard.classList.toggle('cr-usage-card--open');
          if (usageCard.classList.contains('cr-usage-card--open')) {
            updateUsageDisplay(chatCtx, S.sessionUsage || (chatCtx.conversation && chatCtx.conversation.usage) || {});
          }
        }
      }

      function handleCloseUsageCard(evt) {
        evt.stopPropagation();
        if (usageCard) {
          usageCard.classList.remove('cr-usage-card--open');
        }
      }

      function handleDocClickCloseUsage(evt) {
        if (usageCard && usageCard.classList.contains('cr-usage-card--open')) {
          if (!usageCard.contains(evt.target) && !usageBadge.contains(evt.target)) {
            usageCard.classList.remove('cr-usage-card--open');
          }
        }
      }

      if (usageBadge && usageCard) {
        usageBadge.addEventListener('click', handleBadgeClick);
      }
      if (usageCloseBtn) {
        usageCloseBtn.addEventListener('click', handleCloseUsageCard);
      }
      document.addEventListener('click', handleDocClickCloseUsage);

      var compactBtn = container.querySelector('#cr-compact-btn');
      if (compactBtn) {
        function handleCompactClick() {
          if (!chatCtx.conversation || !chatCtx.conversation.messages || chatCtx.conversation.messages.length < 2) {
            return;
          }
          if (chatCtx.S && chatCtx.S.fullResponse && chatCtx.conversation && chatCtx.conversation.messages) {
            var msgs = chatCtx.conversation.messages;
            var lastM = msgs[msgs.length - 1];
            if (!lastM || lastM.role !== 'assistant') {
              msgs.push({
                role: 'assistant',
                content: chatCtx.S.fullResponse,
                thinking: chatCtx.S.fullThinking,
                tool_calls: chatCtx.S._toolCalls,
                timestamp: Date.now()
              });
            } else if (!lastM.content && chatCtx.S.fullResponse) {
              lastM.content = chatCtx.S.fullResponse;
              if (chatCtx.S.fullThinking && !lastM.thinking) lastM.thinking = chatCtx.S.fullThinking;
              if (chatCtx.S._toolCalls && !lastM.tool_calls) lastM.tool_calls = chatCtx.S._toolCalls;
            }
          }
          compactBtn.disabled = true;
          compactBtn.textContent = '⏳ Compacting...';

          var cpNum = 1;
          if (chatCtx.conversation.compactCheckpoint && chatCtx.conversation.compactCheckpoint.id) {
            cpNum = parseInt(chatCtx.conversation.compactCheckpoint.id.replace('cp', ''), 10) + 1;
            if (isNaN(cpNum)) cpNum = 1;
          }

          if (window.VSCODE_API) {
            window.VSCODE_API.postMessage({
              type: 'compactConversation',
              conversationId: chatCtx.conversation.id,
              messages: chatCtx.conversation.messages,
              checkpointNumber: cpNum
            });
          }
        }
        compactBtn.addEventListener('click', handleCompactClick);
      }

      window._activeChatCtx = chatCtx;
    } catch (e) {
      console.error("[CHATSPACE] Error inside renderChatSpace:", e);
    }
  }
  window.renderChatSpace = renderChatSpace;

  function refreshActiveChatUsage() {
    if (window._activeChatCtx && window._activeChatCtx.S && window._activeChatCtx.S.sessionUsage) {
      updateUsageDisplay(window._activeChatCtx, window._activeChatCtx.S.sessionUsage);
    }
  }
  window.refreshActiveChatUsage = refreshActiveChatUsage;

  function handleWindowMessage(event) {
    var message = event.data || {};
    if (message.type === "agentEvent" && window.activeChatStreamCallback) {
      window.activeChatStreamCallback(message.event);
    }

    if (message.type === 'diffResult' && message.diffId) {
      var diffStat = message.result && message.result.success ? 'accepted' : 'rejected';
      var allDiffCards = document.querySelectorAll('.cr-diff-card[data-diff-id="' + message.diffId + '"]');
      for (var dci = 0; dci < allDiffCards.length; dci++) {
        if (typeof window.setDiffCardStatus === 'function') {
          window.setDiffCardStatus(allDiffCards[dci], diffStat);
        }
      }
      if (typeof updateSubagentDiffStatus === 'function') {
        updateSubagentDiffStatus(message.sessionId, message.diffId, diffStat);
      }
      if (typeof window.refreshActiveAgentControls === 'function') {
        window.refreshActiveAgentControls();
      }
    }

    if (message.type === 'diffAllResult' && message.results) {
      for (var dr = 0; dr < message.results.length; dr++) {
        var r = message.results[dr];
        if (r.diffId) {
          var rStat = r.success ? 'accepted' : 'rejected';
          var allDiffCards2 = document.querySelectorAll('.cr-diff-card[data-diff-id="' + r.diffId + '"]');
          for (var dci2 = 0; dci2 < allDiffCards2.length; dci2++) {
            if (typeof window.setDiffCardStatus === 'function') {
              window.setDiffCardStatus(allDiffCards2[dci2], rStat);
            }
          }
          if (typeof updateSubagentDiffStatus === 'function') {
            updateSubagentDiffStatus(message.sessionId, r.diffId, rStat);
          }
        }
      }
      if (typeof window.refreshActiveAgentControls === 'function') {
        window.refreshActiveAgentControls();
      }
    }

    if (message.type === 'undoCheckpointResult' && message.filePath) {
      if (window.updateActionsBarStatus) {
        window.updateActionsBarStatus(message.filePath, message.success ? 'Restored' : 'Failed', message.checkpointId);
      }
    }

    if (message.type === 'compactCheckpoint' && message.checkpoint) {
      var cpData = message.checkpoint;
      if (typeof window.getDashboardConversations === 'function') {
        var convs = window.getDashboardConversations() || [];
        for (var ci = 0; ci < convs.length; ci++) {
          if (convs[ci].id === message.conversationId || (window.getDashboardActiveConversationId && convs[ci].id === window.getDashboardActiveConversationId())) {
            convs[ci].compactCheckpoint = cpData;
            if (convs[ci].usage) {
              convs[ci].usage.context_tokens = Math.round(((cpData && cpData.content) ? cpData.content.length : 0) / 4) + 600;
            }
            break;
          }
        }
        if (typeof window.saveDashboardConversations === 'function') {
          window.saveDashboardConversations(convs);
        }
      }
      var msgListEl = document.querySelector('.cr-msg-list');
      if (msgListEl) {
        appendCompactCheckpoint(msgListEl, cpData);
        msgListEl.scrollTop = msgListEl.scrollHeight;
      }
      var valContextEl = document.querySelector('.cr-usage-val-context');
      if (valContextEl && cpData && cpData.content) {
        var estTokens = Math.round(cpData.content.length / 4) + 600;
        var estDisplay = estTokens >= 1000 ? (estTokens / 1000).toFixed(1) + 'K' : String(estTokens);
        valContextEl.textContent = '~' + estDisplay + ' (compacted)';
      }
      var cBtn = document.querySelector('#cr-compact-btn');
      if (cBtn) {
        cBtn.disabled = false;
        cBtn.textContent = '📦 Compact Conversation';
      }
    }

    if (message.type === 'compactError') {
      var cBtnErr = document.querySelector('#cr-compact-btn');
      if (cBtnErr) {
        cBtnErr.disabled = false;
        cBtnErr.textContent = '📦 Compact Conversation';
      }
    }
  }
  window.addEventListener("message", handleWindowMessage);

  if (typeof window.getDashboardActiveConversationId === "function") {
    var activeId = window.getDashboardActiveConversationId();
    if (activeId && typeof window.selectDashboardConversation === "function") {
      window.selectDashboardConversation(activeId);
    }
  }
}

initializeChatSpace();
