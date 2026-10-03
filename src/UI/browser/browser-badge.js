// browser-badge.js (UI side)
// Renders visual badges and indicators distinguishing Qwen Browser sessions.
// Strict traditional function declarations only.

function renderBrowserBadge(modelName) {
  var label = modelName ? ('🌐 Qwen Browser • ' + modelName) : '🌐 Qwen Browser API';
  return '<div class="cr-browser-badge" title="Reverse-engineered Qwen Browser Session with native Web Search & Vision">' +
    '<span class="cr-browser-badge-icon">🌐</span>' +
    '<span>' + (modelName || 'Qwen Browser') + '</span>' +
  '</div>';
}

function renderThreadBrowserTag() {
  return '<span class="cr-browser-thread-tag" title="Qwen Browser Session">🌐 Qwen</span>';
}

if (typeof window !== 'undefined') {
  window.renderBrowserBadge = renderBrowserBadge;
  window.renderThreadBrowserTag = renderThreadBrowserTag;
}
