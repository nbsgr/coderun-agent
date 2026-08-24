// MarkdownRenderer.js — Markdown to HTML with syntax highlighting
// Exposes: window.renderMarkdown(text) → HTML string

(function () {
  'use strict';

  var COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  function highlightJavaScript(code) {
    return code
      .replace(/\b(function|return|var|let|const|if|else|for|while|switch|case|break|continue|new|this|typeof|instanceof|in|of|async|await|import|export|from|class|extends|super|try|catch|finally|throw|yield|default)\b/g, '<span class="md-kw">$1</span>')
      .replace(/\b(true|false|null|undefined|NaN|Infinity)\b/g, '<span class="md-bool">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="md-str">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="md-num">$1</span>')
      .replace(/(\/\/.*$)/gm, '<span class="md-comment">$1</span>')
      .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="md-func">$1</span>');
  }

  function highlightPython(code) {
    return code
      .replace(/\b(def|class|return|if|elif|else|for|while|try|except|finally|with|as|import|from|raise|assert|lambda|yield|pass|break|continue|global|nonlocal|del|in|is|not|and|or|True|False|None|async|await)\b/g, '<span class="md-kw">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|"""[\s\S]*?"""|'''[\s\S]*?''')/g, '<span class="md-str">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="md-num">$1</span>')
      .replace(/(#.*$)/gm, '<span class="md-comment">$1</span>')
      .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="md-func">$1</span>');
  }

  function highlightJson(code) {
    return code
      .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="md-str">$1</span>')
      .replace(/\b(true|false|null)\b/g, '<span class="md-bool">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="md-num">$1</span>');
  }

  function highlightBash(code) {
    return code
      .replace(/(#.*$)/gm, '<span class="md-comment">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="md-str">$1</span>')
      .replace(/\b(echo|cd|ls|mkdir|rm|cp|mv|cat|grep|find|chmod|sudo|apt|pip|npm|node|python|python3|curl|wget|git|docker|kubectl)\b/g, '<span class="md-kw">$1</span>');
  }

  function highlightHtml(code) {
    return code
      .replace(/(&lt;\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^&>]*)?&gt;)/g, '<span class="md-tag">$1</span>')
      .replace(/([a-zA-Z-]+)=/g, '<span class="md-attr">$1</span>=')
      .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="md-str">$1</span>');
  }

  function highlightCss(code) {
    return code
      .replace(/([a-zA-Z-]+)(?=\s*[:{])/g, '<span class="md-attr">$1</span>')
      .replace(/(:\s*)([^;{}]+)/g, '$1<span class="md-val">$2</span>')
      .replace(/(\/\*.*?\*\/)/g, '<span class="md-comment">$1</span>');
  }

  var HIGHLIGHTERS = {
    javascript: highlightJavaScript,
    python: highlightPython,
    json: highlightJson,
    bash: highlightBash,
    html: highlightHtml,
    css: highlightCss
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function highlightCode(code, lang) {
    if (!lang) return esc(code);
    var highlighter = HIGHLIGHTERS[lang.toLowerCase()];
    if (highlighter) return highlighter(esc(code));
    return esc(code);
  }

  function handleRemoveCopiedClass(btn) {
    btn.classList.remove('md-copied');
  }

  function handleClipboardSuccess(btn) {
    btn.classList.add('md-copied');
    setTimeout(handleRemoveCopiedClass.bind(null, btn), 1500);
  }

  function handleClipboardError(err) {
    console.warn('Copy failed:', err);
  }

  function handleDocumentClick(e) {
    var btn = e.target.closest('.md-copy-btn');
    if (!btn) return;
    var wrap = btn.closest('.md-code-wrap');
    if (!wrap) return;
    var codeEl = wrap.querySelector('code');
    var text = codeEl ? codeEl.textContent : '';
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
        .then(handleClipboardSuccess.bind(null, btn))
        .catch(handleClipboardError);
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        handleClipboardSuccess(btn);
      } catch (err) {
        handleClipboardError(err);
      }
      document.body.removeChild(ta);
    }
  }

  var _copyBound = false;
  function bindCopyHandler() {
    if (_copyBound) return;
    _copyBound = true;
    document.addEventListener('click', handleDocumentClick);
  }

  function replaceFencedCodeBlock(_, lang, code) {
    var cls = lang ? ' language-' + lang : '';
    var label = lang ? '<span class="md-code-lang">' + esc(lang) + '</span>' : '';
    var highlighted = highlightCode(code.replace(/\n$/, ''), lang);
    return (
      '<div class="md-code-wrap">' +
        '<div class="md-code-header">' + label +
          '<button class="md-copy-btn" title="Copy">' + COPY_SVG + '</button>' +
        '</div>' +
        '<pre class="md-pre"><code class="md-code' + cls + '">' + highlighted + '</code></pre>' +
      '</div>'
    );
  }

  function replaceInlineCode(_, content) {
    return '<code class="md-inline-code">' + content + '</code>';
  }

  function replaceBoldItalic1(_, text) { return '<strong><em>' + text + '</em></strong>'; }
  function replaceBold1(_, text) { return '<strong>' + text + '</strong>'; }
  function replaceItalic1(_, text) { return '<em>' + text + '</em>'; }
  function replaceBold2(_, text) { return '<strong>' + text + '</strong>'; }
  function replaceItalic2(_, text) { return '<em>' + text + '</em>'; }
  function replaceStrikethrough(_, text) { return '<del>' + text + '</del>'; }
  function replaceHeading6(_, text) { return '<h6 class="md-h6">' + text + '</h6>'; }
  function replaceHeading5(_, text) { return '<h5 class="md-h5">' + text + '</h5>'; }
  function replaceHeading4(_, text) { return '<h4 class="md-h4">' + text + '</h4>'; }
  function replaceHeading3(_, text) { return '<h3 class="md-h3">' + text + '</h3>'; }
  function replaceHeading2(_, text) { return '<h2 class="md-h2">' + text + '</h2>'; }
  function replaceHeading1(_, text) { return '<h1 class="md-h1">' + text + '</h1>'; }
  function replaceHorizontalRule() { return '<hr class="md-hr"/>'; }

  function replaceBlockQuote(block) {
    return '<blockquote class="md-blockquote">' + block.replace(/^> /gm, '').trim() + '</blockquote>\n';
  }

  function replaceTable(table) {
    var rawRows = table.trim().split('\n');
    var html = '<div class="md-table-wrap"><table class="md-table">';
    var isHeader = true;
    for (var i = 0; i < rawRows.length; i++) {
      var row = rawRows[i].trim();
      if (!row) continue;
      if (/^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?$/.test(row)) {
        isHeader = false;
        continue;
      }
      var rawCells = row.replace(/^\|/, '').replace(/\|$/, '').split('|');
      var tag = isHeader ? 'th' : 'td';
      var cols = [];
      for (var ci = 0; ci < rawCells.length; ci++) {
        var cellText = rawCells[ci].trim();
        cols.push('<' + tag + '>' + cellText + '</' + tag + '>');
      }
      html += '<tr>' + cols.join('') + '</tr>';
      if (isHeader) isHeader = false;
    }
    html += '</table></div>';
    return html;
  }

  function renderUnorderedListItem(l) {
    return '<li class="md-li">' + l.replace(/^[-*+] /, '') + '</li>';
  }

  function replaceUnorderedList(block) {
    var rawLines = block.trim().split('\n');
    var items = [];
    for (var li = 0; li < rawLines.length; li++) {
      items.push(renderUnorderedListItem(rawLines[li]));
    }
    return '<ul class="md-ul">' + items.join('') + '</ul>\n';
  }

  function renderOrderedListItem(l) {
    return '<li class="md-li">' + l.replace(/^\d+\. /, '') + '</li>';
  }

  function replaceOrderedList(block) {
    var rawLines = block.trim().split('\n');
    var items = [];
    for (var li = 0; li < rawLines.length; li++) {
      items.push(renderOrderedListItem(rawLines[li]));
    }
    return '<ol class="md-ol">' + items.join('') + '</ol>\n';
  }

  function replaceImage(_, alt, src) {
    return '<img class="md-img" alt="' + alt + '" src="' + src + '"/>';
  }

  function replaceLink(_, text, href) {
    return '<a class="md-link" href="' + href + '" target="_blank" rel="noopener">' + text + '</a>';
  }

  var BLOCK_RE = /^<(div|ul|ol|h[1-6]|pre|blockquote|hr|img|table)/;

  function renderSection(sec) {
    var trimmed = sec.trim();
    if (!trimmed) return '';
    if (BLOCK_RE.test(trimmed)) return trimmed;
    return '<p class="md-p">' + trimmed.replace(/\n/g, '<br>') + '</p>';
  }

  function renderMarkdown(raw) {
    if (!raw) return '';
    bindCopyHandler();
    var t = String(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    t = esc(t);

    // Fenced code blocks
    t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, replaceFencedCodeBlock);

    // Inline code
    t = t.replace(/`([^`\n]+)`/g, replaceInlineCode);

    // Bold + italic
    t = t.replace(/\*\*\*(.+?)\*\*\*/g, replaceBoldItalic1);
    t = t.replace(/\*\*(.+?)\*\*/g, replaceBold1);
    t = t.replace(/\*(.+?)\*/g, replaceItalic1);
    t = t.replace(/__(.+?)__/g, replaceBold2);
    t = t.replace(/_([^_\n]+)_/g, replaceItalic2);

    // Strikethrough
    t = t.replace(/~~(.+?)~~/g, replaceStrikethrough);

    // Tables
    t = t.replace(/(^\|[^\n]+\|\n\|[ \t]*[-|: ]+\|\n(?:\|[^\n]+\|\n?)+)/gm, replaceTable);

    // Headings
    t = t.replace(/^###### (.+)$/gm, replaceHeading6);
    t = t.replace(/^##### (.+)$/gm, replaceHeading5);
    t = t.replace(/^#### (.+)$/gm, replaceHeading4);
    t = t.replace(/^### (.+)$/gm, replaceHeading3);
    t = t.replace(/^## (.+)$/gm, replaceHeading2);
    t = t.replace(/^# (.+)$/gm, replaceHeading1);

    // Horizontal rule
    t = t.replace(/^---+$/gm, replaceHorizontalRule);

    // Block quote
    t = t.replace(/(^> .+\n?)+/gm, replaceBlockQuote);

    // Tables
    t = t.replace(/(\|.+\|\n\|[-:]+\|\n(?:\|.+\|\n?)+)/g, replaceTable);

    // Unordered list
    t = t.replace(/(^[-*+] .+\n?)+/gm, replaceUnorderedList);

    // Ordered list
    t = t.replace(/(^\d+\. .+\n?)+/gm, replaceOrderedList);

    // Images
    t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, replaceImage);

    // Links
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, replaceLink);

    // Paragraphs
    var sections = t.split(/\n{2,}/);
    var renderedSecs = [];
    for (var si = 0; si < sections.length; si++) {
      var rendered = renderSection(sections[si]);
      if (rendered) {
        renderedSecs.push(rendered);
      }
    }
    t = renderedSecs.join('\n');

    return t;
  }

  window.renderMarkdown = renderMarkdown;
})();