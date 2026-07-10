// memoryManager.js — Manages agent memory across conversations
// Placeholder architecture — can be extended with vector DB, file-based memory, etc.

var memories = [];

export function add(content, meta) {
  memories.push({
    content: content,
    meta: meta || {},
    timestamp: Date.now()
  });
}

export function getAll() {
  return memories.slice();
}

export function getRecent(count) {
  return memories.slice(-count);
}

export function search(query) {
  // Simple substring search — replace with semantic search later
  return memories.filter(function(m) {
    return m.content.toLowerCase().includes(query.toLowerCase());
  });
}

export function clear() {
  memories = [];
}

export function remove(index) {
  memories.splice(index, 1);
}

export function getPromptFragment(maxItems) {
  maxItems = maxItems || 5;
  var recent = getRecent(maxItems);
  if (!recent.length) return '';
  return recent.map(function(m) { return '- ' + m.content; }).join('\n');
}