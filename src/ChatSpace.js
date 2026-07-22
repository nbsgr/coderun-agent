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

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

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

  function truncate(s, n) { return s.length > n ? s.substring(0, n) + '…' : s; }

  function flatStr(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }

  function formatTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function fmtActionLabel(action, args) {
    return 'Executing action <span class="cr-action-name">' + esc(action) + '</span>';
  }

  // ── ANSI escape sequence cleaner (client-side belt & suspenders) ───
  function stripAnsi(text) {
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

  function scrollBottom(el) {
    if (!el) return;
    var hasPendingPermissions = el.querySelector('.cr-permission-actions button') !== null;
    if (hasPendingPermissions) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }

  // ── RAF-coalesced smooth scroll (avoids layout thrashing) ───
  var _scrollRAF = null;
  function scrollBottomSmooth(el) {
    if (!el) return;
    var hasPendingPermissions = el.querySelector('.cr-permission-actions button') !== null;
    if (hasPendingPermissions) return;
    if (_scrollRAF) return;
    _scrollRAF = requestAnimationFrame(function() {
      _scrollRAF = null;
      el.scrollTop = el.scrollHeight;
    });
  }

  // ── Debounced markdown render for streaming content ───
  var _renderTimer = null;
  function scheduleContentRender(S) {
    if (_renderTimer) return;
    _renderTimer = setTimeout(function() {
      _renderTimer = null;
      if (S.contentDiv && S.contentText !== undefined) {
        S.contentDiv.innerHTML = md(S.contentText);
      }
    }, 100);
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
    return map[name] || name.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  }

  // ── Tool icon selector ───────────────────────────────
  function getToolIcon(name) {
    if (name === 'run_terminal') return I.terminal;
    if (name === 'list_directory' || name === 'create_folder' || name === 'delete_folder') return I.folder;
    return I.tool;
  }

  window.renderChatSpace = function(container, conversation, options) {
    try {
      if (!container || !conversation) return;
      options = options || {};

      var convId = conversation.id;
      var baseUrl = options.baseUrl || (window.getDashboardBaseUrl ? window.getDashboardBaseUrl() : 'http://localhost:11434');
      var model = options.model || (window.getDashboardModel ? window.getDashboardModel() : '');
      var workspace = options.workspaceFolder || (window.getDashboardWorkspace ? window.getDashboardWorkspace() : '');
      var onStreamStart = options.onStreamStart || function() {};
      var onStreamEnd = options.onStreamEnd || function() {};
      var onStreamError = options.onStreamError || function() {};

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

      var pendingImage = null;
      var abortCtrl = null;

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
        // Terminal streaming state
        _terminalCards: {},        // Maps terminalId → card element for inline terminal cards
        _activeTerminalId: null,   // Current active terminal execution ID
        _terminalCardOrder: [],    // Ordered list of terminal IDs for auto-collapse
        // Checkpoints tracking for undo
        _currentCheckpoints: [],
        // Tool cards — uses _toolQueue for ordered tracking
        toolCards: {},
        _toolQueue: [],
        _toolCalls: [],    // Accumulated tool call objects for this turn
        _toolIdCounter: 0,
        _seenToolIds: {},  // Tracks tool call IDs to prevent duplicate cards
        timeline: null
      };

      function clearStatusLines(S) {
        if (S.statusLines && S.statusLines.length) {
          S.statusLines.forEach(function(el) {
            if (el && el.parentNode) el.parentNode.removeChild(el);
          });
          S.statusLines = [];
        }
      }

      function clearStreamTurn() {
        // Cancel any pending debounced renders
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
        // Clear terminal and tool card state
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
        if (todosPanel) todosPanel.style.display = 'none';
        if (controlsPanel) controlsPanel.style.display = 'none';
      }

      function renderTodos(plan) {
        if (!todosPanel) return;
        if (!plan || !plan.steps || !plan.steps.length) {
          todosPanel.style.display = 'none';
          return;
        }
        var completedCount = plan.steps.filter(function(s) { return s.status === 'completed'; }).length;
        var totalCount = plan.steps.length;
        if (completedCount === totalCount) {
          todosPanel.style.display = 'none';
          return;
        }
        todosPanel.style.display = 'block';
        var isCollapsed = todosPanel.dataset.collapsed === 'true';

        todosPanel.innerHTML =
          '<div class="cr-todos-header">' +
            '<span class="cr-todos-toggle">' + (isCollapsed ? '▶' : '▼') + '</span>' +
            '<span class="cr-todos-title">Todos (' + completedCount + '/' + totalCount + ')</span>' +
            '<span class="cr-todos-icon"><svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg></span>' +
          '</div>' +
          '<div class="cr-todos-list" style="display:' + (isCollapsed ? 'none' : 'block') + '">' +
            plan.steps.map(function(s) {
              var isComp = s.status === 'completed';
              var statusIcon = isComp
                ? '<span class="cr-todo-status completed">' + I.check + '</span>'
                : '<span class="cr-todo-status pending"><span class="cr-todo-circle"></span></span>';
              return (
                '<div class="cr-todo-item">' +
                  statusIcon +
                  '<span class="cr-todo-text">' + esc(s.description) + '</span>' +
                '</div>'
              );
            }).join('') +
          '</div>';

        var header = todosPanel.querySelector('.cr-todos-header');
        header.onclick = function() {
          var collapsed = todosPanel.dataset.collapsed === 'true';
          todosPanel.dataset.collapsed = !collapsed;
          renderTodos(plan);
        };
      }

      function updateAgentControlsPanel() {
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
            allowAllBtn.onclick = function() {
              var allowBtns = msgList.querySelectorAll('.cr-permission-actions button[data-action="allow"]');
              allowBtns.forEach(function(btn) { btn.click(); });
              updateAgentControlsPanel();
            };
          }

          var denyAllBtn = controlsPanel.querySelector('.cr-btn-quit-all');
          if (denyAllBtn) {
            denyAllBtn.onclick = function() {
              var denyBtns = msgList.querySelectorAll('.cr-permission-actions button[data-action="deny"]');
              denyBtns.forEach(function(btn) { btn.click(); });
              updateAgentControlsPanel();
            };
          }

          var acceptAllDiffsBtn = controlsPanel.querySelector('.cr-btn-accept-all-diffs');
          if (acceptAllDiffsBtn) {
            acceptAllDiffsBtn.onclick = function() {
              var acceptBtns = msgList.querySelectorAll('.cr-diff-card[data-diff-status="pending"] .cr-diff-accept');
              acceptBtns.forEach(function(btn) { btn.click(); });
              updateAgentControlsPanel();
            };
          }

          var rejectAllDiffsBtn = controlsPanel.querySelector('.cr-btn-reject-all-diffs');
          if (rejectAllDiffsBtn) {
            rejectAllDiffsBtn.onclick = function() {
              var rejectBtns = msgList.querySelectorAll('.cr-diff-card[data-diff-status="pending"] .cr-diff-reject');
              rejectBtns.forEach(function(btn) { btn.click(); });
              updateAgentControlsPanel();
            };
          }
        } else {
          controlsPanel.style.display = 'none';
        }
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

      function loadHistory(msgList, messages) {
        if (!msgList || !messages) return;
        msgList.innerHTML = '';

        var turns = [];
        var currentTurn = null;

        messages.forEach(function(m) {
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
        });
        if (currentTurn) {
          turns.push(currentTurn);
        }

        turns.forEach(function(turn) {
          if (turn.user) {
            appendUserBubble(msgList, turn.user.content, turn.user.image || (turn.user.images ? turn.user.images[0] : null));
          }

          if (turn.botMessages && turn.botMessages.length) {
            var body = appendBotWrapper(msgList);
            turn.botMessages.forEach(function(m, mIdx) {
              if (m.role === 'assistant') {
                var content = m.content || '';
                var thinking = m.thinking || null;
                var startIdx = content.indexOf('\uE000');
                var endIdx = content.indexOf('\uE001');
                if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                  thinking = content.substring(startIdx + 1, endIdx);
                  content = content.substring(0, startIdx) + content.substring(endIdx + 1);
                  content = content.replace(/^\n+/, '');
                }

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
                  m.tool_calls.forEach(function(tc, tcIdx) {
                    var toolName = (tc.function && tc.function.name) || tc.name || '';
                    var toolArgs = {};
                    var rawArgs = (tc.function && tc.function.arguments) || tc.arguments || {};
                    if (typeof rawArgs === 'string') {
                      try { toolArgs = JSON.parse(rawArgs); } catch(_) { toolArgs = { raw: rawArgs }; }
                    } else {
                      toolArgs = rawArgs;
                    }
                    var toolId = tc.id || '';

                    var matchingResultMsg = findMatchingToolResponse(turn.botMessages, toolId, mIdx, tcIdx);
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
                      var termCard = appendTerminalCard(body, cardKey, toolName, toolArgs, status, resultObj);
                      if (termCard) termCard.open = false;
                    } else {
                      appendToolCard(body, cardKey, toolName, toolArgs, status, resultObj);
                    }
                  });
                }
              }
            });
          }
        });

        scrollBottom(msgList);
      }

      if (conversation.plan) {
        renderTodos(conversation.plan);
      } else {
        if (todosPanel) todosPanel.style.display = 'none';
      }
      loadHistory(msgList, conversation.messages || []);

      input.addEventListener('input', function() {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 180) + 'px';
        if (charCount) charCount.textContent = input.value.length;
      });

      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
      });
      sendBtn.addEventListener('click', doSend);

      if (stopBtn) {
        stopBtn.addEventListener('click', function() {
          // Local abort (for direct fetch path)
          if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
          // Cooperative stop signal (for the VS Code path) — backend agent loop
          // checks this flag between iterations and halts gracefully.
          if (window.VSCODE_API) {
            try { window.VSCODE_API.postMessage({ type: 'stopChat' }); } catch (e) {}
          }
          setStreaming(false);
          if (window.stopGeneration) window.stopGeneration();
        });
      }

      window.stopCurrentChatStream = function() {
        if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
        if (window.VSCODE_API) {
          try { window.VSCODE_API.postMessage({ type: 'stopChat' }); } catch (e) {}
        }
        setStreaming(false);
        onStreamEnd();
      };

      input.addEventListener('paste', function(e) {
        var items = (e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData)) ? (e.clipboardData || e.originalEvent.clipboardData).items : null;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
          if (items[i].type && items[i].type.indexOf('image') !== -1) {
            e.preventDefault();
            var blob = items[i].getAsFile();
            if (!blob) continue;
            var reader = new FileReader();
            reader.onload = function(ev) {
              pendingImage = ev.target.result.replace(/^data:[^;]+;base64,/, '');
              if (previewImg) previewImg.src = ev.target.result;
              if (previewBox) previewBox.style.display = 'flex';
            };
            reader.readAsDataURL(blob);
            break;
          }
        }
      });

      attachBtn.addEventListener('click', function() { fileInput.click(); });
      fileInput.addEventListener('change', function() {
        var f = fileInput.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
          pendingImage = ev.target.result.replace(/^data:[^;]+;base64,/, '');
          if (previewImg) previewImg.src = ev.target.result;
          if (previewBox) previewBox.style.display = 'flex';
        };
        reader.readAsDataURL(f);
        fileInput.value = '';
      });
      if (clearImg) {
        clearImg.addEventListener('click', function() {
          pendingImage = null;
          if (previewBox) previewBox.style.display = 'none';
        });
      }

      function doSend() {
        try {
          var text = input.value.trim();
          if ((!text && !pendingImage) || S.isStreaming) return;

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

          var imgB64 = pendingImage;
          pendingImage = null;
          if (previewBox) previewBox.style.display = 'none';
          input.value = '';
          input.style.height = 'auto';
          if (charCount) charCount.textContent = '0';
          // Terminal is rendered inline — no fixed panel to clear

          if (!conversation.messages) conversation.messages = [];
          if (window.saveConversationMessage) {
            window.saveConversationMessage(convId, 'user', text, { image: imgB64 });
          } else {
            conversation.messages.push({ role: 'user', content: text, image: imgB64, timestamp: Date.now() });
          }

          appendUserBubble(msgList, text, imgB64);
          scrollBottom(msgList);

          clearStreamTurn();
          S.fullResponse = '';
          S.botBody = appendBotWrapper(msgList);
          appendTyping(S.botBody);
          setStreaming(true);
          scrollBottom(msgList);

          var history = conversation.messages.slice(0, -1).map(function(m) {
            var h = { role: m.role, content: m.content || '' };
            if (m.thinking) h.thinking = m.thinking;
            if (m.tool_calls) h.tool_calls = m.tool_calls;
            if (m.tool_call_id) h.tool_call_id = m.tool_call_id;
            if (m.images) h.images = m.images;
            if (m.image && !h.images) h.images = [m.image];
            return h;
          });

          if (window.VSCODE && window.VSCODE_API) {
            onStreamStart();
            window.activeChatStreamCallback = function(ev) {
              if (ev && ev.message && ev.message.content) {
                console.log('[CHATSPACE] Received content event:', ev.message.content.substring(0, 100));
              }
              if (ev.type === 'stream_end') {
                finishStream(S);
                setStreaming(false);
                onStreamEnd();
                saveBotResponse(S);
                // Render action bar for checkpoints at stream end
                if (S._currentCheckpoints && S._currentCheckpoints.length) {
                  var lastRow = msgList.querySelector('.cr-row--bot:last-child');
                  var lastBody = lastRow ? lastRow.querySelector('.cr-bot-body') : null;
                  if (lastBody) {
                    appendActionsBar(lastBody, S._currentCheckpoints);
                  }
                }
                scrollBottomSmooth(msgList);
                window.activeChatStreamCallback = null;
                return;
              }
              if (ev.type === 'stream_error') {
                handleStreamError(ev.error);
                onStreamError(ev.error);
                window.activeChatStreamCallback = null;
                return;
              }
              handleEvent(ev, S);
              scrollBottomSmooth(msgList);
            };

            window.VSCODE_API.postMessage({
              type: "startChat",
              message: text,
              image: imgB64,
              model: currentModel,
              provider: currentProvider,
              history: history,
              workspaceFolder: currentWorkspace
            });
            return;
          }

          onStreamStart();
          abortCtrl = new AbortController();

          var body = {
            message: text,
            model: currentModel,
            session_id: convId,
            workspaceFolder: currentWorkspace,
            workspace_folder: currentWorkspace,
            history: history
          };
          if (imgB64) body.images = [imgB64];

          fetch(currentBaseUrl + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/x-ndjson' },
            body: JSON.stringify(body),
            signal: abortCtrl.signal
          })
          .then(function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + res.statusText);
            var reader = res.body.getReader();
            var dec = new TextDecoder('utf-8');
            var buf = '';

            function pump() {
              return reader.read().then(function(c) {
                if (c.done) {
                  if (buf.trim()) {
                    try { handleEvent(JSON.parse(buf.trim()), S); } catch(e) {}
                  }
                  finishStream(S);
                  setStreaming(false);
                  onStreamEnd();
                  saveBotResponse(S);
                  scrollBottomSmooth(msgList);
                  return;
                }
                buf += dec.decode(c.value, { stream: true });
                var lines = buf.split('\n');
                buf = lines.pop();
                lines.forEach(function(line) {
                  line = line.trim();
                  if (!line) return;
                  try {
                    var ev = JSON.parse(line);
                    handleEvent(ev, S);
                    scrollBottomSmooth(msgList);
                  } catch(e) {}
                });
                return pump();
              }).catch(function(e) {
                if (e.name !== 'AbortError') {
                  handleStreamError(e);
                  onStreamError(e);
                }
              });
            }
            return pump();
          })
          .catch(function(e) {
            if (e.name !== 'AbortError') {
              handleStreamError(e);
              onStreamError(e);
            }
          });
        } catch (e) {
          console.error("[CHATSPACE] Error in doSend:", e);
        }
      }

      function handleStreamError(err) {
        removeTyping(S.botBody);
        var e = mk('div', 'cr-error-line');
        e.innerHTML = I.err + ' Error: ' + esc(err && err.message || String(err));
        if (S.botBody) S.botBody.appendChild(e);
        setStreaming(false);
        scrollBottom(msgList);
      }

      function saveBotResponse(S) {
        // In the VS Code environment, the agent loop's chat_history_update event
        // already handles detailed chronological saving of sequential assistant
        // and tool messages. Overwriting the last message here would flatten the turn,
        // corrupting the display order of tools and final responses upon reload.
        if (window.VSCODE_API) {
          return;
        }

        if (S.fullResponse || S.fullThinking || (S._toolCalls && S._toolCalls.length)) {
          var extra = {};
          if (S.sources && S.sources.length) extra.sources = S.sources;
          if (S.fullThinking) extra.thinking = S.fullThinking;
          if (S._toolCalls && S._toolCalls.length) extra.tool_calls = S._toolCalls;
          // Prevent duplicate: if the last saved message is already the same assistant content, skip
          var lastMsg = conversation.messages[conversation.messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content === (S.fullResponse || '')) {
            // Already persisted by chat_history_update — just update missing fields
            if (S.fullThinking && !lastMsg.thinking) lastMsg.thinking = S.fullThinking;
            if (S._toolCalls && S._toolCalls.length && !lastMsg.tool_calls) lastMsg.tool_calls = S._toolCalls;
            return;
          }
          if (window.saveConversationMessage) {
            window.saveConversationMessage(convId, 'assistant', S.fullResponse || '', extra);
          } else {
            conversation.messages.push({
              role: 'assistant',
              content: S.fullResponse || '',
              thinking: S.fullThinking,
              tool_calls: S._toolCalls,
              timestamp: Date.now()
            });
          }
        }
      }

      function setStreaming(on) {
        S.isStreaming = on;
        sendBtn.disabled = on;
        input.disabled = on;
        sendBtn.classList.toggle('cr-send-btn--busy', on);
        if (stopBtn) stopBtn.style.display = on ? 'flex' : 'none';
        if (sendBtn) sendBtn.style.display = on ? 'none' : 'flex';
      }

      // ═══════════════════════════════════════════════════
      // EVENT HANDLER — handles ALL event types
      // ═══════════════════════════════════════════════════
      function handleEvent(ev, S) {
        if (!ev) return;
        console.log('[CHATSPACE] CHAT EVENT =', JSON.stringify(ev).substring(0, 500));

        // LLM streaming messages come as { message: { role: 'assistant', content: '...' } }
        // Tool events have { message: 'Writing file: ...' } which is a string.
        // Only enter this branch when message is an OBJECT (LLM response).
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
            // Accumulate finalized tool_calls for conversation persistence
            msg.tool_calls.forEach(function(tc) {
              // Only store complete tool calls with a function name
              var fnName = (tc.function && tc.function.name) || tc.name || '';
              var fnArgs = (tc.function && tc.function.arguments) || tc.arguments || {};
              if (fnName) {
                var existing = S._toolCalls.find(function(e) { return e.index === tc.index || e.id === tc.id; });
                if (!existing) {
                  S._toolCalls.push({
                    index: tc.index,
                    id: tc.id || fnName + '_' + Date.now(),
                    type: tc.type || 'function',
                    function: { name: fnName, arguments: typeof fnArgs === 'string' ? fnArgs : JSON.stringify(fnArgs) }
                  });
                }
              }
            });
            msg.tool_calls.forEach(function(tc) {
              var toolName = (tc.function && tc.function.name) || tc.name || '';
              if (!toolName) return;
              // Terminal tools are handled by the terminal event system with custom cards
              if (toolName === 'terminal_input' || toolName === 'stop_terminal') return;
              if (toolName === 'run_terminal') {
                var toolArgs = (tc.function && tc.function.arguments) || tc.arguments || {};
                var toolId = tc.id || '';
                var toolIndex = tc.index;
                reuseOrCreateTerminalCard(S, toolName, toolArgs, toolId, toolIndex);
                return;
              }
              var toolArgs = (tc.function && tc.function.arguments) || tc.arguments || {};
              var toolId = tc.id || '';
              var toolIndex = tc.index;
              reuseOrCreateToolCard(S, toolName, toolArgs, toolId, toolIndex);
            });
          }
          return;
        }

        if (ev.type) {
          switch (ev.type) {
            case 'plan_created':
            case 'plan_updated': {
              if (ev.plan) {
                conversation.plan = ev.plan;
                renderTodos(ev.plan);
              }
              break;
            }
            case 'chat_history_update': {
              if (ev.messages && ev.messages.length) {
                if (window.saveConversationMessageBatch) {
                  window.saveConversationMessageBatch(convId, ev.messages, ev.plan);
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
                appendPermissionRequestBlock(S.botBody, ev.tool, ev.arguments, ev.id);
                updateAgentControlsPanel();
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
              // For run_terminal, actions update the terminal card status
              if (action === 'run_terminal') {
                var termCard = getLastPendingCard(S);
                if (termCard) {
                  var statusEl = termCard.querySelector('.cr-tool-card-status');
                  if (statusEl) statusEl.textContent = 'Running…';
                  // Link card so tool_result can find it
                  if (ev.toolCallId) S.toolCards[ev.toolCallId] = termCard;
                }
                break;
              }
              var actionMsg = ev.message || '';
              // Try to find the exact card using toolCallId
              var pendingCard = null;
              if (ev.toolCallId && S.toolCards[ev.toolCallId]) {
                pendingCard = S.toolCards[ev.toolCallId];
              }
              if (!pendingCard) {
                pendingCard = findPendingCardByToolName(S, action, ev.toolCallId) || findPendingCardByToolName(S, action);
                if (!pendingCard) {
                  pendingCard = getLastPendingCard(S);
                }
                // If found by fallback, link it by toolCallId so the
                // subsequent tool_result can find it directly.
                if (pendingCard && ev.toolCallId) {
                  S.toolCards[ev.toolCallId] = pendingCard;
                }
              }
              if (!pendingCard) {
                // No card yet — create one from the action itself
                var actionKey = action + '_action_' + (++S._toolIdCounter);
                S.toolCards[actionKey] = appendToolCard(S.botBody, actionKey, action, {}, 'running');
                S._toolQueue.push({ key: actionKey, toolName: action, id: actionKey });
                var createdCard = S.toolCards[actionKey];
                if (createdCard) {
                  appendToolAction(createdCard, action, actionMsg, 'started');
                  // Link by toolCallId too
                  if (ev.toolCallId) S.toolCards[ev.toolCallId] = createdCard;
                }
              } else {
                appendToolAction(pendingCard, action, actionMsg, 'started');
              }
              break;
            }
            case 'tool_result': {
              removeTyping(S.botBody);
              var resTool = ev.tool;
              if (resTool === 'terminal_input' || resTool === 'stop_terminal') break;
              var resSuccess = ev.success !== false;
              var resStatus = resSuccess ? 'success' : 'error';
              
              // For terminal tools: the card is already finalized by terminal_exit.
              // tool_result should only fill in any missing output data without
              // changing the canonical status set by terminal_exit/terminal_error.
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
                  // Only fill data — don't change status (already set by terminal_exit)
                  updateTerminalCardResult(termCardToUpdate, resStatus, ev);
                }
                break;
              }
              
              var cardToUpdate = null;
              // Pass 1: try exact toolCallId key
              if (ev.toolCallId && S.toolCards[ev.toolCallId]) {
                cardToUpdate = S.toolCards[ev.toolCallId];
              }
              // Pass 1.5: try matching a pending card of the same tool name
              if (!cardToUpdate) {
                cardToUpdate = findPendingCardByToolName(S, resTool, ev.toolCallId) || findPendingCardByToolName(S, resTool);
                if (cardToUpdate && ev.toolCallId) {
                  S.toolCards[ev.toolCallId] = cardToUpdate;
                }
              }
              // Pass 2: try toolName-based index key (handles providers that
              // don't send tool call IDs — Ollama, etc.)
              if (!cardToUpdate && ev.toolCallId) {
                var idxKey = resTool + '_toolCall_' + ev.toolCallId;
                if (S.toolCards[idxKey]) {
                  cardToUpdate = S.toolCards[idxKey];
                }
              }
              
              var updated = false;
              if (cardToUpdate) {
                updateToolCard(cardToUpdate, resStatus, ev);
                cardToUpdate.dataset.status = resStatus;
                updated = true;
              } else {
                // Pass 3: DOM fallback — search BACKWARDS for the
                // LAST (most recently created) card with this toolName.
                var domCards = S.botBody ? S.botBody.querySelectorAll('.cr-tool-card') : [];
                for (var di = domCards.length - 1; di >= 0; di--) {
                  var dc = domCards[di];
                  if (dc && dc.dataset && dc.dataset.toolName === resTool) {
                    updateToolCard(dc, resStatus, ev);
                    dc.dataset.status = resStatus;
                    updated = true;
                    break;
                  }
                }
              }
              if (!updated) {
                var fallbackKey = 'tr_' + Date.now();
                appendToolCard(S.botBody, fallbackKey, resTool, {}, resStatus, ev);
              }
              break;
            }
            case 'agent_status': {
              removeTyping(S.botBody);
              var statusMsg = ev.status === 'executing_tools' ? 'Executing ' + ev.count + ' tool call(s)...' : ev.status || '';
              if (statusMsg) appendStatusLine(S.botBody, statusMsg);
              break;
            }
            case 'agent_iteration': {
              S.iterationCount = ev.iteration;
              S.thinkBlock = null; S.thinkPre = null; S.thinkText = ''; S.iterationThinking = '';
              S.contentDiv = null; S.contentText = '';
              clearStatusLines(S);
              // Reset tool tracking for new iteration
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
              // Render action bar for checkpoints
              if (S._currentCheckpoints && S._currentCheckpoints.length) {
                appendActionsBar(S.botBody, S._currentCheckpoints);
              }
              if (ev.reason === 'max_iterations') {
                appendContinueButton(S.botBody);
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
              appendStatusLine(S.botBody, ev.message);
              break;
            }
            case 'keepalive': {
              break;
            }
            // ════════════════════════════════════════════
            // CHECKPOINT events — track undo-able actions
            // ════════════════════════════════════════════
            case 'checkpoints_created': {
              if (ev.checkpoints && ev.checkpoints.length) {
                for (var cpi = 0; cpi < ev.checkpoints.length; cpi++) {
                  var cp = ev.checkpoints[cpi];
                  // Avoid duplicates
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
            // ════════════════════════════════════════════
            // DIFF REVIEW: Inline diff card
            // ════════════════════════════════════════════
            case 'request_diff': {
              removeTyping(S.botBody);
              appendDiffCard(S.botBody, ev);
              break;
            }
            // ════════════════════════════════════════════
            // Terminal streaming events — rendered as inline cards
            // ════════════════════════════════════════════
            case 'terminal_start': {
              removeTyping(S.botBody);
              var termId = ev.terminalId || 'term_' + Date.now();
              S._activeTerminalId = termId;

              // Find the existing card created by tool_calls/tool_call streaming.
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
                termCard = appendTerminalCard(S.botBody, emergencyKey, 'run_terminal',
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
              // Auto-collapse previous terminal cards
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
              // Update tool card
              if (termId && S._terminalCards[termId]) {
                appendTerminalCardOutput(S._terminalCards[termId], cleanChunk);
              }
              break;
            }
            case 'terminal_exit': {
              var termId = ev.terminalId;
              var exitCode = ev.exitCode;
              var duration = ev.duration;
              // Determine canonical status using the single source of truth
              var execStatus = determineExecStatus(exitCode, duration, ev);
              // Update tool card — only setTerminalCardStatus changes status
              if (termId && S._terminalCards[termId]) {
                setTerminalCardStatus(S._terminalCards[termId], execStatus, exitCode, duration, ev);
                // Collapse completed terminal cards (but not waiting-for-input ones)
                if (execStatus !== 'waiting') {
                  S._terminalCards[termId].open = false;
                }
              }
              S._activeTerminalId = null;
              break;
            }
            case 'terminal_error': {
              var termId = ev.terminalId;
              var errMsg = ev.message || 'Unknown error';
              var execStatus = 'error';
              // Update tool card if available
              if (termId && S._terminalCards[termId]) {
                setTerminalCardStatus(S._terminalCards[termId], execStatus, -1, null, { message: errMsg });
              } else {
                // Fallback: find any pending terminal card
                var pendingTermCard = getLastPendingCard(S);
                if (pendingTermCard && pendingTermCard.dataset.toolName === 'run_terminal') {
                  setTerminalCardStatus(pendingTermCard, execStatus, -1, null, { message: errMsg });
                }
              }
              break;
            }
            case 'terminal_line': {
              // Legacy terminal line event
              if (window.appendTerminalLine) {
                window.appendTerminalLine(ev.message, ev.outputType);
              }
              break;
            }
          }
        }
      }

      function finishStream(S) {
        flushContentRender(S);
        removeTyping(S.botBody);
        S.thinkBlock = null; S.thinkPre = null;
      }

      // ═══════════════════════════════════════════════════
      // UI BUILDERS
      // ═══════════════════════════════════════════════════

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

      function appendStatusLine(body, message) {
        if (!body) return null;
        var d = mk('div', 'cr-status-line');
        d.innerHTML = '<span class="cr-status-bullet">·</span> <span class="cr-status-text">' + esc(message) + '</span>';
        body.appendChild(d);
        if (S.statusLines) S.statusLines.push(d);
        return d;
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

      function appendPermissionRequestBlock(body, tool, args, id) {
        if (!body) return null;
        var argsStr = '';
        try { argsStr = JSON.stringify(args, null, 2); } catch (_) { argsStr = String(args || ''); }

        // Try to find the last pending tool card of the same name to embed inside it
        var pendingCard = findPendingCardByToolName(S, tool, id);

        // If not found, pre-emptively create it so we can embed the permission request inside it!
        if (!pendingCard) {
          var cardKey = tool + '_' + (++S._toolIdCounter) + '_' + Date.now();
          if (tool === 'run_terminal') {
            pendingCard = appendTerminalCard(S.botBody, cardKey, tool, args, 'pending', null);
            pendingCard.dataset.toolCallId = id;
            pendingCard.dataset.terminalId = '';
            S.toolCards[cardKey] = pendingCard;
            S.toolCards[id] = pendingCard;
            S._toolQueue.push({ key: cardKey, toolName: tool, id: id });
          } else {
            pendingCard = appendToolCard(S.botBody, cardKey, tool, args, 'running', null);
            pendingCard.dataset.toolCallId = id;
            S.toolCallBlocks[id || cardKey] = pendingCard;
            S.toolCards[cardKey] = pendingCard;
            S.toolCards[id] = pendingCard;
            S.toolCards[tool + '_idx_' + S._toolIdCounter] = pendingCard;
            S._toolQueue.push({ key: cardKey, toolName: tool, id: id });
          }
        } else {
          // If found, update its ID tracking so that subsequent action/result events find it
          if (id) {
            pendingCard.dataset.toolCallId = id;
            S.toolCards[id] = pendingCard;
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
            pendingCard.open = true; // Always expand the card to show the permission request!
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
        var actions = d.querySelector('#actions-' + id);
        actions.addEventListener('click', function(e) {
          var btn = e.target.closest('[data-action]');
          if (!btn) return;
          var act = btn.dataset.action;
          var isAllow = act === 'allow' || act === 'always-allow';
          var isAlways = act === 'always-allow' || act === 'always-deny';
          var label = isAlways
            ? (isAllow ? '✓ Always Allowed' : '✗ Always Denied')
            : (isAllow ? '✓ Allowed' : '✗ Denied');
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
          if (typeof updateAgentControlsPanel === 'function') {
            setTimeout(updateAgentControlsPanel, 50);
          }
        });
        scrollBottom(msgList);
        return d;
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
        else if (ev.entries) text = ev.entries.map(function(e) { return '- [' + e.type.toUpperCase() + '] ' + e.name; }).join('\n');
        else if (ev.matches) text = ev.matches.map(function(m) { return '- ' + m; }).join('\n');
        else if (ev.info) { try { text = JSON.stringify(ev.info, null, 2); } catch(_) { text = String(ev.info); } }
        else if (ev.datetime) text = 'Datetime: ' + ev.datetime;
        else { try { text = JSON.stringify(ev, null, 2); } catch(_) { text = String(ev); } }
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

      function appendSources(body, sources) {
        if (!body || !sources || !sources.length) return;
        var d = mk('div', 'cr-sources');
        var lbl = mk('span', 'cr-sources-lbl');
        lbl.textContent = 'Sources: ';
        d.appendChild(lbl);
        sources.forEach(function(src) {
          var a = mk('a', 'cr-source-chip');
          a.innerHTML = I.src + ' <span>' + esc(src) + '</span>';
          a.title = 'Open ' + src;
          a.addEventListener('click', function(e) {
            e.preventDefault();
            if (window.VSCODE_API) {
              window.VSCODE_API.postMessage({ type: 'openFile', path: src });
            }
          });
          d.appendChild(a);
        });
        body.appendChild(d);
        return d;
      }

      /**
       * Create a collapsible terminal card for a terminal execution.
       * Each terminal execution gets its own independent card in the chat.
       */
      function appendTerminalCard(body, cardKey, toolName, args, status, result) {
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

        // Terminal Container (the box)
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

        // Track in terminal card state
        var termId = card.dataset.terminalId || 'card_' + Date.now();
        S._terminalCards[termId] = card;
        S.toolCards[cardKey] = card;
        if (S._terminalCardOrder.indexOf(termId) === -1) {
          S._terminalCardOrder.push(termId);
        }

        scrollBottom(msgList);
        return card;
      }

      /**
       * Append a streamed output chunk to a terminal card.
       * Output is appended incrementally (not replaced).
       */
      function appendTerminalCardOutput(card, cleanChunk) {
        if (!card) return;
        var bodyEl = card.querySelector('.cr-terminal-body');
        if (!bodyEl) return;

        // Split chunk into lines and append each as a separate div
        var lines = cleanChunk.split('\n');
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li];
          // Skip empty lines at the end (partial line from streaming)
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

      /**
       * Sole source of truth for terminal card status.
       * Updates ALL visual elements from one canonical `execStatus`:
       *   'pending'    — Awaiting user approval
       *   'running'    — Command is executing
       *   'success'    — Command completed successfully
       *   'error'      — Command failed
       *   'timeout'    — Command timed out
       *   'cancelled'  — Command was cancelled
       */
      function setTerminalCardStatus(card, execStatus, exitCode, duration, extra) {
        if (!card) return;
        card.dataset.status = execStatus;
        
        var container = card.querySelector('.cr-terminal-container');
        if (container) {
          container.className = 'cr-terminal-container cr-terminal-container--' + execStatus;
        }

        // Collapse card if finished successfully, but keep open for errors or waiting
        if (execStatus !== 'running' && execStatus !== 'waiting' && execStatus !== 'pending') {
          if (execStatus === 'success') {
            card.open = false;
          } else {
            card.open = true;
          }
        }
      }

      /**
       * Determine canonical execution status from terminal exit info.
       */
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

      /**
       * Fill a terminal card with output data (stdout, stderr, shell).
       * Only fills content if the body is empty (i.e., no streaming output
       * was captured via terminal_output events). If the body already has
       * content from live streaming, we do NOT clear it — that would
       * duplicate the output.
       */
      function updateTerminalCardResult(card, status, result) {
        if (!card) return;
        var bodyEl = card.querySelector('.cr-terminal-body');
        if (!bodyEl) return;

        // If the body already has content from terminal_output streaming,
        // do NOT clear and repopulate — that would duplicate output.
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



      // ── No legacy terminal functions — all terminal output
      //    is rendered via inline tool cards only ─────────

      // ═══════════════════════════════════════════════════
      // Actions Bar — rendered below assistant responses
      // Shows Undo for files that were modified by tools
      // ═══════════════════════════════════════════════════

      function appendActionsBar(body, checkpoints) {
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

          undoBtn.addEventListener('click', function() {
            var btn = this;
            btn.disabled = true;
            btn.innerHTML = '↩ Undoing...';
            if (window.VSCODE_API) {
              window.VSCODE_API.postMessage({
                type: 'undoCheckpoint',
                filePath: btn.dataset.filePath,
                checkpointId: btn.dataset.cpId
              });
            }
          });

          bar.appendChild(undoBtn);
        }
        body.appendChild(bar);
      }

      // Expose globally so the window message handler can update after undo
      window.updateActionsBarStatus = function(filePath, statusText) {
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
      };

      // ═══════════════════════════════════════════════════
      // Inline Diff Card (replaces temporary vscode.diff)
      // ═══════════════════════════════════════════════════

      function appendDiffCard(body, ev) {
        if (!body) return;
        var diffId = ev.id || 'diff_' + Date.now();
        var filePath = ev.file_path || 'unknown';
        var isNew = ev.is_new_file || false;
        var originalText = ev.original_content || '';
        var modifiedText = ev.new_content || '';
        var toolName = ev.tool || 'edit';
        var additions = 0;
        var deletions = 0;

        // Compute line diff
        var origLines = originalText.split('\n');
        var modLines = modifiedText.split('\n');
        var maxLen = Math.max(origLines.length, modLines.length);
        var diffLines = [];
        for (var di = 0; di < maxLen; di++) {
          var ol = origLines[di] || '';
          var ml = modLines[di] || '';
          if (ol === ml) {
            diffLines.push({ type: 'context', oldLine: di + 1, newLine: di + 1, text: ol });
          } else if (!ol && ml) {
            additions++;
            diffLines.push({ type: 'add', oldLine: null, newLine: di + 1, text: ml });
          } else if (ol && !ml) {
            deletions++;
            diffLines.push({ type: 'del', oldLine: di + 1, newLine: null, text: ol });
          } else {
            additions++;
            deletions++;
            diffLines.push({ type: 'del', oldLine: di + 1, newLine: null, text: ol });
            diffLines.push({ type: 'add', oldLine: null, newLine: di + 1, text: ml });
          }
        }

        var card = mk('div', 'cr-diff-card');
        card.dataset.diffId = diffId;
        card.dataset.diffStatus = 'pending';

        // Header
        var header = mk('div', 'cr-diff-header');
        var icon = isNew ? '📝' : '✏️';
        header.innerHTML =
          '<span class="cr-diff-header-icon">' + icon + '</span>' +
          '<span class="cr-diff-header-file">' + esc(filePath) + '</span>' +
          '<span class="cr-diff-header-stats">' +
            '<span class="cr-diff-add">+' + additions + '</span> ' +
            '<span class="cr-diff-del">-' + deletions + '</span>' +
          '</span>';
        card.appendChild(header);

        // Diff body (collapsible)
        var details = mk('details', 'cr-diff-details');
        details.open = true;
        var summary = mk('summary', 'cr-diff-summary');
        summary.textContent = 'View Changes';
        details.appendChild(summary);

        var diffBody = mk('div', 'cr-diff-body');
        diffBody.style.overflowX = 'auto';
        diffBody.style.maxHeight = '400px';
        diffBody.style.overflowY = 'auto';

        // Build unified diff lines
        var maxLineNum = Math.max(origLines.length, modLines.length);
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

        // Actions
        var actions = mk('div', 'cr-diff-actions');
        actions.innerHTML =
          '<button class="cr-btn cr-btn-allow cr-diff-accept" data-diff-id="' + esc(diffId) + '">Accept</button>' +
          '<button class="cr-btn cr-btn-deny cr-diff-reject" data-diff-id="' + esc(diffId) + '">Reject</button>' +
          '<button class="cr-diff-full-btn" data-diff-id="' + esc(diffId) + '" title="Open in VS Code diff editor">Open Full Diff</button>' +
          '<span class="cr-diff-status" style="display:none"></span>';
        card.appendChild(actions);

        // Bind accept/reject
        actions.querySelector('.cr-diff-accept').onclick = function() {
          if (!window.VSCODE_API) return;
          window.VSCODE_API.postMessage({ type: 'acceptDiff', diffId: diffId });
          setDiffCardStatus(card, 'accepted');
          updateAgentControlsPanel();
        };
        actions.querySelector('.cr-diff-reject').onclick = function() {
          if (!window.VSCODE_API) return;
          window.VSCODE_API.postMessage({ type: 'rejectDiff', diffId: diffId });
          setDiffCardStatus(card, 'rejected');
          updateAgentControlsPanel();
        };
        actions.querySelector('.cr-diff-full-btn').onclick = function() {
          if (!window.VSCODE_API) return;
          window.VSCODE_API.postMessage({ type: 'openDiffEditor', diffId: diffId });
        };

        var targetParent = body;
        var pendingCard = null;
        if (ev.toolCallId && S.toolCards[ev.toolCallId]) {
          pendingCard = S.toolCards[ev.toolCallId];
        }
        if (!pendingCard) {
          pendingCard = findPendingCardByToolName(S, toolName) || getLastPendingCard(S);
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
        scrollBottom(msgList);
        updateAgentControlsPanel();
      }

      function appendContinueButton(parent) {
        if (!parent) return;
        var btnContainer = mk('div', 'cr-continue-container');
        btnContainer.style.padding = '8px 12px';
        btnContainer.style.display = 'flex';
        btnContainer.style.gap = '8px';
        btnContainer.style.justifyContent = 'flex-start';

        var btnContinue = mk('button', 'cr-btn cr-btn-continue-all');
        btnContinue.textContent = 'Continue';
        btnContinue.addEventListener('click', function() {
          btnContainer.remove();
          input.value = "Continue building the project from where you left off";
          doSend();
        });

        var btnQuit = mk('button', 'cr-btn cr-btn-quit-all');
        btnQuit.textContent = 'Quit';
        btnQuit.addEventListener('click', function() {
          btnContainer.remove();
          setStreaming(false);
        });

        btnContainer.appendChild(btnContinue);
        btnContainer.appendChild(btnQuit);
        parent.appendChild(btnContainer);
        scrollBottom(msgList);
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

      // Expose globally so the window message handler can update diff cards
      window.setDiffCardStatus = setDiffCardStatus;

      function padNum(n, width) {
        var s = String(n);
        while (s.length < width) s = ' ' + s;
        return s;
      }

      // ═══════════════════════════════════════════════════
      // Tool Card Helpers
      // ═══════════════════════════════════════════════════

      /**
       * Get the most recent pending tool card from the queue.
       */
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

      /**
       * Find ANY pending card (not yet finalized) by tool name across all cards.
       * Used to prevent duplicate cards when the same tool call arrives via
       * both streaming ev.message.tool_calls and a direct ev.type === 'tool_call'.
       */
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

        var cardElement = appendTerminalCard(S.botBody, cardKey, toolName, toolArgs, 'pending', null);
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
        var cardElement = appendToolCard(S.botBody, cardKey, toolName, toolArgs, 'running');
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

      /**
       * Find ANY card (even finalized) by tool name.
       * Last resort fallback for tool_result matching.
       */
      function findAnyCardByToolName(S, toolName) {
        for (var cardKey in S.toolCards) {
          var card = S.toolCards[cardKey];
          if (card && card.dataset && card.dataset.toolName === toolName) {
            return card;
          }
        }
        return null;
      }

      /**
       * Find the last pending card for a given tool name and finalize it.
       * First searches the ordered queue, then falls back to scanning all
       * tool cards by dataset.toolName (in case the queue entry was lost).
       */
      function findAndFinalizeCard(S, toolName, status, result) {
        // Pass 1: search the ordered queue (backwards — most recent first)
        for (var i = S._toolQueue.length - 1; i >= 0; i--) {
          var entry = S._toolQueue[i];
          if (entry.toolName === toolName) {
            var card = S.toolCards[entry.key];
            if (card) {
              updateToolCard(card, status, result);
              return card;
            }
          }
        }
        // Pass 2: fallback — scan ALL tool cards by dataset attribute
        for (var cardKey in S.toolCards) {
          var aCard = S.toolCards[cardKey];
          if (aCard && aCard.dataset && aCard.dataset.toolName === toolName &&
              aCard.dataset.status !== 'success' && aCard.dataset.status !== 'error') {
            updateToolCard(aCard, status, result);
            return aCard;
          }
        }
        return null;
      }

      /**
       * Calculate file diff stats for write_file and edit_file results.
       * Returns { added, removed, isNewFile, summary } or null.
       */
      function calculateDiffStats(toolName, args, result) {
        if (toolName === 'write_file') {
          var content = (args && args.content) || '';
          var lines = content.split('\n').filter(function(l) { return l.length > 0; });
          var lineCount = content.split('\n').length;
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
          var oldLines = oldStr.split('\n').filter(function(l) { return l.length > 0; });
          var newLines = newStr.split('\n').filter(function(l) { return l.length > 0; });
          return {
            added: newLines.length,
            removed: oldLines.length,
            isNewFile: false,
            summary: '+' + newLines.length + ' -' + oldLines.length
          };
        }
        return null;
      }

      /**
       * Format a tool result into a readable text string.
       */
      function formatToolResultText(toolName, result) {
        if (!result) return '';
        // Structured terminal result
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
        else if (result.entries) text = result.entries.map(function(e) { return '- [' + e.type.toUpperCase() + '] ' + e.name; }).join('\n');
        else if (result.matches) text = result.matches.map(function(m) { return '- ' + m; }).join('\n');
        else if (result.info) { try { text = JSON.stringify(result.info, null, 2); } catch(_) { text = String(result.info); } }
        else if (result.datetime) text = 'Datetime: ' + result.datetime;
        else if (result.command) text = 'Command: ' + result.command + '\nExit code: ' + (result.exit_code != null ? result.exit_code : '?') + '\n\n' + (result.output || '');
        else { try { text = JSON.stringify(result, null, 2); } catch(_) { text = String(result); } }
        return text;
      }

      // ═══════════════════════════════════════════════════
      // NEW: Collapsible Copilot-style Tool Cards
      // ═══════════════════════════════════════════════════

      function appendToolCard(body, cardKey, toolName, args, status, result) {
        if (!body) return null;
        status = status || 'running';
        var card = mk('details', 'cr-tool-card cr-tool-card--' + status);
        card.open = (status !== 'success');
        card.dataset.cardKey = cardKey;
        card.dataset.toolName = toolName;
        card.dataset.status = status;

        var displayName = formatToolName(toolName);
        var iconHtml = getToolIcon(toolName);

        // Calculate diff stats if applicable
        var diffStats = calculateDiffStats(toolName, args, result);
        var statusLabel = status === 'running' ? 'Running…' : status === 'success' ? 'Completed' : 'Failed';
        if (status === 'success' && diffStats) {
          statusLabel = '+' + diffStats.added;
          if (diffStats.removed > 0) statusLabel += ' -' + diffStats.removed;
          statusLabel += ' lines';
        }

        // Build args summary (show first ~50 chars of file path or key args)
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
            } catch(_) { argsSummary = ''; }
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
          fileEl.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var fp = fileEl.dataset.filePath;
            if (fp && window.VSCODE_API) {
              window.VSCODE_API.postMessage({ type: 'openFile', path: fp });
            }
          });
        }

        // Body contains: args (collapsible) + actions (collapsible) + result
        var cardBody = mk('div', 'cr-tool-card-body');
        cardBody.style.display = 'block';

        // Arguments section (collapsible)
        var argsStr = '';
        try { argsStr = JSON.stringify(args, null, 2); } catch (_) { argsStr = String(args || ''); }
        if (argsStr && argsStr !== '{}') {
          var argsBlock = mk('details', 'cr-tool-card-args-block');
          argsBlock.open = false;
          argsBlock.innerHTML =
            '<summary class="cr-tool-card-args-summary">Arguments</summary>' +
            '<pre class="cr-tool-card-args-pre"><code>' + esc(argsStr) + '</code></pre>';
          cardBody.appendChild(argsBlock);
        }

        // Actions container (for live action updates within this card)
        var actionsContainer = mk('div', 'cr-tool-card-actions');
        actionsContainer.style.display = 'none';
        cardBody.appendChild(actionsContainer);

        // Result container
        var resultContainer = mk('div', 'cr-tool-card-result');
        resultContainer.style.display = 'none';
        if (result) {
          var resText = formatToolResultText(toolName, result);
          if (resText) {
            resultContainer.style.display = 'block';
            resultContainer.innerHTML = '<pre class="cr-tool-card-result-pre">' + esc(resText) + '</pre>';
          }
          // If result has an error, show it
          if (status === 'error') {
            resultContainer.style.display = 'block';
            resultContainer.innerHTML = '<div class="cr-tool-card-error-msg">' + I.err + ' ' + esc(result.message || result.error || 'Unknown error') + '</div>';
          }
        }
        cardBody.appendChild(resultContainer);

        card.appendChild(cardBody);
        body.appendChild(card);

        // Store reference
        S.toolCards[cardKey] = card;

        scrollBottom(msgList);
        return card;
      }

      function updateToolCard(card, status, result) {
        if (!card) return;
        var oldStatus = card.dataset.status;
        card.className = 'cr-tool-card cr-tool-card--' + status;
        card.dataset.status = status;
        card.open = (status !== 'success');

        var toolName = card.dataset.toolName;

        // Update icon
        var iconEl = card.querySelector('.cr-tool-card-icon');
        if (iconEl) {
          iconEl.className = 'cr-tool-card-icon cr-tool-card-icon--' + status;
          iconEl.innerHTML = status === 'success' ? I.check : status === 'error' ? I.err : I.spin;
        }

        // Update status label with diff stats
        var statusEl = card.querySelector('.cr-tool-card-status');
        if (statusEl) {
          statusEl.className = 'cr-tool-card-status cr-tool-card-status--' + status;
          if (status === 'success' && result) {
            var diffStats = calculateDiffStats(toolName, null, result);
            if (diffStats) {
              statusEl.textContent = '+' + diffStats.added + (diffStats.removed > 0 ? ' -' + diffStats.removed : '') + ' lines';
            } else {
              // Check if we can calculate from the card's args
              statusEl.textContent = 'Completed';
            }
          } else {
            statusEl.textContent = status === 'success' ? 'Completed' : status === 'error' ? 'Failed' : status;
          }
        }

        // Update body with result
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

            // Show diff if applicable
            if (toolName === 'write_file' || toolName === 'edit_file') {
              var argsBlock = cardBody.querySelector('.cr-tool-card-args-block');
              if (argsBlock) argsBlock.open = true;
            }
          }
        }

        scrollBottom(msgList);
      }

      /**
       * Append an action line inside a tool card (for live progress).
       * Shows things like "Reading file: src/foo.js" or "Running: npm install"
       */
      function appendToolAction(card, action, message, actionStatus) {
        if (!card) return;
        var cardBody = card.querySelector('.cr-tool-card-body');
        if (!cardBody) return;

        var actionsContainer = cardBody.querySelector('.cr-tool-card-actions');
        if (!actionsContainer) {
          actionsContainer = mk('div', 'cr-tool-card-actions');
          cardBody.insertBefore(actionsContainer, cardBody.querySelector('.cr-tool-card-result'));
        }
        actionsContainer.style.display = 'block';

        // Don't duplicate — if last action is same message, skip
        var lastAction = actionsContainer.lastChild;
        if (lastAction && lastAction.textContent === (actionStatus === 'started' ? '▶ ' : '✓ ') + (message || action)) {
          return;
        }

        var line = mk('div', 'cr-tool-card-action-line');
        var icon = actionStatus === 'started' ? '▶' : '✓';
        var color = actionStatus === 'started' ? '#d29922' : '#3fb950';
        line.innerHTML = '<span style="color:' + color + ';margin-right:6px;">' + icon + '</span>' + esc(message || action);
        actionsContainer.appendChild(line);
        scrollBottom(msgList);
      }

      // ── Legacy function kept for backward compatibility ──
      function appendToolCallBlock(body, tool, args, id) {
        if (!body) return;
        var d = mk('div', 'cr-tool-call');
        var argsStr = '';
        try { argsStr = JSON.stringify(args, null, 2); } catch (_) { argsStr = String(args || ''); }
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

    } catch (e) {
      console.error("[CHATSPACE] Error inside renderChatSpace:", e);
    }
  };

  window.addEventListener("message", function(event) {
    var message = event.data || {};
    if (message.type === "agentEvent" && window.activeChatStreamCallback) {
      window.activeChatStreamCallback(message.event);
      // Terminal events are rendered ONLY as inline tool cards inside
      // the assistant message. No forwarding to a separate terminal panel.
    }

    // Handle diff result responses
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

    // Handle undo checkpoint result
    if (message.type === 'undoCheckpointResult' && message.filePath) {
      if (window.updateActionsBarStatus) {
        window.updateActionsBarStatus(message.filePath, message.success ? 'Restored' : 'Failed');
      }
    }
  });

  if (typeof window.getDashboardActiveConversationId === "function") {
    var activeId = window.getDashboardActiveConversationId();
    if (activeId && typeof window.selectDashboardConversation === "function") {
      window.selectDashboardConversation(activeId);
    }
  }
}());
