// SubagentPanel.js — Subagent UI Panel and Dropdown Cards
// Renders all subagents created in this chat as individual collapsible dropdowns.
// When opened, shows Thinking tokens, Tool Cards (Input & Output), and Token gauge
// connected with the vertical continuous timeline track — matching the main chat.

function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncateStr(str, maxLen) {
  if (!str) return '';
  str = String(str).replace(/[\r\n]+/g, ' ').trim();
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

function formatRole(role) {
  var r = String(role || 'coder').toLowerCase();
  if (r === 'architect') return 'ARCHITECT';
  if (r === 'reviewer') return 'REVIEWER';
  if (r === 'debugger') return 'DEBUGGER';
  if (r === 'researcher') return 'RESEARCHER';
  return 'CODER';
}

function formatStatus(status) {
  var s = String(status || 'pending').toLowerCase();
  if (s === 'running') return 'RUNNING';
  if (s === 'paused') return 'PAUSED';
  if (s === 'completed') return 'COMPLETED';
  if (s === 'failed') return 'FAILED';
  if (s === 'stopped' || s === 'cancelled') return 'STOPPED';
  return 'PENDING';
}

var _subagentMemoryStorage = {};

function getStorageItem(key) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.getItem === 'function') {
      return localStorage.getItem(key);
    }
  } catch (_) {}
  return _subagentMemoryStorage[key] || null;
}

function setStorageItem(key, val) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.setItem === 'function') {
      localStorage.setItem(key, val);
      return;
    }
  } catch (_) {}
  _subagentMemoryStorage[key] = String(val);
}

export function getSubagentListForSession(sessionId) {
  if (!sessionId) return [];
  var list = [];
  try {
    var raw = getStorageItem('coderun_subagents_' + sessionId);
    if (raw) {
      list = JSON.parse(raw);
    }
  } catch (_) {
    list = [];
  }
  if (!Array.isArray(list)) list = [];

  // Also inspect any subagent traces stored for this session
  var subTraces = [];
  try {
    var rawTraces = getStorageItem('coderun_subagent_traces_' + sessionId);
    if (rawTraces) {
      subTraces = JSON.parse(rawTraces);
    }
  } catch (_) {
    subTraces = [];
  }
  if (Array.isArray(subTraces)) {
    for (var t = 0; t < subTraces.length; t++) {
      var tr = subTraces[t];
      var found = false;
      for (var l = 0; l < list.length; l++) {
        if (list[l].agentId === tr.agentId || list[l].id === tr.agentId || list[l].sessionId === tr.sessionId || (tr.agentId && list[l].agentId && list[l].agentId.indexOf(tr.agentId) !== -1)) {
          found = true;
          // Merge trace steps & thinking into subagent object
          list[l].trace = tr;
          if (tr.status && list[l].status !== 'paused') {
            list[l].status = tr.status;
          }
          break;
        }
      }
      if (!found && tr.agentId) {
        list.push({
          agentId: tr.agentId,
          id: tr.id || tr.agentId,
          name: tr.name || tr.agentId,
          role: tr.role || 'coder',
          status: tr.status || 'completed',
          task: tr.task || (tr.user && tr.user.query) || '',
          sessionId: tr.sessionId || '',
          startedAt: tr.startedAt,
          completedAt: tr.completedAt,
          trace: tr
        });
      }
    }
  }

  return list;
}

export function saveSubagentListForSession(sessionId, list) {
  if (!sessionId) return;
  try {
    setStorageItem('coderun_subagents_' + sessionId, JSON.stringify(list || []));
  } catch (_) {
    // Intentionally ignore storage write errors
  }
}

export function saveSubagentsToLocalStorage(sessionId, list) {
  return saveSubagentListForSession(sessionId, list);
}

export function updateSubagentDiffStatus(sessionId, diffId, status) {
  if (!diffId) return;
  try {
    var normStatus = (status === 'accepted' || status === 'applied') ? 'approved' : status;
    var sessionKeys = [];
    if (sessionId) {
      sessionKeys.push('coderun_subagents_' + sessionId);
      sessionKeys.push('coderun_subagent_traces_' + sessionId);
    }
    if (typeof localStorage !== 'undefined') {
      for (var k = 0; k < localStorage.length; k++) {
        var key = localStorage.key(k);
        if (key && (key.indexOf('coderun_subagents_') === 0 || key.indexOf('coderun_subagent_traces_') === 0)) {
          if (sessionKeys.indexOf(key) === -1) {
            sessionKeys.push(key);
          }
        }
      }
    }
    for (var mKey in _subagentMemoryStorage) {
      if (mKey.indexOf('coderun_subagents_') === 0 || mKey.indexOf('coderun_subagent_traces_') === 0) {
        if (sessionKeys.indexOf(mKey) === -1) {
          sessionKeys.push(mKey);
        }
      }
    }

    for (var s = 0; s < sessionKeys.length; s++) {
      var storageKey = sessionKeys[s];
      var raw = getStorageItem(storageKey);
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
        setStorageItem(storageKey, JSON.stringify(list));
      }
    }
  } catch (_) {
    // Intentionally ignore storage write errors
  }
}
if (typeof window !== 'undefined' && !window.updateSubagentDiffStatus) {
  window.updateSubagentDiffStatus = updateSubagentDiffStatus;
}

export function markSubagentCheckpointUndone(filePath, checkpointId) {
  try {
    var normFile = String(filePath || '').replace(/\\/g, '/').toLowerCase();
    var sessionKeys = [];
    if (typeof localStorage !== 'undefined' && localStorage) {
      for (var k = 0; k < localStorage.length; k++) {
        var key = localStorage.key(k);
        if (key && (key.indexOf('coderun_subagents_') === 0 || key.indexOf('coderun_subagent_traces_') === 0)) {
          if (sessionKeys.indexOf(key) === -1) {
            sessionKeys.push(key);
          }
        }
      }
    }
    for (var mKey in _subagentMemoryStorage) {
      if (mKey.indexOf('coderun_subagents_') === 0 || mKey.indexOf('coderun_subagent_traces_') === 0) {
        if (sessionKeys.indexOf(mKey) === -1) {
          sessionKeys.push(mKey);
        }
      }
    }

    for (var s = 0; s < sessionKeys.length; s++) {
      var storageKey = sessionKeys[s];
      var raw = getStorageItem(storageKey);
      if (!raw) continue;
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) continue;
      var changed = false;

      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        if (!item) continue;
        if (item.diffs && Array.isArray(item.diffs)) {
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
        if (item.trace && item.trace.diffs && Array.isArray(item.trace.diffs)) {
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
        setStorageItem(storageKey, JSON.stringify(list));
      }
    }
  } catch (_) {}
}
if (typeof window !== 'undefined' && !window.markSubagentCheckpointUndone) {
  window.markSubagentCheckpointUndone = markSubagentCheckpointUndone;
}

export function buildSubagentToolCardHtml(tc) {
  if (!tc) return '';
  var toolName = tc.toolName || tc.name || 'Tool';
  var status = tc.success === false ? 'error' : 'success';
  var statusLabel = status === 'success' ? 'Completed' : 'Failed';

  var inputStr = '';
  try {
    inputStr = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input || {}, null, 2);
  } catch (_) {
    inputStr = String(tc.input || '');
  }

  var outputStr = '';
  try {
    outputStr = typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output || '', null, 2);
  } catch (_) {
    outputStr = String(tc.output || '');
  }

  return (
    '<details class="cr-tool-card cr-tool-card--' + status + '">' +
      '<summary class="cr-tool-card-head">' +
        '<span class="cr-tool-card-icon cr-tool-card-icon--' + status + '">' + (status === 'success' ? '🔧' : '⚠️') + '</span>' +
        '<span class="cr-tool-card-title-group">' +
          '<span class="cr-tool-card-title">' + escHtml(toolName) + '</span>' +
          (tc.durationMs ? '<span class="cr-tool-card-subtitle">' + tc.durationMs + 'ms</span>' : '') +
        '</span>' +
        '<span class="cr-tool-card-status cr-tool-card-status--' + status + '">' + escHtml(statusLabel) + '</span>' +
        '<span class="cr-tool-card-chevron"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg></span>' +
      '</summary>' +
      '<div class="cr-tool-card-body" style="display:block;">' +
        (inputStr && inputStr !== '{}' ?
          '<div class="cr-tool-card-input-block">' +
            '<div class="cr-tool-card-block-label">Tool Input</div>' +
            '<pre class="cr-tool-card-args-pre"><code>' + escHtml(inputStr) + '</code></pre>' +
          '</div>' : '') +
        '<div class="cr-tool-card-result cr-tool-card-output-block" style="display:block;">' +
          '<div class="cr-tool-card-block-label">Tool Output</div>' +
          '<pre class="cr-tool-card-result-pre">' + escHtml(outputStr || '(No output recorded)') + '</pre>' +
        '</div>' +
        (tc.checkpointId ?
          '<div class="cr-tool-undo-bar" data-cp-id="' + escHtml(tc.checkpointId) + '" data-file-path="' + escHtml(tc.filePath || '') + '" style="margin-top:4px;display:flex;align-items:center;">' +
            (tc.undone || tc.restored ?
              '<span class="cr-action-done" style="font-size:11px;padding:2px 6px;color:#3fb950;display:inline-flex;align-items:center;">✓ Restored</span>' :
              '<button type="button" class="cr-action-btn cr-action-undo" data-cp-id="' + escHtml(tc.checkpointId) + '" data-file-path="' + escHtml(tc.filePath || '') + '">↩ Undo</button>') +
          '</div>' : '') +
      '</div>' +
    '</details>'
  );
}

function formatCodeBlock(match, lang, code) {
  var l = (lang || 'text').trim();
  var c = code.trim();
  if ((l.toLowerCase() === 'json' || !l) && (c.startsWith('{') || c.startsWith('['))) {
    try {
      c = JSON.stringify(JSON.parse(c), null, 2);
      if (!l) l = 'json';
    } catch (_) {}
  }
  return (
    '<div class="md-code-block">' +
      '<div class="md-code-header">' +
        '<span class="md-code-lang">' + escHtml(l) + '</span>' +
      '</div>' +
      '<pre><code class="language-' + escHtml(l) + '">' + escHtml(c) + '</code></pre>' +
    '</div>'
  );
}

function formatSubagentMarkdown(text) {
  if (!text) return '';
  var str = String(text);
  var trimmed = str.trim();

  var codeBlockMatch = trimmed.match(/^```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```$/);
  if (codeBlockMatch) {
    var detectedLang = codeBlockMatch[1] || 'json';
    var innerCode = codeBlockMatch[2].trim();
    try {
      var parsed = JSON.parse(innerCode);
      str = '```' + detectedLang + '\n' + JSON.stringify(parsed, null, 2) + '\n```';
    } catch (_) {
      str = '```' + detectedLang + '\n' + innerCode + '\n```';
    }
  } else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      var rawParsed = JSON.parse(trimmed);
      str = '```json\n' + JSON.stringify(rawParsed, null, 2) + '\n```';
    } catch (_) {}
  }

  if (typeof window !== 'undefined' && typeof window.renderMarkdown === 'function') {
    try {
      var res = window.renderMarkdown(str);
      if (res) return res;
    } catch (_) {}
  }
  if (typeof renderMarkdown === 'function') {
    try {
      var res2 = renderMarkdown(str);
      if (res2) return res2;
    } catch (_) {}
  }

  var cbRegex = /```([a-zA-Z0-9_-]*)[ \t]*\n?([\s\S]*?)```/g;
  if (cbRegex.test(str)) {
    return str.replace(/```([a-zA-Z0-9_-]*)[ \t]*\n?([\s\S]*?)```/g, formatCodeBlock);
  }

  return '<p>' + escHtml(str) + '</p>';
}

export function buildSubagentDiffCardHtml(diff) {
  if (!diff) return '';
  var diffId = diff.id || 'diff_' + Date.now();
  var filePath = diff.file_path || 'unknown';
  var isNew = diff.is_new_file || false;
  var originalText = diff.original_content || '';
  var modifiedText = diff.new_content || '';
  var status = diff.status || 'pending';

  var origLines = originalText.split('\n');
  var modLines = modifiedText.split('\n');
  var maxLen = Math.max(origLines.length, modLines.length);
  var additions = 0;
  var deletions = 0;
  var linesHtml = '';

  for (var i = 0; i < maxLen; i++) {
    var o = origLines[i] || '';
    var m = modLines[i] || '';
    if (o === m) {
      linesHtml += '<div class="cr-diff-line cr-diff-line-context">' +
        '<span class="cr-diff-ln">' + (i + 1) + '</span>' +
        '<span class="cr-diff-ln">' + (i + 1) + '</span>' +
        '<span class="cr-diff-code">' + escHtml(o) + '</span>' +
      '</div>';
    } else if (!o && m) {
      additions++;
      linesHtml += '<div class="cr-diff-line cr-diff-line-add">' +
        '<span class="cr-diff-ln"></span>' +
        '<span class="cr-diff-ln">' + (i + 1) + '</span>' +
        '<span class="cr-diff-code">' + escHtml(m) + '</span>' +
      '</div>';
    } else if (o && !m) {
      deletions++;
      linesHtml += '<div class="cr-diff-line cr-diff-line-del">' +
        '<span class="cr-diff-ln">' + (i + 1) + '</span>' +
        '<span class="cr-diff-ln"></span>' +
        '<span class="cr-diff-code">' + escHtml(o) + '</span>' +
      '</div>';
    } else {
      deletions++;
      additions++;
      linesHtml += '<div class="cr-diff-line cr-diff-line-del">' +
        '<span class="cr-diff-ln">' + (i + 1) + '</span>' +
        '<span class="cr-diff-ln"></span>' +
        '<span class="cr-diff-code">' + escHtml(o) + '</span>' +
      '</div>' +
      '<div class="cr-diff-line cr-diff-line-add">' +
        '<span class="cr-diff-ln"></span>' +
        '<span class="cr-diff-ln">' + (i + 1) + '</span>' +
        '<span class="cr-diff-code">' + escHtml(m) + '</span>' +
      '</div>';
    }
  }

  var actionsHtml = '';
  if (status === 'pending') {
    actionsHtml = '<div class="cr-diff-actions">' +
      '<button type="button" class="cr-btn cr-btn-allow cr-diff-accept" data-diff-id="' + escHtml(diffId) + '">Accept</button>' +
      '<button type="button" class="cr-btn cr-btn-deny cr-diff-reject" data-diff-id="' + escHtml(diffId) + '">Reject</button>' +
      '<button type="button" class="cr-diff-full-btn" data-diff-id="' + escHtml(diffId) + '" title="Open in VS Code diff editor">Open Full Diff</button>' +
      '<span class="cr-diff-status" style="display:none"></span>' +
    '</div>';
  } else {
    var isApproved = (status === 'approved' || status === 'accepted' || status === 'applied');
    var isUndone = !!(diff.undone || diff.restored || status === 'restored');
    var statusText = isUndone ? '✓ RESTORED' : (isApproved ? '✓ APPROVED' : (status === 'rejected' ? '✗ REJECTED' : escHtml(status.toUpperCase())));
    var statusCls = isUndone ? 'allowed cr-diff-status--restored' : (isApproved ? 'allowed cr-diff-status--approved' : (status === 'rejected' ? 'denied cr-diff-status--rejected' : ('cr-diff-status--' + escHtml(status))));
    var undoBtnHtml = '';
    if (isUndone) {
      undoBtnHtml = '<span class="cr-action-done" style="margin-left:8px;font-size:11px;padding:2px 6px;color:#3fb950;display:inline-flex;align-items:center;">✓ Restored</span>';
    } else if (isApproved || diff.checkpointId) {
      var cpId = diff.checkpointId || '';
      undoBtnHtml = '<button type="button" class="cr-action-btn cr-action-undo" data-cp-id="' + escHtml(cpId) + '" data-file-path="' + escHtml(filePath) + '" style="margin-left:8px;font-size:11px;padding:2px 6px;">↩ Undo</button>';
    }
    actionsHtml = '<div class="cr-diff-actions" style="display:flex;align-items:center;">' +
      '<span class="cr-diff-status cr-permission-status ' + statusCls + '">' + statusText + '</span>' +
      undoBtnHtml +
    '</div>';
  }

  var fileSvg = '<svg class="cr-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';

  return '<div class="cr-diff-card" data-diff-id="' + escHtml(diffId) + '" data-diff-status="' + escHtml(status) + '" data-file-path="' + escHtml(filePath) + '" style="margin:8px 0;">' +
    '<div class="cr-diff-head">' +
      fileSvg +
      '<span class="cr-diff-title">' + escHtml(filePath) + '</span>' +
      '<span class="cr-diff-stats">' +
        '<span class="cr-diff-stat-add">+' + additions + '</span>' +
        '<span class="cr-diff-stat-del">-' + deletions + '</span>' +
      '</span>' +
    '</div>' +
    '<details class="cr-diff-details" open>' +
      '<summary class="cr-diff-summary">' + (isNew ? 'New File' : 'View Changes') + '</summary>' +
      '<div class="cr-diff-body">' + linesHtml + '</div>' +
    '</details>' +
    actionsHtml +
  '</div>';
}

export function buildSubagentDropdownCardHtml(subagent, isOpen) {
  var agentId = subagent.agentId || subagent.id || 'subagent';
  var name = subagent.name || (subagent.identity && subagent.identity.name) || (subagent.trace && subagent.trace.name) || agentId;
  var role = formatRole(subagent.role);
  var roleLower = role.toLowerCase();
  var status = String(subagent.status || 'running').toLowerCase();
  var statusLabel = formatStatus(status);
  var task = subagent.task || (subagent.trace && subagent.trace.user && subagent.trace.user.query) || 'Assigned task';
  var isRunning = (status === 'running');
  var openAttr = isOpen ? ' open' : '';
  var focusedClass = isRunning ? ' cr-subagent-card--focused' : '';

  var idBadgeHtml = '';
  if (agentId && name !== agentId) {
    idBadgeHtml = '<span class="cr-subagent-id-badge" title="Subagent ID: ' + escHtml(agentId) + '">#' + escHtml(agentId) + '</span>';
  } else if (agentId) {
    idBadgeHtml = '<span class="cr-subagent-id-badge" title="Subagent ID: ' + escHtml(agentId) + '">ID: ' + escHtml(agentId) + '</span>';
  }

  // Controls for paused / running states
  var controlsHtml = '';
  if (status === 'paused') {
    controlsHtml += '<button type="button" class="cr-subagent-action-btn cr-subagent-resume-btn" data-agent-id="' + escHtml(agentId) + '" title="Resume subagent execution">▶ Resume</button>';
    controlsHtml += '<button type="button" class="cr-subagent-action-btn cr-subagent-stop-btn" data-agent-id="' + escHtml(agentId) + '" title="Stop subagent">■ Stop</button>';
  } else if (status === 'running') {
    controlsHtml += '<button type="button" class="cr-subagent-action-btn cr-subagent-pause-btn" data-agent-id="' + escHtml(agentId) + '" title="Pause subagent at iteration boundary">⏸ Pause</button>';
    controlsHtml += '<button type="button" class="cr-subagent-action-btn cr-subagent-stop-btn" data-agent-id="' + escHtml(agentId) + '" title="Stop subagent">■ Stop</button>';
  }

  // Extract thinking and tool calls from trace or subagent object
  var trace = subagent.trace || null;
  var allThinking = subagent.thinking || '';
  var allToolCalls = subagent.toolCalls || [];
  var totalTokens = { input: 0, output: 0, total: 0 };
  var durationSec = 0;

  if (trace) {
    if (trace.metrics && trace.metrics.totalTokens) {
      totalTokens = trace.metrics.totalTokens;
    }
    if (trace.durationMs) {
      durationSec = (trace.durationMs / 1000).toFixed(1);
    }
    if (trace.steps && trace.steps.length) {
      for (var s = 0; s < trace.steps.length; s++) {
        var step = trace.steps[s];
        if (step.llmCall && step.llmCall.thinking) {
          allThinking += (allThinking ? '\n\n' : '') + step.llmCall.thinking;
        }
        if (step.toolCalls && step.toolCalls.length) {
          for (var tc = 0; tc < step.toolCalls.length; tc++) {
            allToolCalls.push(step.toolCalls[tc]);
          }
        }
      }
    }
    if (trace.finalResponse && trace.finalResponse.thinking && !allThinking) {
      allThinking = trace.finalResponse.thinking;
    }
  }

  // Thinking section html
  var thinkingHtml = '';
  if (allThinking) {
    thinkingHtml = (
      '<details class="cr-think-block cr-subagent-think-block">' +
        '<summary class="cr-think-summary">' +
          '<span class="cr-think-icon">🕒</span>' +
          '<span class="cr-think-label">Thought process</span>' +
          '<span class="cr-think-chevron"></span>' +
        '</summary>' +
        '<pre class="cr-think-pre"><code>' + escHtml(allThinking) + '</code></pre>' +
      '</details>'
    );
  }

  // Tools section html
  var toolsHtml = '';
  if (allToolCalls && allToolCalls.length) {
    toolsHtml += '<div class="cr-subagent-tools-section">';
    toolsHtml += '<div class="cr-subagent-block-label">Executed Tools (' + allToolCalls.length + ')</div>';
    for (var t = 0; t < allToolCalls.length; t++) {
      toolsHtml += buildSubagentToolCardHtml(allToolCalls[t]);
    }
    toolsHtml += '</div>';
  }

  var diffsHtml = '';
  var diffList = (subagent && subagent.diffs) || (trace && trace.diffs) || [];
  if (diffList && diffList.length) {
    diffsHtml += '<div class="cr-subagent-diffs-section">';
    diffsHtml += '<div class="cr-subagent-block-label" style="font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground,#888);margin:8px 0 4px;">File Changes &amp; Diffs (' + diffList.length + ')</div>';
    for (var df = 0; df < diffList.length; df++) {
      diffsHtml += buildSubagentDiffCardHtml(diffList[df]);
    }
    diffsHtml += '</div>';
  }

  // Error handling
  var err = subagent.error || (trace && (trace.error || (trace.status === 'failed' && trace.finalResponse && trace.finalResponse.text))) || (subagent.result && subagent.result.failure && subagent.result.failure.message) || null;
  if (!err && (status === 'failed' || (trace && trace.status === 'failed'))) {
    err = (trace && trace.finalResponse && trace.finalResponse.text) ? trace.finalResponse.text : 'Connection or execution error.';
  }

  var errorBannerHtml = '';
  if (err) {
    errorBannerHtml = (
      '<div class="cr-subagent-error-banner" style="background:#2d1515;border:1px solid #7f1d1d;border-radius:8px;padding:12px 14px;margin:8px 0;">' +
        '<div style="display:flex;align-items:center;gap:8px;font-weight:600;color:#f87171;margin-bottom:6px;">' +
          '<span>⚠️</span>' +
          '<span>Error Response</span>' +
        '</div>' +
        '<div style="font-size:12px;color:#fca5a5;line-height:1.4;font-family:monospace;">' + escHtml(typeof err === 'string' ? err : (err.message || JSON.stringify(err))) + '</div>' +
      '</div>'
    );
  }

  // Final Response if any
  var finalResponseHtml = '';
  var finalRespText = (trace && trace.finalResponse && (trace.finalResponse.text || trace.finalResponse.content)) || (subagent.result && (subagent.result.content || subagent.result.summary || subagent.result.output)) || '';
  if (finalRespText) {
    var renderedMarkdown = formatSubagentMarkdown(finalRespText);
    finalResponseHtml = (
      '<div class="cr-subagent-task-block" style="margin-top:6px;">' +
        '<div class="cr-subagent-block-label">Subagent Final Response</div>' +
        '<div class="cr-subagent-markdown-output md-content cr-content-block">' + renderedMarkdown + '</div>' +
      '</div>'
    );
  }

  // Empty state if no steps or output yet
  var emptyStateHtml = '';
  if (!allThinking && (!allToolCalls || allToolCalls.length === 0) && !err && !finalResponseHtml) {
    if (status === 'stopped') {
      emptyStateHtml = '<div class="cr-subagent-timeline-empty" style="color:#94a3b8;padding:8px 0;"><span style="font-size:14px;margin-right:6px;">⏹</span><span>Subagent execution was stopped.</span></div>';
    } else if (status === 'failed') {
      emptyStateHtml = '<div class="cr-subagent-timeline-empty" style="color:#f87171;padding:8px 0;"><span style="font-size:14px;margin-right:6px;">❌</span><span>Subagent execution failed.</span></div>';
    } else if (status === 'completed' || (subagent.result && subagent.result.success !== false)) {
      emptyStateHtml = '<div class="cr-subagent-timeline-empty" style="color:#4ade80;padding:8px 0;"><span style="font-size:14px;margin-right:6px;">✓</span><span>Subagent completed task successfully.</span></div>';
    } else {
      emptyStateHtml = '<div class="cr-subagent-timeline-empty" style="padding:8px 0;"><span class="cr-subagent-empty-dot"></span><span>Initializing subagent agentLoop and workspace context...</span></div>';
    }
  }

  return (
    '<details class="cr-subagent-card cr-subagent-card--' + status + focusedClass + '" data-subagent-id="' + escHtml(agentId) + '"' + openAttr + '>' +
      '<summary class="cr-subagent-head">' +
        '<div class="cr-subagent-head-left">' +
          '<span class="cr-subagent-bot-icon">🤖</span>' +
          '<div class="cr-subagent-title-stack">' +
            '<div class="cr-subagent-title-row">' +
              '<span class="cr-subagent-status-dot cr-subagent-status-dot--' + status + '"></span>' +
              '<span class="cr-subagent-name" title="' + escHtml(name) + (agentId ? ' (ID: ' + escHtml(agentId) + ')' : '') + '">' + escHtml(name) + '</span>' +
              idBadgeHtml +
              '<span class="cr-subagent-role-badge cr-subagent-role--' + roleLower + '">— ' + role + '</span>' +
            '</div>' +
            '<div class="cr-subagent-task" title="' + escHtml(task) + '">Task: "' + escHtml(truncateStr(task, 60)) + '"</div>' +
          '</div>' +
        '</div>' +
        '<div class="cr-subagent-head-right">' +
          '<span class="cr-subagent-status cr-subagent-status--' + status + '">● ' + escHtml(statusLabel) + '</span>' +
          controlsHtml +
          '<span class="cr-subagent-chevron"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg></span>' +
        '</div>' +
      '</summary>' +
      '<div class="cr-subagent-body">' +
        '<div class="cr-subagent-timeline-track">' +
          '<div class="cr-subagent-task-block">' +
            '<div class="cr-subagent-block-label">Assigned Goal</div>' +
            '<div class="cr-subagent-task-text">' + escHtml(task) + '</div>' +
          '</div>' +
          thinkingHtml +
          toolsHtml +
          diffsHtml +
          errorBannerHtml +
          finalResponseHtml +
          emptyStateHtml +
          '<div class="cr-subagent-tokens-row">' +
            '<span class="cr-subagent-tokens-badge">' +
              '📊 Tokens: ' + (totalTokens.total || (totalTokens.input + totalTokens.output) || 0).toLocaleString() + ' (Input: ' + (totalTokens.input || 0).toLocaleString() + ', Output: ' + (totalTokens.output || 0).toLocaleString() + ')' +
              (durationSec ? ' • ⏱ ' + durationSec + 's' : '') +
            '</span>' +
            '<button type="button" class="cr-subagent-view-trace-link" data-subagent-id="' + escHtml(agentId) + '">View Subagent Traces ↗</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</details>'
  );
}

export function buildSubagentExecutionChatHtml(subagent) {
  if (!subagent) return '';
  var agentId = subagent.agentId || subagent.id || 'subagent';
  var role = formatRole(subagent.role);
  var status = formatStatus(subagent.status);
  var task = subagent.task || 'Autonomous Task';
  var trace = subagent.trace || null;
  var steps = (trace && Array.isArray(trace.steps)) ? trace.steps : [];
  var botAvatarSrc = (typeof window !== 'undefined' && window.CODERUN_BOT_AVATAR) ? window.CODERUN_BOT_AVATAR : 'bot-avatar.jpg';

  var innerItemsHtml = '';
  var totalTokens = (trace && trace.totalTokens) ? trace.totalTokens : { input: 0, output: 0, total: 0 };
  var finalResponseText = '';

  if (trace && trace.finalResponse && trace.finalResponse.content) {
    finalResponseText = trace.finalResponse.content;
  } else if (subagent.result && subagent.result.content) {
    finalResponseText = subagent.result.content;
  }

    var err = subagent.error || (trace && (trace.error || (trace.status === 'failed' && trace.finalResponse && trace.finalResponse.text))) || (subagent.result && subagent.result.failure && subagent.result.failure.message) || null;
    if (!err && (status === 'FAILED' || (trace && trace.status === 'failed'))) {
      err = (trace && trace.finalResponse && trace.finalResponse.text) ? trace.finalResponse.text : 'Connection or execution error.';
    }

    var errorBannerHtml = '';
    if (err) {
      errorBannerHtml = (
        '<div class="cr-subagent-error-banner" style="background:#2d1515;border:1px solid #7f1d1d;border-radius:8px;padding:12px 14px;margin:8px 0;">' +
          '<div style="display:flex;align-items:center;gap:8px;font-weight:600;color:#f87171;margin-bottom:6px;">' +
            '<span>⚠️</span>' +
            '<span>Error Response</span>' +
          '</div>' +
          '<div style="font-size:12px;color:#fca5a5;line-height:1.4;">' + escHtml(typeof err === 'string' ? err : (err.message || JSON.stringify(err))) + '</div>' +
        '</div>'
      );
    }

    if (steps.length > 0) {
      for (var s = 0; s < steps.length; s++) {
        var step = steps[s];

        if (step.llmCall && step.llmCall.thinking) {
          innerItemsHtml += (
            '<details class="cr-thinking-block cr-subagent-thinking cr-subagent-think-block" open>' +
              '<summary class="cr-thinking-header">' +
                '<span class="cr-thinking-icon">🕒</span>' +
                '<span class="cr-thinking-label">Thought process</span>' +
                '<span class="cr-think-chevron cr-thinking-chevron"></span>' +
              '</summary>' +
              '<div class="cr-thinking-body">' + escHtml(step.llmCall.thinking) + '</div>' +
            '</details>'
          );
        }

        var toolList = step.toolCalls || step.tools || [];
        if (toolList && toolList.length > 0) {
          for (var t = 0; t < toolList.length; t++) {
            var tc = toolList[t];
            innerItemsHtml += buildSubagentToolCardHtml(tc);
          }
        }
      }
      var diffList = (subagent && subagent.diffs) || (trace && trace.diffs) || [];
      if (diffList && diffList.length > 0) {
        innerItemsHtml += '<div class="cr-subagent-diffs-section">';
        innerItemsHtml += '<div class="cr-subagent-block-label" style="font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground,#888);margin:8px 0 4px;">File Changes &amp; Diffs (' + diffList.length + ')</div>';
        for (var df = 0; df < diffList.length; df++) {
          innerItemsHtml += buildSubagentDiffCardHtml(diffList[df]);
        }
        innerItemsHtml += '</div>';
      }
      if (err) {
        innerItemsHtml += errorBannerHtml;
      }
    } else if (err) {
      innerItemsHtml = errorBannerHtml;
    } else if (status === 'STOPPED') {
      innerItemsHtml = (
        '<div class="cr-subagent-timeline-empty" style="color:#94a3b8;">' +
          '<span style="font-size:14px;margin-right:6px;">⏹</span>' +
          '<span>Subagent execution was stopped.</span>' +
        '</div>'
      );
    } else if (status === 'FAILED') {
      innerItemsHtml = (
        '<div class="cr-subagent-timeline-empty" style="color:#f87171;">' +
          '<span style="font-size:14px;margin-right:6px;">❌</span>' +
          '<span>Subagent execution failed.</span>' +
        '</div>'
      );
    } else {
      innerItemsHtml = (
        '<div class="cr-subagent-timeline-empty">' +
          '<span class="cr-subagent-empty-dot"></span>' +
          '<span>Initializing subagent agentLoop and workspace context...</span>' +
        '</div>'
      );
    }

  var finalResponseHtml = '';
  if (finalResponseText) {
    var textToRenderChat = finalResponseText;
    if (typeof textToRenderChat === 'string' && (textToRenderChat.trim().startsWith('{') || textToRenderChat.trim().startsWith('['))) {
      try {
        var parsedChat = JSON.parse(textToRenderChat.trim());
        textToRenderChat = '```json\n' + JSON.stringify(parsedChat, null, 2) + '\n```';
      } catch (_) {}
    }
    var renderFnChat = (typeof window !== 'undefined' && typeof window.renderMarkdown === 'function')
      ? window.renderMarkdown
      : ((typeof window !== 'undefined' && window.MarkdownRenderer && typeof window.MarkdownRenderer.render === 'function')
        ? window.MarkdownRenderer.render
        : ((typeof globalThis !== 'undefined' && typeof globalThis.renderMarkdown === 'function')
          ? globalThis.renderMarkdown
          : (typeof renderMarkdown === 'function' ? renderMarkdown : null)));
    var renderedContent = renderFnChat
      ? renderFnChat(textToRenderChat)
      : ('<p>' + escHtml(textToRenderChat) + '</p>');
    finalResponseHtml = '<div class="cr-subagent-markdown-output md-content cr-content-block">' + renderedContent + '</div>';
  }

  var tokenGaugeHtml = '';
  if (totalTokens && (totalTokens.total > 0 || totalTokens.input > 0)) {
    tokenGaugeHtml = (
      '<div class="cr-subagent-token-row">' +
        '<span class="cr-subagent-token-item">📊 Tokens: <strong>' + (totalTokens.total || (totalTokens.input + totalTokens.output)) + '</strong></span>' +
        '<span class="cr-subagent-token-sub">(In: ' + (totalTokens.input || 0) + ' • Out: ' + (totalTokens.output || 0) + ')</span>' +
      '</div>'
    );
  }

  return (
    '<div class="cr-subagent-chat-stream">' +
      '<div class="cr-row cr-row--user">' +
        '<div class="cr-user-bubble cr-subagent-user-bubble">' + escHtml(task) + '</div>' +
      '</div>' +
      '<div class="cr-row cr-row--bot">' +
        '<div class="cr-bot-avatar">' +
          '<img class="cr-bot-avatar-img" src="' + botAvatarSrc + '" alt="Bot" onerror="this.outerHTML=\'<svg class=\\\'cr-icon\\\' viewBox=\\\'0 0 24 24\\\' fill=\\\'currentColor\\\'><path d=\\\'M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7H4a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2zM7 14v2a1 1 0 1 0 2 0v-2H7zm8 0v2a1 1 0 1 0 2 0v-2h-2zM5 20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1H5v1z\\\'/></svg>\'"/>' +
        '</div>' +
        '<div class="cr-bot-body">' +
          innerItemsHtml +
          finalResponseHtml +
          tokenGaugeHtml +
          '<div class="cr-subagent-card-footer" style="margin-top:14px;padding-top:10px;border-top:1px solid #1e293b;">' +
            '<button type="button" class="cr-subagent-view-trace-link" data-subagent-id="' + escHtml(agentId) + '">View Subagent Traces ↗</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

export function renderSubagentsView(container, targetSubagentId, customSessionId) {
  if (!container) return;

  var activeSessionId = customSessionId || null;
  if (typeof window !== 'undefined' && window.VSCODE_API) {
    try {
      var vsState = window.VSCODE_API.getState() || {};
      activeSessionId = vsState.activeConversationId;
    } catch (_) {}
  }
  if (!activeSessionId && typeof window !== 'undefined' && window.ACTIVE_CONVERSATION_ID) {
    activeSessionId = window.ACTIVE_CONVERSATION_ID;
  }
  if (!activeSessionId && typeof localStorage !== 'undefined') {
    try {
      var storedConv = localStorage.getItem('coderun_conversations');
      if (storedConv) {
        var convs = JSON.parse(storedConv);
        if (convs && convs.length) activeSessionId = convs[0].id;
      }
    } catch (_) {}
  }

  var activeId = activeSessionId || 'default';
  var subagents = getSubagentListForSession(activeSessionId);

  if (!subagents || subagents.length === 0) {
    var botAvatarSrc = (typeof window !== 'undefined' && window.CODERUN_BOT_AVATAR) ? window.CODERUN_BOT_AVATAR : 'bot-avatar.jpg';
    var botAvatarHtml = '<img class="cr-bot-avatar-img cr-subagent-empty-avatar" src="' + botAvatarSrc + '" alt="Bot" onerror="this.outerHTML=\'<svg class=\\\'cr-icon\\\' viewBox=\\\'0 0 24 24\\\' fill=\\\'currentColor\\\' style=\\\'width:36px;height:36px;color:#58a6ff;\\\'><path d=\\\'M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7H4a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2zM7 14v2a1 1 0 1 0 2 0v-2H7zm8 0v2a1 1 0 1 0 2 0v-2h-2zM5 20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1H5v1z\\\'/></svg>\'"/>';
    container.innerHTML = (
      '<div class="cr-subagents-panel">' +
        '<div class="cr-subagents-toolbar">' +
          '<div class="cr-subagents-toolbar-left">' +
            '<span class="cr-subagents-title">Subagents</span>' +
            '<span class="cr-subagents-count-badge">0</span>' +
          '</div>' +
        '</div>' +
        '<div class="cr-subagents-empty">' +
          '<div class="cr-subagents-empty-icon">' +
            '<div class="cr-subagent-empty-avatar-wrap">' +
              botAvatarHtml +
            '</div>' +
          '</div>' +
          '<div class="cr-subagents-empty-title" data-empty="No subagents created">No subagents are created in this chat</div>' +
        '</div>' +
      '</div>'
    );
    return;
  }

  subagents.sort(function(a, b) {
    var ta = a.startedAt || 0;
    var tb = b.startedAt || 0;
    return ta - tb;
  });

  var existingOpen = container.querySelector ? container.querySelector('.cr-subagent-card[open]') : null;
  var openId = targetSubagentId || (existingOpen ? (existingOpen.getAttribute('data-subagent-id') || existingOpen.getAttribute('data-agent-id')) : null);

  var cardsHtml = '';
  for (var c = 0; c < subagents.length; c++) {
    var sub = subagents[c];
    var isSubOpen = Boolean(openId && (sub.agentId === openId || sub.id === openId));
    cardsHtml += buildSubagentDropdownCardHtml(sub, isSubOpen);
  }

  var html = (
    '<div class="cr-subagents-panel">' +
      '<div class="cr-subagents-toolbar">' +
        '<div class="cr-subagents-toolbar-left">' +
          '<span class="cr-subagents-title">Subagents</span>' +
          '<span class="cr-subagents-count-badge">' + subagents.length + '</span>' +
        '</div>' +
        '<div class="cr-subagents-toolbar-right">' +
          '<span class="cr-subagents-toolbar-desc">click on the drop to check the complete excution of subagents</span>' +
        '</div>' +
      '</div>' +
      '<div class="cr-subagents-list" id="crSubagentsList">' +
        cardsHtml +
      '</div>' +
    '</div>'
  );

  container.innerHTML = html;

  // Bind click handlers for action buttons (Resume, Stop, Pause)
  if (typeof container.querySelectorAll === 'function') {
    var resumeBtns = container.querySelectorAll('.cr-subagent-resume-btn');
    for (var r = 0; r < resumeBtns.length; r++) {
      resumeBtns[r].onclick = handleResumeClick;
    }

    var pauseBtns = container.querySelectorAll('.cr-subagent-pause-btn');
    for (var p = 0; p < pauseBtns.length; p++) {
      pauseBtns[p].onclick = handlePauseClick;
    }

    var stopBtns = container.querySelectorAll('.cr-subagent-stop-btn');
    for (var st = 0; st < stopBtns.length; st++) {
      stopBtns[st].onclick = handleStopClick;
    }

    // Bind click handler for "View Subagent Traces ↗" links
    var traceLinks = container.querySelectorAll('.cr-subagent-view-trace-link');
    for (var t = 0; t < traceLinks.length; t++) {
      traceLinks[t].onclick = handleViewTraceClick;
    }

    var diffAcceptBtns = container.querySelectorAll('.cr-diff-accept');
    for (var da = 0; da < diffAcceptBtns.length; da++) {
      function onSubPanelDiffAcceptClick(ev) {
        var btn = ev.currentTarget;
        var dId = btn.getAttribute('data-diff-id');
        if (dId && typeof window !== 'undefined' && window.VSCODE_API) {
          window.VSCODE_API.postMessage({ type: 'acceptDiff', diffId: dId, sessionId: activeId });
        }
        if (typeof updateSubagentDiffStatus === 'function') {
          updateSubagentDiffStatus(activeId, dId, 'approved');
        } else if (typeof window !== 'undefined' && typeof window.updateSubagentDiffStatus === 'function') {
          window.updateSubagentDiffStatus(activeId, dId, 'approved');
        }
        var c = btn.closest('.cr-diff-card');
        if (c && typeof window !== 'undefined' && typeof window.setDiffCardStatus === 'function') {
          window.setDiffCardStatus(c, 'approved');
        }
        try {
          var allCards = document.querySelectorAll('.cr-diff-card[data-diff-id="' + dId + '"]');
          for (var ac = 0; ac < allCards.length; ac++) {
            if (typeof window.setDiffCardStatus === 'function') {
              window.setDiffCardStatus(allCards[ac], 'approved');
            }
          }
          if (typeof window !== 'undefined' && typeof window.refreshActiveAgentControls === 'function') {
            window.refreshActiveAgentControls();
          }
        } catch (_) {}
      }
      diffAcceptBtns[da].onclick = onSubPanelDiffAcceptClick;
    }

    var diffRejectBtns = container.querySelectorAll('.cr-diff-reject');
    for (var dr = 0; dr < diffRejectBtns.length; dr++) {
      function onSubPanelDiffRejectClick(ev) {
        var btn = ev.currentTarget;
        var dId = btn.getAttribute('data-diff-id');
        if (dId && typeof window !== 'undefined' && window.VSCODE_API) {
          window.VSCODE_API.postMessage({ type: 'rejectDiff', diffId: dId, sessionId: activeId });
        }
        if (typeof updateSubagentDiffStatus === 'function') {
          updateSubagentDiffStatus(activeId, dId, 'rejected');
        } else if (typeof window !== 'undefined' && typeof window.updateSubagentDiffStatus === 'function') {
          window.updateSubagentDiffStatus(activeId, dId, 'rejected');
        }
        var c = btn.closest('.cr-diff-card');
        if (c && typeof window !== 'undefined' && typeof window.setDiffCardStatus === 'function') {
          window.setDiffCardStatus(c, 'rejected');
        }
        try {
          var allCards = document.querySelectorAll('.cr-diff-card[data-diff-id="' + dId + '"]');
          for (var ac = 0; ac < allCards.length; ac++) {
            if (typeof window.setDiffCardStatus === 'function') {
              window.setDiffCardStatus(allCards[ac], 'rejected');
            }
          }
          if (typeof window !== 'undefined' && typeof window.refreshActiveAgentControls === 'function') {
            window.refreshActiveAgentControls();
          }
        } catch (_) {}
      }
      diffRejectBtns[dr].onclick = onSubPanelDiffRejectClick;
    }

    var diffFullBtns = container.querySelectorAll('.cr-diff-full-btn');
    for (var df = 0; df < diffFullBtns.length; df++) {
      function onSubPanelDiffFullClick(ev) {
        var btn = ev.currentTarget;
        var dId = btn.getAttribute('data-diff-id');
        if (dId && typeof window !== 'undefined' && window.VSCODE_API) {
          window.VSCODE_API.postMessage({ type: 'openDiffEditor', diffId: dId, sessionId: activeId });
        }
      }
      diffFullBtns[df].onclick = onSubPanelDiffFullClick;
    }

    var undoBtns = container.querySelectorAll('.cr-action-undo');
    for (var u = 0; u < undoBtns.length; u++) {
      function onSubPanelUndoClick(ev) {
        var btn = ev.currentTarget;
        var cpId = btn.getAttribute('data-cp-id');
        var fPath = btn.getAttribute('data-file-path');
        btn.disabled = true;
        btn.innerHTML = '↩ Undoing...';
        if (typeof window !== 'undefined' && window.VSCODE_API) {
          window.VSCODE_API.postMessage({
            type: 'undoCheckpoint',
            filePath: fPath,
            checkpointId: cpId,
            sessionId: activeId
          });
        }
      }
      undoBtns[u].onclick = onSubPanelUndoClick;
    }
  }
}

function handleResumeClick(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  var agentId = this.getAttribute('data-agent-id');
  if (agentId && window.VSCODE_API) {
    window.VSCODE_API.postMessage({ type: 'resumeSubagent', agentId: agentId });
  }
}

function handlePauseClick(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  var agentId = this.getAttribute('data-agent-id');
  if (agentId && window.VSCODE_API) {
    window.VSCODE_API.postMessage({ type: 'pauseSubagent', agentId: agentId });
  }
}

function handleStopClick(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  var agentId = this.getAttribute('data-agent-id');
  if (agentId && window.VSCODE_API) {
    window.VSCODE_API.postMessage({ type: 'stopSubagent', agentId: agentId, reason: 'Stopped by user from Subagents panel' });
  }
}

function handleViewTraceClick(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  var agentId = this.getAttribute('data-subagent-id');
  if (window.switchDashboardSubView) {
    window.switchDashboardSubView('subagentTraces', agentId);
  }
}

export function handleSubagentEvent(event) {
  if (!event || !event.sessionId) return;
  var subagents = getSubagentListForSession(event.sessionId);
  var agentId = event.agentId || (event.data && event.data.agentId);
  if (!agentId) return;

  var found = false;
  for (var i = 0; i < subagents.length; i++) {
    if (subagents[i].agentId === agentId || subagents[i].id === agentId) {
      found = true;
      if (event.status) subagents[i].status = event.status;
      if (event.role) subagents[i].role = event.role;
      if (event.task) subagents[i].task = event.task;
      if (event.data) {
        for (var k in event.data) {
          subagents[i][k] = event.data[k];
        }
      }
      break;
    }
  }

  if (!found) {
    subagents.push({
      agentId: agentId,
      role: event.role || (event.data && event.data.role) || 'coder',
      status: event.status || (event.data && event.data.status) || 'running',
      task: event.task || (event.data && event.data.task) || '',
      startedAt: Date.now()
    });
  }

  saveSubagentListForSession(event.sessionId, subagents);

  var subContainer = document.getElementById('subagents-area-container');
  if (subContainer && subContainer.style.display !== 'none') {
    renderSubagentsView(subContainer);
  }
}

// Attach helpers to window for global access
if (typeof window !== 'undefined') {
  window.renderSubagentsView = renderSubagentsView;
  window.handleSubagentEvent = handleSubagentEvent;
}
