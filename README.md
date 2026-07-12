# CodeRun AI Agent

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue?logo=visual-studio-code)](https://github.com/nbsgr/coderun-agent.git)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/nbsgr/coderun-agent/pulls)

A professional multi-provider AI coding agent for VS Code. Supports Ollama, OpenAI, Anthropic Claude, Google Gemini, Groq, OpenRouter, xAI (Grok), and any OpenAI-compatible API. Features Copilot-style inline diff review, persistent project knowledge, undo/checkpoints, file operations, and real VS Code terminal integration.

## Features

### 🤖 Multi-Provider AI
- **8 providers** — Ollama, OpenAI, Anthropic, Gemini, Groq, OpenRouter, xAI (Grok), OpenAI Compatible.
- **Per-provider config** — Save multiple provider configurations (API keys, base URLs, models) and switch seamlessly.
- **All models in one dropdown** — Models from all configured providers appear grouped in a single dropdown.
- **Auto SDK selection** — Correct SDK and API key used automatically based on model selection.

### 💬 Unified Chat & Command UI
- **Streaming responses** — Real-time thinking tokens, content, and tool calls.
- **Collapsible tool cards** — Expand/collapse tool execution details with live progress.
- **Direct console blocks** — Suppresses redundant status cards for terminal commands to directly display a clean console terminal.
- **Unified permission dropdowns** — Permission actions (Allow/Deny/Always) are embedded directly inside the active tool card as a section with horizontal scrolls instead of separate boxes.
- **Inline diff review** — Accept/Reject file changes directly in the chat (no temporary editors).
- **Task continuation** — A "Continue Task" button automatically renders when hitting execution limits to resume with one click.

### 🧠 Intelligent Agent Loop
- **Think → Plan → Act → Verify** — Multi-iteration agentic loop with tool execution.
- **Parallel Tool Execution** — Executes multiple independent tool calls concurrently using `Promise.all` for high performance.
- **Fuzzy File Replacement** — Fuzzy whitespace matching in `edit_file` reduces failed model iterations.
- **Multi-block Patching** — A dedicated `patch_file` tool to apply multiple search-and-replace blocks sequentially.
- **Context Manager** — Automatic intent detection, relevant file search, VS Code editor state.
- **Planning Engine** — Structured step-by-step plan generation per request.
- **Verification Engine** — Objective checks on every tool result (file exists, exit code, error patterns, web health).
- **Learning Engine** — Auto-detects framework, build system, conventions, architecture.

### 📁 Project Knowledge Base
- **SQLite-powered** — Embedded SQLite database per project via `sql.js`.
- **Registry.db** — Cross-project workspace registry.
- **Incremental indexing** — Background file indexing with hash-based change detection.
- **File watcher** — Real-time updates on file create/change/delete.
- **Search** — Filename and content search backed by the index, with filesystem fallback.
- **Code Symbol Outlining** — A dedicated `list_symbols` tool extracts classes, methods, and functions with line numbers for large file exploration.

### ↩️ Undo & Checkpoints
- **Automatic checkpoints** — Before every file write/edit/delete, original content is snapshotted to SQLite.
- **Per-response Undo** — Undo buttons appear below assistant responses that modified files.
- **Single-click restore** — Click Undo to restore the original file content instantly.
- **VS Code Command** — `CodeRun: Undo Last Edit` via Command Palette.

### 🖥️ Real Terminal & Verification Integration
- **VS Code Integrated Terminal** — Real shell execution via Shell Integration API.
- **Live streaming** — stdout and exit codes stream into the chat in real time.
- **Background Tasks** — Run long-lived servers or dev tasks persistently (`background: true`).
- **Interactive Inputs** — Send prompts and keyboard inputs (`terminal_input`) or interrupts/Ctrl+C (`stop_terminal`) to active tasks.
- **Web request validation** — Use `web_request` to check if dev servers have booted successfully.
- **Fallback** — Graceful sendText fallback when Shell Integration is unavailable.

### 🔒 Security & Privacy
- **Workspace-safe paths** — All file operations restricted to workspace root.
- **Path traversal blocked** — Attempts outside workspace are rejected.
- **Dangerous tool permissions** — Allow/Deny/Always Allow for write, delete, terminal.
- **API keys in SecretStorage** — Encrypted at rest via VS Code's SecretStorage API.
- **No telemetry** — Zero data leaves your machine unless you use a cloud provider.
- **Offline-first** — Fully functional with local Ollama models.

## Supported Providers

| Provider | Base URL (default) | Needs API Key | Models |
|----------|-------------------|---------------|--------|
| **Ollama** | `http://localhost:11434` | No | All local models |
| **OpenAI** | `https://api.openai.com/v1` | Yes | GPT-4o, GPT-4o-mini, o3, etc. |
| **Anthropic** | `https://api.anthropic.com/v1` | Yes | Claude 3.5 Sonnet, Claude 3 Opus, etc. |
| **Google Gemini** | `https://generativelanguage.googleapis.com/v1beta` | Yes | Gemini 1.5 Pro, Gemini 2.0 Flash, etc. |
| **Groq** | `https://api.groq.com/openai/v1` | Yes | Llama 3, Mixtral, Gemma, etc. |
| **OpenRouter** | `https://openrouter.ai/api/v1` | Yes | 200+ models across providers |
| **xAI (Grok)** | `https://api.x.ai/v1` | Yes | Grok-2, Grok-2-mini |
| **OpenAI Compatible** | Custom | Optional | LM Studio, vLLM, LocalAI, etc. |

## Quick Start

### 1. Install from VS Code Marketplace

Search for **"CodeRun AI Agent"** in the Extensions view (`Ctrl+Shift+X`) or install via CLI:

```bash
code --install-extension Bala-Siva-Ganesh.ai-agent
```

### 2. Install dependencies (for development)

```bash
git clone https://github.com/nbsgr/coderun-agent.git
cd coderun-agent
npm install
```

### 3. Launch

- **From VS Code Marketplace** — Click the chat icon in the activity bar
- **From source** — Press `F5` to open the Extension Development Host, then click the chat icon

### 4. Configure

1. Click the **⚙️ Settings** button in the sidebar
2. Select your **Provider** (e.g., Ollama, OpenAI, Groq)
3. Enter the **Base URL** and **API Key** (if required)
4. Click **Refresh Models** to fetch available models
5. Select a model from the dropdown
6. Click **Save Settings**

Provider configs are saved per-provider — add multiple providers and switch between them freely.

### 5. Start Coding!

Type your request in the chat input and press `Enter`.

## Deep Features

### Inline Diff Review

When the agent proposes file changes, an inline diff card appears right in the chat:

```
┌──────────────────────────────────────────┐
│ 📝 src/components/Login.js   +12  -4    │
│ ▼ View Changes                          │
│ ┌──────────────────────────────────────┐│
│ │ 25  25  const handleSubmit = () =>   ││
│ │ 26     -const oldLogic = '...'       ││  ← red deletion
│ │      26  +const newLogic = '...'     ││  ← green addition
│ │ 27  27  export default Login         ││
│ └──────────────────────────────────────┘│
│ [Accept]  [Reject]  [Open Full Diff]    │
└──────────────────────────────────────────┘
```

- **Accept** — applies the change and resolves the diff card
- **Reject** — discards the proposed change
- **Open Full Diff** — opens the traditional VS Code diff editor
- **Checkpoint created** — original content is snapshotted before any change

### Undo / Checkpoints

Every file modification creates a checkpoint automatically. After the assistant responds:

```
  ↩ Undo Edited: src/App.js
  ↩ Undo Created: src/utils/helpers.js
```

Click any Undo button to instantly restore the file to its pre-edit state. Consumed checkpoints show:

```
  ✓ Restored
```

You can also run `CodeRun: Undo Last Edit` from the Command Palette (`Ctrl+Shift+P`).

### Multi-Provider Model Management

Save configurations for multiple providers:

1. Configure **Ollama** (no API key) — local models appear
2. Configure **Groq** (with API key) — Groq models appear
3. Both sets of models appear in the same dropdown, grouped by provider
4. Select any model — the correct API key and base URL are used automatically

### Project Knowledge Base

On first open, the extension creates a SQLite project database at:

```
<globalStorageUri>/
  ├── registry.db              ← Workspace registry
  └── projects/
      └── <ProjectName>_<Hash>/index.db   ← Project index
```

The `index.db` contains:
- **files** — File metadata, language, size, hash
- **chunks** — Text segments for content search
- **metadata** — Key-value store for settings, plans, learning, timeline

This powers:
- Fast filename and content search via `search_files` and `find_in_files`
- Context-aware prompt enrichment (project metadata, recent timeline)
- Persistent planning, learning, and timeline across sessions

## Settings

All settings under the `coderun.*` namespace:

| Setting | Default | Description |
|---------|---------|-------------|
| `coderun.provider` | `ollama` | AI provider to use |
| `coderun.baseUrl` | `http://localhost:11434` | Provider base URL |
| `coderun.model` | `""` | Model name |
| `coderun.maxIterations` | `20` | Maximum agent iterations per request |
| `coderun.streaming` | `true` | Enable response streaming |
| `coderun.showThinking` | `true` | Show thinking/reasoning tokens |
| `coderun.autoScroll` | `true` | Auto-scroll chat to bottom |
| `coderun.confirmDangerous` | `true` | Confirm destructive actions |
| `coderun.organization` | `null` | OpenAI organization ID |
| `coderun.project` | `null` | OpenAI project ID |

API keys are stored securely using VS Code's SecretStorage — never in plain text or settings.json.

## Commands

| Command | Title | Keybinding |
|---------|-------|------------|
| `coderun.openSidebar` | CodeRun: Open Sidebar | — |
| `coderun.openPanel` | CodeRun: Open Panel | — |
| `coderun.newChat` | CodeRun: New Chat | `Ctrl+L` |
| `coderun.undoLastEdit` | CodeRun: Undo Last Edit | — |

## Architecture

```
src/
├── extension.js              ← Activation, IPC bridge, health, diff/undo handlers
├── agent.js                  ← Public agent API (thin wrapper)
├── agentLoop.js              ← Core loop: context → plan → LLM → tools → verify → retry
├── promptBuilder.js          ← System prompt assembly with knowledge injection
│
├── contextManager.js         ← Phase 3: Intent analysis, editor context, relevant files
├── planningManager.js        ← Phase 4: Structured plan generation
├── executionManager.js       ← Phase 5: Plan-based tool execution
├── verificationManager.js    ← Phase 6: Result verification (file exists, exit code, etc.)
├── learningManager.js        ← Phase 7: Framework/convention/architecture detection
├── timelineManager.js        ← Phase 9: Chronological event recording
├── checkpointManager.js      ← Phase 10: File snapshots, undo/restore
├── diffManager.js            ← Refactor: Inline diff patch storage and management
│
├── projectKnowledge.js       ← Phase 1: SQLite registry + per-project index.db
├── searchManager.js          ← Phase 2: Index-backed search with filesystem fallback
├── symbolParser.js           ← Phase 1 Outline: Regex-based code symbol extractor
├── memoryManager.js          ← In-memory conversation memory (simple array)
│
├── terminalManager.js        ← Real VS Code Integrated Terminal via Shell Integration
├── permissions.js            ← Allow/Deny/Always Allow per tool
├── workspaceContext.js       ← Workspace folder detection
│
├── tools.js                  ← 15 async generators (file, patching, symbols, HTTP, terminal, search)
├── toolRegistry.js           ← Maps tool names to implementations
├── toolDefinitions.js        ← Tool schemas for LLM function calling
├── toolExecutor.js           ← Formats tool results for LLM context
│
├── config.js                 ← VS Code settings reader + multi-provider configs
├── constants.js              ← All enums, defaults, SYSTEM_PROMPT
├── events.js                 ← Simple event bus
├── utils.js                  ← Small reusable helpers
│
├── providerManager.js        ← Provider factory
├── providerOllama.js / OpenAI.js / Anthropic.js / Gemini.js
├── providerGroq.js / OpenRouter.js / Compatible.js
│
├── Dashboard.js / .css       ← Webview shell (sidebar, settings, model dropdown)
├── ChatSpace.js / .css       ← Webview chat rendering (messages, tool cards, terminal, diff)
├── MarkdownRenderer.js       ← Client-side markdown → HTML with syntax highlighting
└── conversationStore.js      ← Conversation persistence
```

### Execution Flow

```
User Message
    ↓
ContextManager.gatherContext()        ← Intent, editor state, relevant files
    ↓
PlanningManager.createPlan()          ← Structured step plan
    ↓
promptBuilder.buildMessages()         ← System + history + knowledge + learning
    ↓
Provider.chat()                       ← LLM streams thinking + tool calls
    ↓
Tool Calls?
  ├─ No  → Agent Done → Response
  └─ Yes → Permission Check
            ↓
         checkpointManager.createCheckpoint()   ← Back up original file
            ↓
         toolRegistry.execute()                ← Run tool
            ↓
         verificationManager.verifyStep()      ← Check result
            ↓
         timelineManager.addToolEvent()        ← Log event
            ↓
         learningManager.recordToolUsage()     ← Learn patterns
            ↓
         Assistant message → messages[]
            ↓
         Loop back to LLM for next iteration
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in input |
| `Ctrl+L` (or `Cmd+L`) | New chat |

## Development

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

