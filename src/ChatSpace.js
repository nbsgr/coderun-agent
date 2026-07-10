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

  function scrollBottom(el) {
    if (el) el.scrollTop = el.scrollHeight;
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
        // NEW: Terminal streaming state
        terminalBlocks: {},
        toolCards: {},
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
        S.thinkBlock = null; S.thinkPre = null; S.thinkText = '';
        S.fullThinking = ''; S.iterationThinking = '';
        S.contentDiv = null; S.contentText = '';
        S.actionList = null; S.actionMap = {};
        S.sources = [];
        S.toolCallBlocks = {};
        S.iterationCount = 0;
        clearStatusLines(S);
        // NEW: Clear terminal and tool card state
        S.terminalBlocks = {};
        S.toolCards = {};
        S.timeline = null;
      }

      function loadHistory(msgList, messages) {
        if (!msgList || !messages) return;
        msgList.innerHTML = '';
        messages.forEach(function(m) {
          if (m.role === 'user') {
            appendUserBubble(msgList, m.content, m.image || (m.images ? m.images[0] : null));
          } else if (m.role === 'assistant') {
            var body = appendBotWrapper(msgList);
            if (m.thinking) {
              var det = appendThinkBlock(body);
              var pre = det.querySelector('.cr-think-pre');
              if (pre) pre.textContent = m.thinking;
              var lbl = det.querySelector('.cr-think-label');
              if (lbl) lbl.textContent = 'Thought process';
              det.open = false;
            }
            if (m.content) {
              var d = appendContentBlock(body);
              d.innerHTML = md(m.content);
            }
          }
        });
        scrollBottom(msgList);
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
          if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
          setStreaming(false);
          if (window.stopGeneration) window.stopGeneration();
        });
      }

      window.stopCurrentChatStream = function() {
        if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
        setStreaming(false);
        onStreamEnd();
      };

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
          if (!text || S.isStreaming) return;

          var currentModel = (window.getDashboardModel ? window.getDashboardModel() : '') || model;
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
          if (window.clearTerminal) window.clearTerminal();

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
              if (ev.type === 'stream_end') {
                finishStream(S);
                setStreaming(false);
                onStreamEnd();
                saveBotResponse(S);
                scrollBottom(msgList);
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
              scrollBottom(msgList);
            };

            window.VSCODE_API.postMessage({
              type: "startChat",
              message: text,
              model: currentModel,
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
                  scrollBottom(msgList);
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
                    scrollBottom(msgList);
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
        if (S.fullResponse || S.fullThinking) {
          var extra = {};
          if (S.sources && S.sources.length) extra.sources = S.sources;
          if (S.fullThinking) extra.thinking = S.fullThinking;
          if (window.saveConversationMessage) {
            window.saveConversationMessage(convId, 'assistant', S.fullResponse, extra);
          } else {
            conversation.messages.push({
              role: 'assistant',
              content: S.fullResponse,
              thinking: S.fullThinking,
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

        if (ev.message) {
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
            S.contentDiv.innerHTML = md(S.contentText);
          }
          if (msg.tool_calls && msg.tool_calls.length) {
            removeTyping(S.botBody);
            msg.tool_calls.forEach(function(tc) {
              var toolName = (tc.function && tc.function.name) || tc.name || '';
              var toolArgs = (tc.function && tc.function.arguments) || tc.arguments || {};
              var toolId = tc.id || 'tool_' + Date.now();
              if (!S.toolCallBlocks[toolId]) {
                S.toolCallBlocks[toolId] = appendToolCallBlock(S.botBody, toolName, toolArgs, toolId);
              }
            });
          }
          return;
        }

        if (ev.type) {
          switch (ev.type) {
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
                var fullThink = ev.full_thinking || ev.full_content || S.thinkText;
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
              S.contentDiv.innerHTML = md(S.contentText);
              break;
            }
            case 'tool_call': {
              removeTyping(S.botBody);
              var toolId = ev.id || 'tool_' + Date.now();
              S.toolCallBlocks[toolId] = appendToolCallBlock(S.botBody, ev.tool, ev.args, ev.id);
              S.thinkBlock = null; S.thinkPre = null; S.thinkText = '';
              break;
            }
            case 'requestPermission': {
              removeTyping(S.botBody);
              appendPermissionRequestBlock(S.botBody, ev.tool, ev.arguments, ev.id);
              break;
            }
            case 'action': {
              removeTyping(S.botBody);
              var action = ev.action;
              // NEW: Use collapsible tool cards instead of plain action items
              if (!S.toolCards[action]) {
                S.toolCards[action] = appendToolCard(S.botBody, action, 'running', ev.message);
              }
              break;
            }
            case 'tool_result': {
              removeTyping(S.botBody);
              var action = ev.tool;
              var success = ev.success !== false;
              var status = success ? 'success' : 'error';
              // Update or create tool card
              if (S.toolCards[action]) {
                updateToolCard(S.toolCards[action], status, ev);
              } else {
                S.toolCards[action] = appendToolCard(S.botBody, action, status, null, ev);
              }
              // Also append legacy tool result block for detailed view
              appendToolResultBlock(S.botBody, action, ev);
              break;
            }
            case 'agent_status': {
              removeTyping(S.botBody);
              var statusMsg = ev.status === 'executing_tools' ? 'Executing ' + ev.count + ' tool call(s)...' : ev.status || '';
              appendStatusLine(S.botBody, statusMsg);
              break;
            }
            case 'agent_iteration': {
              S.iterationCount = ev.iteration;
              S.thinkBlock = null; S.thinkPre = null; S.thinkText = ''; S.iterationThinking = '';
              S.contentDiv = null; S.contentText = '';
              clearStatusLines(S);
              // Reset tool cards for new iteration
              S.toolCards = {};
              break;
            }
            case 'agent_done':
            case 'done': {
              removeTyping(S.botBody);
              if (ev.full_content && !S.contentDiv) {
                S.contentDiv = appendContentBlock(S.botBody);
                S.contentDiv.innerHTML = md(ev.full_content);
                S.fullResponse = ev.full_content;
              }
              if (ev.sources && ev.sources.length) {
                S.sources = ev.sources;
                appendSources(S.botBody, ev.sources);
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
            // NEW: Terminal streaming events
            // ════════════════════════════════════════════
            case 'terminal_start': {
              removeTyping(S.botBody);
              var termId = ev.terminalId || 'term_' + Date.now();
              if (!S.terminalBlocks[termId]) {
                S.terminalBlocks[termId] = appendTerminalBlock(S.botBody, termId, ev.command, ev.fallback);
              }
              break;
            }
            case 'terminal_output': {
              var termId = ev.terminalId;
              if (S.terminalBlocks[termId]) {
                appendTerminalOutput(S.terminalBlocks[termId], ev.chunk);
              }
              break;
            }
            case 'terminal_exit': {
              var termId = ev.terminalId;
              if (S.terminalBlocks[termId]) {
                finalizeTerminalBlock(S.terminalBlocks[termId], ev.exitCode, ev.duration, ev.fallback);
              }
              break;
            }
            case 'terminal_error': {
              var termId = ev.terminalId;
              if (S.terminalBlocks[termId]) {
                setTerminalError(S.terminalBlocks[termId], ev.message);
              } else {
                // Create error block if not exists
                var errBlock = appendTerminalBlock(S.botBody, termId, '', false);
                setTerminalError(errBlock, ev.message);
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
          img.src = 'data:image/png;base64,' + imgB64;
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

      function appendPermissionRequestBlock(body, tool, args, id) {
        if (!body) return null;
        var d = mk('div', 'cr-permission-card');
        var argsStr = '';
        try { argsStr = JSON.stringify(args, null, 2); } catch (_) { argsStr = String(args || ''); }
        d.innerHTML =
          '<div class="cr-permission-head">' +
            I.tool +
            '<span class="cr-permission-title">Permission Requested</span>' +
          '</div>' +
          '<div class="cr-permission-body">' +
            '<p>The agent wants to execute tool <strong>' + esc(tool) + '</strong> with arguments:</p>' +
            '<pre class="cr-permission-args"><code>' + esc(argsStr) + '</code></pre>' +
          '</div>' +
          '<div class="cr-permission-actions" id="actions-' + id + '">' +
            '<button class="cr-btn cr-btn-allow" data-action="allow" data-id="' + id + '">Allow</button>' +
            '<button class="cr-btn cr-btn-deny" data-action="deny" data-id="' + id + '">Deny</button>' +
          '</div>';
        body.appendChild(d);
        var actions = d.querySelector('#actions-' + id);
        actions.addEventListener('click', function(e) {
          var btn = e.target.closest('[data-action]');
          if (!btn) return;
          var isAllow = btn.dataset.action === 'allow';
          actions.innerHTML = '<span class="cr-permission-status ' + (isAllow ? 'allowed' : 'denied') + '">' +
            (isAllow ? '✓ Allowed' : '✗ Denied') +
          '</span>';
          if (window.VSCODE_API) {
            window.VSCODE_API.postMessage({
              type: 'permissionResponse',
              approved: isAllow,
              toolCallId: id
            });
          }
        });
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

      // ═══════════════════════════════════════════════════
      // NEW: Terminal Streaming UI
      // ═══════════════════════════════════════════════════

      function appendTerminalBlock(body, termId, command, isFallback) {
        if (!body) return null;
        var block = mk('div', 'cr-terminal-block cr-terminal-block--running');
        block.dataset.terminalId = termId;

        var header = mk('div', 'cr-terminal-header');
        header.innerHTML =
          '<span class="cr-terminal-header-icon">' + I.terminal + '</span>' +
          '<span class="cr-terminal-command">$ ' + esc(truncate(command || '', 80)) + '</span>' +
          '<span class="cr-terminal-exit-code cr-terminal-exit-code--success" style="display:none"></span>';
        block.appendChild(header);

        var bodyEl = mk('div', 'cr-terminal-body');
        bodyEl.innerHTML = '<div class="cr-terminal-line cr-terminal-line--prompt">$ ' + esc(command || '') + '</div>';
        block.appendChild(bodyEl);

        if (isFallback) {
          var fallbackMsg = mk('div', 'cr-terminal-line cr-terminal-line--err');
          fallbackMsg.textContent = '[Shell integration unavailable. Check the VS Code terminal panel for output.]';
          bodyEl.appendChild(fallbackMsg);
        }

        body.appendChild(block);
        scrollBottom(msgList);
        return block;
      }

      function appendTerminalOutput(block, chunk) {
        if (!block) return;
        var bodyEl = block.querySelector('.cr-terminal-body');
        if (!bodyEl) return;

        // Split chunk into lines and append each
        var lines = chunk.split('\n');
        lines.forEach(function(line) {
          if (line.trim() === '') return;
          var div = mk('div', 'cr-terminal-line cr-terminal-line--out');
          div.textContent = line;
          bodyEl.appendChild(div);
        });
        scrollBottom(msgList);
      }

      function finalizeTerminalBlock(block, exitCode, duration, isFallback) {
        if (!block) return;
        block.classList.remove('cr-terminal-block--running');
        var isSuccess = isFallback || exitCode === 0;
        block.classList.add(isSuccess ? 'cr-terminal-block--success' : 'cr-terminal-block--error');

        var exitCodeEl = block.querySelector('.cr-terminal-exit-code');
        if (exitCodeEl) {
          exitCodeEl.style.display = 'inline-block';
          exitCodeEl.className = 'cr-terminal-exit-code ' + (isSuccess ? 'cr-terminal-exit-code--success' : 'cr-terminal-exit-code--error');
          exitCodeEl.textContent = isFallback ? 'Sent' : 'Exit: ' + (exitCode != null ? exitCode : '?');
        }

        var bodyEl = block.querySelector('.cr-terminal-body');
        if (bodyEl && duration != null) {
          var timeLine = mk('div', 'cr-terminal-line');
          timeLine.style.color = '#666';
          timeLine.style.fontSize = '10px';
          timeLine.style.marginTop = '4px';
          timeLine.textContent = '[Completed in ' + duration + 'ms]';
          bodyEl.appendChild(timeLine);
        }

        if (isFallback) {
          var fallbackLine = mk('div', 'cr-terminal-line');
          fallbackLine.style.color = '#888';
          fallbackLine.style.fontSize = '10px';
          fallbackLine.style.marginTop = '4px';
          fallbackLine.textContent = '[Fallback mode: shell integration not available]';
          bodyEl.appendChild(fallbackLine);
        }

        scrollBottom(msgList);
      }

      function setTerminalError(block, message) {
        if (!block) return;
        block.classList.remove('cr-terminal-block--running');
        block.classList.add('cr-terminal-block--error');
        var bodyEl = block.querySelector('.cr-terminal-body');
        if (bodyEl) {
          var errLine = mk('div', 'cr-terminal-line cr-terminal-line--err');
          errLine.textContent = '[Error: ' + message + ']';
          bodyEl.appendChild(errLine);
        }
        scrollBottom(msgList);
      }

      // ═══════════════════════════════════════════════════
      // NEW: Collapsible Tool Cards
      // ═══════════════════════════════════════════════════

      function appendToolCard(body, toolName, status, message, result) {
        if (!body) return null;
        var card = mk('details', 'cr-tool-card cr-tool-card--' + status);
        card.open = true;
        card.dataset.toolName = toolName;

        var displayName = formatToolName(toolName);
        var iconHtml = getToolIcon(toolName);
        var statusLabel = status === 'running' ? 'Running' : status === 'success' ? 'Completed' : status === 'error' ? 'Failed' : 'Pending';
        var statusClass = 'cr-tool-card-status--' + status;
        var iconClass = 'cr-tool-card-icon--' + status;

        var head = mk('summary', 'cr-tool-card-head');
        head.innerHTML =
          '<span class="cr-tool-card-icon ' + iconClass + '">' + (status === 'running' ? I.spin : iconHtml) + '</span>' +
          '<span class="cr-tool-card-title">' + esc(displayName) + '</span>' +
          '<span class="cr-tool-card-status ' + statusClass + '">' + statusLabel + '</span>' +
          '<span class="cr-tool-card-chevron">' + I.chevron + '</span>';
        card.appendChild(head);

        var cardBody = mk('div', 'cr-tool-card-body');
        if (message) {
          cardBody.innerHTML = '<div>' + esc(message) + '</div>';
        }
        if (result) {
          var resultText = '';
          if (result.content != null) resultText = result.content;
          else if (result.output != null) resultText = result.output;
          else if (result.message != null) resultText = result.message;
          else if (result.entries) resultText = result.entries.map(function(e) { return '- [' + e.type.toUpperCase() + '] ' + e.name; }).join('\n');
          else if (result.matches) resultText = result.matches.map(function(m) { return '- ' + m; }).join('\n');
          else if (result.info) { try { resultText = JSON.stringify(result.info, null, 2); } catch(_) { resultText = String(result.info); } }
          else if (result.datetime) resultText = result.datetime;
          else { try { resultText = JSON.stringify(result, null, 2); } catch(_) { resultText = String(result); } }

          if (resultText) {
            var pre = mk('pre', '');
            pre.textContent = resultText;
            cardBody.appendChild(pre);
          }
        }
        card.appendChild(cardBody);

        body.appendChild(card);
        scrollBottom(msgList);
        return card;
      }

      function updateToolCard(card, status, result) {
        if (!card) return;
        card.className = 'cr-tool-card cr-tool-card--' + status;

        var iconEl = card.querySelector('.cr-tool-card-icon');
        if (iconEl) {
          iconEl.className = 'cr-tool-card-icon cr-tool-card-icon--' + status;
          iconEl.innerHTML = status === 'running' ? I.spin : getToolIcon(card.dataset.toolName);
        }

        var statusEl = card.querySelector('.cr-tool-card-status');
        if (statusEl) {
          statusEl.className = 'cr-tool-card-status cr-tool-card-status--' + status;
          statusEl.textContent = status === 'success' ? 'Completed' : status === 'error' ? 'Failed' : status;
        }

        // Update body with result
        if (result) {
          var cardBody = card.querySelector('.cr-tool-card-body');
          if (cardBody) {
            var resultText = '';
            if (result.content != null) resultText = result.content;
            else if (result.output != null) resultText = result.output;
            else if (result.message != null) resultText = result.message;
            else if (result.entries) resultText = result.entries.map(function(e) { return '- [' + e.type.toUpperCase() + '] ' + e.name; }).join('\n');
            else if (result.matches) resultText = result.matches.map(function(m) { return '- ' + m; }).join('\n');
            else if (result.info) { try { resultText = JSON.stringify(result.info, null, 2); } catch(_) { resultText = String(result.info); } }
            else if (result.datetime) resultText = result.datetime;
            else { try { resultText = JSON.stringify(result, null, 2); } catch(_) { resultText = String(result); } }

            if (resultText) {
              var existingPre = cardBody.querySelector('pre');
              if (existingPre) {
                existingPre.textContent = resultText;
              } else {
                var pre = mk('pre', '');
                pre.textContent = resultText;
                cardBody.appendChild(pre);
              }
            }
          }
        }
        scrollBottom(msgList);
      }

    } catch (e) {
      console.error("[CHATSPACE] Error inside renderChatSpace:", e);
    }
  };

  window.addEventListener("message", function(event) {
    var message = event.data || {};
    if (message.type === "agentEvent" && window.activeChatStreamCallback) {
      window.activeChatStreamCallback(message.event);
    }
  });

  if (typeof window.getDashboardActiveConversationId === "function") {
    var activeId = window.getDashboardActiveConversationId();
    if (activeId && typeof window.selectDashboardConversation === "function") {
      window.selectDashboardConversation(activeId);
    }
  }
}());
