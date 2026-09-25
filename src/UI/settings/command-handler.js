// command-handler.js (UI side)
// Handles incoming command messages from the extension (like switching views)
// Strict traditional function declarations only

export function handlesettingsviewcommand() {
  console.log('[CODERUN UI] handlesettingsviewcommand triggered');
  if (typeof window.showSettingsView === 'function') {
    window.showSettingsView();
  }
}

export function handlechatviewcommand() {
  console.log('[CODERUN UI] handlechatviewcommand triggered');
  if (typeof window.showChatView === 'function') {
    window.showChatView();
  }
}
