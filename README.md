# CodeRun AI Agent 🚀

<p align="center">
  <img src="./logo.png" width="160" alt="CodeRun Logo"/>
</p>

[![VS Code Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/Bala-Siva-Ganesh.ai-agent?logo=visual-studio-code&label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=Bala-Siva-Ganesh.ai-agent)
[![VS Code Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/Bala-Siva-Ganesh.ai-agent?logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=Bala-Siva-Ganesh.ai-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/nbsgr/coderun-agent/pulls)

**CodeRun AI Agent** (`AI-AGENT`) is a professional, multi-provider autonomous coding companion for Visual Studio Code. Built upon an advanced agentic loop, CodeRun acts as an intelligent pair programmer capable of reading, writing, and editing files, indexing codebases in a high-speed local SQLite database, running interactive terminal processes, applying precision diffs, and orchestrating multi-step execution plans.

Whether you are running completely offline with local models via **Ollama**, leveraging official API keys (**OpenAI**, **Anthropic Claude**, **Google Gemini**, **Groq**, **OpenRouter**, **xAI Grok**), or routing custom endpoints (**Cloudflare Workers AI**, **vLLM**, **LM Studio**, **Aero Link**), CodeRun delivers a deeply integrated, robust, and secure developer experience.

---

## 🌟 Key Highlights & Features

### 🤖 Multi-Provider Model Orchestration
*   **8 Native Providers Supported:** Ollama, OpenAI, Anthropic Claude, Google Gemini, Groq, OpenRouter, xAI (Grok), and custom OpenAI Compatible endpoints.
*   **Saved Provider Configurations:** Save credentials (API keys, base URLs, default models) for multiple endpoints. Switch models on the fly in the middle of a chat session without resetting settings.
*   **Unified Model Dropdown:** All models from your active and saved providers are dynamically retrieved and presented in a single, clean dropdown, grouped logically by provider.
*   **API Type Selection:** Custom compatible providers support setting the underlying **API Type** (**OpenAI Compatible**, **Anthropic Compatible**, or **Google Gemini Compatible**) to correctly format request bodies, endpoint paths, and API headers.
*   **Cloudflare Workers AI Support:** Dynamically parses Cloudflare base URLs to extract your Account ID and retrieve model lists using Cloudflare's search API.

### 💻 Interactive Terminal Execution & REPLs
*   **Full Interactive Session Lifecycle:** Launch interactive REPLs (Node, Python, Ruby, MySQL, npm init, etc.) with `run_terminal` (`interactive: true`).
*   **Live Keystroke Delivery:** Send commands and inputs dynamically to active sessions using `terminal_input`, with clean multi-line and escape character normalization.
*   **Reliable Foreground Interrupts:** Send clean interrupt signals (`\u0003` / `Ctrl+C`) to active terminals using `stop_terminal` without killing your base shell.
*   **Smart Prompt Detection:** Accurately detects interactive question prompts (e.g. `(y/N)`, `Password:`, `>>>`) while filtering out standard idle shell prompts (`PS ...>`, `user@host:~$`).
*   **ANSI Escape Cleaning:** All ANSI escape sequences, OSC markers, and VS Code shell integration codes are stripped before rendering.

### 📋 Real-Time Checklist & Todo Tracking
*   **Cognitive Brain/Body Architecture:** The LLM serves as the cognitive brain creating and updating plans; the runtime faithfully tracks and renders progress.
*   **Live Progress Bar:** The composer displays a live `Todos (X/Y)` bar reflecting in-progress `[/]` and completed `[x]` tasks as each step finishes.
*   **Graceful Auto-Hide on Completion:** When all tasks finish (`Todos (13/13) ✓`), the panel confirms completion and smoothly fades out after 5 seconds to keep the workspace clean.
*   **Collapsible & Inspectable:** Click the Todos header anytime to expand and review all checklist steps.

### 🧠 Advanced Agent Loop & Concurrency
*   **Think → Plan → Act → Verify:** Multi-iteration loop executing tool actions, verifying outputs, and learning repository patterns.
*   **Parallel Concurrency for Read-Only Tools:** Concurrent execution of independent read and search operations (`read_file`, `search_files`, `find_in_files`, `get_file_info`) via `Promise.all` for maximum speed.
*   **Per-File Mutation Serialization:** Atomic file write locking via `fileLockManager.js` ensures sequential safety during concurrent writes.
*   **Repetitive Failure Circuit Breaker:** Automatically detects repeated tool failures on identical arguments, halting loops and prompting reflection.
*   **Reasoning Models Support:** Captures and renders thoughts from reasoning models (Gemma 4, DeepSeek-R1, o3-mini) in dedicated collapsible **Thought Process** blocks.

### 🔍 Diff Management & Approval Pipeline
*   **SHA-256 Optimistic Concurrency:** Stages proposed file changes in memory with baseline SHA-256 hashing to prevent overwriting external disk edits.
*   **Inline Webview Diffs & Side-by-Side Editor:** Inspect additions (green) and deletions (red) directly inside chat cards or launch native side-by-side VS Code diff editors.
*   **Single-Click Batch Operations:** Accept or reject individual diffs or click **Accept All** / **Reject All** in the agent controls bar.

### ↩️ Database-Backed Snapshots & Checkpoints
*   **SQLite-Powered Snapshots:** Snapshots files into a local SQLite database (`index.db`) before any mutation.
*   **Single-Click Undo:** Real-time **Undo** buttons appear directly under assistant responses for instant rollback.
*   **Command Palette Integration:** Run `CodeRun: Undo Last Edit` at any time.

### 📦 0ms Local Context Compaction
*   **Deterministic Tool Compaction:** Compacts verbose outputs and directory listings into concise status summaries (`Read file`, `Wrote file`, `Patched file`).
*   **Zero-Loss History Preservation:** Injects structured chronological checkpoints with 4 sub-dropdowns: User Messages, Thinking, Response Summary, and Tool Executions.
*   **Instant Local Execution:** Runs 100% locally with zero API latency or token cost.

### 🪵 Real-Time Visual Execution Traces
*   **Dual View (`[Chats]` / `[Traces]`):** Switch between conversational chat and an interactive step-by-step trace graph.
*   **Detailed Step Diagnostics:** Inspect exact system prompts, LLM decisions, duration in milliseconds, inputs, and outputs per step.
*   **One-Click Export:** Copy individual step data or export the full run JSON to clipboard.

### 📜 Global & Workspace Rules Engine
*   **Hierarchical Rule Precedence:** Define Global Rules (`~/.coderun/rules`) that apply everywhere across all projects, and Workspace Rules (`.coderunrules`) scoped to the active repository.
*   **Integrated Code-Style Editor:** In-app editor with dynamic line number gutters, synchronized scrolling, one-click open in VS Code, and instant `Ctrl + S` saving.

### 🔄 Tool Lifecycle State Sync
*   **Reliable Lifecycle Transitions:** Every tool follows the exact lifecycle: PENDING → WAITING_FOR_PERMISSION → RUNNING → COMPLETED/FAILED/CANCELLED. No tool card remains stuck in RUNNING.
*   **Provider-Compatible Card Linking:** Cards are stored under multiple key aliases (toolCallId, index key, toolName key), ensuring `tool_result` events find the correct card regardless of whether the LLM provider emits tool call IDs or not.
*   **Backwards DOM Fallback:** When lookup keys fail, the DOM search iterates backwards to find the most recently created card — fixing issues where multiple calls of the same tool (e.g., two `update_plan` invocations) would update the wrong card.

---

## 🧰 Complete Tool Matrix (20 Tools)

CodeRun exposes a curated set of **20 active tools** organized across 6 core categories. The LLM receives standard function calling schemas for these tools, while heavy index operations (such as SQLite indexing) run deterministically in the background.

| Category | Tool | Description | Dangerous / Permissions |
| :--- | :--- | :--- | :--- |
| **📁 File Operations** | `read_file` | Read complete file contents at a relative path | No |
| | `write_file` | Create or overwrite a file with full diff preview | ⚠️ Yes |
| | `edit_file` | Find and replace a single exact string occurrence | ⚠️ Yes |
| | `patch_file` | Apply multiple search-and-replace edit blocks | ⚠️ Yes |
| | `delete_file` | Permanently delete a specified file | ⚠️ Yes |
| | `create_folder` | Create directory structure including parents | No |
| | `delete_folder` | Recursively delete a directory and its contents | ⚠️ Yes |
| | `get_file_info` | Get file metadata (size, lines, modified date, MIME) | No |
| **🔍 Search & Navigation** | `search_files` | Find files matching glob patterns (e.g. `*.js`, `src/**`) | No |
| | `find_in_files` | Search workspace file contents for text queries | No |
| | `list_symbols` | Parse classes, functions, and symbols with line numbers | No |
| | `list_directory` | List folder contents with recursive depth controls | No |
| **💻 Terminal Execution** | `run_terminal` | Execute shell commands in VS Code terminal (or child_process fallback) | ⚠️ Yes |
| | `terminal_input` | Send input to an active interactive terminal session / REPL | ⚠️ Yes |
| | `stop_terminal` | Send `Ctrl+C` interrupt to abort a running terminal command | No |
| **📋 Planning & Progress** | `create_plan` | Initialize a structured task checklist | No |
| | `update_plan` | Update task statuses (`[ ]` pending, `[/]` in progress, `[x]` done) | No |
| **🌐 Utilities & Web** | `web_request` | Perform HTTP requests (GET, POST, PUT, DELETE) | No |
| | `get_current_datetime` | Retrieve current date and time in ISO format | No |
| **🗄️ Database** | `query_project_db` | Execute safe read-only SQL queries on the project knowledge database | No |

---

## 🛠️ Supported Providers

| Provider | Default Base URL | Keys Required | Vision Support | Common Models |
| :--- | :--- | :--- | :--- | :--- |
| **Ollama** | `http://localhost:11434` | No | ✅ `images` Array | `deepseek-r1`, `qwen2.5-coder`, `llama3.3`, `llava` |
| **OpenAI** | `https://api.openai.com/v1` | Yes | ✅ `image_url` Blocks | `gpt-4o`, `gpt-4o-mini`, `o3-mini` |
| **Anthropic** | `https://api.anthropic.com/v1` | Yes | ✅ `image` Source Blocks | `claude-3-7-sonnet`, `claude-3-5-sonnet` |
| **Google Gemini** | `https://generativelanguage.googleapis.com/v1beta` | Yes | ✅ `inline_data` Parts | `gemini-2.5-flash`, `gemini-1.5-pro` |
| **Groq** | `https://api.groq.com/openai/v1` | Yes | ✅ `image_url` Blocks | `llama-3.3-70b-versatile`, `deepseek-r1-distill-llama-70b` |
| **OpenRouter** | `https://openrouter.ai/api/v1` | Yes | ✅ `image_url` Blocks | 200+ vision & reasoning models |
| **xAI (Grok)** | `https://api.x.ai/v1` | Yes | ✅ `image_url` Blocks | `grok-2`, `grok-2-vision` |
| **OpenAI Compatible** | Custom | Optional | ✅ `image_url` Blocks | LM Studio, vLLM, LocalAI, Cloudflare |

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

# Run the complete test suite
node test/runAllTests.js

# Launch Extension Host in VS Code: Press F5
```

### 3. Basic Configuration
1. Open the CodeRun panel by clicking the robot icon in the Activity Bar.
2. Click the **⚙️ Settings** button.
3. Select your desired **Provider** (e.g. Ollama, Gemini, OpenAI, Anthropic).
4. Enter the **Base URL** (or use defaults) and paste your **API Key**.
5. Click **Refresh Models** to fetch your model list.
6. Select a model and click **Save Settings**.

---

## 🧪 Adversarial Test Suite

CodeRun features a comprehensive test harness (`test/runAllTests.js`) covering **42 adversarial test groups** with 0 external dependencies:
* Session isolation across terminal instances and permission choices.
* Concurrency protection via SHA-256 optimistic locking and hierarchical file locks.
* SSRF protection blocking all private and loopback subnets.
* Token and secret redaction (JWTs, API keys, database URLs, AWS credentials).
* Checkpoint restoration, directory tree preservation, and cross-session diff safety.
* Signal cancellation and max iterations lifecycle.

Run all tests anytime:
```bash
node test/runAllTests.js
```

---

## 📖 Deep Dive: CodeRun Architecture

CodeRun's engine is split into isolated manager modules that govern the lifecycle of a task execution. The **terminal execution pipeline** provides interactive REPL sessions, automatic shell detection, ANSI cleaning, structured results, and a canonical execution status enum ensuring consistent SUCCESS/FAILED/CANCELLED/TIMEOUT states across all UI elements.

```
src/
├── extension.js              ← VS Code activation, IPC message bridge, secrets, health checks
├── agentLoop.js              ← Core agentic loop (gathers context, plans steps, streams LLM output)
├── promptBuilder.js          ← Assembles system prompt with workspace, planning, and memory contexts
│
├── context/
│   ├── contextManager.js     ← Identifies request intent, extracts editor state & active file details
│   ├── rulesLoader.js        ← Loads user-defined project rules & conventions
│   ├── goalTracker.js        ← Tracks goals, subgoals, and plan execution metrics
│   ├── memoryManager.js      ← Session-scoped memory and key facts store
│   └── compactionManager.js  ← Pure local 0ms conversation compaction engine & checkpoint generator
│
├── execution/
│   ├── executionTrace.js     ← Real-time trace engine (LLM calls, tools, errors, disk persistence)
│   ├── verificationManager.js← Runs post-execution tests (build checks, syntax checks, output matches)
│   ├── recoveryEngine.js     ← Automatic error recovery and LLM diagnostic advice
│   └── timelineManager.js    ← Logs chronological workspace events to timeline history
│
├── planningManager.js        ← Generates step-by-step plans written to a database-backed plan file
├── checkpointManager.js      ← Manages file backups, snapshot comparison, and rollback operations
├── diffManager.js            ← Staged diff patches with SHA-256 concurrency checks
│
├── terminalManager.js        ← VS Code Integrated Terminal API with shell integration,
│                                auto shell detection (powershell/cmd/bash/zsh/fish/wsl),
│                                ANSI escape stripping, interactive REPL support, and stop_terminal
│
├── toolDefinitions.js        ← Declares JSON schemas (functions, parameters) sent to the LLM
├── toolRegistry.js           ← Unified tool registry with alias mapping, validation, and hidden filtering
├── tools.js                  ← 20 active async generators across 6 categories
│
├── providerManager.js        ← Factory to instantiate the correct provider SDK
├── providerOllama.js / OpenAI.js / Anthropic.js / Gemini.js / Compatible.js ...
│
├── Dashboard.js / .css       ← Webview manager: dual-nav (Chats/Traces), multi-run tabs, settings
├── ChatSpace.js / .css       ← Chat space: collapsible tool cards, inline terminal cards with live
│                                streaming, permission dialogs, diff reviews, thought process
├── MarkdownRenderer.js       ← Client-side markdown processor with tables, code & syntax highlighting
├── webview-shared.js         ← Shared utilities (esc, truncate, stripAnsi) between Dashboard & ChatSpace
└── agentState.js             ← Formal finite state machine for the agent loop
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Enter` | Send message |
| `Shift + Enter` | Insert new line in chat input |
| `Ctrl + V` / `Cmd + V` | Paste image directly into chat |
| `Ctrl + S` / `Cmd + S` | Save rules when inside the Rules editor |
| `Ctrl + Shift + P` → `CodeRun: Open Sidebar` | Focus the CodeRun agent sidebar |
| `Ctrl + Shift + P` → `CodeRun: New Chat` | Start a fresh isolated conversation |
| `Ctrl + Shift + P` → `CodeRun: Undo Last Edit` | Restore previous workspace snapshot |

---

## 📄 License

[MIT](LICENSE)

---

## 🔗 Official Links

- 🏪 **VS Code Marketplace:** [Bala-Siva-Ganesh.ai-agent](https://marketplace.visualstudio.com/items?itemName=Bala-Siva-Ganesh.ai-agent)
- 🐙 **GitHub Repository:** [nbsgr/coderun-agent](https://github.com/nbsgr/coderun-agent)
- 🐛 **Issue Tracker:** [GitHub Issues](https://github.com/nbsgr/coderun-agent/issues)


