# CodeRun AI Agent

A multi-provider AI coding agent for VS Code. Supports Ollama, OpenAI, Anthropic, Google Gemini, OpenRouter, and any OpenAI-compatible API.

## Features
- **Multi-provider support** — Switch between Ollama, OpenAI, Anthropic, Gemini, OpenRouter, and generic OpenAI-compatible endpoints
- **Copilot-style tool permissions** — Allow/Deny dangerous actions with "Always Allow" / "Always Deny" options
- **Real-time streaming** — Live thinking tokens, content, tool calls, and terminal output
- **VS Code terminal integration** — Real terminal execution, not just child_process
- **File operations** — Read, write, edit, delete, search with workspace safety checks
- **Modular architecture** — Clean separation: providers, tools, prompts, loop, storage

## Supported Providers

| Provider | Base URL (default) | Needs API Key |
|----------|-------------------|---------------|
| Ollama | `http://localhost:11434` | No |
| OpenAI | `https://api.openai.com/v1` | Yes |
| Anthropic | `https://api.anthropic.com/v1` | Yes |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | Yes |
| OpenRouter | `https://openrouter.ai/api/v1` | Yes |
| OpenAI Compatible | `http://localhost:1234/v1` | Optional |

Compatible with: LM Studio, vLLM, LocalAI, and any OpenAI-compatible endpoint.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Launch in VS Code Extension Host:**
   Press `F5` or run the "Run Extension" debug configuration.

3. **Configure your provider:**
   - Open the CodeRun sidebar (activity bar icon)
   - Go to Settings (⚙️)
   - Select Provider, enter Base URL and API Key if needed
   - Click "Refresh Models" then select a model
   - Click "Save Settings"

4. **Start coding!**
   Select a chat, choose a model, and ask anything.

## Settings

All settings under the `coderun.*` namespace:

| Setting | Default | Description |
|---------|---------|-------------|
| `coderun.provider` | `ollama` | AI provider |
| `coderun.baseUrl` | `http://localhost:11434` | Provider base URL |
| `coderun.model` | `""` | Model name |
| `coderun.maxIterations` | `20` | Max agent loops per request |
| `coderun.streaming` | `true` | Enable response streaming |
| `coderun.showThinking` | `true` | Show thinking/reasoning tokens |
| `coderun.autoScroll` | `true` | Auto-scroll chat |
| `coderun.confirmDangerous` | `true` | Confirm destructive actions |
| `coderun.organization` | `null` | OpenAI organization ID |
| `coderun.project` | `null` | OpenAI project ID |

API keys are stored securely using VS Code's SecretStorage — never in plain text.

## Architecture

```
src/
  extension.js          — VS Code extension entry point
  agent.js              — Public agent API (thin wrapper)
  agentLoop.js          — Core reasoning loop (Think → Plan → Act → Verify)
  promptBuilder.js      — Assembles prompts from system + history + tools + memory
  providerManager.js    — Provider factory (creates the right provider)
  providerOllama.js     — Ollama API provider
  providerOpenAI.js    — OpenAI API provider
  providerAnthropic.js  — Anthropic Claude provider
  providerGemini.js     — Google Gemini provider
  providerOpenRouter.js — OpenRouter provider
  providerCompatible.js — Generic OpenAI-compatible provider
  toolRegistry.js       — Maps tool names to implementations
  toolDefinitions.js    — Auto-registering tool schemas for LLM
  toolExecutor.js       — Formats tool results for LLM context
  tools.js              — All tool implementations (file, dir, terminal, etc.)
  conversationStore.js  — Conversation persistence
  settingsStore.js      — Settings persistence
  workspaceContext.js   — Workspace info provider
  memoryManager.js      — Memory management (placeholder)
  skillsManager.js      — Skills management (placeholder)
  mcpManager.js         — MCP support (placeholder)
  terminalManager.js    — VS Code terminal integration
  terminalRenderer.js   — Terminal output in chat
  permissions.js        — Permission system for dangerous actions
  events.js             — Event bus for loose coupling
  constants.js          — All constants, defaults, system prompt
  utils.js              — Small utility functions
  config.js             — VS Code configuration reader
  Dashboard.js          — Frontend dashboard shell
  ChatSpace.js          — Frontend chat UI
  MarkdownRenderer.js   — Markdown to HTML with syntax highlighting
  Dashboard.css         — Dashboard styles
  ChatSpace.css         — Chat styles
```

## Agent Loop

```
User Request
    ↓
Prompt Builder (system + history + workspace + tools + memory)
    ↓
Provider.chat() — model decides
    ↓
Tool Calls? → YES → Permission Check → Execute Tool → Append Result
    ↓                                          ↓
    NO ←———————————————————————————————————————
    ↓
Final Response
```

Max 20 iterations. If reached, asks: *"Maximum agent iterations reached (20). The task may not be complete. Do you want me to continue?"*

## Keyboard Shortcuts

- `Ctrl+L` — New chat
- `Enter` — Send message
- `Shift+Enter` — New line in input

## Safety

- All file paths are resolved relative to workspace root
- Path traversal attacks are blocked
- Dangerous actions require explicit permission
- API keys stored in VS Code SecretStorage (encrypted)
- No telemetry, no cloud backends, complete privacy with local providers

## License

MIT
