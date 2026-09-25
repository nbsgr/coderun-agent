// MarkdownRenderer.js — Production Markdown to HTML Renderer with Syntax Highlighting
// Attaches to window.renderMarkdown & globalThis.renderMarkdown

var COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeUrl(url) {
  if (!url) return '#';
  var clean = String(url).trim();
  var lower = clean.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:text/html')) {
    return '#';
  }

  if (lower.startsWith('vscode-webview:') || lower.indexOf('vscode-resource') !== -1 || lower.indexOf('vscode-cdn') !== -1 || lower.startsWith('data:image/') || lower.startsWith('data:video/')) {
    return clean;
  }

  // Dynamic media resolution for webview environment
  if (typeof window !== 'undefined' && window.CODERUN_MEDIA_DIR_PATH && window.CODERUN_MEDIA_ROOT_URI) {
    var normClean = clean.replace(/\\/g, '/').toLowerCase();
    var normDir = String(window.CODERUN_MEDIA_DIR_PATH).replace(/\\/g, '/').toLowerCase();
    if (normClean.indexOf(normDir) !== -1 || normClean.indexOf('/media/') !== -1) {
      var segs = clean.split(/[/\\]/);
      var filename = segs[segs.length - 1];
      if (filename && filename.indexOf('?') !== -1) filename = filename.split('?')[0];
      if (filename && /\.(png|jpg|jpeg|webp|gif|svg|mp4|webm|mov|mkv)$/i.test(filename)) {
        return window.CODERUN_MEDIA_ROOT_URI + '/' + filename;
      }
    }
  }

  if (lower.startsWith('http:') || lower.startsWith('https:') || lower.startsWith('file:') ||
      lower.startsWith('vscode:') || lower.startsWith('mailto:') || lower.startsWith('/') ||
      lower.startsWith('./') || lower.startsWith('../') || lower.startsWith('#')) {
    return clean;
  }
  return clean;
}

function highlightJavaScript(code) {
  var escaped = esc(code);
  var tokens = [];
  function replaceJavaScriptToken(match) {
    var placeholder = '\uE004JS_' + tokens.length + '\uE005';
    var isComment = match.startsWith('//') || match.startsWith('/*');
    var cls = isComment ? 'md-comment' : 'md-str';
    tokens.push('<span class="' + cls + '">' + match + '</span>');
    return placeholder;
  }
  var clean = escaped.replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, replaceJavaScriptToken);

  clean = clean
    .replace(/\b(function|return|var|let|const|if|else|for|while|switch|case|break|continue|new|this|typeof|instanceof|in|of|async|await|import|export|from|class|extends|super|try|catch|finally|throw|yield|default)\b/g, '<span class="md-kw">$1</span>')
    .replace(/\b(true|false|null|undefined|NaN|Infinity)\b/g, '<span class="md-bool">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="md-num">$1</span>')
    .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="md-func">$1</span>');

  for (var i = 0; i < tokens.length; i++) {
    clean = clean.replace('\uE004JS_' + i + '\uE005', tokens[i]);
  }
  return clean;
}

function highlightPython(code) {
  var escaped = esc(code);
  var tokens = [];
  function replacePythonToken(match) {
    var placeholder = '\uE004PY_' + tokens.length + '\uE005';
    var isComment = match.startsWith('#');
    var cls = isComment ? 'md-comment' : 'md-str';
    tokens.push('<span class="' + cls + '">' + match + '</span>');
    return placeholder;
  }
  var clean = escaped.replace(/(#[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, replacePythonToken);

  clean = clean
    .replace(/\b(def|class|return|if|elif|else|for|while|try|except|finally|with|as|import|from|raise|assert|lambda|yield|pass|break|continue|global|nonlocal|del|in|is|not|and|or|True|False|None|async|await)\b/g, '<span class="md-kw">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="md-num">$1</span>')
    .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="md-func">$1</span>');

  for (var i = 0; i < tokens.length; i++) {
    clean = clean.replace('\uE004PY_' + i + '\uE005', tokens[i]);
  }
  return clean;
}

function highlightJson(code) {
  var escaped = esc(code);
  var tokens = [];
  function replaceJsonToken(match) {
    var placeholder = '\uE004JSON_' + tokens.length + '\uE005';
    tokens.push('<span class="md-str">' + match + '</span>');
    return placeholder;
  }
  var clean = escaped.replace(/("(?:[^"\\]|\\.)*")/g, replaceJsonToken);

  clean = clean
    .replace(/\b(true|false|null)\b/g, '<span class="md-bool">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="md-num">$1</span>');

  for (var i = 0; i < tokens.length; i++) {
    clean = clean.replace('\uE004JSON_' + i + '\uE005', tokens[i]);
  }
  return clean;
}

function highlightBash(code) {
  var escaped = esc(code);
  var tokens = [];
  function replaceBashToken(match) {
    var placeholder = '\uE004SH_' + tokens.length + '\uE005';
    var isComment = match.startsWith('#');
    var cls = isComment ? 'md-comment' : 'md-str';
    tokens.push('<span class="' + cls + '">' + match + '</span>');
    return placeholder;
  }
  var clean = escaped.replace(/(#[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, replaceBashToken);

  clean = clean
    .replace(/\b(echo|cd|ls|mkdir|rm|cp|mv|cat|grep|find|chmod|sudo|apt|pip|npm|node|python|python3|curl|wget|git|docker|kubectl)\b/g, '<span class="md-kw">$1</span>');

  for (var i = 0; i < tokens.length; i++) {
    clean = clean.replace('\uE004SH_' + i + '\uE005', tokens[i]);
  }
  return clean;
}

function highlightHtml(code) {
  return esc(code)
    .replace(/(&lt;\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^&>]*)?&gt;)/g, '<span class="md-tag">$1</span>');
}

function highlightCss(code) {
  return esc(code)
    .replace(/([a-zA-Z-]+)(?=\s*[:{])/g, '<span class="md-attr">$1</span>')
    .replace(/(:\s*)([^;{}]+)/g, '$1<span class="md-val">$2</span>');
}

var HIGHLIGHTERS = {
  javascript: highlightJavaScript,
  js: highlightJavaScript,
  typescript: highlightJavaScript,
  ts: highlightJavaScript,
  python: highlightPython,
  py: highlightPython,
  json: highlightJson,
  bash: highlightBash,
  sh: highlightBash,
  shell: highlightBash,
  zsh: highlightBash,
  powershell: highlightBash,
  ps1: highlightBash,
  html: highlightHtml,
  xml: highlightHtml,
  css: highlightCss
};

function highlightCode(code, lang) {
  if (!lang) return esc(code);
  var highlighter = HIGHLIGHTERS[lang.toLowerCase()];
  if (highlighter) return highlighter(code);
  return esc(code);
}

function buildFencedCodeHtml(language, rawCode) {
  var lang = (language || '').trim();
  var raw = rawCode.replace(/\n$/, '').trim();
  if ((lang.toLowerCase() === 'json' || !lang) && (raw.startsWith('{') || raw.startsWith('['))) {
    try {
      var parsed = JSON.parse(raw);
      raw = JSON.stringify(parsed, null, 2);
      if (!lang) {
        lang = 'json';
      }
    } catch (catchErr) { console.debug('[MARKDOWN] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }
  }
  var highlighted = highlightCode(raw, lang);
  var encoded = encodeURIComponent(raw);
  return '<div class="md-code-block">' +
    '<div class="md-code-header">' +
      '<span class="md-code-lang">' + esc(lang || 'text') + '</span>' +
      '<button class="md-code-copy-btn" data-code="' + encoded + '">' +
        COPY_SVG +
        '<span class="md-copied-label">Copied!</span>' +
      '</button>' +
    '</div>' +
    '<pre><code class="language-' + esc(lang) + '">' + highlighted + '</code></pre>' +
  '</div>';
}

function buildInlineCodeHtml(code) {
  return '<code class="md-inline-code">' + esc(code) + '</code>';
}

function renderTableRow(row, tag) {
  var cells = row.split('|');
  if (cells.length > 2) {
    cells = cells.slice(1, -1);
  }
  var cellHtml = [];
  for (var ci = 0; ci < cells.length; ci++) {
    cellHtml.push('<' + tag + '>' + renderInlineStyles(cells[ci].trim()) + '</' + tag + '>');
  }
  return '<tr>' + cellHtml.join('') + '</tr>';
}

function renderTable(tableBlock) {
  var lines = tableBlock.trim().split('\n');
  if (lines.length < 2) return tableBlock;
  var header = renderTableRow(lines[0], 'th');
  var bodyRows = [];
  var startIdx = 1;
  if (lines.length > 1 && /^\|?[ \t]*:?[-]+:?[ \t]*(\|?[ \t]*:?[-]+:?[ \t]*)*\|?$/.test(lines[1])) {
    startIdx = 2;
  }
  for (var li = startIdx; li < lines.length; li++) {
    if (lines[li].trim()) {
      bodyRows.push(renderTableRow(lines[li], 'td'));
    }
  }
  return '<div class="md-table-wrap"><table>' +
    '<thead>' + header + '</thead>' +
    '<tbody>' + bodyRows.join('') + '</tbody>' +
  '</table></div>';
}

function renderListItems(listText, isOrdered) {
  var lines = listText.trim().split('\n');
  var items = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var itemContent = isOrdered ? line.replace(/^\s*\d+\.\s+/, '') : line.replace(/^\s*[-*+]\s+/, '');
    items.push('<li class="md-li">' + renderInlineStyles(itemContent).replace(/\n/g, '<br>') + '</li>');
  }
  var tag = isOrdered ? 'ol' : 'ul';
  var cls = isOrdered ? 'md-ol' : 'md-ul';
  return '<' + tag + ' class="' + cls + '">' + items.join('') + '</' + tag + '>';
}

function renderInlineStyles(text) {
  var s = esc(text);
  // Bold & Italic
  s = s.replace(/\*\*\*([^\*\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^\*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/\*([^\*\n]+?)\*/g, '<em>$1</em>');
  s = s.replace(/(^|\s)_([^_\n]+?)_(\s|$)/g, '$1<em>$2</em>$3');

  // Strikethrough
  s = s.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');

  // Images
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, replaceMarkdownImage);

  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, replaceMarkdownLink);

  return s;
}

function replaceMarkdownImage(match, alt, src) {
  var safeSrc = sanitizeUrl(src);
  var isVideo = /\.(mp4|webm|mov|mkv)(\?.*)?$/i.test(safeSrc) || safeSrc.startsWith('data:video/');
  if (isVideo) {
    return '<div class="cr-media-card cr-video-card" data-video-card="1">' +
      '<div class="cr-media-header">' +
        '<span class="cr-media-badge">🎬 Video</span>' +
        (alt ? '<span class="cr-media-alt">' + esc(alt) + '</span>' : '') +
      '</div>' +
      '<div class="cr-media-preview cr-video-preview">' +
        '<video controls playsinline preload="metadata" class="cr-media-video" src="' + esc(safeSrc) + '" data-media-src="' + esc(safeSrc) + '" onerror="if(!this.dataset.triedFallback){this.dataset.triedFallback=\'1\';if(window.requestMediaData){window.requestMediaData(this,\'' + esc(safeSrc) + '\');}}"></video>' +
        '<div class="cr-video-overlay-play">▶</div>' +
      '</div>' +
      '<div class="cr-video-controls">' +
        '<button type="button" class="cr-vid-btn cr-vid-play" title="Play / Pause">▶</button>' +
        '<button type="button" class="cr-vid-btn cr-vid-rewind" title="Rewind 10 seconds">⏪ -10s</button>' +
        '<button type="button" class="cr-vid-btn cr-vid-forward" title="Forward 10 seconds">⏩ +10s</button>' +
        '<span class="cr-vid-time cr-vid-time-current">0:00</span>' +
        '<div class="cr-vid-progress-container">' +
          '<input type="range" class="cr-vid-progress" min="0" max="100" step="0.1" value="0" title="Seek video" />' +
          '<div class="cr-vid-progress-fill"></div>' +
        '</div>' +
        '<span class="cr-vid-time cr-vid-time-duration">0:00</span>' +
        '<button type="button" class="cr-vid-btn cr-vid-mute" title="Mute / Unmute">🔊</button>' +
        '<button type="button" class="cr-vid-btn cr-vid-fullscreen" title="Fullscreen">⛶</button>' +
      '</div>' +
      '<div class="cr-media-actions">' +
        '<button type="button" class="cr-btn-save-media" data-media-path="' + esc(safeSrc) + '">📥 Save to Project</button>' +
        '<button type="button" class="cr-btn-copy-media" data-media-path="' + esc(safeSrc) + '">📋 Copy URL</button>' +
      '</div>' +
    '</div>';
  }

  return '<div class="cr-media-card cr-image-card">' +
    '<div class="cr-media-header">' +
      '<span class="cr-media-badge">🖼️ Image</span>' +
      (alt ? '<span class="cr-media-alt">' + esc(alt) + '</span>' : '') +
    '</div>' +
    '<div class="cr-media-preview">' +
      '<img src="' + esc(safeSrc) + '" alt="' + esc(alt.replace(/&amp;/g, '&')) + '" class="md-img" data-media-src="' + esc(safeSrc) + '" onerror="if(!this.dataset.triedFallback){this.dataset.triedFallback=\'1\';if(window.requestMediaData){window.requestMediaData(this,\'' + esc(safeSrc) + '\');}}" loading="lazy" />' +
    '</div>' +
    '<div class="cr-media-actions">' +
      '<button type="button" class="cr-btn-save-media" data-media-path="' + esc(safeSrc) + '">📥 Save to Project</button>' +
      '<button type="button" class="cr-btn-copy-media" data-media-path="' + esc(safeSrc) + '">📋 Copy URL</button>' +
    '</div>' +
  '</div>';
}

function replaceMarkdownLink(match, label, href) {
  var safeHref = sanitizeUrl(href);
  return '<a href="' + esc(safeHref) + '" target="_blank" rel="noopener noreferrer" class="md-link">' + label + '</a>';
}

function renderMarkdown(src) {
  if (!src) return '';
  var text = String(src).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 1. Extract Fenced Code Blocks into placeholders
  var codeBlocks = [];
  function replaceFencedCodeBlock(match, lang, code) {
    var placeholder = '\uE002CODEBLOCK_' + codeBlocks.length + '\uE003';
    codeBlocks.push(buildFencedCodeHtml(lang, code));
    return '\n\n' + placeholder + '\n\n';
  }
  text = text.replace(/```([a-zA-Z0-9_-]*)[ \t]*\n?([\s\S]*?)```/g, replaceFencedCodeBlock);

  // 2. Extract Inline Code into placeholders
  var inlineCodes = [];
  function replaceInlineCode(match, code) {
    var placeholder = '\uE002INLINECODE_' + inlineCodes.length + '\uE003';
    inlineCodes.push(buildInlineCodeHtml(code));
    return placeholder;
  }
  text = text.replace(/`([^`\n]+)`/g, replaceInlineCode);

  // 3. Process block elements
  var lines = text.split('\n');
  var out = [];
  var inList = false;
  var isOrderedList = false;
  var currentListLines = [];
  var inTable = false;
  var currentTableLines = [];
  var inBlockquote = false;
  var currentQuoteLines = [];

  function flushList() {
    if (currentListLines.length > 0) {
      var renderedList = renderListItems(currentListLines.join('\n'), isOrderedList);
      out.push(renderedList);
      currentListLines = [];
      inList = false;
    }
  }

  function flushTable() {
    if (currentTableLines.length > 0) {
      var renderedTable = renderTable(currentTableLines.join('\n'));
      out.push(renderedTable);
      currentTableLines = [];
      inTable = false;
    }
  }

  function flushQuote() {
    if (currentQuoteLines.length > 0) {
      var quoteContent = renderInlineStyles(currentQuoteLines.join('\n')).replace(/\n/g, '<br>');
      out.push('<blockquote class="md-blockquote">' + quoteContent + '</blockquote>');
      currentQuoteLines = [];
      inBlockquote = false;
    }
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();

    // Check code block placeholder
    if (trimmed.startsWith('\uE002CODEBLOCK_') && trimmed.endsWith('\uE003')) {
      flushList();
      flushTable();
      flushQuote();
      out.push(trimmed);
      continue;
    }

    // Check Table
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushList();
      flushQuote();
      inTable = true;
      currentTableLines.push(trimmed);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Check Blockquote
    if (trimmed.startsWith('>')) {
      flushList();
      flushTable();
      inBlockquote = true;
      currentQuoteLines.push(trimmed.replace(/^>\s?/, ''));
      continue;
    } else if (inBlockquote) {
      flushQuote();
    }

    // Check Headings
    if (/^######\s+(.+)$/.test(trimmed)) {
      flushList();
      var h6Text = trimmed.replace(/^######\s+/, '');
      out.push('<h6 class="md-h6">' + renderInlineStyles(h6Text) + '</h6>');
      continue;
    }
    if (/^#####\s+(.+)$/.test(trimmed)) {
      flushList();
      var h5Text = trimmed.replace(/^#####\s+/, '');
      out.push('<h5 class="md-h5">' + renderInlineStyles(h5Text) + '</h5>');
      continue;
    }
    if (/^####\s+(.+)$/.test(trimmed)) {
      flushList();
      var h4Text = trimmed.replace(/^####\s+/, '');
      out.push('<h4 class="md-h4">' + renderInlineStyles(h4Text) + '</h4>');
      continue;
    }
    if (/^###\s+(.+)$/.test(trimmed)) {
      flushList();
      var h3Text = trimmed.replace(/^###\s+/, '');
      out.push('<h3 class="md-h3">' + renderInlineStyles(h3Text) + '</h3>');
      continue;
    }
    if (/^##\s+(.+)$/.test(trimmed)) {
      flushList();
      var h2Text = trimmed.replace(/^##\s+/, '');
      out.push('<h2 class="md-h2">' + renderInlineStyles(h2Text) + '</h2>');
      continue;
    }
    if (/^#\s+(.+)$/.test(trimmed)) {
      flushList();
      var h1Text = trimmed.replace(/^#\s+/, '');
      out.push('<h1 class="md-h1">' + renderInlineStyles(h1Text) + '</h1>');
      continue;
    }

    // Check Horizontal Rule
    if (/^(---+|\*\*\*+|___+)$/.test(trimmed)) {
      flushList();
      out.push('<hr class="md-hr">');
      continue;
    }

    // Check Unordered List
    if (/^[-*+]\s+(.+)$/.test(trimmed)) {
      if (!inList || isOrderedList) {
        flushList();
        inList = true;
        isOrderedList = false;
      }
      currentListLines.push(trimmed);
      continue;
    }

    // Check Ordered List
    if (/^\d+\.\s+(.+)$/.test(trimmed)) {
      if (!inList || !isOrderedList) {
        flushList();
        inList = true;
        isOrderedList = true;
      }
      currentListLines.push(trimmed);
      continue;
    }

    // Empty line ends lists
    if (!trimmed) {
      flushList();
      flushTable();
      flushQuote();
      continue;
    }

    // If still in list and line is indented, treat as part of list item
    if (inList && (line.startsWith('  ') || line.startsWith('\t'))) {
      if (currentListLines.length > 0) {
        currentListLines[currentListLines.length - 1] += '<br>' + trimmed;
      }
      continue;
    }

    flushList();

    // Standard paragraph line
    out.push('<p class="md-p">' + renderInlineStyles(line) + '</p>');
  }

  flushList();
  flushTable();
  flushQuote();

  var resultHtml = out.join('\n');

  // 4. Restore Inline Code placeholders
  for (var j = 0; j < inlineCodes.length; j++) {
    resultHtml = resultHtml.replace('\uE002INLINECODE_' + j + '\uE003', inlineCodes[j]);
  }

  // 5. Restore Code Block placeholders
  for (var k = 0; k < codeBlocks.length; k++) {
    resultHtml = resultHtml.replace('\uE002CODEBLOCK_' + k + '\uE003', codeBlocks[k]);
  }

  return resultHtml;
}

if (typeof window !== 'undefined') {
  window.renderMarkdown = renderMarkdown;
  window.MarkdownRenderer = {
    render: renderMarkdown
  };
}

if (typeof globalThis !== 'undefined') {
  globalThis.renderMarkdown = renderMarkdown;
  globalThis.MarkdownRenderer = {
    render: renderMarkdown
  };
}