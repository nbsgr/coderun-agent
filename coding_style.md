# CodeRun AI Agent (`D:\cline-ollama`) — Engineering Standards & Coding Style Contract

This document defines the strict engineering standards, language constraints, architectural principles, and coding style rules for the **CodeRun AI Agent** (`AI-AGENT` / `D:\cline-ollama`) project. All engineers, contributors, and AI assistants must follow these standards without exception.

---

## 1. Project Overview & Repository Identity

* **Extension Name:** `ai-agent` (Display: `AI-AGENT` / CodeRun AI Agent v1.6.3)
* **Publisher:** `Bala-Siva-Ganesh`
* **Repository:** `https://github.com/nbsgr/coderun-agent.git`
* **Working Root:** `D:\cline-ollama`
* **Core Functionality:** Multi-provider autonomous coding companion (Ollama, OpenAI, Claude, Gemini, Groq, OpenRouter) featuring an iterative agent loop (Think → Plan → Act → Verify), dual terminal execution (`CodeRun(main)` & `CodeRun(BG)`), 36 built-in tools, SQLite-backed codebase indexing, subagent lifecycle orchestration, and native zero-dependency HTML5 media generation.

---

## 2. Core Coding Philosophy

1. **Requirement First, Simplicity Always:** Solve the requirement directly. Never use language features simply because they exist.
2. **Readability Over Cleverness:** Write code that any engineer or beginner can immediately read, understand, debug, and maintain.
3. **Explicit Over Implicit:** Write clear, explicit code with well-named parameters and functions rather than dense one-liners or complex abstractions.
4. **Resilience & Fault Isolation:** Subsystems must isolate failures, log context with subsystem tags, and provide graceful recovery paths without crashing the extension host or webview.

---

## 3. Language & Syntax Rules

### 3.1. Language Constraint: Plain JavaScript Only
* **Never use TypeScript (`.ts` / `.tsx`).** The project does not use a TypeScript compiler or transpile step.
* **Never use JSX.**
* All runtime modules in `src/extension/` and `src/UI/` use `.js`.
* Native ES Module syntax (`import` / `export`) is used for all runtime application code, extension host modules, webview scripts, and test runners.
* CommonJS (`.cjs`) is reserved strictly for configuration files (`.eslintrc.cjs`, `eslint.config.cjs`) and isolated child-process workers (`builtinServers/fetchServer.cjs`).

### 3.2. Strict Traditional Function Declarations
All functions must be declared using the traditional named `function name() {}` declaration:

```javascript
// ✅ PREFERRED (CodeRun Standard):
function handleUserMessage(payload) {
  // implementation
}

function calculateDiffStats(originalText, modifiedText) {
  // implementation
}
```

### 3.3. Prohibited Syntax Patterns
* ❌ **No Arrow Functions (`=>`):**
  Never use arrow functions in runtime code, webview scripts, utilities, or tests.
  ```javascript
  // ❌ FORBIDDEN:
  const getToolName = (tool) => tool.name;
  items.map((item) => item.id);

  // ✅ PREFERRED:
  function getToolName(tool) {
    return tool.name;
  }
  function getItemId(item) {
    return item.id;
  }
  items.map(getItemId);
  ```

* ❌ **No Immediately Invoked Function Expressions (IIFEs):**
  ```javascript
  // ❌ FORBIDDEN:
  (function() {
    initApp();
  })();

  // ✅ PREFERRED:
  function initApp() {
    // initialization logic
  }
  initApp();
  ```

* ❌ **No Function Expressions Assigned to Variables:**
  ```javascript
  // ❌ FORBIDDEN:
  var computeHash = function(data) {};
  const renderCard = function(card) {};

  // ✅ PREFERRED:
  function computeHash(data) {}
  function renderCard(card) {}
  ```

* ❌ **Never Use `.bind()`:**
  Do not use `Function.prototype.bind()`. Pass parameters or execution contexts explicitly.
  *(Exception Note: SQL.js query param binding `stmt.bind(params)` in `projectKnowledge.js` is a database driver API call, not JavaScript function binding, and is permitted).*

* ❌ **Never Use the `class` Keyword:**
  Do not use ES `class` or `extends`. Use plain object literals, factory functions, or standard object prototypes instead:
  ```javascript
  // ✅ PREFERRED (CodeRun State Machine):
  function createAgentState(sessionId) {
    return {
      sessionId: sessionId,
      status: 'idle',
      transitions: [],
      transitionWithTrace: function(targetState, metadata) {
        // atomic state transition logic
      }
    };
  }
  ```

* ❌ **Never Use JSDoc `@param` Tags:**
  Do not clutter function signatures with `@param` or `@returns` annotations. Code must be self-documenting through descriptive parameter names and concise inline explanatory comments explaining *why*, not *what*.

---

## 4. Extension & Agent Architecture (3-Tier Modular Pattern)

`D:\cline-ollama` strictly enforces a **Controller → Handler → Manager** 3-tier pattern with physical and logical separation between the Backend Extension Host (`src/extension/`) and Frontend Webview (`src/UI/`):

```plaintext
Frontend Webview (DOM & UI)                Backend Extension Host (VS Code API)
┌─────────────────────────────────┐        ┌─────────────────────────────────┐
│  src/UI/                        │        │  src/extension/                 │
│                                 │        │                                 │
│  [1. Host Controller]           │        │  [1. UI Controller]             │
│  (src/UI/controller/            │◄──IPC─►│  (src/extension/controller/     │
│   host-controller.js)           │        │   UI-controller.js)             │
│           │                     │        │           │                     │
│           ▼                     │        │           ▼                     │
│  [2. UI Domain Managers]        │        │  [2. Backend Domain Handlers]   │
│  (chats-message-manager.js,     │        │  (chatshandler.js,              │
│   chats-diff-manager.js, etc.)  │        │   diffshandler.js,              │
│           │                     │        │   mcphandler.js, etc.)          │
│           ▼                     │        │           │                     │
│  [3. View Shell Coordinators]   │        │           ▼                     │
│  (dashboard.js, chats.js,       │        │  [3. Engine Managers]           │
│   settings.js)                  │        │  (tools.js, agentLoop.js,       │
│                                 │        │   checkpointManager.js, etc.)   │
└─────────────────────────────────┘        └─────────────────────────────────┘
```

### Tier 1: Controllers (Pure Routers)
* **Extension Host Controller:** `src/extension/controller/UI-controller.js`
  * Subscribes to `webview.onDidReceiveMessage`.
  * Inspects `message.id` or `message.command` and immediately dispatches to the registered domain handler.
  * **Strictly ZERO business logic, state mutations, or direct tool invocations.**
* **Webview Host Controller:** `src/UI/controller/host-controller.js`
  * Subscribes to `window.addEventListener("message")`.
  * Routes incoming backend notifications to UI domain managers.

### Tier 2: Handlers (Payload Coordinators)
* Located in `src/extension/manager/`:
  * `chatshandler.js`: Validates chat request payloads, manages cancellation tokens, drives agent loop triggers.
  * `diffshandler.js`: Handles diff approval/rejection and coordinates subagent diff status syncing.
  * `mcphandler.js`: Coordinates MCP server discovery, status toggles, and tool dispatch.
  * `mediahandler.js`: Resolves media URIs, handles base64 extraction, and executes workspace export actions.
  * `modelshandler.js`: Queries providers for dynamic model lists, classifications, and connection health.
  * `ruleshandler.js`: Reads and persists user rules (`~/.coderun/rules`, `.coderunrules`).
  * `settingshandler.js`: Synchronizes provider API keys, base URLs, and active settings securely.
  * `subagentshandler.js`: Manages subagent status queries and lifecycle state mutations.
  * `terminalhandler.js`: Handles shell commands, keystroke delivery, and process interrupts.
  * `traceshandler.js`: Retrieves execution trace logs and disk exports.
* **Responsibilities:** Validate inputs, invoke domain managers, and format IPC response messages back through the controller channel.

### Tier 3: Managers & Core Engines (Business Logic)
* `src/extension/tools/tools.js`: Pure implementations of 36 asynchronous tools.
* `src/extension/agents/agentLoop.js`: Core orchestrator executing the Think → Plan → Act → Verify lifecycle.
* `src/extension/context/projectKnowledge.js`: SQLite-backed AST and semantic indexing engine using `SQL.js`.
* `src/extension/tools/checkpointManager.js`: File snapshotting, SQLite backup store, and rollback manager.
* `src/extension/tools/diffManager.js`: Staged diff patching with SHA-256 concurrency checks.
* `src/extension/tools/terminalManager.js`: Dual-terminal session lifecycle (`CodeRun(main)` & `CodeRun(BG)`).
* `src/extension/permission-manager/permission-store.js`: Session-isolated async permission resolution callbacks.

---

## 5. CodeRun Subsystem Rules & Implementation Contracts

### 5.1. Dual Terminal Architecture
* Every chat maintains two distinct, visible VS Code terminal sessions:
  * `CodeRun(main)`: Direct foreground terminal for builds, tests, git commands, and interactive REPLs.
  * `CodeRun(BG)`: Background terminal for dev servers (`npm run dev`, `vite`, `python -m http.server`) with URL/port sniffing.
* Terminal commands must always specify target terminal session explicitly.
* Pager suppression (`$env:PAGER='cat'`, `GIT_PAGER=cat`, `--no-pager`) must be prepended to avoid hanging terminal executions.

### 5.2. File Mutation Serialization & Path Security
* **Concurrent Writes:** All write operations (`write_to_file`, `replace_file_content`, `apply_diff`) must acquire a lock via `fileLockManager.js` to serialize concurrent edits.
* **Workspace Sandboxing:** All file paths must be validated through `pathSecurity.js` to prevent directory traversal outside active workspace roots unless explicitly granted permission.

### 5.3. Error Handling & Anti-Swallowing Policy
* **Never use empty catch blocks:** `catch (_) {}` and `catch (err) {}` with empty bodies are strictly prohibited.
* **Contextual Tagging:** Every catch block must log context using standardized subsystem tags:
  * `[EXTENSION]`: Extension lifecycle, activation, and HTML rendering errors.
  * `[AGENT_LOOP]`: Model streaming, iteration limits, and loop failures.
  * `[TOOL_EXEC]`: Tool parameter parsing, execution, or file system errors.
  * `[TERMINAL]`: Shell process spawns, streams, and interrupt errors.
  * `[MCP]`: JSON-RPC protocol, client transport, and Python venv errors.
  * `[MEDIA]`: Image/video endpoint routing and extraction errors.
  * `[TRACE]`: Trace recording and disk persistence errors.

---

## 6. Directory Structure Reference (`D:\cline-ollama`)

```plaintext
D:\cline-ollama/
├── icons/                            ← Brand, logo, and avatar media assets
│   ├── bot-avatar.jpg
│   ├── logo.png
│   ├── media-generation.png
│   └── user-avatar.svg
│
├── src/
│   ├── extension/                    ← 100% Backend Extension Host Logic
│   │   ├── main/                     ← Extension lifecycle & activation root
│   │   ├── controller/               ← Pure extension message router (UI-controller.js)
│   │   ├── manager/                  ← Domain request handlers (chatshandler.js, etc.)
│   │   ├── permission-manager/       ← Unified permission storage (permission-store.js)
│   │   ├── agents/                   ← Agent loop, state machine, subagents & prompts
│   │   ├── context/                  ← Context engine & SQLite knowledge base (index.db)
│   │   ├── execution/                ← Diagnostics, review, verification & trace engines
│   │   ├── mcp/                      ← MCP clients & Python virtualenv manager
│   │   ├── media/                    ← Media extraction, formatting & disk persistence
│   │   ├── providers/                ← 8 native LLM providers & model classifier
│   │   └── tools/                    ← 36 async tool implementations & security guards
│   │
│   └── UI/                           ← 100% Frontend Webview DOM & Styling
│       ├── index.html                ← Single entry point loading dashboard/dashboard.js
│       ├── controller/               ← Pure Webview message routing & VS Code API
│       ├── dashboard/                ← Shell layout, header status, navigation & logo
│       ├── chats/                    ← Chat rendering, timeline, diffs, checkpoints & subagents
│       ├── permission-manager/       ← Reusable permission prompt dialogs (permission-card.js)
│       └── settings/                 ← Provider, model, MCP, rules & trace panels
```

---

## 7. Verification & Automated Quality Gates

Every code change must pass all three automated quality gates before committing:

1. **Syntax Check:**
   ```bash
   node --check <file-path>
   ```
2. **ESLint Verification:**
   ```bash
   npm run lint
   ```
   *Strictly 0 errors against custom AST rules prohibiting arrow functions, classes, and disallowed syntax.*
3. **Adversarial Test Suite:**
   ```bash
   npm test
   ```
   *All 87 adversarial test groups must pass cleanly with 0 failures and 0 regressions.*
