// conversationStore.js — Conversation storage and management

import { STORAGE_KEYS } from './constants.js';
import { safeJsonParse, genId } from './utils.js';

var _conversations = null;

export function loadConversations() {
  if (_conversations) return _conversations;
  try {
    var raw = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
    _conversations = safeJsonParse(raw, []);
  } catch (_) {
    _conversations = [];
  }
  return _conversations;
}

export function saveConversations(conversations) {
  _conversations = conversations || [];
  try {
    localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(_conversations));
  } catch (_) {}
}

export function createConversation(title) {
  var conv = {
    id: genId(),
    title: title || 'New chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  var convs = loadConversations();
  convs.unshift(conv);
  saveConversations(convs);
  return conv;
}

export function getConversation(id) {
  return loadConversations().find(function(c) { return c.id === id; });
}

export function updateConversation(id, updates) {
  var convs = loadConversations();
  var idx = convs.findIndex(function(c) { return c.id === id; });
  if (idx === -1) return null;
  convs[idx] = Object.assign({}, convs[idx], updates, { updatedAt: Date.now() });
  saveConversations(convs);
  return convs[idx];
}

export function deleteConversation(id) {
  var convs = loadConversations().filter(function(c) { return c.id !== id; });
  saveConversations(convs);
  return convs;
}

export function renameConversation(id, title) {
  return updateConversation(id, { title: title });
}

export function addMessage(convId, role, content, extra) {
  extra = extra || {};
  var conv = getConversation(convId);
  if (!conv) return null;
  if (!conv.messages) conv.messages = [];

  var message = {
    role: role,
    content: content || '',
    timestamp: Date.now()
  };
  if (extra.thinking) message.thinking = extra.thinking;
  if (extra.sources) message.sources = extra.sources;
  if (extra.image) message.image = extra.image;
  if (extra.images) message.images = extra.images;
  if (extra.tool_calls) message.tool_calls = extra.tool_calls;
  if (extra.tool_call_id) message.tool_call_id = extra.tool_call_id;
  if (extra.tool_name) message.tool_name = extra.tool_name;
  if (extra.result) message.result = extra.result;

  var last = conv.messages[conv.messages.length - 1];
  if (last && last.role === role) {
    if (content) last.content = content;
    if (message.thinking) last.thinking = message.thinking;
    if (message.sources) last.sources = message.sources;
    if (message.tool_calls) last.tool_calls = message.tool_calls;
    if (message.tool_name) last.tool_name = message.tool_name;
    if (message.result) last.result = message.result;
  } else {
    conv.messages.push(message);
  }

  if (conv.title === 'New chat' && role === 'user' && content) {
    conv.title = content.slice(0, 44) + (content.length > 44 ? '...' : '');
  }

  conv.updatedAt = Date.now();
  saveConversations(loadConversations());
  return conv;
}

export function clearAllConversations() {
  _conversations = [];
  saveConversations([]);
}

export function exportConversations() {
  return JSON.stringify(loadConversations(), null, 2);
}

export function importConversations(json) {
  var convs = safeJsonParse(json, []);
  if (Array.isArray(convs)) {
    saveConversations(convs);
    return convs;
  }
  return null;
}