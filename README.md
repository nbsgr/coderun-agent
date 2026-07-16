# CodeRun AI Agent 🚀

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue?logo=visual-studio-code)](https://github.com/nbsgr/coderun-agent.git)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/nbsgr/coderun-agent/pulls)

**CodeRun AI Agent** is a professional, multi-provider AI coding companion for Visual Studio Code. Operating as a state-of-the-art agentic loop, CodeRun acts as a decision-maker to read, write, and edit files, index codebases in a local SQLite database, and run terminal processes using VS Code's integrated terminal. 

Whether you are running completely offline with local models (Ollama), leveraging official API keys (OpenAI, Anthropic, Gemini, Groq, OpenRouter), or routing custom endpoints (Cloudflare Workers AI, Aero Link), CodeRun delivers an exceptionally integrated and secure developer experience.

---

## 🌟 Key Highlights & Features

### 🤖 Multi-Provider Model Orchestration
*   **8 Native Providers Supported:** Ollama, OpenAI, Anthropic Claude, Google Gemini, Groq, OpenRouter, xAI (Grok), and OpenAI Compatible.
*   **Saved Provider Configurations:** Save credentials (API keys, base URLs, default models) for multiple endpoints. Switch models on the fly in the middle of a chat session without resetting settings.
*   **Unified Model Dropdown:** All models from your active and saved providers are dynamically retrieved and presented in a single, clean dropdown, grouped logically by provider.
*   **API Type Selection:** Custom compatible providers support setting the underlying **API Type** (**OpenAI Compatible**, **Anthropic Compatible**, or **Google Gemini Compatible**) to correctly format request bodies, endpoint paths, and API headers.
*   **Cloudflare Workers AI Support:** Dynamically parses Cloudflare base URLs to extract your Account ID and retrieve model lists using Cloudflare's search API, before cleanly returning to standard completions.

### 💬 Streamlined Chat & Agent UI
*   **Streaming Content & Thinking:** Real-time stream processing for thinking process blocks, final content, and tool execution.
*   **Interactive Collapsible Tool Cards:** Status messages, step durations, and arguments expand and collapse cleanly in real time as the agent progresses.
*   **Direct Console Blocks:** Suppresses redundant cards for shell integration to stream terminal outputs directly inside a dark console terminal box.
*   **Unified Embedded Permissions:** Authorizations (Allow, Deny, Always Allow, Always Deny) are integrated directly inside the active tool card with horizontal scrolls, removing annoying overlay modals.
*   **Inline Diff Reviews:** Inspect proposed file changes block-by-block directly in the chat window, showing green additions and red deletions. Click **Accept** or **Reject** right inside the card.
*   **Task Continuation:** A single-click **Continue Task** button appears automatically when hitting execution limits to resume the agent's work loop.

### 🧠 Advanced Agent Loop
*   **Think → Plan → Act → Verify:** Multi-iteration loop executing tool actions one at a time, verifying outputs, and learning repository styles.
*   **Parallel Tool Execution:** Executes multiple independent tool calls concurrently (e.g. reading or writing multiple files) using `Promise.all` for high performance.
*   **Transparent Tool Aliasing:** Declares explicit schemas and maps habit-based model tools (**`bash`**, **`execute_command`**, **`read`**, **`write`**, **`edit`**) to CodeRun's native implementations, providing full compatibility with Claude Code proxy environments (like Aero Link).
*   **Reasoning Models Support:** Captures and extracts thoughts from reasoning models (like Gemma 4 and DeepSeek-R1) via `thought`, `reasoning_content`, and `reasoning` keys, rendering them in a dedicated collapsible **Thought Process** card.

### ↩️ Undo & Automatic Checkpoints
*   **Database-Backed Snapshots:** CodeRun takes automatic snapshots of your files in a local SQLite database before any write, edit, or delete action.
*   **Single-Click Restore:** An **Undo** button appears under assistant responses that modified your files. Click it to restore files instantly.
*   **Command Palette Integration:** Run `CodeRun: Undo Last Edit` at any time to roll back changes.

### 📁 SQLite Project Knowledge Base
*   **SQLite-Powered Index:** Uses `sql.js` to run a local SQLite database (`index.db`) in your global storage, keeping track of file metadata, chunk hashes, and project metrics.
*   **Symbol Outlines:** The `list_symbols` tool parses files to outline functions, classes, and structs with line numbers.
*   **Incremental Indexing:** Runs in the background, updating only changed files detected by file watchers.
*   **Fallback Search:** `find_in_files` and `search_files` query the SQLite database for instant matches and fall back to filesystem scans if the database is indexing.

### 🖥️ Enhanced Terminal Execution
*   **Inline Collapsible Terminal Cards:** Every terminal execution appears as its own independent collapsible card inside the conversation timeline — no more fixed terminal panel at the top of the chat.
*   **True Streaming Output:** stdout/stderr is streamed incrementally (appended, not replaced) with live updates as the command runs.
*   **Automatic Shell Detection:** The tool auto-detects PowerShell, Command Prompt (cmd), Git Bash, WSL, Bash, Zsh, and Fish — providing shell metadata directly to the LLM so it generates correct command syntax.
*   **ANSI Escape Cleaning:** All ANSI escape sequences, OSC sequences, VS Code shell integration markers (`]633;C`, `]133;`), color codes (`[0m`, `[91m`), and cursor control sequences are stripped before rendering — only human-readable output is shown.
*   **Reliable Fallback Execution:** When VS Code shell integration is unavailable, commands are executed directly via `child_process.execFile` with real stdout, stderr, exit code, and duration capture — no more "check the terminal panel" messages.
*   **Structured Tool Results:** The terminal tool returns a structured object `{ shell, command, stdout, stderr, exitCode, durationMs, success, workingDirectory }` for both the LLM and the UI.
*   **Canonical Execution Status:** Every terminal card derives all UI elements from a single canonical status enum: `pending` → `running` → `success` / `error` / `timeout` / `cancelled`. No contradictory displays (e.g., FAILED + ✓ Completed).
*   **Accurate Success Detection:** Exit code 0 → SUCCESS. Exit code non-zero → FAILED. No exit code but no errors → SUCCESS (shows "Exit code unavailable"). Never displays "Exit code ?".
*   **Adaptive Scrolling:** Small outputs grow naturally with no internal scrollbar. Large outputs get a scrollbar with a 320px max-height.

### 🔄 Tool Lifecycle State Sync
*   **Reliable Lifecycle Transitions:** Every tool follows the exact lifecycle: PENDING → WAITING_FOR_PERMISSION → RUNNING → COMPLETED/FAILED/CANCELLED. No tool card remains stuck in RUNNING.
*   **Provider-Compatible Card Linking:** Cards are stored under multiple key aliases (toolCallId, index key, toolName key), ensuring `tool_result` events find the correct card regardless of whether the LLM provider emits tool call IDs or not.
*   **Backwards DOM Fallback:** When lookup keys fail, the DOM search iterates backwards to find the most recently created card — fixing issues where multiple calls of the same tool (e.g., two `update_plan` invocations) would update the wrong card.

---

## 🛠️ Supported Providers

| Provider | Default Base URL | Keys Required | Common Models |
| :--- | :--- | :--- | :--- |
| **Ollama** | `http://localhost:11434` | No | `llama3`, `mistral`, `deepseek-coder` |
| **OpenAI** | `https://api.openai.com/v1` | Yes | `gpt-4o`, `gpt-4o-mini`, `o3-mini` |
| **Anthropic** | `https://api.anthropic.com/v1` | Yes | `claude-3-5-sonnet`, `claude-3-opus` |
| **Google Gemini** | `https://generativelanguage.googleapis.com/v1beta` | Yes | `gemini-2.5-flash`, `gemma-4-31b-it` |
| **Groq** | `https://api.groq.com/openai/v1` | Yes | `llama-3.3-70b-versatile` |
| **OpenRouter** | `https://openrouter.ai/api/v1` | Yes | 200+ models across providers |
| **xAI (Grok)** | `https://api.x.ai/v1` | Yes | `grok-2-1212` |
| **OpenAI Compatible** | Custom | Optional | LM Studio, vLLM, LocalAI |

---

## 🚀 Quick Start

### 1. Installation
Install **"CodeRun AI Agent"** via the Extensions view (`Ctrl+Shift+X`) in VS Code, or install it using the command-line interface:
```bash
code --install-extension Bala-Siva-Ganesh.ai-agent
```

### 2. Development Setup (From Source)
```bash
# Clone the repository
git clone https://github.com/nbsgr/coderun-agent.git
cd coderun-agent

# Install dependencies
npm install

# Launch Development Host
# Press F5 in VS Code to run the Extension Development Host window.
```

### 3. Basic Configuration
1.  Open the CodeRun panel by clicking the chat icon in the Activity Bar.
2.  Click the **⚙️ Settings** button.
3.  Select your desired **Provider** (e.g. Google Gemini, Ollama, OpenAI).
4.  Enter the **Base URL** (or use defaults) and paste your **API Key**.
5.  Click **Refresh Models** to fetch your model list.
6.  Select a model and click **Save Settings**.

---

## 📖 Deep Dive: CodeRun Architecture

CodeRun's engine is split into isolated manager modules that govern the lifecycle of a task execution. The **terminal execution pipeline** has been significantly enhanced with inline collapsible cards, automatic shell detection, ANSI cleaning, structured results, and a canonical execution status enum ensuring consistent SUCCESS/FAILED/CANCELLED/TIMEOUT states across all UI elements. The **tool lifecycle** has been hardened so every tool reliably transitions through PENDING → RUNNING → COMPLETED/FAILED — no cards remain stuck.

```
src/
├── extension.js              ← VS Code activation, IPC message bridge, secrets, health checks
├── agentLoop.js              ← Core agentic loop (gathers context, plans steps, streams LLM output)
├── promptBuilder.js          ← Assembles system prompt with workspace, planning, and memory contexts
│
├── contextManager.js         ← Identifies request intent, extracts editor state & active file details
├── planningManager.js        ← Generates step-by-step plans written to a database-backed plan file
├── executionManager.js       ← Executes plan steps and processes step completions
├── verificationManager.js    ← Runs post-execution tests (build checks, syntax checks, output matches)
├── learningManager.js        ← Automates style guidelines discovery (indentation, framework syntax)
├── timelineManager.js        ← Logs chronological system events to timeline history
├── checkpointManager.js      ← Manages file backups, snapshot comparison, and rollback operations
├── diffManager.js            ← Stores diff patches for inline rendering in the webview
│
├── terminalManager.js        ← VS Code Integrated Terminal API with shell integration,
│                                auto shell detection (powershell/cmd/bash/zsh/fish/wsl),
│                                ANSI escape stripping, child_process fallback execution,
│                                and live output streaming through shell integration events
│
├── toolDefinitions.js        ← Declares JSON schemas (functions, parameters) sent to the LLM
├── toolRegistry.js           ← Maps tool calls to implementations and aliases custom proxy commands
├── tools.js                  ← 18 async generators: file I/O (read/write/edit/delete),
│                                directory (list/create/delete), search (files/content/symbols),
│                                terminal (run_terminal + aliases bash/execute_command),
│                                utility (datetime, web_request), planning (create/update_plan)
│
├── providerManager.js        ← Factory to instantiate the correct provider SDK
├── providerOllama.js / OpenAI.js / Anthropic.js / Gemini.js / Compatible.js ...
│
├── Dashboard.js / .css       ← Webview interface manager (sidebar, settings, model list)
├── ChatSpace.js / .css       ← Chat message space: collapsible tool cards, inline terminal
│                                cards with live streaming, permission dialogs, diff reviews,
│                                thought process blocks, and task continuation buttons
└── MarkdownRenderer.js       ← Client-side markdown processor with custom syntax highlighting
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Enter` | Send message |
### Prerequisites

- [Node.js](https://nodejs.org) >= 18.x
- [VS Code](https://code.visualstudio.com) >= 1.80.0

### Setup

```bash
git clone https://github.com/nbsgr/coderun-agent.git
cd coderun-agent
npm install
```

### Debug

1. Open the project in VS Code
2. Press `F5` — the Extension Development Host window opens
3. Click the chat icon in the activity bar

### Package for Marketplace

```bash
npm install -g @vscode/vsce
vsce package
```

This creates a `.vsix` file that can be installed via:
```
code --install-extension ai-agent-<version>.vsix
```

## License

MIT

## Links

- [GitHub Repository](https://github.com/nbsgr/coderun-agent)
- [Issue Tracker](https://github.com/nbsgr/coderun-agent/issues)
- [VS Code Marketplace](https://github.com/nbsgr/coderun-agent.git) *(pending)*

