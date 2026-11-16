// browser-tools-handler.js (UI side)
// Message router and handler for browser tool UI messages
// Pure functions, traditional function declarations only. Zero arrow functions, zero classes.

import { handleBrowserEvent } from '../chats/chats-browser-manager.js';

// ==========================================
// HANDLERS
// ==========================================

export function handleVscodeBrowserMessage(message) {
  if (!message) return;
  handleBrowserEvent(message);
}
