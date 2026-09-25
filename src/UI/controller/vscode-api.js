// vscode-api.js (UI side)
// Singleton acquisition and export of VS Code Webview API
// Strict traditional function declarations only

var vscode = (typeof window !== 'undefined' && window.vscode)
  ? window.vscode
  : (typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null);

if (typeof window !== 'undefined') {
  window.vscode = vscode;
}

export { vscode };
