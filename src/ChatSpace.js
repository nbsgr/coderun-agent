// ChatSpace.js — CodeRun Agent Chat UI
// Handles: message posting, permission requests, event streaming,
// terminal streaming, collapsible tool cards, status timeline
// New prefix: cr- (coderun)

(function() {
  'use strict';

  var I = {
    bot:    '<svg class="cr-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7H4a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2zM7 14v2a1 1 0 1 0 2 0v-2H7zm8 0v2a1 1 0 1 0 2 0v-2h-2zM5 20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1H5v1z"/></svg>',
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
    chevron: '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>'
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
    _scrollRAF = requestAnimationFrame(handleScrollRAF.bind(null, el));
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
    _renderTimer = setTimeout(handleContentRenderTimeout.bind(null, S), 100);
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

  // ── Tool name formatter ──────────────────────────────
  function formatToolName(name) {
    var map = {
      'read_file': 'Read File',
      'write_file': 'Write File',
      'edit_file': 'Edit File',
      'delete_file': 'Delete File',
      'create_folder': 'Create Folder',
      'delete_folder': 'Delete Folder',
      'list_directory': 'Read Directory',
      'search_files': 'Search Files',
      'get_file_info': 'File Info',
      'run_terminal': 'Execute Terminal Command',
      'get_current_datetime': 'Get DateTime'
    };
    return map[name] || name.replace(/_/g, ' ').replace(/\b\w/g, toUpperCaseChar);
  }

  // ── Tool icon selector ───────────────────────────────
  function getToolIcon(name) {
    if (name === 'run_terminal') return I.terminal;
    if (name === 'list_directory' || name === 'create_folder' || name === 'delete_folder') return I.folder;
    return I.tool;
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
  }

  function renderTodos(chatCtx, plan) {
    if (!chatCtx.todosPanel) return;
    if (!plan) {
      chatCtx.todosPanel.style.display = 'none';
      return;
    }

    var steps = [];
    if (plan.phases && plan.phases.length) {
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

    chatCtx.todosPanel.style.display = 'block';
    var isCollapsed = chatCtx.todosPanel.dataset.collapsed === 'true';

    var stepsHtml = '';
    for (var si = 0; si < steps.length; si++) {
      var s = steps[si];
      var isComp = s.status === 'completed';
      var statusIcon = isComp
        ? '<span class="cr-todo-status completed">' + I.check + '</span>'
        : '<span class="cr-todo-status pending"><span class="cr-todo-circle"></span></span>';
      stepsHtml +=
        '<div class="cr-todo-item">' +
          statusIcon +
          '<span class="cr-todo-text">' + esc(s.description) + '</span>' +
        '</div>';
    }

    chatCtx.todosPanel.innerHTML =
      '<div class="cr-todos-header">' +
        '<span class="cr-todos-toggle">' + (isCollapsed ? '▶' : '▼') + '</span>' +
        '<span class="cr-todos-title">Todos (' + completedCount + '/' + totalCount + ')</span>' +
        '<span class="cr-todos-icon"><svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg></span>' +
      '</div>' +
      '<div class="cr-todos-list" style="display:' + (isCollapsed ? 'none' : 'block') + '">' +
        stepsHtml +
      '</div>';

    var header = chatCtx.todosPanel.querySelector('.cr-todos-header');
    header.onclick = handleTodosHeaderClick.bind(null, chatCtx, plan);
  }

  function handleTodosHeaderClick(chatCtx, plan) {
    var collapsed = chatCtx.todosPanel.dataset.collapsed === 'true';
    chatCtx.todosPanel.dataset.collapsed = !collapsed;
    renderTodos(chatCtx, plan);
  }

  function updateAgentControlsPanel(chatCtx) {
    var controlsPanel = chatCtx.controlsPanel;
    var msgList = chatCtx.msgList;
    if (!controlsPanel) return;
    var pendingButtons = msgList.querySelectorAll('.cr-permission-actions button[data-action="allow"]');
    var pendingDiffs = msgList.querySelectorAll('.cr-diff-card[data-diff-status="pending"] .cr-diff-accept');
    var totalPending = pendingButtons.length + pendingDiffs.length;

    if (totalPending > 0) {
      controlsPanel.style.display = 'block';
      var html = '<div class="cr-controls-inner">';

      if (pendingButtons.length > 0 && pendingDiffs.length > 0) {
        html +=
          '<span class="cr-controls-label">' + pendingButtons.length + ' permission(s) + ' + pendingDiffs.length + ' file change(s)</span>' +
          '<div class="cr-controls-buttons">' +
            '<button class="cr-btn cr-btn-continue-all" title="Allow all pending permissions">Allow</button>' +
            '<button class="cr-btn cr-btn-quit-all" title="Deny all pending permissions">Deny</button>' +
            '<button class="cr-btn cr-btn-accept-all-diffs" title="Accept all pending file changes">Accept All</button>' +
            '<button class="cr-btn cr-btn-reject-all-diffs" title="Reject all pending file changes">Reject All</button>' +
          '</div>';
      } else if (pendingButtons.length > 0) {
        html +=
          '<span class="cr-controls-label">' + pendingButtons.length + ' confirmation(s) required</span>' +
          '<div class="cr-controls-buttons">' +
            '<button class="cr-btn cr-btn-continue-all" title="Allow all pending actions">Allow</button>' +
            '<button class="cr-btn cr-btn-quit-all" title="Deny all pending actions">Deny</button>' +
          '</div>';
      } else {
        html +=
          '<span class="cr-controls-label">' + pendingDiffs.length + ' file change(s) pending</span>' +
          '<div class="cr-controls-buttons">' +
            '<button class="cr-btn cr-btn-accept-all-diffs" title="Accept all pending file changes">Accept All</button>' +
            '<button class="cr-btn cr-btn-reject-all-diffs" title="Reject all pending file changes">Reject All</button>' +
          '</div>';
      }

      html += '</div>';
      controlsPanel.innerHTML = html;

      var allowAllBtn = controlsPanel.querySelector('.cr-btn-continue-all');
      if (allowAllBtn) {
        allowAllBtn.onclick = handleAllowAllClick.bind(null, chatCtx);
      }

      var denyAllBtn = controlsPanel.querySelector('.cr-btn-quit-all');
      if (denyAllBtn) {
        denyAllBtn.onclick = handleDenyAllClick.bind(null, chatCtx);
      }

      var acceptAllDiffsBtn = controlsPanel.querySelector('.cr-btn-accept-all-diffs');
      if (acceptAllDiffsBtn) {
        acceptAllDiffsBtn.onclick = handleAcceptAllDiffsClick.bind(null, chatCtx);
      }

      var rejectAllDiffsBtn = controlsPanel.querySelector('.cr-btn-reject-all-diffs');
      if (rejectAllDiffsBtn) {
        rejectAllDiffsBtn.onclick = handleRejectAllDiffsClick.bind(null, chatCtx);
      }
    } else {
      controlsPanel.style.display = 'none';
    }
  }

  function handleAllowAllClick(chatCtx) {
    var allowBtns = chatCtx.msgList.querySelectorAll('.cr-permission-actions button[data-action="allow"]');
    for (var i = 0; i < allowBtns.length; i++) {
      allowBtns[i].click();
    }
    updateAgentControlsPanel(chatCtx);
  }

  function handleDenyAllClick(chatCtx) {
    var denyBtns = chatCtx.msgList.querySelectorAll('.cr-permission-actions button[data-action="deny"]');
    for (var i = 0; i < denyBtns.length; i++) {
      denyBtns[i].click();
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

    console.log('[LOAD_HISTORY] ═══ LOADING', messages.length, 'MESSAGES ═══');
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

    for (var ti = 0; ti < turns.length; ti++) {
      var turn = turns[ti];
      if (turn.user) {
        appendUserBubble(msgList, turn.user.content, turn.user.image || (turn.user.images ? turn.user.images[0] : null));
      }

      if (turn.botMessages && turn.botMessages.length) {
        var body = appendBotWrapper(msgList);
        for (var mi = 0; mi < turn.botMessages.length; mi++) {
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
                    resultObj = { content: resContent };
                  }
                } else {
                  status = 'error';
                  resultObj = { error: 'No result recorded' };
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
        window.VSCODE_API.postMessage({ type: 'stopChat' });
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
        reader.onload = handleReaderOnload.bind(null, chatCtx);
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
    reader.onload = handleReaderOnload.bind(null, chatCtx);
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
        window.VSCODE_API.postMessage({ type: 'stopChat' });
      } catch (e) {
        // Intentionally ignore if postMessage is restricted in the current environment
      }
    }
    setStreaming(chatCtx, false);
    chatCtx.onStreamEnd();
  }

  function handleStreamError(chatCtx, err) {
    var S = chatCtx.S;
    removeTyping(S.botBody);
    var errorLine = mk('div', 'cr-error-line');
    errorLine.innerHTML = I.err + ' Error: ' + esc(err && err.message || String(err));
    if (S.botBody) S.botBody.appendChild(errorLine);
    setStreaming(chatCtx, false);
    scrollBottom(chatCtx.msgList);
  }

  function handleActiveChatStream(chatCtx, ev) {
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
    if (ev.type === 'stream_error') {
      handleStreamError(chatCtx, ev.error);
      chatCtx.onStreamError(ev.error);
      window.activeChatStreamCallback = null;
      return;
    }
    handleEvent(chatCtx, ev, S);
    scrollBottomSmooth(msgList);
  }

  function pumpStream(streamCtx) {
    return streamCtx.reader.read()
      .then(handleReaderChunk.bind(null, streamCtx))
      .catch(handleReaderError.bind(null, streamCtx));
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
        window.saveConversationMessage(chatCtx.convId, 'user', text, { image: imgB64 });
      } else {
        conversation.messages.push({ role: 'user', content: text, image: imgB64, timestamp: Date.now() });
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
          var h = { role: m.role, content: m.content || '' };
          if (m.thinking) h.thinking = m.thinking;
          if (m.tool_calls) h.tool_calls = m.tool_calls;
          if (m.tool_call_id) h.tool_call_id = m.tool_call_id;
          if (m.images) h.images = m.images;
          if (m.image && !h.images) h.images = [m.image];
          history.push(h);
        }
      }

      if (window.VSCODE && window.VSCODE_API) {
        onStreamStart();
        window.activeChatStreamCallback = handleActiveChatStream.bind(null, chatCtx);

        window.VSCODE_API.postMessage({
          type: "startChat",
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
      .then(handleFetchChatResponse.bind(null, S, msgList, onStreamEnd, onStreamError, chatCtx))
      .catch(handleFetchChatError.bind(null, onStreamError, chatCtx));
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
      S.botBody = appendBotWrapper(msgList);
      appendTyping(S.botBody);
      setStreaming(chatCtx, true);
      scrollBottom(msgList);

      var history = [];
      if (conversation.messages) {
        for (var hi = 0; hi < conversation.messages.length; hi++) {
          var m = conversation.messages[hi];
          var h = { role: m.role, content: m.content || '' };
          if (m.thinking) h.thinking = m.thinking;
          if (m.tool_calls) h.tool_calls = m.tool_calls;
          if (m.tool_call_id) h.tool_call_id = m.tool_call_id;
          if (m.images) h.images = m.images;
          if (m.image && !h.images) h.images = [m.image];
          history.push(h);
        }
      }

      if (window.VSCODE && window.VSCODE_API) {
        onStreamStart();
        window.activeChatStreamCallback = handleActiveChatStream.bind(null, chatCtx);

        window.VSCODE_API.postMessage({
          type: "startChat",
          message: null,
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
      .then(handleFetchChatResponse.bind(null, S, msgList, onStreamEnd, onStreamError, chatCtx))
      .catch(handleFetchChatError.bind(null, onStreamError, chatCtx));
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
        if (S.thinkBlock) {
          var lbl = S.thinkBlock.querySelector('.cr-think-label');
          if (lbl) lbl.textContent = 'Thought process';
          S.thinkBlock.open = false;
          S.thinkBlock = null; S.thinkPre = null; S.thinkText = ''; S.iterationThinking = '';
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
          if (toolName === 'terminal_input' || toolName === 'stop_terminal') continue;
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
          if (ev.plan) {
            var isCompleted = ev.plan.status === 'completed';
            if (isCompleted) {
              chatCtx.conversation.plan = null;
              renderTodos(chatCtx, null);
              if (window.saveConversationMessageBatch) {
                window.saveConversationMessageBatch(chatCtx.convId, null, null);
              }
            } else {
              chatCtx.conversation.plan = ev.plan;
              renderTodos(chatCtx, ev.plan);
              if (window.saveConversationMessageBatch) {
                window.saveConversationMessageBatch(chatCtx.convId, null, ev.plan);
              }
            }
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
            S.thinkBlock.open = true;
          }
          S.thinkBlock = null; S.thinkPre = null; S.thinkText = ''; S.iterationThinking = '';
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
        case 'requestPermission': {
          removeTyping(S.botBody);
          if (ev.autoResolved) {
            var autoLine = mk('div', 'cr-permission-auto');
            var decisionLabel = ev.decision === 'allow' ? '✓ Auto-allowed' : '✗ Auto-denied';
            var decisionCls = ev.decision === 'allow' ? 'allowed' : 'denied';
            autoLine.innerHTML =
              '<span class="cr-permission-auto-icon">' + I.tool + '</span>' +
              '<span class="cr-permission-auto-text">' +
                esc(ev.tool) + ' — <span class="cr-permission-status ' + decisionCls + '">' + decisionLabel + '</span>' +
                ' <span class="cr-permission-auto-hint">(Always ' + (ev.decision === 'allow' ? 'Allow' : 'Deny') + ')</span>' +
              '</span>';
            S.botBody.appendChild(autoLine);
          } else {
            appendPermissionRequestBlock(chatCtx, S.botBody, ev.tool, ev.arguments, ev.id);
            updateAgentControlsPanel(chatCtx);
          }
          break;
        }
        case 'tool_call': {
          removeTyping(S.botBody);
          var toolId = ev.id || 'tool_' + (++S._toolIdCounter);
          var toolName = ev.tool || '';
          if (toolName === 'terminal_input' || toolName === 'stop_terminal') break;
          var toolArgs = ev.args || {};
          var toolIndex = ev.index;

          if (toolName === 'run_terminal') {
            reuseOrCreateTerminalCard(S, toolName, toolArgs, toolId, toolIndex);
            S.thinkBlock = null; S.thinkPre = null; S.thinkText = '';
          } else {
            var card = reuseOrCreateToolCard(S, toolName, toolArgs, toolId, toolIndex);
            if (card) {
              S.toolCallBlocks[ev.id || card.dataset.cardKey || ('tool_' + S._toolIdCounter)] = card;
            }
            S.thinkBlock = null; S.thinkPre = null; S.thinkText = '';
          }
          break;
        }
        case 'action': {
          removeTyping(S.botBody);
          var action = ev.action;
          if (action === 'terminal_input' || action === 'stop_terminal') break;
          if (action === 'run_terminal') {
            var termCard = getLastPendingCard(S);
            if (termCard) {
              var statusEl = termCard.querySelector('.cr-tool-card-status');
              if (statusEl) statusEl.textContent = 'Running…';
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
            if (!pendingCard) {
              pendingCard = getLastPendingCard(S);
            }
            if (pendingCard && ev.toolCallId) {
              S.toolCards[ev.toolCallId] = pendingCard;
            }
          }
          if (!pendingCard) {
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
          var resTool = ev.tool;
          if (resTool === 'terminal_input' || resTool === 'stop_terminal') break;
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
          
          var updated = false;
          if (cardToUpdate) {
            updateToolCard(chatCtx, cardToUpdate, resStatus, ev);
            cardToUpdate.dataset.status = resStatus;
            updated = true;
          } else {
            var domCards = S.botBody ? S.botBody.querySelectorAll('.cr-tool-card') : [];
            for (var di = domCards.length - 1; di >= 0; di--) {
              var dc = domCards[di];
              if (dc && dc.dataset && dc.dataset.toolName === resTool) {
                updateToolCard(chatCtx, dc, resStatus, ev);
                dc.dataset.status = resStatus;
                updated = true;
                break;
              }
            }
          }
          if (!updated) {
            var fallbackKey = 'tr_' + Date.now();
            appendToolCard(S, chatCtx.msgList, S.botBody, fallbackKey, resTool, {}, resStatus, ev);
          }
          break;
        }
        case 'agent_status': {
          removeTyping(S.botBody);
          var statusMsg = ev.status === 'executing_tools' ? 'Executing ' + ev.count + ' tool call(s)...' : ev.status || '';
          if (statusMsg) appendStatusLine(S, S.botBody, statusMsg);
          break;
        }
        case 'agent_iteration': {
          S.iterationCount = ev.iteration;
          S.thinkBlock = null; S.thinkPre = null; S.thinkText = ''; S.iterationThinking = '';
          S.contentDiv = null; S.contentText = '';
          clearStatusLines(S);
          S.toolCards = {};
          S._toolQueue = [];
          S._toolIdCounter = 0;
          break;
        }
        case 'agent_done':
        case 'done': {
          removeTyping(S.botBody);
          var finalContent = ev.content || ev.full_content;
          if (finalContent && !S.contentDiv) {
            S.contentDiv = appendContentBlock(S.botBody);
            S.contentDiv.innerHTML = md(finalContent);
            S.fullResponse = finalContent;
          }
          if (ev.sources && ev.sources.length) {
            S.sources = ev.sources;
            appendSources(S.botBody, ev.sources);
          }
          if (S._currentCheckpoints && S._currentCheckpoints.length) {
            appendActionsBar(chatCtx, S.botBody, S._currentCheckpoints);
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
          var errDiv = mk('div', 'cr-error-line');
          errDiv.innerHTML = I.err + ' ' + esc(ev.message || ev.error || 'Error from agent');
          if (S.botBody) S.botBody.appendChild(errDiv);
          clearStatusLines(S);
          break;
        }
        case 'status': {
          removeTyping(S.botBody);
          appendStatusLine(S, S.botBody, ev.message);
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
            }
          }
          break;
        }
        case 'request_diff': {
          removeTyping(S.botBody);
          appendDiffCard(chatCtx, S.botBody, ev);
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
    flushContentRender(S);
    removeTyping(S.botBody);
    S.thinkBlock = null; S.thinkPre = null;
    if (chatCtx.conversation && chatCtx.conversation.plan) {
      renderTodos(chatCtx, chatCtx.conversation.plan);
    } else if (chatCtx.todosPanel) {
      chatCtx.todosPanel.style.display = 'none';
      chatCtx.todosPanel.innerHTML = '';
    }
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
    det.open = true;
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

  function appendPermissionRequestBlock(chatCtx, body, tool, args, id) {
    if (!body) return null;
    var argsStr = '';
    try {
      argsStr = JSON.stringify(args, null, 2);
    } catch (_) {
      // Intentionally fall back to string description if circular refs prevent stringification
      argsStr = String(args || '');
    }

    var pendingCard = findPendingCardByToolName(chatCtx.S, tool, id);

    if (!pendingCard) {
      var cardKey = tool + '_' + (++chatCtx.S._toolIdCounter) + '_' + Date.now();
      if (tool === 'run_terminal') {
        pendingCard = appendTerminalCard(chatCtx.S, chatCtx.msgList, chatCtx.S.botBody, cardKey, tool, args, 'pending', null);
        pendingCard.dataset.toolCallId = id;
        pendingCard.dataset.terminalId = '';
        chatCtx.S.toolCards[cardKey] = pendingCard;
        chatCtx.S.toolCards[id] = pendingCard;
        chatCtx.S._toolQueue.push({ key: cardKey, toolName: tool, id: id });
      } else {
        pendingCard = appendToolCard(chatCtx.S, chatCtx.msgList, chatCtx.S.botBody, cardKey, tool, args, 'running', null);
        pendingCard.dataset.toolCallId = id;
        chatCtx.S.toolCards[cardKey] = pendingCard;
        chatCtx.S.toolCards[id] = pendingCard;
        chatCtx.S.toolCards[tool + '_idx_' + chatCtx.S._toolIdCounter] = pendingCard;
        chatCtx.S._toolQueue.push({ key: cardKey, toolName: tool, id: id });
      }
    } else {
      if (id) {
        pendingCard.dataset.toolCallId = id;
        chatCtx.S.toolCards[id] = pendingCard;
      }
    }

    var targetParent = body;
    var isEmbedded = false;

    var isMatch = false;
    if (pendingCard) {
      if (pendingCard.dataset.toolName === tool) {
        isMatch = true;
      } else if ((tool === 'terminal_input' || tool === 'stop_terminal') && pendingCard.dataset.toolName === 'run_terminal') {
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
      d.innerHTML =
        '<div class="cr-permission-prompt" style="font-size: 11.5px; color: #b4b4b4; margin-bottom: 6px; font-weight: 500; padding: 0 10px;">' +
          'Permission Requested: Allow execution?' +
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
      d.innerHTML =
        '<div class="cr-permission-head">' +
          I.tool +
          '<span class="cr-permission-title">Permission Requested</span>' +
          '<button class="cr-permission-info" title="This tool can modify files or run commands. Choose how to handle future calls of this tool.">ⓘ</button>' +
        '</div>' +
        '<div class="cr-permission-body">' +
          '<p>The agent wants to execute tool <strong>' + esc(tool) + '</strong> with arguments:</p>' +
          '<pre class="cr-permission-args"><code>' + esc(argsStr) + '</code></pre>' +
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
    actions.addEventListener('click', handlePermissionActionClick.bind(null, id, tool, chatCtx.msgList, chatCtx.controlsPanel));
    scrollBottom(chatCtx.msgList);
    return d;
  }

  function handlePermissionActionClick(id, tool, msgList, controlsPanel, e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var act = btn.dataset.action;
    var isAllow = act === 'allow' || act === 'always-allow';
    var isAlways = act === 'always-allow' || act === 'always-deny';
    var label = isAlways
      ? (isAllow ? '✓ Always Allowed' : '✗ Always Denied')
      : (isAllow ? '✓ Allowed' : '✗ Denied');
    var actions = e.currentTarget;
    actions.innerHTML = '<span class="cr-permission-status ' + (isAllow ? 'allowed' : 'denied') + '">' + label + '</span>';
    if (window.VSCODE_API) {
      window.VSCODE_API.postMessage({
        type: 'permissionResponse',
        approved: isAllow,
        toolCallId: id,
        always: isAlways,
        tool: tool
      });
    }
    var chatCtx = { msgList: msgList, controlsPanel: controlsPanel };
    setTimeout(updateAgentControlsPanel.bind(null, chatCtx), 50);
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
      a.addEventListener('click', handleSourceChipClick.bind(null, src));
      d.appendChild(a);
    }
    body.appendChild(d);
    return d;
  }

  function appendTerminalCard(S, msgList, body, cardKey, toolName, args, status, result) {
    if (!body) return null;
    status = status || 'pending';

    var card = mk('details', 'cr-terminal-details');
    card.open = true;
    card.dataset.cardKey = cardKey;
    card.dataset.toolName = 'run_terminal';
    card.dataset.status = status;

    var command = (args && args.command) || '';
    var shortCommand = command.split(' ')[0] || 'Terminal';

    var summary = mk('summary', 'cr-terminal-summary-trigger');
    summary.innerHTML =
      'Ran <span class="cr-terminal-trigger-cmd">' + esc(shortCommand) + '</span>' +
      '<span class="cr-terminal-summary-chevron">' + I.chevron + '</span>';
    card.appendChild(summary);

    var container = mk('div', 'cr-terminal-container cr-terminal-container--' + status);
    
    var head = mk('div', 'cr-terminal-header');
    head.innerHTML =
      '<span class="cr-terminal-status-dot"></span>' +
      '<span class="cr-terminal-header-title">' + esc(command) + '</span>' +
      '<span class="cr-terminal-header-icon">' + I.terminal + '</span>';
    container.appendChild(head);

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
    card.dataset.status = execStatus;
    
    var container = card.querySelector('.cr-terminal-container');
    if (container) {
      container.className = 'cr-terminal-container cr-terminal-container--' + execStatus;
    }

    if (execStatus !== 'running' && execStatus !== 'waiting' && execStatus !== 'pending') {
      if (execStatus === 'success') {
        card.open = false;
      } else {
        card.open = true;
      }
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
    if (!body || !checkpoints || !checkpoints.length) return;
    var existing = body.querySelector('.cr-actions-bar');
    if (existing) existing.remove();

    var bar = mk('div', 'cr-actions-bar');
    var seenFiles = {};
    for (var ai = 0; ai < checkpoints.length; ai++) {
      var cp = checkpoints[ai];
      if (!cp.filePath || seenFiles[cp.filePath]) continue;
      seenFiles[cp.filePath] = true;

      var undoBtn = mk('button', 'cr-action-btn cr-action-undo');
      undoBtn.dataset.cpId = cp.id;
      undoBtn.dataset.filePath = cp.filePath;
      undoBtn.innerHTML = '↩ Undo <span class="cr-action-label">' + esc(cp.label || cp.filePath) + '</span>';
      undoBtn.addEventListener('click', handleUndoBtnClick);

      bar.appendChild(undoBtn);
    }
    body.appendChild(bar);
  }

  function handleUndoBtnClick(e) {
    var btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '↩ Undoing...';
    if (window.VSCODE_API) {
      window.VSCODE_API.postMessage({
        type: 'undoCheckpoint',
        filePath: btn.dataset.filePath,
        checkpointId: btn.dataset.cpId
      });
    }
  }

  function updateActionsBarStatus(filePath, statusText) {
    var bars = document.querySelectorAll('.cr-actions-bar');
    for (var bi = 0; bi < bars.length; bi++) {
      var btns = bars[bi].querySelectorAll('.cr-action-undo');
      for (var bj = 0; bj < btns.length; bj++) {
        var btn = btns[bj];
        if (btn.dataset.filePath === filePath) {
          btn.disabled = true;
          btn.innerHTML = '✓ ' + statusText;
          btn.classList.add('cr-action-done');
        }
      }
    }
  }
  window.updateActionsBarStatus = updateActionsBarStatus;

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
    if (!body) return;
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

    var head = mk('div', 'cr-diff-head');
    head.innerHTML =
      I.file +
      '<span class="cr-diff-title">' + esc(filePath) + '</span>' +
      '<span class="cr-diff-stats">' +
        '<span class="cr-diff-stat-add">+' + additions + '</span>' +
        '<span class="cr-diff-stat-del">-' + deletions + '</span>' +
      '</span>';
    card.appendChild(head);

    var details = mk('details', 'cr-diff-details');
    details.open = true;

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

    actions.querySelector('.cr-diff-accept').onclick = handleDiffAcceptClick.bind(null, diffId, card, chatCtx.controlsPanel, chatCtx.msgList);
    actions.querySelector('.cr-diff-reject').onclick = handleDiffRejectClick.bind(null, diffId, card, chatCtx.controlsPanel, chatCtx.msgList);
    actions.querySelector('.cr-diff-full-btn').onclick = handleDiffFullClick.bind(null, diffId);

    var targetParent = body;
    var pendingCard = null;
    if (ev.toolCallId && chatCtx.S.toolCards[ev.toolCallId]) {
      pendingCard = chatCtx.S.toolCards[ev.toolCallId];
    }
    if (!pendingCard) {
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
    targetParent.appendChild(card);
    scrollBottom(chatCtx.msgList);
    updateAgentControlsPanel(chatCtx);
  }

  function handleDiffAcceptClick(diffId, card, controlsPanel, msgList) {
    if (!window.VSCODE_API) return;
    window.VSCODE_API.postMessage({ type: 'acceptDiff', diffId: diffId });
    setDiffCardStatus(card, 'accepted');
    var chatCtx = { controlsPanel: controlsPanel, msgList: msgList };
    updateAgentControlsPanel(chatCtx);
  }

  function handleDiffRejectClick(diffId, card, controlsPanel, msgList) {
    if (!window.VSCODE_API) return;
    window.VSCODE_API.postMessage({ type: 'rejectDiff', diffId: diffId });
    setDiffCardStatus(card, 'rejected');
    var chatCtx = { controlsPanel: controlsPanel, msgList: msgList };
    updateAgentControlsPanel(chatCtx);
  }

  function handleDiffFullClick(diffId) {
    if (!window.VSCODE_API) return;
    window.VSCODE_API.postMessage({ type: 'openDiffEditor', diffId: diffId });
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
    btnContinue.addEventListener('click', handleContinueClick.bind(null, btnContainer, chatCtx));

    var btnQuit = mk('button', 'cr-btn cr-btn-quit-all');
    btnQuit.textContent = 'Quit';
    btnQuit.addEventListener('click', handleQuitClick.bind(null, btnContainer, chatCtx));

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
    var statusEl = card.querySelector('.cr-diff-status');
    if (acceptBtn) acceptBtn.style.display = 'none';
    if (rejectBtn) rejectBtn.style.display = 'none';
    if (fullBtn) fullBtn.style.display = 'none';
    if (statusEl) {
      statusEl.style.display = 'inline-block';
      statusEl.textContent = status === 'accepted' ? '✓ Applied' : '✗ Rejected';
      statusEl.className = 'cr-diff-status cr-diff-status--' + status;
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
    if (toolName === 'terminal_input' || toolName === 'stop_terminal') {
      var termCards = S.botBody ? S.botBody.querySelectorAll('.cr-terminal-details') : [];
      if (termCards.length > 0) {
        return termCards[termCards.length - 1];
      }
    }

    for (var cardKey in S.toolCards) {
      var card = S.toolCards[cardKey];
      if (card && card.dataset && card.dataset.toolName === toolName &&
          card.dataset.status !== 'success' && card.dataset.status !== 'error') {
        var cid = card.dataset.toolCallId;
        var isTemp = cid && (cid.indexOf('tool_') === 0 || cid.indexOf('term_') === 0);
        if (!cid || isTemp || (toolId && cid === toolId)) {
          return card;
        }
      }
    }
    return null;
  }

  function reuseOrCreateTerminalCard(S, toolName, toolArgs, toolId, toolIndex) {
    var indexKey = toolName + '_idx_' + (toolIndex != null ? toolIndex : '?');
    var idKey = toolId || '';
    if ((idKey && S._seenToolIds[idKey]) || S._seenToolIds[indexKey]) {
      var card = S.toolCards[idKey] || S.toolCards[indexKey];
      if (card && idKey) {
        S._seenToolIds[idKey] = true;
        card.dataset.toolCallId = idKey;
        S.toolCards[idKey] = card;
      }
      return card;
    }

    var existingCard = findPendingCardByToolName(S, toolName, toolId) || (toolId && S.toolCards[toolId]);
    if (existingCard) {
      S._seenToolIds[indexKey] = true;
      if (idKey) S._seenToolIds[idKey] = true;
      if (toolId) existingCard.dataset.toolCallId = toolId;
      S.toolCards[indexKey] = existingCard;
      if (idKey) S.toolCards[idKey] = existingCard;
      return existingCard;
    }

    S._seenToolIds[indexKey] = true;
    if (idKey) S._seenToolIds[idKey] = true;

    S.contentDiv = null;
    S.contentText = '';

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
    S.toolCards[displayId] = cardElement;
    S._toolQueue.push({ key: cardKey, toolName: toolName, id: displayId });
    return cardElement;
  }

  function reuseOrCreateToolCard(S, toolName, toolArgs, toolId, toolIndex) {
    var indexKey = toolName + '_idx_' + (toolIndex != null ? toolIndex : '?');
    var idKey = toolId || '';
    if ((idKey && S._seenToolIds[idKey]) || S._seenToolIds[indexKey]) {
      var card = S.toolCards[idKey] || S.toolCards[indexKey];
      if (card && idKey) {
        S._seenToolIds[idKey] = true;
        card.dataset.toolCallId = idKey;
        S.toolCards[idKey] = card;
      }
      return card;
    }

    var existingCard = findPendingCardByToolName(S, toolName, toolId) || (toolId && S.toolCards[toolId]);
    if (existingCard) {
      S._seenToolIds[indexKey] = true;
      if (idKey) S._seenToolIds[idKey] = true;
      if (toolId) existingCard.dataset.toolCallId = toolId;
      S.toolCards[indexKey] = existingCard;
      if (idKey) S.toolCards[idKey] = existingCard;
      return existingCard;
    }

    S._seenToolIds[indexKey] = true;
    if (idKey) S._seenToolIds[idKey] = true;

    S.contentDiv = null;
    S.contentText = '';

    var displayId = toolId || 'tool_' + (++S._toolIdCounter);
    var cardKey = toolName + '_' + S._toolIdCounter + '_' + Date.now();
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
    card.open = (status !== 'success');
    card.dataset.cardKey = cardKey;
    card.dataset.toolName = toolName;
    card.dataset.status = status;

    var displayName = formatToolName(toolName);
    var iconHtml = getToolIcon(toolName);

    var diffStats = calculateDiffStats(toolName, args, result);
    var statusLabel = status === 'running' ? 'Running…' : status === 'success' ? 'Completed' : 'Failed';
    if (status === 'success' && diffStats) {
      statusLabel = '+' + diffStats.added;
      if (diffStats.removed > 0) statusLabel += ' -' + diffStats.removed;
      statusLabel += ' lines';
    }

    var argsSummary = '';
    var isFile = false;
    if (args) {
      if (args.file_path) {
        argsSummary = args.file_path;
        isFile = true;
      }
      else if (args.command) argsSummary = truncate(args.command, 60);
      else if (args.folder_path) {
        argsSummary = args.folder_path;
        isFile = true;
      }
      else if (args.pattern) argsSummary = args.pattern;
      else {
        try {
          var argsStr = JSON.stringify(args);
          argsSummary = truncate(argsStr, 60);
        } catch (_) {
          // Intentionally ignore and set arguments summary to empty on serialization failure
          argsSummary = '';
        }
      }
    }

    var statusClass = 'cr-tool-card-status--' + status;
    var iconClass = 'cr-tool-card-icon--' + status;

    var head = mk('summary', 'cr-tool-card-head');
    head.innerHTML =
      '<span class="cr-tool-card-icon ' + iconClass + '">' + (status === 'running' ? I.spin : iconHtml) + '</span>' +
      '<span class="cr-tool-card-title">' + esc(displayName) + '</span>' +
      (argsSummary ? (isFile ? '<span class="cr-tool-card-args cr-clickable-file" data-file-path="' + esc(argsSummary) + '" title="Open file in editor">' + esc(argsSummary) + '</span>' : '<span class="cr-tool-card-args">' + esc(argsSummary) + '</span>') : '') +
      '<span class="cr-tool-card-status ' + statusClass + '">' + esc(statusLabel) + '</span>' +
      '<span class="cr-tool-card-chevron">' + I.chevron + '</span>';
    card.appendChild(head);

    var fileEl = head.querySelector('.cr-clickable-file');
    if (fileEl) {
      fileEl.addEventListener('click', handleFileElClick.bind(null, fileEl));
    }

    var cardBody = mk('div', 'cr-tool-card-body');
    cardBody.style.display = 'block';

    var argsStr = '';
    try {
      argsStr = JSON.stringify(args, null, 2);
    } catch (_) {
      // Intentionally fall back to string conversion if circular references prevent serialization
      argsStr = String(args || '');
    }
    if (argsStr && argsStr !== '{}') {
      var argsBlock = mk('details', 'cr-tool-card-args-block');
      argsBlock.open = false;
      argsBlock.innerHTML =
        '<summary class="cr-tool-card-args-summary">Arguments</summary>' +
        '<pre class="cr-tool-card-args-pre"><code>' + esc(argsStr) + '</code></pre>';
      cardBody.appendChild(argsBlock);
    }

    var actionsContainer = mk('div', 'cr-tool-card-actions');
    actionsContainer.style.display = 'none';
    cardBody.appendChild(actionsContainer);

    var resultContainer = mk('div', 'cr-tool-card-result');
    resultContainer.style.display = 'none';
    if (result) {
      var resText = formatToolResultText(toolName, result);
      if (resText) {
        resultContainer.style.display = 'block';
        resultContainer.innerHTML = '<pre class="cr-tool-card-result-pre">' + esc(resText) + '</pre>';
      }
      if (status === 'error') {
        resultContainer.style.display = 'block';
        resultContainer.innerHTML = '<div class="cr-tool-card-error-msg">' + I.err + ' ' + esc(result.message || result.error || 'Unknown error') + '</div>';
      }
    }
    cardBody.appendChild(resultContainer);

    card.appendChild(cardBody);
    body.appendChild(card);

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
    card.className = 'cr-tool-card cr-tool-card--' + status;
    card.dataset.status = status;
    card.open = (status !== 'success');

    var toolName = card.dataset.toolName;

    var iconEl = card.querySelector('.cr-tool-card-icon');
    if (iconEl) {
      iconEl.className = 'cr-tool-card-icon cr-tool-card-icon--' + status;
      iconEl.innerHTML = status === 'success' ? I.check : status === 'error' ? I.err : I.spin;
    }

    var statusEl = card.querySelector('.cr-tool-card-status');
    if (statusEl) {
      statusEl.className = 'cr-tool-card-status cr-tool-card-status--' + status;
      if (status === 'success' && result) {
        var diffStats = calculateDiffStats(toolName, null, result);
        if (diffStats) {
          statusEl.textContent = '+' + diffStats.added + (diffStats.removed > 0 ? ' -' + diffStats.removed : '') + ' lines';
        } else {
          statusEl.textContent = 'Completed';
        }
      } else {
        statusEl.textContent = status === 'success' ? 'Completed' : status === 'error' ? 'Failed' : status;
      }
    }

    if (result) {
      var cardBody = card.querySelector('.cr-tool-card-body');
      if (cardBody) {
        var resText = formatToolResultText(toolName, result);
        var resultContainer = cardBody.querySelector('.cr-tool-card-result');
        if (!resultContainer) {
          resultContainer = mk('div', 'cr-tool-card-result');
          cardBody.appendChild(resultContainer);
        }
        resultContainer.style.display = 'block';
        if (status === 'error') {
          resultContainer.innerHTML = '<div class="cr-tool-card-error-msg">' + I.err + ' ' + esc(result.message || result.error || 'Unknown error') + '</div>';
          if (resText) {
            resultContainer.innerHTML += '<pre class="cr-tool-card-result-pre">' + esc(resText) + '</pre>';
          }
        } else if (resText) {
          resultContainer.innerHTML = '<pre class="cr-tool-card-result-pre">' + esc(resText) + '</pre>';
        }

        if (toolName === 'write_file' || toolName === 'edit_file') {
          var argsBlock = cardBody.querySelector('.cr-tool-card-args-block');
          if (argsBlock) argsBlock.open = true;
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
          '<div class="cr-agent-controls-panel" style="display:none"></div>' +
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
      var baseUrl = options.baseUrl || (window.getDashboardBaseUrl ? window.getDashboardBaseUrl() : 'http://localhost:11434');
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
      var controlsPanel = container.querySelector('.cr-agent-controls-panel');

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
        controlsPanel: controlsPanel,
        pendingImage: null,
        abortCtrl: null,
        S: S
      };

      window.stopCurrentChatStream = stopCurrentChatStream.bind(null, chatCtx);

      if (conversation.plan) {
        renderTodos(chatCtx, conversation.plan);
      } else {
        if (todosPanel) todosPanel.style.display = 'none';
      }
      loadHistory(chatCtx, msgList, conversation.messages || []);

      input.addEventListener('input', handleInputTextChange.bind(null, input, charCount));
      input.addEventListener('keydown', handleInputKeyDown.bind(null, doSend.bind(null, chatCtx)));
      sendBtn.addEventListener('click', doSend.bind(null, chatCtx));

      if (stopBtn) {
        stopBtn.addEventListener('click', handleStopButtonClick.bind(null, chatCtx));
      }

      input.addEventListener('paste', handleInputPaste.bind(null, chatCtx));
      attachBtn.addEventListener('click', handleAttachClick.bind(null, fileInput));
      fileInput.addEventListener('change', handleFileInputChange.bind(null, chatCtx));
      if (clearImg) {
        clearImg.addEventListener('click', handleClearImgClick.bind(null, chatCtx));
      }

    } catch (e) {
      console.error("[CHATSPACE] Error inside renderChatSpace:", e);
    }
  }
  window.renderChatSpace = renderChatSpace;

  function handleWindowMessage(event) {
    var message = event.data || {};
    if (message.type === "agentEvent" && window.activeChatStreamCallback) {
      window.activeChatStreamCallback(message.event);
    }

    if (message.type === 'diffResult' && message.diffId) {
      var card = document.querySelector('.cr-diff-card[data-diff-id="' + message.diffId + '"]');
      if (card && typeof window.setDiffCardStatus === 'function') {
        window.setDiffCardStatus(card, message.result && message.result.success ? 'accepted' : 'rejected');
      }
    }

    if (message.type === 'diffAllResult' && message.results) {
      for (var dr = 0; dr < message.results.length; dr++) {
        var r = message.results[dr];
        if (r.diffId) {
          var card2 = document.querySelector('.cr-diff-card[data-diff-id="' + r.diffId + '"]');
          if (card2 && typeof window.setDiffCardStatus === 'function') {
            window.setDiffCardStatus(card2, r.success ? 'accepted' : 'rejected');
          }
        }
      }
    }

    if (message.type === 'undoCheckpointResult' && message.filePath) {
      if (window.updateActionsBarStatus) {
        window.updateActionsBarStatus(message.filePath, message.success ? 'Restored' : 'Failed');
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
}());
