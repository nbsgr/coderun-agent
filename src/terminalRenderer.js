// terminalRenderer.js — Handles terminal output streaming in the chat UI

export function createTerminalRenderer(container) {
  var lines = [];
  var element = null;

  function ensureElement() {
    if (element) return element;
    element = document.createElement('div');
    element.className = 'cr-terminal-block';
    element.innerHTML = '<div class="cr-terminal-header"><span class="cr-terminal-label">Terminal</span></div><div class="cr-terminal-body"></div>';
    container.appendChild(element);
    return element;
  }

  function appendLine(text, type) {
    var body = ensureElement().querySelector('.cr-terminal-body');
    var line = document.createElement('div');
    line.className = 'cr-terminal-line ' + (type || 'out');
    line.textContent = text;
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
  }

  function appendCommand(cmd) {
    appendLine('$ ' + cmd, 'cmd');
  }

  function appendOutput(text) {
    var body = ensureElement().querySelector('.cr-terminal-body');
    var lines = String(text || '').split(/\r?\n/);
    lines.forEach(function(ln) {
      if (ln.length) {
        var line = document.createElement('div');
        line.className = 'cr-terminal-line out';
        line.textContent = ln;
        body.appendChild(line);
      }
    });
    body.scrollTop = body.scrollHeight;
  }

  function appendError(text) {
    appendLine(text, 'err');
  }

  function finish(success) {
    var header = ensureElement().querySelector('.cr-terminal-label');
    if (header) {
      header.textContent = 'Terminal ' + (success ? '✓' : '✗');
      header.style.color = success ? '#4ec9b0' : '#f85149';
    }
  }

  return {
    appendCommand: appendCommand,
    appendOutput: appendOutput,
    appendError: appendError,
    appendLine: appendLine,
    finish: finish,
    getElement: ensureElement
  };
}
