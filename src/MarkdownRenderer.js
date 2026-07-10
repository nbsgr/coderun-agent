// MarkdownRenderer.js — Markdown to HTML with syntax highlighting
// Exposes: window.renderMarkdown(text) → HTML string

(function () {
  'use strict';

  var COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  var HIGHLIGHTERS = {
    javascript: function(code) {
      return code
        .replace(/\b(function|return|var|let|const|if|else|for|while|switch|case|break|continue|new|this|typeof|instanceof|in|of|async|await|import|export|from|class|extends|super|try|catch|finally|throw|yield|default)\b/g, '<span class="md-kw">$1</span>')
        .replace(/\b(true|false|null|undefined|NaN|Infinity)\b/g, '<span class="md-bool">$1</span>')
        .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="md-str">$1</span>')
        .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="md-num">$1</span>')
        .replace(/(\/\/.*$)/gm, '<span class="md-comment">$1</span>')
        .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="md-func">$1</span>');
    },
    python: function(code) {
      return code
        .replace(/\b(def|class|return|if|elif|else|for|while|try|except|finally|with|as|import|from|raise|assert|lambda|yield|pass|break|continue|global|nonlocal|del|in|is|not|and|or|True|False|None|async|await)\b/g, '<span class="md-kw">$1</span>')
        .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|"""[\s\S]*?"""|'''[\s\S]*?''')/g, '<span class="md-str">$1</span>')
        .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="md-num">$1</span>')
        .replace(/(#.*$)/gm, '<span class="md-comment">$1</span>')
        .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="md-func">$1</span>');
    },
    json: function(code) {
      return code
        .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="md-str">$1</span>')
        .replace(/\b(true|false|null)\b/g, '<span class="md-bool">$1</span>')
        .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="md-num">$1</span>');
    },
    bash: function(code) {
      return code
        .replace(/(#.*$)/gm, '<span class="md-comment">$1</span>')
        .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="md-str">$1</span>')
        .replace(/\b(echo|cd|ls|mkdir|rm|cp|mv|cat|grep|find|chmod|sudo|apt|pip|npm|node|python|python3|curl|wget|git|docker|kubectl)\b/g, '<span class="md-kw">$1</span>');
    },
    html: function(code) {
      return code
        .replace(/(&lt;\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^&>]*)?&gt;)/g, '<span class="md-tag">$1</span>')
        .replace(/([a-zA-Z-]+)=/g, '<span class="md-attr">$1</span>=')
        .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="md-str">$1</span>');
    },
    css: function(code) {
      return code
        .replace(/([a-zA-Z-]+)(?=\s*[:{])/g, '<span class="md-attr">$1</span>')
        .replace(/(:\s*)([^;{}]+)/g, '$1<span class="md-val">$2</span>')
        .replace(/(\/\*.*?\*\/)/g, '<span class="md-comment">$1</span>');
    }
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

  var _copyBound = false;
  function bindCopyHandler() {
    if (_copyBound) return;
    _copyBound = true;
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.md-copy-btn');
      if (!btn) return;
      var wrap = btn.closest('.md-code-wrap');
      if (!wrap) return;
      var codeEl = wrap.querySelector('code');
      var text = codeEl ? codeEl.textContent : '';
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () {
          btn.classList.add('md-copied');
          setTimeout(function () { btn.classList.remove('md-copied'); }, 1500);
        }).catch(function(err) {
          console.warn('Copy failed:', err);
        });
      } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          btn.classList.add('md-copied');
          setTimeout(function () { btn.classList.remove('md-copied'); }, 1500);
        } catch (e) {}
        document.body.removeChild(ta);
      }
    });
  }

  function renderMarkdown(raw) {
    if (!raw) return '';
    bindCopyHandler();
    var t = String(raw);
    t = esc(t);

    // Fenced code blocks
    t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
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
    });

    // Inline code
    t = t.replace(/`([^`\n]+)`/g, '<code class="md-inline-code">$1</code>');

    // Bold + italic
    t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
    t = t.replace(/__(.+?)__/g, '<strong>$1</strong>');
    t = t.replace(/_([^_\n]+)_/g, '<em>$1</em>');

    // Strikethrough
    t = t.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Headings
    t = t.replace(/^###### (.+)$/gm, '<h6 class="md-h6">$1</h6>');
    t = t.replace(/^##### (.+)$/gm, '<h5 class="md-h5">$1</h5>');
    t = t.replace(/^#### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
    t = t.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    t = t.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
    t = t.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>');

    // Horizontal rule
    t = t.replace(/^---+$/gm, '<hr class="md-hr"/>');

    // Block quote
    t = t.replace(/(^> .+\n?)+/gm, function (block) {
      return '<blockquote class="md-blockquote">' + block.replace(/^> /gm, '').trim() + '</blockquote>\n';
    });

    // Tables
    t = t.replace(/(\|.+\|\n\|[-:]+\|\n(?:\|.+\|\n?)+)/g, function(table) {
      var rows = table.trim().split('\n');
      var html = '<table class="md-table">';
      rows.forEach(function(row, i) {
        if (i === 1) return;
        var cells = row.split('|').filter(function(c) { return c.trim() !== ''; });
        var tag = i === 0 ? 'th' : 'td';
        html += '<tr>' + cells.map(function(c) { return '<' + tag + '>' + c.trim() + '</' + tag + '>'; }).join('') + '</tr>';
      });
      html += '</table>';
      return html;
    });

    // Unordered list
    t = t.replace(/(^[-*+] .+\n?)+/gm, function (block) {
      var items = block.trim().split('\n').map(function (l) {
        return '<li class="md-li">' + l.replace(/^[-*+] /, '') + '</li>';
      }).join('');
      return '<ul class="md-ul">' + items + '</ul>\n';
    });

    // Ordered list
    t = t.replace(/(^\d+\. .+\n?)+/gm, function (block) {
      var items = block.trim().split('\n').map(function (l) {
        return '<li class="md-li">' + l.replace(/^\d+\. /, '') + '</li>';
      }).join('');
      return '<ol class="md-ol">' + items + '</ol>\n';
    });

    // Images
    t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img class="md-img" alt="$1" src="$2"/>');

    // Links
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener">$1</a>');

    // Paragraphs
    var blockRe = /^<(div|ul|ol|h[1-6]|pre|blockquote|hr|img|table)/;
    var sections = t.split(/\n{2,}/);
    t = sections.map(function (sec) {
      sec = sec.trim();
      if (!sec) return '';
      if (blockRe.test(sec)) return sec;
      return '<p class="md-p">' + sec.replace(/\n/g, '<br>') + '</p>';
    }).filter(Boolean).join('\n');

    return t;
  }

  window.renderMarkdown = renderMarkdown;
}());