// chats-browser-manager.js (UI side)
// Pure implementations of browser card rendering, screenshot viewers, and state presentation.
// Pure functions, traditional function declarations only. Zero arrow functions, zero classes.

// ==========================================
// STATE & RENDERING
// ==========================================

export function handleBrowserEvent(message) {
  if (!message) return;
  var app = document.getElementById('app');
  if (!app) return;

  var existingCard = document.getElementById('cr-vscode-browser-status');
  if (existingCard) {
    existingCard.remove();
  }

  var actionTitle = message.success === false ? 'Integrated Browser Error' : 'Integrated Browser';
  var status = message.success === false
    ? (message.error || 'The browser operation failed.')
    : (message.isOpen === false ? 'Not connected' : 'Connected');
  var url = message.url || '';
  var card = renderBrowserActionCard(actionTitle, url, status);
  card.id = 'cr-vscode-browser-status';
  app.appendChild(card);
}

export function renderBrowserActionCard(actionTitle, url, status) {
  var card = document.createElement('div');
  card.className = 'cr-browser-card cr-vscode-browser-status';

  var header = document.createElement('div');
  header.className = 'cr-browser-card-title';
  header.textContent = '🌐 ' + (actionTitle || 'Browser Action');

  var body = document.createElement('div');
  body.className = 'cr-browser-card-body';
  body.textContent = (url ? ('URL: ' + url + ' ') : '') + (status ? ('(' + status + ')') : '');

  card.appendChild(header);
  card.appendChild(body);
  return card;
}
