// Dashboard.js — CodeRun Agent Dashboard
// Settings (provider, baseUrl, model, apiKey) are read from VS Code user settings.
// The backend is the single source of truth for provider configuration.

function initializeDashboard() {
  "use strict";

  var DEFAULT_BASE_URL = "http://localhost:11434/v1";
  var PROVIDER_DEFAULT_URLS = {
    ollama: "http://localhost:11434/v1",
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
    openrouter: "https://openrouter.ai/api/v1",
    xai: "https://api.x.ai/v1",
    groq: "https://api.groq.com/openai/v1",
    compatible: ""
  };
  var STORAGE_KEY = "coderun_conversations";
  var SETTINGS_KEY = "coderun_settings";
  var MODEL_KEY = "coderun_selected_model";

  var vscodeState = {};
  if (!!window.VSCODE && window.VSCODE_API) {
    try {
      vscodeState = window.VSCODE_API.getState() || {};
    } catch (e) {
      // Intentionally ignore if VS Code state retrieval is restricted or errors
    }
  }

  var state = {
    sidebarOpen: vscodeState.sidebarOpen !== undefined ? vscodeState.sidebarOpen : true,
    conversations: vscodeState.conversations || [],
    activeConversationId: vscodeState.activeConversationId || null,
    renamingId: null,
    renameValue: "",
    selectedModel: "",
    selectedProvider: "",
    savedProviderConfigs: {},
    workspaceFolder: vscodeState.workspaceFolder || window.WORKSPACE_FOLDER || "",
    models: [],
    modelsByProvider: {},
    modelContextWindows: {},
    isVsCode: !!window.VSCODE,
    baseUrl: DEFAULT_BASE_URL,
    provider: "ollama",
    isOnline: false,
    apiKey: "",
    hasApiKey: false,
    settingsLoadedFromVscode: false,
    // "Always Allow / Always Deny" decisions per tool. Populated from the
    // extension host via the 'permissionState' message on webviewReady and
    // after every change. ChatSpace can read it via getDashboardAlwaysDecisions.
    alwaysDecisions: {},
    pinnedModels: {},
    modelSearchFilter: "",
    openProviderGroups: {},
    mcpServers: [],
    settings: {
      provider: "ollama",
      baseUrl: DEFAULT_BASE_URL,
      apiKey: "",
      model: "",
      maxIterations: 20,
      streaming: true,
      showThinking: true,
      autoScroll: true,
      confirmDangerous: true
    }
  };

  var currentMcpTemplate = "github";
  var currentMcpRuntime = "node";

  try {
    var storedPinned = localStorage.getItem("coderun_pinned_models");
    if (storedPinned) {
      state.pinnedModels = JSON.parse(storedPinned);
    }
  } catch (_) {
    state.pinnedModels = {};
  }

  try {
    var storedContext = localStorage.getItem("coderun_model_context_windows");
    if (storedContext) {
      state.modelContextWindows = JSON.parse(storedContext);
    }
  } catch (_) {
    state.modelContextWindows = {};
  }

  try {
    var storedModalities = localStorage.getItem("coderun_model_modalities");
    if (storedModalities) {
      state.modelModalities = JSON.parse(storedModalities);
    }
  } catch (_) {
    state.modelModalities = {};
  }

  function getModelContextWindow(modelName) {
    if (!modelName || !state.modelContextWindows) return null;
    return state.modelContextWindows[modelName] || null;
  }
  window.getModelContextWindow = getModelContextWindow;

  function saveStateToVscode() {
    if (state.isVsCode && window.VSCODE_API) {
      try {
        window.VSCODE_API.setState({
          sidebarOpen: state.sidebarOpen,
          conversations: state.conversations,
          activeConversationId: state.activeConversationId,
          selectedModel: state.selectedModel,
          selectedProvider: state.selectedProvider,
          workspaceFolder: state.workspaceFolder
        });
      } catch (e) {
        // Intentionally ignore if VS Code state storage is restricted or errors
      }
    }
  }

  function defaultEsc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  var esc = window.sharedEsc || defaultEsc;

  function defaultGenId() {
    return "cr_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
  }
  var sharedGenId = window.sharedGenId || defaultGenId;

  function loadConversations() {
    try {
      state.conversations = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch (_) {
      // Intentionally fall back to empty list if localStorage access is disabled or parsing fails
      state.conversations = [];
    }
  }

  function saveConversations() {
    var raw = JSON.stringify(state.conversations);
    saveStateToVscode();
    try {
      localStorage.setItem(STORAGE_KEY, raw);
    } catch (_) {
      // Intentionally ignore if localStorage write access is restricted or quota exceeded
    }
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: "saveConversations", conversations: raw });
    }
  }

  function saveSelectedModel() {
    saveStateToVscode();
    try {
      localStorage.setItem(MODEL_KEY, state.selectedModel);
    } catch (_) {
      // Intentionally ignore if localStorage write access is restricted
    }
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: "saveSelectedModel", model: state.selectedModel, provider: state.selectedProvider });
    }
    if (typeof window.refreshActiveChatUsage === 'function') {
      window.refreshActiveChatUsage();
    }
  }

  function loadConversationsFromExtension(conversationsJson, selectedModel, selectedProvider) {
    try {
      var extConvs = typeof conversationsJson === "string" ? JSON.parse(conversationsJson || "[]") : Array.isArray(conversationsJson) ? conversationsJson : [];
      if (extConvs && extConvs.length > 0) {
        var cleanConvs = [];
        for (var i = 0; i < extConvs.length; i++) {
          if (extConvs[i]) {
            var c = extConvs[i];
            if (c.messages) {
              var cleanMsgs = [];
              for (var j = 0; j < c.messages.length; j++) {
                if (c.messages[j]) cleanMsgs.push(c.messages[j]);
              }
              c.messages = cleanMsgs;
            }
            cleanConvs.push(c);
          }
        }
        state.conversations = cleanConvs;
        saveStateToVscode();
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state.conversations));
        } catch (_) {
          // Intentionally ignore if localStorage write access is restricted
        }
      }
    } catch (_) {
      // Intentionally ignore errors during extension data load to preserve app flow
    }
    
    try {
      if (selectedModel) {
        state.selectedModel = selectedModel;
        saveStateToVscode();
        try {
          localStorage.setItem(MODEL_KEY, state.selectedModel);
        } catch (_) {
          // Intentionally ignore if localStorage write access is restricted
        }
      }
      if (selectedProvider) {
        state.selectedProvider = selectedProvider;
      }
    } catch (_) {
      // Intentionally ignore errors during model selection persistence to preserve app flow
    }
    renderSidebar();

    var hasActive = false;
    if (state.activeConversationId) {
      for (var i = 0; i < state.conversations.length; i++) {
        if (state.conversations[i].id === state.activeConversationId) {
          hasActive = true;
          break;
        }
      }
    }
    if (state.activeConversationId && hasActive) {
      selectConversation(state.activeConversationId);
    } else if (state.conversations.length) {
      selectConversation(state.conversations[0].id);
    } else {
      selectConversation(null);
    }
    updateModelSelectValue();
    updateModelBadge();
  }
  window.loadConversationsFromExtension = loadConversationsFromExtension;

  function setDashboardWorkspace(folderPath) {
    state.workspaceFolder = folderPath || "";
    var display = document.getElementById("cfgWorkspaceDisplay");
    if (display) display.textContent = state.workspaceFolder || "(not detected)";
    saveStateToVscode();
  }
  window.setDashboardWorkspace = setDashboardWorkspace;

  function applyVscodeSettings(vscodeSettings) {
    if (!vscodeSettings) return;
    state.settingsLoadedFromVscode = true;

    if (vscodeSettings.provider !== undefined) {
      state.provider = vscodeSettings.provider;
      state.settings.provider = vscodeSettings.provider;
    }
    if (vscodeSettings.baseUrl !== undefined) {
      state.baseUrl = vscodeSettings.baseUrl;
      state.settings.baseUrl = vscodeSettings.baseUrl;
    }
    if (vscodeSettings.model !== undefined) {
      state.settings.model = vscodeSettings.model;
      if (!state.selectedModel) {
        state.selectedModel = vscodeSettings.model;
      }
    }
    if (vscodeSettings.maxIterations !== undefined) state.settings.maxIterations = vscodeSettings.maxIterations;
    if (vscodeSettings.streaming !== undefined) state.settings.streaming = vscodeSettings.streaming;
    if (vscodeSettings.showThinking !== undefined) state.settings.showThinking = vscodeSettings.showThinking;
    if (vscodeSettings.confirmDangerous !== undefined) state.settings.confirmDangerous = vscodeSettings.confirmDangerous;
    if (vscodeSettings.enableTools !== undefined) state.settings.enableTools = vscodeSettings.enableTools;
    if (vscodeSettings.hasApiKey !== undefined) state.hasApiKey = vscodeSettings.hasApiKey;

    // Subagent settings
    if (vscodeSettings.subagentProvider !== undefined) state.settings.subagentProvider = vscodeSettings.subagentProvider;
    if (vscodeSettings.subagentModel !== undefined) state.settings.subagentModel = vscodeSettings.subagentModel;
    if (vscodeSettings.subagentMaxConcurrent !== undefined) state.settings.subagentMaxConcurrent = vscodeSettings.subagentMaxConcurrent;
    if (vscodeSettings.subagentMaxIterations !== undefined) state.settings.subagentMaxIterations = vscodeSettings.subagentMaxIterations;
    if (vscodeSettings.subagentMaxDepth !== undefined) state.settings.subagentMaxDepth = vscodeSettings.subagentMaxDepth;

    updateSettingsUI();
    updateModelBadge();
    updateModelSelectValue();
    renderSubagentSettings();
  }
  window.applyVscodeSettings = applyVscodeSettings;

  function updateSettingsUI() {
    var providerEl = document.getElementById("cfgProvider");
    var baseUrlEl = document.getElementById("cfgBaseUrl");
    var apiKeyEl = document.getElementById("cfgApiKey");
    var modelEl = document.getElementById("cfgModel");
    var maxIterEl = document.getElementById("cfgMaxIterations");
    var streamingEl = document.getElementById("cfgStreaming");
    var showThinkingEl = document.getElementById("cfgShowThinking");
    var confirmEl = document.getElementById("cfgConfirmDangerous");
    var compNameGroup = document.getElementById("cfgCompatibleNameGroup");
    var compNameEl = document.getElementById("cfgCompatibleName");
    var compApiTypeGroup = document.getElementById("cfgCompatibleApiTypeGroup");
    var compApiTypeEl = document.getElementById("cfgCompatibleApiType");

    var currentProvider = state.settings.provider || 'ollama';
    var isCompatible = currentProvider === 'compatible' || currentProvider.startsWith('compatible:');

    if (providerEl) {
      // Re-populate dropdown dynamically
      var configs = state.savedProviderConfigs || {};
      var keys = Object.keys(configs);
      
      var html = 
        '<option value="ollama">Ollama</option>' +
        '<option value="openai">OpenAI</option>' +
        '<option value="anthropic">Anthropic</option>' +
        '<option value="gemini">Google Gemini</option>' +
        '<option value="openrouter">OpenRouter</option>' +
        '<option value="xai">xAI (Grok)</option>' +
        '<option value="groq">Groq</option>';
      
      // Add custom compatible options
      var hasCurrentAsCustom = false;
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key.startsWith('compatible:')) {
          var name = key.substring(11);
          var cfg = configs[key] || {};
          var type = cfg.apiType || 'openai';
          var typeLabel = type === 'anthropic' ? 'Anthropic' : (type === 'gemini' ? 'Gemini' : 'Compatible');
          html += '<option value="' + esc(key) + '">' + esc(name) + ' (' + typeLabel + ')</option>';
          if (key === currentProvider) {
            hasCurrentAsCustom = true;
          }
        }
      }
      
      // If the current provider is compatible:XYZ but not saved yet
      if (currentProvider && currentProvider.startsWith('compatible:') && !hasCurrentAsCustom) {
        var name = currentProvider.substring(11);
        var type = state.settings.apiType || 'openai';
        var typeLabel = type === 'anthropic' ? 'Anthropic' : (type === 'gemini' ? 'Gemini' : 'Compatible');
        html += '<option value="' + esc(currentProvider) + '">' + esc(name) + ' (' + typeLabel + ')</option>';
      }
      
      html += '<option value="compatible">OpenAI/Anthropic/Gemini Compatible (New...)</option>';
      providerEl.innerHTML = html;
      providerEl.value = currentProvider;
    }

    if (compNameGroup && compNameEl && compApiTypeGroup && compApiTypeEl) {
      if (isCompatible) {
        compNameGroup.style.display = 'flex';
        compApiTypeGroup.style.display = 'flex';
        if (currentProvider.startsWith('compatible:')) {
          compNameEl.value = currentProvider.substring(11);
          var saved = (state.savedProviderConfigs || {})[currentProvider] || {};
          compApiTypeEl.value = state.settings.apiType || saved.apiType || 'openai';
        } else {
          compNameEl.value = '';
          compApiTypeEl.value = state.settings.apiType || 'openai';
        }
      } else {
        compNameGroup.style.display = 'none';
        compApiTypeGroup.style.display = 'none';
        compNameEl.value = '';
        compApiTypeEl.value = 'openai';
      }
    }

    var defaultUrl = PROVIDER_DEFAULT_URLS[currentProvider] !== undefined ? PROVIDER_DEFAULT_URLS[currentProvider] : '';
    if (baseUrlEl) {
      baseUrlEl.value = (state.settings.baseUrl !== undefined && state.settings.baseUrl !== null && state.settings.baseUrl !== '') ? state.settings.baseUrl : defaultUrl;
    }

    // Check if the current selected provider has a saved key, otherwise show empty
    var configs = state.savedProviderConfigs || {};
    var hasApiKeyForCurrent = false;
    if (configs[currentProvider] && configs[currentProvider].apiKey) {
      hasApiKeyForCurrent = true;
    } else if (currentProvider === state.settings.provider && state.hasApiKey) {
      hasApiKeyForCurrent = true;
    }
    if (apiKeyEl) apiKeyEl.value = hasApiKeyForCurrent ? "••••••••" : "";

    var modelVal = state.settings.model || '';
    if (!modelVal && configs[currentProvider] && configs[currentProvider].model) {
      modelVal = configs[currentProvider].model;
    } else if (!modelVal && state.selectedProvider === currentProvider && state.selectedModel) {
      modelVal = state.selectedModel;
    }
    if (modelEl) modelEl.value = modelVal;
    if (maxIterEl) maxIterEl.value = state.settings.maxIterations || 20;
    if (streamingEl) streamingEl.checked = state.settings.streaming !== false;
    if (showThinkingEl) showThinkingEl.checked = state.settings.showThinking !== false;
    if (confirmEl) confirmEl.checked = state.settings.confirmDangerous !== false;
    var globalToolsToggle = document.getElementById("mcpGlobalToolsToggle");
    if (globalToolsToggle) globalToolsToggle.checked = state.settings.enableTools !== false;
  }

  function handleLoadProviderBtnClick(e) {
    e.stopPropagation();
    var btn = e.currentTarget;
    var item = btn.closest('.cr-saved-provider-item');
    var prov = item ? item.dataset.provider : '';
    var configs = state.savedProviderConfigs || {};
    if (prov && configs[prov]) {
      loadProviderToForm(prov, configs[prov]);
    }
  }

  function handleRemoveProviderBtnClick(e) {
    e.stopPropagation();
    var btn = e.currentTarget;
    var item = btn.closest('.cr-saved-provider-item');
    var prov = item ? item.dataset.provider : '';
    var configs = state.savedProviderConfigs || {};
    if (prov) {
      delete configs[prov];
      state.savedProviderConfigs = configs;
      renderSavedProviders();
      if (state.isVsCode && window.VSCODE_API) {
        window.VSCODE_API.postMessage({ type: 'removeProviderConfig', provider: prov });
      }
    }
  }

  /**
   * Render the list of saved provider configs in the settings panel.
   */
  function renderSavedProviders() {
    var section = document.getElementById("savedProvidersSection");
    if (!section) return;
    var configs = state.savedProviderConfigs || {};
    var keys = Object.keys(configs);
    if (!keys.length) {
      section.innerHTML = '';
      return;
    }
    var html = '<div class="cr-saved-providers-heading">Saved Providers</div>';
    for (var i = 0; i < keys.length; i++) {
      var prov = keys[i];
      var cfg = configs[prov] || {};
      var label = prov;
      if (prov.startsWith('compatible:')) {
        var name = prov.substring(11);
        var type = cfg.apiType || 'openai';
        var typeLabel = type === 'anthropic' ? 'Anthropic' : (type === 'gemini' ? 'Gemini' : 'Compatible');
        label = name + ' (' + typeLabel + ')';
      } else {
        label = prov.charAt(0).toUpperCase() + prov.slice(1);
      }
      var keyMap = state.providerHasKeyMap || {};
      var hasKey = keyMap[prov] ? '🔑' : '○';
      var defaultUrl = PROVIDER_DEFAULT_URLS[prov] || '';
      var rawUrl = cfg.baseUrl || defaultUrl;
      var url = rawUrl ? rawUrl.replace(/^https?:\/\//, '').substring(0, 30) : '(no URL)';
      var provErr = (state.providerErrors && state.providerErrors[prov]) || '';
      var errBadge = provErr ? ' <span class="cr-saved-provider-error" title="' + esc(provErr) + '">⚠️</span>' : '';
      var itemTitle = label + (provErr ? ' — Error: ' + provErr : '');
      html += '<div class="cr-saved-provider-item" data-provider="' + esc(prov) + '">' +
        '<span class="cr-saved-provider-name" title="' + esc(itemTitle) + '">' + hasKey + ' ' + esc(label) + errBadge + '</span>' +
        '<span class="cr-saved-provider-url" title="' + esc(rawUrl || '') + '">' + esc(url) + '</span>' +
        '<button class="cr-saved-provider-load" title="Load this provider\'s settings">Load</button>' +
        '<button class="cr-saved-provider-remove" title="Remove this provider config">✕</button>' +
        '</div>';
    }
    section.innerHTML = html;

    var loadBtns = section.querySelectorAll('.cr-saved-provider-load');
    for (var li = 0; li < loadBtns.length; li++) {
      loadBtns[li].onclick = handleLoadProviderBtnClick;
    }

    var removeBtns = section.querySelectorAll('.cr-saved-provider-remove');
    for (var ri = 0; ri < removeBtns.length; ri++) {
      removeBtns[ri].onclick = handleRemoveProviderBtnClick;
    }

    renderSubagentSettings();
  }

  /**
   * Load a saved provider's config into the settings form fields.
   */
  function loadProviderToForm(provider, cfg) {
    if (!cfg) cfg = {};
    var defaultUrl = PROVIDER_DEFAULT_URLS[provider] !== undefined ? PROVIDER_DEFAULT_URLS[provider] : '';
    state.provider = provider;
    state.settings.provider = provider;
    state.settings.baseUrl = cfg.baseUrl || defaultUrl;
    state.settings.apiKey = '';
    var keyMap = state.providerHasKeyMap || {};
    state.hasApiKey = !!keyMap[provider];
    state.settings.model = cfg.model || '';
    state.settings.apiType = cfg.apiType || 'openai';

    if (cfg.model) {
      state.selectedModel = cfg.model;
      state.selectedProvider = provider;
      updateModelBadge();
      updateModelSelectValue();
    }

    updateSettingsUI();
  }

  function renderDashboard(container) {
    if (!container) return;
    loadConversations();
    container.innerHTML = buildShell();
    initUI();
    renderSidebar();

    var sidebar = document.getElementById("cr-chat-sidebar");
    if (sidebar) {
      sidebar.classList.toggle("open", state.sidebarOpen);
      sidebar.classList.toggle("closed", !state.sidebarOpen);
    }

    var hasActive = false;
    if (state.activeConversationId) {
      for (var i = 0; i < state.conversations.length; i++) {
        if (state.conversations[i].id === state.activeConversationId) {
          hasActive = true;
          break;
        }
      }
    }
    if (state.activeConversationId && hasActive) {
      selectConversation(state.activeConversationId);
    } else if (state.conversations.length) {
      selectConversation(state.conversations[0].id);
    } else {
      selectConversation(null);
    }

    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: "webviewReady" });
    } else {
      loadStandaloneSettings();
      loadModels();
    }
  }
  window.renderDashboard = renderDashboard;

  function loadStandaloneSettings() {
    // Standalone fallback: read from localStorage or window.CODERUN_CONFIG
    try {
      var saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      if (saved.provider) state.provider = state.settings.provider = saved.provider;
      if (saved.baseUrl) state.baseUrl = state.settings.baseUrl = saved.baseUrl;
      if (saved.apiKey) state.apiKey = state.settings.apiKey = saved.apiKey;
      if (saved.model) {
        state.settings.model = saved.model;
        state.selectedModel = saved.model;
      }
    } catch (_) {
      // Intentionally ignore storage read/parse error to fall back to default settings
    }

    // Override with window.CODERUN_CONFIG if present
    if (window.CODERUN_CONFIG) {
      if (window.CODERUN_CONFIG.provider) state.provider = state.settings.provider = window.CODERUN_CONFIG.provider;
      if (window.CODERUN_CONFIG.baseUrl) state.baseUrl = state.settings.baseUrl = window.CODERUN_CONFIG.baseUrl;
      if (window.CODERUN_CONFIG.model) {
        state.settings.model = window.CODERUN_CONFIG.model;
        if (!state.selectedModel) state.selectedModel = window.CODERUN_CONFIG.model;
      }
    }

    updateSettingsUI();
  }

  function buildShell() {
    return (
      '<div class="cr-root">' +
        '<header class="cr-header">' +
          '<div class="cr-header-left">' +
            '<span class="cr-copilot-mark">R</span>' +
            '<span class="cr-title">CodeRun Agent</span>' +
            '<span class="cr-model-badge" id="headerModelBadge"></span>' +
          '</div>' +
          '<div class="cr-header-right">' +
            '<span class="cr-status"><span class="cr-status-dot connecting" id="status-dot"></span><span id="status-text">Connecting</span></span>' +
            '<button id="newChatHeaderBtn" class="cr-icon-btn" title="New Chat">+</button>' +
          '</div>' +
        '</header>' +
        '<div class="cr-body">' +
          '<nav class="cr-rail">' +
            '<button id="rail-toggle" class="cr-rail-btn" title="Toggle chats">☰</button>' +
            '<button id="rail-chat" class="cr-rail-btn active" title="Chat">💬</button>' +
            '<button id="rail-settings" class="cr-rail-btn" title="Settings">⚙</button>' +
            '<button id="rail-rules" class="cr-rail-btn" title="Rules">📋</button>' +
            '<button id="rail-mcp" class="cr-rail-btn" title="Model Context Protocol (MCP)">' +
              '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>' +
            '</button>' +
            '<button id="rail-subagents" class="cr-rail-btn" title="Subagent Settings">🤖</button>' +
          '</nav>' +
          '<main class="cr-viewport">' +
            '<section id="panel-chat" class="cr-panel active">' +
              '<div class="cr-chat-layout">' +
                '<aside id="cr-chat-sidebar" class="cr-sidebar open">' +
                  '<div class="cr-sidebar-head"><span>Chats</span><button id="newChatBtn" class="cr-mini-btn" title="New chat">+</button></div>' +
                  '<div id="thread-list" class="cr-thread-list"></div>' +
                '</aside>' +
                '<section class="cr-chat-main">' +
                  '<div class="cr-model-bar">' +
                    '<label for="modelInput">Model</label>' +
                    '<div class="cr-combobox">' +
                      '<input type="text" id="modelInput" placeholder="Select model..." readonly autocomplete="off">' +
                      '<span id="modelDropdownArrow" class="cr-combobox-arrow">▼</span>' +
                      '<div id="modelDropdownList" class="cr-combobox-list" style="display:none"></div>' +
                    '</div>' +
                    '<button id="refreshModelsBtn" class="cr-refresh-btn" title="Refresh models">↻</button>' +
                  '</div>' +
                  '<div class="cr-view-nav">' +
                    '<button id="viewNavChatsBtn" class="cr-view-nav-btn active">Agent Chats</button>' +
                    '<button id="viewNavTracesBtn" class="cr-view-nav-btn">Agent Traces</button>' +
                    '<button id="viewNavSubagentsBtn" class="cr-view-nav-btn">Subagents</button>' +
                    '<button id="viewNavSubagentTracesBtn" class="cr-view-nav-btn">Subagent Traces</button>' +
                  '</div>' +
                  '<div id="chat-area-container"></div>' +
                  '<div id="traces-area-container" style="display:none;"></div>' +
                  '<div id="subagents-area-container" style="display:none; flex: 1; height: 100%; min-height: 0; width: 100%;"></div>' +
                  '<div id="subagent-traces-area-container" style="display:none; flex: 1; height: 100%; min-height: 0; width: 100%;"></div>' +
                '</section>' +
              '</div>' +
            '</section>' +
            '<section id="panel-settings" class="cr-panel">' +
              '<div class="cr-settings">' +
                '<div class="cr-input-group"><label>Provider</label><select id="cfgProvider"><option value="ollama">Ollama</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Google Gemini</option><option value="openrouter">OpenRouter</option><option value="xai">xAI (Grok)</option><option value="groq">Groq</option><option value="compatible">OpenAI Compatible</option></select></div>' +
                '<div class="cr-input-group" id="cfgCompatibleNameGroup" style="display:none"><label>Custom Provider Name</label><input type="text" id="cfgCompatibleName" placeholder="e.g. Bynara, LM Studio"></div>' +
                '<div class="cr-input-group" id="cfgCompatibleApiTypeGroup" style="display:none"><label>API Type</label><select id="cfgCompatibleApiType"><option value="openai">OpenAI Compatible</option><option value="anthropic">Anthropic Compatible</option><option value="gemini">Google Gemini Compatible</option></select></div>' +
                '<div class="cr-input-group"><label>Base URL</label><input type="text" id="cfgBaseUrl" value="' + esc(state.baseUrl) + '" placeholder="e.g., https://api.example.com/v1"></div>' +
                '<div class="cr-input-group"><label>API Key</label><input type="password" id="cfgApiKey" value="" placeholder="sk-..."></div>' +
                '<div class="cr-input-group"><label>Model</label><input type="text" id="cfgModel" value="' + esc(state.settings.model) + '" placeholder="Model name (e.g., llama3, gpt-4)"></div>' +
                '<div class="cr-input-group"><label>Max Iterations</label><input type="number" id="cfgMaxIterations" value="20" min="1" max="50"></div>' +
                '<div class="cr-input-group"><label>Workspace Folder</label><div id="cfgWorkspaceDisplay" class="cr-workspace-display">' + esc(state.workspaceFolder || "(not detected)") + '</div></div>' +
                '<div class="cr-input-group cr-checkbox"><label><input type="checkbox" id="cfgStreaming" checked> Enable Streaming</label></div>' +
                '<div class="cr-input-group cr-checkbox"><label><input type="checkbox" id="cfgShowThinking" checked> Show Thinking</label></div>' +
                '<div class="cr-input-group cr-checkbox"><label><input type="checkbox" id="cfgConfirmDangerous" checked> Confirm Dangerous Actions</label></div>' +
                '<button id="saveSettingsBtn" class="cr-save-btn">Save Settings</button>' +
                '<button id="clearAllConvBtn" class="cr-danger-btn">Clear All Conversations</button>' +
                '<div id="savedProvidersSection" class="cr-saved-providers"></div>' +
              '</div>' +
            '</section>' +
            '<section id="panel-rules" class="cr-panel">' +
              '<div class="cr-settings">' +
                '<div class="cr-rules-header-block">' +
                  '<div class="cr-rules-header-row">' +
                    '<h3 class="cr-rules-heading">' +
                      '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;margin-right:6px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>Rules' +
                    '</h3>' +
                    '<div class="cr-rules-order-tag">' +
                      'Rule order <span class="cr-order-global">Global</span> <span class="cr-order-arrow">→</span> <span class="cr-order-workspace">Workspace</span>' +
                    '</div>' +
                  '</div>' +
                  '<p class="cr-rules-desc">Instructions the agent follows automatically.</p>' +
                  '<p class="cr-rules-subdesc">Global rules apply everywhere; workspace rules apply only to this project.</p>' +
                '</div>' +
                '<hr class="cr-rules-divider">' +
                '<div class="cr-rules-card">' +
                  '<div class="cr-rules-card-header">' +
                    '<div class="cr-rules-card-title">' +
                      '<span class="cr-rules-icon">🌐</span>' +
                      '<span class="cr-rules-title-text global">GLOBAL</span>' +
                    '</div>' +
                    '<div class="cr-rules-path-container">' +
                      '<span class="cr-rules-path" id="rulesGlobalPath" title="~/.coderun/rules">~/.coderun/rules</span>' +
                      '<button class="cr-rules-open-file-btn" id="openGlobalRulesFileBtn" title="Open in VS Code editor">' +
                        '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>' +
                      '</button>' +
                    '</div>' +
                  '</div>' +
                  '<p class="cr-rules-card-hint">Applied across all projects</p>' +
                  '<div class="cr-rules-editor-wrapper">' +
                    '<div class="cr-rules-gutter" id="rulesGlobalGutter">' +
                      '<div class="cr-gutter-num">1</div>' +
                      '<div class="cr-gutter-num">2</div>' +
                      '<div class="cr-gutter-num">3</div>' +
                      '<div class="cr-gutter-num">4</div>' +
                      '<div class="cr-gutter-num">5</div>' +
                      '<div class="cr-gutter-num">6</div>' +
                    '</div>' +
                    '<textarea id="rulesGlobalTextarea" class="cr-rules-textarea" placeholder="Enter rules that apply to every project...&#10;Example: Always use ES modules, never require()."></textarea>' +
                  '</div>' +
                  '<div class="cr-rules-card-footer">' +
                    '<div class="cr-rules-status" id="rulesGlobalStatus">' +
                      '<span class="cr-rules-status-dot saved" id="rulesGlobalStatusDot"></span>' +
                      '<span class="cr-rules-status-text" id="rulesGlobalStatusText">Saved</span>' +
                      '<span class="cr-rules-status-time" id="rulesGlobalStatusTime"></span>' +
                    '</div>' +
                    '<div class="cr-rules-actions">' +
                      '<span class="cr-rules-kbd">Ctrl + S</span>' +
                      '<button id="saveGlobalRulesBtn" class="cr-rules-primary-save-btn">' +
                        '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;margin-right:4px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>Save' +
                      '</button>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<hr class="cr-rules-divider">' +
                '<div class="cr-rules-card">' +
                  '<div class="cr-rules-card-header">' +
                    '<div class="cr-rules-card-title">' +
                      '<span class="cr-rules-icon">📂</span>' +
                      '<span class="cr-rules-title-text workspace">WORKSPACE</span>' +
                    '</div>' +
                    '<div class="cr-rules-path-container">' +
                      '<span class="cr-rules-path" id="rulesWorkspacePath" title=".coderunrules">.coderunrules</span>' +
                      '<button class="cr-rules-open-file-btn" id="openWorkspaceRulesFileBtn" title="Open in VS Code editor">' +
                        '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>' +
                      '</button>' +
                    '</div>' +
                  '</div>' +
                  '<p class="cr-rules-card-hint">Applied only to this project</p>' +
                  '<div class="cr-rules-editor-wrapper">' +
                    '<div class="cr-rules-gutter" id="rulesWorkspaceGutter">' +
                      '<div class="cr-gutter-num">1</div>' +
                      '<div class="cr-gutter-num">2</div>' +
                      '<div class="cr-gutter-num">3</div>' +
                      '<div class="cr-gutter-num">4</div>' +
                      '<div class="cr-gutter-num">5</div>' +
                      '<div class="cr-gutter-num">6</div>' +
                    '</div>' +
                    '<textarea id="rulesWorkspaceTextarea" class="cr-rules-textarea" placeholder="Enter rules for this project only...&#10;Example: Use PostgreSQL syntax for all queries."></textarea>' +
                  '</div>' +
                  '<div class="cr-rules-card-footer">' +
                    '<div class="cr-rules-status" id="rulesWorkspaceStatus">' +
                      '<span class="cr-rules-status-dot clean" id="rulesWorkspaceStatusDot"></span>' +
                      '<span class="cr-rules-status-text" id="rulesWorkspaceStatusText">No changes</span>' +
                      '<span class="cr-rules-status-time" id="rulesWorkspaceStatusTime"></span>' +
                    '</div>' +
                    '<div class="cr-rules-actions">' +
                      '<span class="cr-rules-kbd">Ctrl + S</span>' +
                      '<button id="saveWorkspaceRulesBtn" class="cr-rules-primary-save-btn">' +
                        '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;margin-right:4px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>Save' +
                      '</button>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<hr class="cr-rules-divider">' +
                '<div class="cr-rules-precedence-card">' +
                  '<h4 class="cr-precedence-heading">Rule precedence</h4>' +
                  '<p class="cr-precedence-desc">The agent follows rules in this order:</p>' +
                  '<div class="cr-precedence-flow">' +
                    '<div class="cr-precedence-box global">' +
                      '<div class="cr-precedence-box-title"><span class="cr-precedence-box-icon">🌐</span> GLOBAL</div>' +
                      '<div class="cr-precedence-box-sub">Applied everywhere</div>' +
                    '</div>' +
                    '<span class="cr-precedence-arrow">→</span>' +
                    '<div class="cr-precedence-box workspace">' +
                      '<div class="cr-precedence-box-title"><span class="cr-precedence-box-icon">📂</span> WORKSPACE</div>' +
                      '<div class="cr-precedence-box-sub">Applied to this project</div>' +
                    '</div>' +
                    '<span class="cr-precedence-arrow">→</span>' +
                    '<div class="cr-precedence-box agent">' +
                      '<div class="cr-precedence-box-title"><span class="cr-precedence-box-icon">🤖</span> AGENT</div>' +
                      '<div class="cr-precedence-box-sub">Final instructions</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</section>' +
            '<section id="panel-mcp" class="cr-panel">' +
              '<div class="cr-settings cr-mcp-panel-content">' +
                '<div class="cr-mcp-top-header">' +
                  '<div class="cr-mcp-header-top-row">' +
                    '<div class="cr-mcp-header-title-box">' +
                      '<div class="cr-mcp-icon-box">' +
                        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>' +
                      '</div>' +
                      '<h3 class="cr-mcp-header-title">Model Context Protocol (MCP)</h3>' +
                    '</div>' +
                    '<button id="addMcpServerBtn" class="cr-btn-add-mcp" type="button">' +
                      '<span style="font-size:14px;margin-right:2px;">+</span>' +
                      '<span>Add MCP</span>' +
                      '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="margin-left:4px;"><path d="M7 10l5 5 5-5z"/></svg>' +
                    '</button>' +
                  '</div>' +
                  '<div class="cr-mcp-header-divider"></div>' +
                  '<div class="cr-mcp-header-desc">' +
                    '<p class="cr-mcp-header-p">Connect built-in free tools or custom servers (Python, Node, SSE, HTTP).</p>' +
                    '<p class="cr-mcp-header-p-sub">Tools are auto-discovered, presented to the model, and guarded by your permission flow.</p>' +
                  '</div>' +
                '</div>' +
                '<div class="cr-mcp-global-card">' +
                  '<label class="cr-switch" title="Toggle Function Calling / Agent Tools">' +
                    '<input type="checkbox" id="mcpGlobalToolsToggle" checked class="cr-switch-input">' +
                    '<span class="cr-switch-slider"></span>' +
                  '</label>' +
                  '<div class="cr-mcp-global-card-text">' +
                    '<strong class="cr-mcp-global-card-title">Enable Function Calling / Agent Tools</strong>' +
                    '<div class="cr-mcp-global-card-sub">When disabled, tools parameter is omitted from API requests so models/APIs that block tools will not error.</div>' +
                  '</div>' +
                '</div>' +
                '<div id="mcpServerList" class="cr-mcp-list">' +
                  '<div class="cr-mcp-empty">Loading MCP servers...</div>' +
                '</div>' +
              '</div>' +
            '</section>' +
            '<section id="panel-subagents" class="cr-panel">' +
              '<div class="cr-settings cr-subagent-settings-panel">' +
                '<div class="cr-subagent-top-header">' +
                  '<div class="cr-subagent-header-row">' +
                    '<div class="cr-subagent-header-title-box">' +
                      '<div class="cr-subagent-icon-box">🤖</div>' +
                      '<div>' +
                        '<h3 class="cr-subagent-header-title">Subagent Settings</h3>' +
                        '<p class="cr-subagent-header-sub">Configure dedicated provider, model, and execution limits for subagent workers</p>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="cr-subagent-header-divider"></div>' +
                '</div>' +
                '<div class="cr-subagent-active-card">' +
                  '<div class="cr-subagent-card-title-row">' +
                    '<span class="cr-subagent-pulse-dot"></span>' +
                    '<span class="cr-subagent-card-heading">Active Subagent Runtime</span>' +
                  '</div>' +
                  '<div class="cr-subagent-active-details">' +
                    '<div class="cr-subagent-status-pill">' +
                      '<span class="cr-subagent-pill-label">Provider</span>' +
                      '<span id="subagentActiveProviderDisplay" class="cr-subagent-pill-value">(Inherited)</span>' +
                    '</div>' +
                    '<div class="cr-subagent-status-pill">' +
                      '<span class="cr-subagent-pill-label">Model</span>' +
                      '<span id="subagentActiveModelDisplay" class="cr-subagent-pill-value">(Inherited)</span>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="cr-subagent-form">' +
                  '<div class="cr-subagent-section-card">' +
                    '<div class="cr-subagent-section-header">' +
                      '<span class="cr-subagent-section-icon">⚡</span>' +
                      '<div>' +
                        '<h4 class="cr-subagent-section-title">Model &amp; Provider</h4>' +
                        '<p class="cr-subagent-section-desc">Select an isolated provider and model for subagents, or inherit from the main agent.</p>' +
                      '</div>' +
                    '</div>' +
                    '<div class="cr-input-group">' +
                      '<label for="subagentCfgProvider">Subagent Provider</label>' +
                      '<select id="subagentCfgProvider"><option value="">(Inherit from Main Agent)</option></select>' +
                      '<span class="cr-field-hint">Choose from saved providers or inherit main agent configuration.</span>' +
                    '</div>' +
                    '<div class="cr-input-group">' +
                      '<label for="subagentModelInput">Subagent Model</label>' +
                      '<div class="cr-combobox cr-subagent-combobox">' +
                        '<input type="text" id="subagentModelInput" placeholder="Select subagent model..." readonly autocomplete="off">' +
                        '<span id="subagentModelDropdownArrow" class="cr-combobox-arrow">▼</span>' +
                        '<div id="subagentModelDropdownList" class="cr-combobox-list" style="display:none"></div>' +
                      '</div>' +
                      '<span class="cr-field-hint">Specify model for subagents, or inherit from main chat.</span>' +
                    '</div>' +
                  '</div>' +
                  '<div class="cr-subagent-section-card">' +
                    '<div class="cr-subagent-section-header">' +
                      '<span class="cr-subagent-section-icon">⚙️</span>' +
                      '<div>' +
                        '<h4 class="cr-subagent-section-title">Execution &amp; Concurrency Limits</h4>' +
                        '<p class="cr-subagent-section-desc">Govern concurrency thresholds and iteration loops for subagent tasks.</p>' +
                      '</div>' +
                    '</div>' +
                    '<div class="cr-input-group">' +
                      '<label for="subagentCfgMaxConcurrent">Max Concurrent Subagents</label>' +
                      '<input type="number" id="subagentCfgMaxConcurrent" value="10" min="1" max="50">' +
                      '<span class="cr-field-hint">Simultaneous subagent executions allowed (1 – 50, default: 10).</span>' +
                    '</div>' +
                    '<div class="cr-input-group">' +
                      '<label for="subagentCfgMaxIterations">Subagent Max Iterations</label>' +
                      '<input type="number" id="subagentCfgMaxIterations" value="20" min="1" max="100">' +
                      '<span class="cr-field-hint">Maximum reasoning/tool loops per subagent run (1 – 100, default: 20).</span>' +
                    '</div>' +
                    '<div class="cr-input-group">' +
                      '<label for="subagentCfgMaxDepth">Subagent Max Depth</label>' +
                      '<input type="number" id="subagentCfgMaxDepth" value="1" min="0" max="3">' +
                      '<span class="cr-field-hint">Delegation nesting depth: 0 = disabled, 1 = parent only, 2+ = nested.</span>' +
                    '</div>' +
                  '</div>' +
                  '<div class="cr-subagent-actions">' +
                    '<button id="saveSubagentSettingsBtn" class="cr-save-btn cr-subagent-save-btn">Save Subagent Settings</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</section>' +
          '</main>' +
        '</div>' +
        '<div id="mcpModalOverlay" class="cr-mcp-modal-overlay" style="display:none;">' +
          '<div class="cr-mcp-modal">' +
            '<div class="cr-mcp-modal-header">' +
              '<div class="cr-mcp-modal-title-wrap">' +
                '<div class="cr-mcp-modal-icon-box">' +
                  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>' +
                    '<rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>' +
                    '<line x1="6" y1="6" x2="6.01" y2="6"></line>' +
                    '<line x1="6" y1="18" x2="6.01" y2="18"></line>' +
                  '</svg>' +
                '</div>' +
                '<div>' +
                  '<h3 class="cr-mcp-modal-title">Add MCP Server</h3>' +
                  '<p class="cr-mcp-modal-subtitle">Connect an MCP server to extend your agent with external tools.</p>' +
                '</div>' +
              '</div>' +
              '<button id="closeMcpModalBtn" class="cr-mcp-modal-close-btn" title="Close">✕</button>' +
            '</div>' +
            '<div class="cr-mcp-modal-body">' +
              '<div class="cr-mcp-modal-section">' +
                '<div class="cr-mcp-sec-header-row">' +
                  '<div class="cr-mcp-sec-title-group">' +
                    '<div class="cr-mcp-sec-title-left">' +
                      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>' +
                      '<span class="cr-mcp-sec-heading">Quick Setup (Popular Servers)</span>' +
                    '</div>' +
                    '<div class="cr-mcp-sec-sub">Select a template to pre-fill the configuration.</div>' +
                  '</div>' +
                  '<button type="button" id="mcpViewAllTemplatesBtn" class="cr-mcp-btn-secondary-link">' +
                    '<span>View All Templates</span>' +
                    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>' +
                  '</button>' +
                '</div>' +
                '<div class="cr-mcp-templates-grid">' +
                  '<div class="cr-mcp-template-card active" data-template="github">' +
                    '<div class="cr-mcp-template-icon">' +
                      '<svg width="26" height="26" viewBox="0 0 24 24" fill="#f0f6fc"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>' +
                    '</div>' +
                    '<span class="cr-mcp-template-name">GitHub</span>' +
                  '</div>' +
                  '<div class="cr-mcp-template-card" data-template="web-fetch">' +
                    '<div class="cr-mcp-template-icon">' +
                      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#388bfd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>' +
                    '</div>' +
                    '<span class="cr-mcp-template-name">Web Fetch</span>' +
                  '</div>' +
                  '<div class="cr-mcp-template-card" data-template="memory">' +
                    '<div class="cr-mcp-template-icon">' +
                      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#f778ba" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04z"></path><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04z"></path></svg>' +
                    '</div>' +
                    '<span class="cr-mcp-template-name">Memory</span>' +
                  '</div>' +
                  '<div class="cr-mcp-template-card" data-template="postgres">' +
                    '<div class="cr-mcp-template-icon">' +
                      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 11V4a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v7"></path><path d="M5 11a7 7 0 0 0 14 0"></path><path d="M9 22v-4"></path><path d="M15 22v-4"></path><path d="M9 18h6"></path></svg>' +
                    '</div>' +
                    '<span class="cr-mcp-template-name">PostgreSQL</span>' +
                  '</div>' +
                  '<div class="cr-mcp-template-card" data-template="mysql">' +
                    '<div class="cr-mcp-template-icon">' +
                      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#e3b341" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>' +
                    '</div>' +
                    '<span class="cr-mcp-template-name">MySQL</span>' +
                  '</div>' +
                  '<div class="cr-mcp-template-card" data-template="custom">' +
                    '<div class="cr-mcp-template-icon">' +
                      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#8b949e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0 2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>' +
                    '</div>' +
                    '<span class="cr-mcp-template-name">Custom</span>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="cr-mcp-modal-section cr-mcp-server-config-section">' +
                '<div class="cr-mcp-sec-title-left" style="margin-bottom:12px;">' +
                  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0 2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>' +
                  '<span class="cr-mcp-sec-heading">Server Configuration</span>' +
                '</div>' +
                '<div class="cr-mcp-form-group">' +
                  '<label class="cr-mcp-form-label">Server Name <span class="cr-mcp-required">*</span></label>' +
                  '<input type="text" id="mcpServerName" class="cr-mcp-form-input" value="github" placeholder="github">' +
                  '<div class="cr-mcp-form-subtext">A friendly name to identify this server.</div>' +
                '</div>' +
                '<div class="cr-mcp-form-group">' +
                  '<label class="cr-mcp-form-label">Transport Type <span class="cr-mcp-required">*</span> <span class="cr-mcp-info-badge" title="How the client connects to this MCP server">ⓘ</span></label>' +
                  '<input type="radio" name="mcpTransportType" value="stdio" id="mcpRadioStdio" style="display:none;" checked>' +
                  '<input type="radio" name="mcpTransportType" value="sse" id="mcpRadioSse" style="display:none;">' +
                  '<div class="cr-mcp-transport-cards-row">' +
                    '<div id="mcpTransportCardStdio" class="cr-mcp-transport-card active" data-type="stdio">' +
                      '<div class="cr-mcp-transport-radio-circle"><div class="cr-mcp-transport-radio-dot"></div></div>' +
                      '<div class="cr-mcp-transport-text-wrap">' +
                        '<div class="cr-mcp-transport-title">Local Command</div>' +
                        '<div class="cr-mcp-transport-sub">Run a local command (Python, Node, Binary)</div>' +
                      '</div>' +
                    '</div>' +
                    '<div id="mcpTransportCardSse" class="cr-mcp-transport-card" data-type="sse">' +
                      '<div class="cr-mcp-transport-radio-circle"><div class="cr-mcp-transport-radio-dot"></div></div>' +
                      '<div class="cr-mcp-transport-text-wrap">' +
                        '<div class="cr-mcp-transport-title">Remote Server</div>' +
                        '<div class="cr-mcp-transport-sub">Connect via SSE or HTTP URL</div>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<div id="mcpStdioFields">' +
                  '<div class="cr-mcp-form-group">' +
                    '<label class="cr-mcp-form-label">Runtime Environment <span class="cr-mcp-required">*</span></label>' +
                    '<div class="cr-mcp-runtime-row">' +
                      '<button type="button" id="mcpRuntimeNodeBtn" class="cr-mcp-runtime-pill active" data-runtime="node">' +
                        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>' +
                        'Node.js (npx / node)' +
                      '</button>' +
                      '<button type="button" id="mcpRuntimePythonBtn" class="cr-mcp-runtime-pill" data-runtime="python">' +
                        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M11.914 2C9.28 2 7.64 3.16 7.64 5.37v2.49h4.36v.62H5.56C3.35 8.48 2 10.12 2 12.75c0 2.64 1.54 4.14 4.04 4.14h1.56v-2.18c0-2.49 1.7-4.36 4.36-4.36h4.35V7.86c0-2.21-1.78-5.86-4.4-5.86zm-1.25 1.56a.93.93 0 1 1 0 1.87.93.93 0 0 1 0-1.87z" fill="#387eb8"/><path d="M12.086 22c2.634 0 4.274-1.16 4.274-3.37v-2.49H12v-.62h6.44c2.21 0 3.56-1.64 3.56-4.27 0-2.64-1.54-4.14-4.04-4.14h-1.56v2.18c0 2.49-1.7 4.36-4.36 4.36H7.74v2.49c0 2.21 1.78 5.86 4.346 5.86zm1.25-1.56a.93.93 0 1 1 0-1.87.93.93 0 0 1 0 1.87z" fill="#ffe052"/></svg>' +
                        'Python (uvx / python)' +
                      '</button>' +
                    '</div>' +
                    '<div class="cr-mcp-form-subtext">Select runtime environment for executing this local MCP server.</div>' +
                  '</div>' +
                  '<div class="cr-mcp-form-group">' +
                    '<label class="cr-mcp-form-label">Command <span class="cr-mcp-required">*</span></label>' +
                    '<input type="text" id="mcpCommand" class="cr-mcp-form-input" value="npx" placeholder="npx">' +
                    '<div class="cr-mcp-form-subtext">The command to start the MCP server.</div>' +
                  '</div>' +
                  '<div class="cr-mcp-form-group">' +
                    '<label class="cr-mcp-form-label">Arguments / Script Path</label>' +
                    '<input type="text" id="mcpArgs" class="cr-mcp-form-input" value="-y @modelcontextprotocol/server-github" placeholder="-y @modelcontextprotocol/server-github">' +
                    '<div class="cr-mcp-form-subtext">Arguments for the command or path to your script.</div>' +
                  '</div>' +
                '</div>' +
                '<div id="mcpSseFields" style="display:none;">' +
                  '<div class="cr-mcp-form-group">' +
                    '<label class="cr-mcp-form-label">Server URL <span class="cr-mcp-required">*</span></label>' +
                    '<input type="text" id="mcpUrl" class="cr-mcp-form-input" placeholder="http://localhost:8000/sse or https://mcp.domain.com/sse">' +
                    '<div class="cr-mcp-form-subtext">The SSE or HTTP endpoint for the MCP server.</div>' +
                  '</div>' +
                  '<div class="cr-mcp-form-group">' +
                    '<label class="cr-mcp-form-label">Headers / Auth (Optional)</label>' +
                    '<input type="text" id="mcpHeaders" class="cr-mcp-form-input" placeholder="Authorization: Bearer mytoken">' +
                    '<div class="cr-mcp-form-subtext">Comma-separated headers (e.g. Authorization: Bearer token).</div>' +
                  '</div>' +
                '</div>' +
                '<div class="cr-mcp-form-group">' +
                  '<div class="cr-mcp-env-header-row">' +
                    '<label class="cr-mcp-form-label" style="margin-bottom:0;">Environment Variables (Optional) <span class="cr-mcp-info-badge" title="Custom environment variables injected into the process">ⓘ</span></label>' +
                    '<button type="button" id="mcpAddEnvVarBtn" class="cr-mcp-btn-add-var">+ Add Variable</button>' +
                  '</div>' +
                  '<div class="cr-mcp-env-table">' +
                    '<div class="cr-mcp-env-table-header">' +
                      '<span class="cr-mcp-env-th-key">Key</span>' +
                      '<span class="cr-mcp-env-th-val">Value</span>' +
                      '<span class="cr-mcp-env-th-act"></span>' +
                    '</div>' +
                    '<div id="mcpEnvRowsContainer" class="cr-mcp-env-rows-container">' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<details class="cr-mcp-advanced-details" id="mcpAdvancedDetails">' +
                  '<summary class="cr-mcp-advanced-summary">' +
                    '<div class="cr-mcp-adv-summary-left">' +
                      '<svg class="cr-mcp-adv-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>' +
                      '<span>Advanced Options</span>' +
                    '</div>' +
                    '<span id="mcpAdvToggleText" class="cr-mcp-adv-toggle-link">Show</span>' +
                  '</summary>' +
                  '<div class="cr-mcp-advanced-body">' +
                    '<div class="cr-mcp-form-group">' +
                      '<label class="cr-mcp-form-label">Custom Working Directory (Optional)</label>' +
                      '<input type="text" id="mcpCwd" class="cr-mcp-form-input" placeholder="e.g. C:/projects/my-mcp-server">' +
                    '</div>' +
                    '<div class="cr-mcp-form-group">' +
                      '<label class="cr-mcp-form-label">Initialization Timeout (Seconds)</label>' +
                      '<input type="number" id="mcpTimeout" class="cr-mcp-form-input" value="15" min="5" max="120">' +
                    '</div>' +
                  '</div>' +
                '</details>' +
                '<div class="cr-mcp-perm-check-wrap">' +
                  '<label class="cr-mcp-checkbox-container">' +
                    '<input type="checkbox" id="mcpAlwaysAsk" checked class="cr-mcp-real-checkbox">' +
                    '<span class="cr-mcp-checkbox-custom"></span>' +
                    '<span class="cr-mcp-perm-label-texts">' +
                      '<strong class="cr-mcp-perm-title">Always ask permission before executing tools</strong>' +
                      '<span class="cr-mcp-perm-sub">When enabled, you\'ll be prompted to approve tool executions.</span>' +
                    '</span>' +
                  '</label>' +
                '</div>' +
                '<div id="mcpModalError" class="cr-mcp-error-box" style="display:none;"></div>' +
              '</div>' +
            '</div>' +
            '<div class="cr-mcp-modal-footer">' +
              '<button id="cancelMcpModalBtn" type="button" class="cr-btn-modal-cancel">Cancel</button>' +
              '<button id="saveMcpModalBtn" type="button" class="cr-btn-modal-primary">Connect & Save</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function initUI() {
    document.getElementById("rail-toggle").onclick = toggleSidebar;
    document.getElementById("rail-chat").onclick = handleRailChatClick;
    document.getElementById("rail-settings").onclick = handleRailSettingsClick;
    var railRulesBtn = document.getElementById("rail-rules");
    if (railRulesBtn) railRulesBtn.onclick = handleRailRulesClick;
    var saveGlobalBtn = document.getElementById("saveGlobalRulesBtn");
    if (saveGlobalBtn) saveGlobalBtn.onclick = handleSaveGlobalRules;
    var saveWorkspaceBtn = document.getElementById("saveWorkspaceRulesBtn");
    if (saveWorkspaceBtn) saveWorkspaceBtn.onclick = handleSaveWorkspaceRules;

    var globalTa = document.getElementById("rulesGlobalTextarea");
    if (globalTa) {
      globalTa.oninput = handleRulesGlobalTextareaInput;
      globalTa.onscroll = handleRulesGlobalScroll;
      globalTa.onkeydown = handleRulesGlobalKeyDown;
    }
    var wsTa = document.getElementById("rulesWorkspaceTextarea");
    if (wsTa) {
      wsTa.oninput = handleRulesWorkspaceTextareaInput;
      wsTa.onscroll = handleRulesWorkspaceScroll;
      wsTa.onkeydown = handleRulesWorkspaceKeyDown;
    }
    var openGlobalBtn = document.getElementById("openGlobalRulesFileBtn");
    if (openGlobalBtn) openGlobalBtn.onclick = handleOpenGlobalRulesFile;
    var openWsBtn = document.getElementById("openWorkspaceRulesFileBtn");
    if (openWsBtn) openWsBtn.onclick = handleOpenWorkspaceRulesFile;
    document.getElementById("newChatBtn").onclick = createNewChat;
    document.getElementById("newChatHeaderBtn").onclick = createNewChat;
    document.getElementById("refreshModelsBtn").onclick = loadModels;
    var clearTermBtn = document.getElementById("clearTerminalBtn");
    if (clearTermBtn) clearTermBtn.onclick = clearTerminal;

    var modelInput = document.getElementById("modelInput");
    if (modelInput) {
      modelInput.onclick = handleModelInputClick;
      modelInput.oninput = handleModelInputInput;
    }

    document.addEventListener("click", handleDocumentClickCloseDropdown);

    document.getElementById("cfgProvider").onchange = handleCfgProviderChange;

    document.getElementById("saveSettingsBtn").onclick = handleSaveSettingsClick;

    document.getElementById("clearAllConvBtn").onclick = handleClearAllConvClick;


    var chatsBtn = document.getElementById("viewNavChatsBtn");
    if (chatsBtn) chatsBtn.onclick = handleViewNavChatsClick;

    var tracesBtn = document.getElementById("viewNavTracesBtn");
    if (tracesBtn) tracesBtn.onclick = handleViewNavTracesClick;

    var subagentsBtn = document.getElementById("viewNavSubagentsBtn");
    if (subagentsBtn) subagentsBtn.onclick = handleViewNavSubagentsClick;

    var subagentTracesBtn = document.getElementById("viewNavSubagentTracesBtn");
    if (subagentTracesBtn) subagentTracesBtn.onclick = handleViewNavSubagentTracesClick;

    var railMcpBtn = document.getElementById("rail-mcp");
    if (railMcpBtn) railMcpBtn.onclick = handleRailMcpClick;

    var railSubagentsBtn = document.getElementById("rail-subagents");
    if (railSubagentsBtn) railSubagentsBtn.onclick = handleRailSubagentsClick;

    var saveSubagentBtn = document.getElementById("saveSubagentSettingsBtn");
    if (saveSubagentBtn) saveSubagentBtn.onclick = handleSaveSubagentSettingsClick;

    var subagentProviderSelect = document.getElementById("subagentCfgProvider");
    if (subagentProviderSelect) subagentProviderSelect.onchange = handleSubagentProviderChange;

    var subagentModelInput = document.getElementById("subagentModelInput");
    if (subagentModelInput) subagentModelInput.onclick = handleSubagentModelInputClick;

    var subagentModelArrow = document.getElementById("subagentModelDropdownArrow");
    if (subagentModelArrow) subagentModelArrow.onclick = handleSubagentModelInputClick;

    var addMcpBtn = document.getElementById("addMcpServerBtn");
    if (addMcpBtn) addMcpBtn.onclick = openAddMcpModal;

    var closeMcpBtn = document.getElementById("closeMcpModalBtn");
    if (closeMcpBtn) closeMcpBtn.onclick = closeAddMcpModal;

    var cancelMcpBtn = document.getElementById("cancelMcpModalBtn");
    if (cancelMcpBtn) cancelMcpBtn.onclick = closeAddMcpModal;

    var saveMcpBtn = document.getElementById("saveMcpModalBtn");
    if (saveMcpBtn) saveMcpBtn.onclick = handleSaveMcpServer;

    var tCardStdio = document.getElementById("mcpTransportCardStdio");
    var tCardSse = document.getElementById("mcpTransportCardSse");
    if (tCardStdio) tCardStdio.onclick = handleTransportCardStdioClick;
    if (tCardSse) tCardSse.onclick = handleTransportCardSseClick;

    var runtimeNodeBtn = document.getElementById("mcpRuntimeNodeBtn");
    var runtimePythonBtn = document.getElementById("mcpRuntimePythonBtn");
    if (runtimeNodeBtn) runtimeNodeBtn.onclick = handleRuntimeNodeClick;
    if (runtimePythonBtn) runtimePythonBtn.onclick = handleRuntimePythonClick;

    var globalToolsToggle = document.getElementById("mcpGlobalToolsToggle");
    if (globalToolsToggle) {
      globalToolsToggle.onchange = handleGlobalToolsToggleChange;
    }

    var templateCards = document.querySelectorAll(".cr-mcp-template-card");
    for (var tc = 0; tc < templateCards.length; tc++) {
      templateCards[tc].onclick = handleTemplateCardClick;
    }

    var addVarBtn = document.getElementById("mcpAddEnvVarBtn");
    if (addVarBtn) addVarBtn.onclick = handleAddEnvVarClick;

    var envRowsContainer = document.getElementById("mcpEnvRowsContainer");
    if (envRowsContainer) envRowsContainer.onclick = handleEnvRowsContainerClick;

    var advDetails = document.getElementById("mcpAdvancedDetails");
    if (advDetails) advDetails.ontoggle = handleAdvancedDetailsToggle;

    var viewAllBtn = document.getElementById("mcpViewAllTemplatesBtn");
    if (viewAllBtn) viewAllBtn.onclick = handleViewAllTemplatesClick;

    var modalOverlay = document.getElementById("mcpModalOverlay");
    if (modalOverlay) modalOverlay.onclick = handleModalOverlayClick;

    document.addEventListener("keydown", handleDocumentKeyDown);

    updateSettingsUI();
  }

  function handleViewNavChatsClick() {
    switchSubView("chats");
  }

  function handleViewNavTracesClick() {
    switchSubView("traces");
  }

  function handleViewNavSubagentsClick() {
    switchSubView("subagents");
  }

  function handleViewNavSubagentTracesClick() {
    switchSubView("subagentTraces");
  }

  function switchSubView(viewName, targetSubagentId) {
    var chatsBtn = document.getElementById("viewNavChatsBtn");
    var tracesBtn = document.getElementById("viewNavTracesBtn");
    var subagentsBtn = document.getElementById("viewNavSubagentsBtn");
    var subagentTracesBtn = document.getElementById("viewNavSubagentTracesBtn");
    var chatArea = document.getElementById("chat-area-container");
    var tracesArea = document.getElementById("traces-area-container");
    var subagentsArea = document.getElementById("subagents-area-container");
    var subagentTracesArea = document.getElementById("subagent-traces-area-container");

    if (chatsBtn) chatsBtn.classList.remove("active");
    if (tracesBtn) tracesBtn.classList.remove("active");
    if (subagentsBtn) subagentsBtn.classList.remove("active");
    if (subagentTracesBtn) subagentTracesBtn.classList.remove("active");

    if (chatArea) chatArea.style.display = "none";
    if (tracesArea) tracesArea.style.display = "none";
    if (subagentsArea) subagentsArea.style.display = "none";
    if (subagentTracesArea) subagentTracesArea.style.display = "none";

    if (viewName === "traces") {
      if (tracesBtn) tracesBtn.classList.add("active");
      if (tracesArea) {
        tracesArea.style.display = "flex";
        renderTracesView(tracesArea);
        if (state.activeConversationId && state.isVsCode && window.VSCODE_API) {
          window.VSCODE_API.postMessage({ type: "getTraces", sessionId: state.activeConversationId });
        }
      }
    } else if (viewName === "subagents") {
      if (subagentsBtn) subagentsBtn.classList.add("active");
      if (subagentsArea) {
        subagentsArea.style.display = "flex";
        subagentsArea.style.flex = "1";
        subagentsArea.style.height = "100%";
        subagentsArea.style.minHeight = "0";
        renderSubagentsView(subagentsArea, targetSubagentId);
        if (state.activeConversationId && state.isVsCode && window.VSCODE_API) {
          window.VSCODE_API.postMessage({ type: "getSubagents", sessionId: state.activeConversationId });
        }
      }
    } else if (viewName === "subagentTraces") {
      if (subagentTracesBtn) subagentTracesBtn.classList.add("active");
      if (subagentTracesArea) {
        subagentTracesArea.style.display = "flex";
        subagentTracesArea.style.flex = "1";
        subagentTracesArea.style.height = "100%";
        subagentTracesArea.style.minHeight = "0";
        renderSubagentTracesView(subagentTracesArea, targetSubagentId);
        if (state.activeConversationId && state.isVsCode && window.VSCODE_API) {
          window.VSCODE_API.postMessage({ type: "getSubagentTraces", sessionId: state.activeConversationId });
        }
      }
    } else {
      if (chatsBtn) chatsBtn.classList.add("active");
      if (chatArea) chatArea.style.display = "flex";
    }
  }
  window.switchDashboardSubView = switchSubView;

  function formatStepToolsDecision(stepTools) {
    if (!stepTools || !stepTools.length) return 'Generate response';
    var decisions = [];
    for (var d = 0; d < stepTools.length; d++) {
      var tool = stepTools[d];
      var name = (tool && tool.toolName) || 'Tool';
      var cmd = (tool && tool.command) ? ' (' + tool.command + ')' : '';
      decisions.push('Call ' + name + cmd);
    }
    return decisions.join(', ');
  }

  function reconstructTracesFromConversation(conv) {
    if (!conv || !conv.messages || !Array.isArray(conv.messages) || !conv.messages.length) return [];
    var runs = [];
    var currentRun = null;
    var currentStep = null;
    var convModel = conv.model || (conv.provider ? conv.provider : 'Model');
    var convProvider = conv.provider || 'ollama';

    for (var i = 0; i < conv.messages.length; i++) {
      var msg = conv.messages[i];
      if (msg.role === 'user') {
        if (currentRun) {
          runs.push(currentRun);
        }
        var nextAssistantMsg = conv.messages[i + 1];
        var runModel = msg.model || (nextAssistantMsg && nextAssistantMsg.model) || convModel;
        var runProvider = msg.provider || (nextAssistantMsg && nextAssistantMsg.provider) || convProvider;
        currentRun = {
          id: 'run_hist_' + (runs.length + 1),
          sessionId: conv.id,
          startedAt: msg.timestamp || Date.now(),
          completedAt: 0,
          durationMs: 0,
          status: 'running',
          provider: runProvider,
          model: runModel,
          user: {
            query: msg.content || '',
            images: msg.images || [],
            context: { workspaceFolder: '' }
          },
          steps: [],
          finalResponse: { text: '', thinking: '', durationMs: 0 },
          metrics: { totalDurationMs: 0, totalTokens: { input: 0, output: 0, total: 0 }, toolsExecuted: 0, filesTouched: [] }
        };
        currentStep = null;
      } else if (currentRun) {
        if (msg.role === 'assistant') {
          if (msg.model) currentRun.model = msg.model;
          if (msg.provider) currentRun.provider = msg.provider;
          if (msg.tool_calls && msg.tool_calls.length) {
            var stepIndex = currentRun.steps.length + 1;
            var stepTools = [];
            for (var t = 0; t < msg.tool_calls.length; t++) {
              var tc = msg.tool_calls[t];
              var parsedArgs = {};
              try {
                parsedArgs = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function.arguments || {});
              } catch (_) {
                parsedArgs = tc.function.arguments || {};
              }
              stepTools.push({
                id: tc.id || ('tool_' + t),
                toolName: tc.function.name,
                command: (parsedArgs && (parsedArgs.command || parsedArgs.file_path || parsedArgs.folder_path || parsedArgs.pattern)) || '',
                input: parsedArgs,
                output: '',
                success: true,
                durationMs: 0
              });
              currentRun.metrics.toolsExecuted += 1;
            }
            currentStep = {
              stepIndex: stepIndex,
              llmCall: {
                model: currentRun.model,
                provider: currentRun.provider,
                messages: { system: 'System context', user: currentRun.user.query, toolResults: null },
                thinking: msg.thinking || '',
                decision: formatStepToolsDecision(stepTools),
                tokens: { input: 0, output: 0, total: 0 },
                durationMs: 0
              },
              toolCalls: stepTools
            };
            currentRun.steps.push(currentStep);
          } else {
            var isErrMsg = !!(msg.error || (typeof msg.content === 'string' && (msg.content.indexOf('Error from provider') !== -1 || msg.content.indexOf('Error: ') === 0 || msg.content.indexOf('Upstream request failed') !== -1 || msg.content.indexOf('Request was aborted') !== -1)));
            currentRun.completedAt = msg.timestamp || Date.now();
            currentRun.durationMs = currentRun.completedAt - currentRun.startedAt;
            if (isErrMsg) {
              currentRun.status = 'failed';
              currentRun.error = msg.error || msg.content;
              currentRun.finalResponse.text = msg.content || msg.error;
              currentRun.finalResponse.error = msg.error || msg.content;
            } else {
              currentRun.status = 'completed';
              currentRun.finalResponse.text = msg.content || '';
              currentRun.finalResponse.thinking = msg.thinking || '';
              if (msg.thinking || msg.content) {
                currentRun.steps.push({
                  stepIndex: currentRun.steps.length + 1,
                  llmCall: {
                    model: currentRun.model,
                    provider: currentRun.provider,
                    messages: { system: 'System context', user: currentRun.user.query, toolResults: null },
                    thinking: msg.thinking || '',
                    decision: 'Generate response',
                    tokens: { input: 0, output: 0, total: 0 },
                    durationMs: 0
                  },
                  toolCalls: []
                });
              }
            }
          }
        } else if (msg.role === 'tool' && currentStep) {
          for (var st = 0; st < currentStep.toolCalls.length; st++) {
            if (currentStep.toolCalls[st].id === msg.tool_call_id || !currentStep.toolCalls[st].output) {
              currentStep.toolCalls[st].output = msg.content || 'Completed';
              break;
            }
          }
        }
      }
    }

    if (currentRun) {
      runs.push(currentRun);
    }

    return runs;
  }

  function reconcileTracesWithConversation(existingTraces, conv) {
    if (!conv || !conv.messages || !Array.isArray(conv.messages) || !conv.messages.length) return existingTraces || [];
    var reconstructed = reconstructTracesFromConversation(conv);
    if (!reconstructed.length) return existingTraces || [];

    if (!existingTraces || !existingTraces.length) {
      return reconstructed;
    }

    var reconciled = [];
    var traceIdx = 0;

    for (var u = 0; u < reconstructed.length; u++) {
      var rec = reconstructed[u];
      var matchFound = null;

      for (var t = traceIdx; t < existingTraces.length; t++) {
        var et = existingTraces[t];
        var etQuery = (et.user && et.user.query) ? et.user.query.trim() : '';
        var recQuery = (rec.user && rec.user.query) ? rec.user.query.trim() : '';
        if (etQuery === recQuery) {
          matchFound = et;
          traceIdx = t + 1;
          break;
        }
      }

      if (matchFound) {
        if ((!matchFound.steps || !matchFound.steps.length) && rec.steps && rec.steps.length) {
          matchFound.steps = rec.steps;
        }
        if (!matchFound.finalResponse || !matchFound.finalResponse.text) {
          if (rec.finalResponse && rec.finalResponse.text) {
            matchFound.finalResponse = rec.finalResponse;
          }
        }
        reconciled.push(matchFound);
      } else {
        reconciled.push(rec);
      }
    }

    while (traceIdx < existingTraces.length) {
      reconciled.push(existingTraces[traceIdx]);
      traceIdx++;
    }

    return reconciled;
  }

  function renderTracesView(container) {
    if (!container) return;
    var activeId = state.activeConversationId;
    var traces = [];
    try {
      if (activeId) {
        traces = JSON.parse(localStorage.getItem("coderun_traces_" + activeId) || "[]");
      }

      if (activeId && state.conversations) {
        for (var c = 0; c < state.conversations.length; c++) {
          if (state.conversations[c].id === activeId) {
            var reconciled = reconcileTracesWithConversation(traces, state.conversations[c]);
            if (reconciled && reconciled.length) {
              traces = reconciled;
              try {
                localStorage.setItem("coderun_traces_" + activeId, JSON.stringify(traces));
              } catch (_) {
                // Intentionally ignore storage write errors
              }
            }
            break;
          }
        }
      }
    } catch (err) {
      console.warn('[DASHBOARD] Trace load/reconcile error:', err);
    }

    if (!traces.length) {
      container.innerHTML = 
        '<div class="cr-traces-empty">' +
          '<div class="cr-traces-empty-icon">🪵</div>' +
          '<div class="cr-traces-empty-title">No Traces Recorded Yet</div>' +
          '<div class="cr-traces-empty-desc">Execution traces, LLM decisions, tool calls, and results for this chat will appear here in real time.</div>' +
        '</div>';
      return;
    }

    if (state.activeTraceRunIndex === undefined || state.activeTraceRunIndex == null || state.activeTraceRunIndex >= traces.length) {
      state.activeTraceRunIndex = traces.length - 1;
    }

    var activeIndex = state.activeTraceRunIndex >= 0 ? state.activeTraceRunIndex : 0;
    var activeTrace = traces[activeIndex] || traces[0];

    // Reconcile status if trace is running but conversation ended with an error
    if (activeTrace && activeTrace.status === 'running' && activeId && state.conversations) {
      for (var ci = 0; ci < state.conversations.length; ci++) {
        if (state.conversations[ci].id === activeId) {
          var convMsgs = state.conversations[ci].messages || [];
          if (convMsgs.length > 0) {
            var lastMsg = convMsgs[convMsgs.length - 1];
            if (lastMsg.error || (typeof lastMsg.content === 'string' && (lastMsg.content.indexOf('Error from provider') !== -1 || lastMsg.content.indexOf('Error: ') === 0 || lastMsg.content.indexOf('Upstream request failed') !== -1))) {
              activeTrace.status = 'failed';
              activeTrace.error = lastMsg.error || lastMsg.content;
              activeTrace.completedAt = activeTrace.completedAt || Date.now();
              activeTrace.durationMs = activeTrace.durationMs || activeTrace.completedAt - (activeTrace.startedAt || activeTrace.completedAt);
              if (!activeTrace.finalResponse) activeTrace.finalResponse = {};
              activeTrace.finalResponse.text = lastMsg.error || lastMsg.content;
              activeTrace.finalResponse.error = lastMsg.error || lastMsg.content;
              try {
                localStorage.setItem("coderun_traces_" + activeId, JSON.stringify(traces));
              } catch (_) {}
            }
          }
          break;
        }
      }
    }

    var prevTabsEl = container.querySelector(".cr-trace-run-tabs");
    var prevScrollLeft = prevTabsEl ? prevTabsEl.scrollLeft : null;

    container.innerHTML = buildTraceHtml(activeTrace, activeIndex, traces.length);

    var newTabsEl = container.querySelector(".cr-trace-run-tabs");
    if (newTabsEl) {
      if (prevScrollLeft !== null) {
        newTabsEl.scrollLeft = prevScrollLeft;
      }
      var activeTabBtn = newTabsEl.querySelector(".cr-trace-run-tab.active");
      if (activeTabBtn && typeof activeTabBtn.scrollIntoView === "function") {
        activeTabBtn.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
      }
    }

    var tabButtons = container.querySelectorAll(".cr-trace-run-tab");
    for (var i = 0; i < tabButtons.length; i++) {
      tabButtons[i].onclick = handleTraceRunTabClick;
    }

    var copyButtons = container.querySelectorAll(".cr-trace-copy-btn");
    for (var j = 0; j < copyButtons.length; j++) {
      copyButtons[j].onclick = handleCopyTraceCardClick;
    }

    var fullCopyBtn = container.querySelector(".cr-trace-copy-full-btn");
    if (fullCopyBtn) {
      fullCopyBtn.onclick = handleCopyFullTraceClick;
    }
  }

  function handleTraceRunTabClick() {
    var idx = parseInt(this.dataset.runIndex, 10);
    if (!isNaN(idx)) {
      state.activeTraceRunIndex = idx;
      var container = document.getElementById("traces-area-container");
      if (container) renderTracesView(container);
    }
  }

  function buildSubagentTraceDropdownCardHtml(trace, isOpen, traceIndex) {
    if (!trace) return '';
    var agentId = trace.agentId || trace.id || ('subagent_' + (traceIndex + 1));
    var name = trace.name || (trace.user && trace.user.context && trace.user.context.agentName) || agentId;
    var role = formatSubagentRole(trace.role || 'coder');
    var roleLower = role.toLowerCase();
    var status = formatSubagentStatus(trace.status || 'completed');
    var statusLower = status.toLowerCase();
    var task = trace.task || (trace.user ? trace.user.query : '') || 'Autonomous Task';
    var isRunning = (status === 'RUNNING' || statusLower === 'running');
    var openAttr = isOpen ? ' open' : '';
    var focusedClass = isRunning ? ' cr-subagent-card--focused' : '';

    var idBadgeHtml = '';
    if (agentId && name !== agentId) {
      idBadgeHtml = '<span class="cr-subagent-id-badge" title="Subagent ID: ' + esc(agentId) + '">#' + esc(agentId) + '</span>';
    } else if (agentId) {
      idBadgeHtml = '<span class="cr-subagent-id-badge" title="Subagent ID: ' + esc(agentId) + '">ID: ' + esc(agentId) + '</span>';
    }

    var steps = (trace && Array.isArray(trace.steps)) ? trace.steps : [];
    var totalTokens = (trace && trace.metrics && trace.metrics.totalTokens) ? trace.metrics.totalTokens : { input: 0, output: 0, total: 0 };
    var inTokens = (totalTokens.input || totalTokens.prompt_tokens) || 0;
    var outTokens = (totalTokens.output || totalTokens.completion_tokens) || 0;
    var totalTokensCount = (totalTokens.total || (inTokens + outTokens)) || 0;
    if (!totalTokensCount && steps.length) {
      for (var si = 0; si < steps.length; si++) {
        var sLlm = steps[si].llmCall && steps[si].llmCall.tokens;
        if (sLlm && typeof sLlm === 'object') {
          inTokens += (sLlm.input || 0);
          outTokens += (sLlm.output || 0);
        }
      }
      totalTokensCount = inTokens + outTokens;
    }
    var durationSec = trace.durationMs ? (trace.durationMs / 1000).toFixed(1) : 0;

    var rawTraceJson = '';
    try { rawTraceJson = JSON.stringify(trace, null, 2); } catch (_) {}

    var timelineHtml = '';

    // 1. Assigned Goal (Trace node)
    timelineHtml += 
      '<div class="cr-trace-node">' +
        '<div class="cr-trace-node-header"><span class="cr-trace-dot">●</span> Assigned Goal</div>' +
        '<div class="cr-trace-user-box">' +
          '<p class="cr-trace-user-prompt">' + esc(task) + '</p>' +
          (trace.user && trace.user.context && trace.user.context.workspaceFolder ? '<div class="cr-trace-context-tag">📂 ' + esc(trace.user.context.workspaceFolder) + '</div>' : '') +
        '</div>' +
      '</div>';

    // 2. Steps Flow: LLM Call cards + Tool Call cards with connectors
    if (steps.length > 0) {
      for (var s = 0; s < steps.length; s++) {
        var step = steps[s];
        timelineHtml += '<div class="cr-trace-connector">▼</div>';
        timelineHtml += buildLlmCallCardHtml(step.llmCall, step.stepIndex || (s + 1));

        var toolList = step.toolCalls || step.tools || [];
        if (toolList && toolList.length > 0) {
          for (var t = 0; t < toolList.length; t++) {
            timelineHtml += '<div class="cr-trace-connector">▼</div>';
            timelineHtml += buildToolCallCardHtml(toolList[t]);
          }
        }
      }
    }

    // 3. Error or Final Response node
    if (trace.error || trace.status === 'failed') {
      var errDisplay = trace.error || (trace.finalResponse && (trace.finalResponse.error || trace.finalResponse.text)) || 'Subagent execution failed.';
      timelineHtml += '<div class="cr-trace-connector">▼</div>';
      timelineHtml += 
        '<div class="cr-trace-node cr-trace-node-error">' +
          '<div class="cr-trace-node-header"><span class="cr-trace-error-icon">❌</span> Error Response</div>' +
          '<div class="cr-trace-error-box">' +
            '<div class="cr-trace-error-banner">' +
              '<span class="cr-trace-error-symbol">⚠️</span> ' + esc(typeof errDisplay === 'string' ? errDisplay : (errDisplay.message || JSON.stringify(errDisplay))) +
            '</div>' +
          '</div>' +
        '</div>';
    } else if (trace.finalResponse && (trace.finalResponse.content || trace.finalResponse.text || trace.status === 'completed')) {
      var finalRespText = trace.finalResponse.content || trace.finalResponse.text || '(Subagent completed task successfully)';
      var finalHtml = (typeof window.renderMarkdown === 'function') 
        ? window.renderMarkdown(finalRespText) 
        : '<p class="cr-trace-final-text">' + esc(finalRespText) + '</p>';
      timelineHtml += '<div class="cr-trace-connector">▼</div>';
      timelineHtml += 
        '<div class="cr-trace-node">' +
          '<div class="cr-trace-node-header"><span class="cr-trace-bot-icon">🤖</span> Final Response</div>' +
          '<div class="cr-trace-final-box md-content cr-content-block">' +
            finalHtml +
          '</div>' +
        '</div>';
    }

    var tokenGaugeHtml = (
      '<div class="cr-subagent-tokens-row cr-subagent-token-row" style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08);">' +
        '<span class="cr-subagent-tokens-badge cr-subagent-token-item">' +
          '📊 Tokens: <strong>' + totalTokensCount.toLocaleString() + '</strong> (In: ' + inTokens.toLocaleString() + ' • Out: ' + outTokens.toLocaleString() + ')' +
          (durationSec ? ' • ⏱ ' + durationSec + 's' : '') +
        '</span>' +
        '<button type="button" class="cr-trace-copy-full-btn" data-full-copy="' + esc(rawTraceJson) + '">📋 Copy Trace</button>' +
      '</div>'
    );

    return (
      '<details class="cr-subagent-card cr-subagent-card--' + statusLower + focusedClass + '" id="subagent_trace_card_' + esc(agentId) + '" data-subagent-id="' + esc(agentId) + '"' + openAttr + '>' +
        '<summary class="cr-subagent-head cr-subagent-card-header">' +
          '<div class="cr-subagent-head-left cr-subagent-card-header-left">' +
            '<span class="cr-subagent-bot-icon">🤖</span>' +
            '<div class="cr-subagent-title-stack">' +
              '<div class="cr-subagent-title-row">' +
                '<span class="cr-subagent-status-dot cr-subagent-status-dot--' + statusLower + '"></span>' +
                '<span class="cr-subagent-name font-bold" title="' + esc(name) + (agentId ? ' (ID: ' + esc(agentId) + ')' : '') + '">' + esc(name) + '</span>' +
                idBadgeHtml +
                '<span class="cr-subagent-role-badge cr-subagent-role--' + roleLower + '">— ' + esc(role) + '</span>' +
              '</div>' +
              '<div class="cr-subagent-task" title="' + esc(task) + '">Task: "' + esc(truncateStr(task, 60)) + '"</div>' +
            '</div>' +
          '</div>' +
          '<div class="cr-subagent-head-right cr-subagent-card-header-right">' +
            '<span class="cr-subagent-status cr-subagent-status--' + statusLower + '">● ' + esc(status) + '</span>' +
            '<span class="cr-subagent-chevron"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg></span>' +
          '</div>' +
        '</summary>' +
        '<div class="cr-subagent-body cr-subagent-card-body">' +
          '<div class="cr-subagent-timeline-track cr-subagent-timeline-container cr-trace-timeline" style="padding:16px 12px;">' +
            timelineHtml +
            tokenGaugeHtml +
          '</div>' +
        '</div>' +
      '</details>'
    );
  }

  function renderSubagentTracesView(container, targetSubagentId) {
    if (!container) return;
    var activeId = state.activeConversationId;
    var traces = [];
    try {
      if (activeId) {
        traces = JSON.parse(localStorage.getItem("coderun_subagent_traces_" + activeId) || "[]");
      }
    } catch (_) {
      traces = [];
    }

    if (!traces.length && activeId) {
      var activeSubs = getSubagentsForCurrentSession(activeId);
      for (var as = 0; as < activeSubs.length; as++) {
        if (activeSubs[as] && activeSubs[as].trace) {
          traces.push(activeSubs[as].trace);
        }
      }
    }

    if (!traces.length) {
      container.innerHTML = 
        '<div class="cr-traces-empty">' +
          '<div class="cr-traces-empty-icon">🪵</div>' +
          '<div class="cr-traces-empty-title">No Subagent Traces Recorded Yet</div>' +
          '<div class="cr-traces-empty-desc">Execution traces, LLM decisions, tool calls, and results for subagents in this chat will appear here in real time.</div>' +
        '</div>';
      return;
    }

    traces.sort(function(a, b) {
      var ta = a.startedAt || 0;
      var tb = b.startedAt || 0;
      return ta - tb;
    });

    var cardsHtml = '';
    for (var o = 0; o < traces.length; o++) {
      var tr = traces[o];
      var isOpen = Boolean(targetSubagentId && (tr.agentId === targetSubagentId || tr.id === targetSubagentId));
      cardsHtml += buildSubagentTraceDropdownCardHtml(tr, isOpen, o);
    }

    var toolbarHtml = (
      '<div class="cr-subagents-toolbar">' +
        '<div class="cr-subagents-toolbar-left">' +
          '<span class="cr-subagents-title">Subagent Traces</span>' +
          '<span class="cr-subagents-count-badge">' + traces.length + '</span>' +
        '</div>' +
        '<div class="cr-subagents-toolbar-right">' +
          '<span class="cr-subagents-toolbar-desc">click on the drop to check the complete excution of subagents</span>' +
        '</div>' +
      '</div>'
    );

    container.innerHTML = (
      '<div class="cr-subagents-panel">' +
        toolbarHtml +
        '<div class="cr-subagents-list" id="crSubagentTracesList">' +
          cardsHtml +
        '</div>' +
      '</div>'
    );

    var copyButtons = container.querySelectorAll(".cr-trace-copy-full-btn");
    for (var j = 0; j < copyButtons.length; j++) {
      copyButtons[j].onclick = handleCopyFullTraceClick;
    }

    var cardCopyBtns = container.querySelectorAll(".cr-trace-copy-btn");
    for (var k = 0; k < cardCopyBtns.length; k++) {
      cardCopyBtns[k].onclick = handleCopyTraceCardClick;
    }
  }

  function truncateStr(str, maxLen) {
    if (!str) return '';
    str = String(str).replace(/[\r\n]+/g, ' ').trim();
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 3) + '...';
  }

  function formatSubagentRole(role) {
    var r = String(role || 'coder').toLowerCase();
    if (r === 'architect') return 'ARCHITECT';
    if (r === 'reviewer') return 'REVIEWER';
    if (r === 'debugger') return 'DEBUGGER';
    if (r === 'researcher') return 'RESEARCHER';
    return 'CODER';
  }

  function formatSubagentStatus(status) {
    var s = String(status || 'pending').toLowerCase();
    if (s === 'running') return 'RUNNING';
    if (s === 'pausing') return 'PAUSING';
    if (s === 'paused') return 'PAUSED';
    if (s === 'completed') return 'COMPLETED';
    if (s === 'failed') return 'FAILED';
    if (s === 'stopped' || s === 'cancelled') return 'STOPPED';
    return 'PENDING';
  }

  function getSubagentsForCurrentSession(sessionId) {
    if (!sessionId) return [];
    var list = [];
    try {
      var raw = localStorage.getItem('coderun_subagents_' + sessionId);
      if (raw) {
        list = JSON.parse(raw);
      }
    } catch (_) {
      list = [];
    }
    if (!Array.isArray(list)) list = [];

    var subTraces = [];
    try {
      var rawTraces = localStorage.getItem('coderun_subagent_traces_' + sessionId);
      if (rawTraces) {
        subTraces = JSON.parse(rawTraces);
      }
    } catch (_) {
      subTraces = [];
    }
    if (Array.isArray(subTraces)) {
      for (var t = 0; t < subTraces.length; t++) {
        var tr = subTraces[t];
        var found = false;
        for (var l = 0; l < list.length; l++) {
          if (list[l].agentId === tr.agentId || list[l].id === tr.agentId || list[l].sessionId === tr.sessionId || (tr.agentId && list[l].agentId && list[l].agentId.indexOf(tr.agentId) !== -1)) {
            found = true;
            list[l].trace = tr;
            if (!list[l].name && tr.name) {
              list[l].name = tr.name;
            }
            if (tr.status && list[l].status !== 'paused') {
              list[l].status = tr.status;
            }
            break;
          }
        }
        if (!found && tr.agentId) {
          list.push({
            agentId: tr.agentId,
            id: tr.id || tr.agentId,
            name: tr.name || tr.agentId,
            role: tr.role || 'coder',
            status: tr.status || 'completed',
            task: tr.task || (tr.user && tr.user.query) || '',
            sessionId: tr.sessionId || '',
            startedAt: tr.startedAt,
            completedAt: tr.completedAt,
            trace: tr
          });
        }
      }
    }

    return list;
  }

  function buildSubagentToolCardHtml(tc) {
    if (!tc) return '';
    var toolName = tc.toolName || tc.name || 'Tool';
    var status = tc.success === false ? 'error' : 'success';
    var statusLabel = status === 'success' ? 'Completed' : 'Failed';

    var inputStr = '';
    try {
      inputStr = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input || {}, null, 2);
    } catch (_) {
      inputStr = String(tc.input || '');
    }

    var outputStr = '';
    try {
      outputStr = typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output || '', null, 2);
    } catch (_) {
      outputStr = String(tc.output || '');
    }

    return (
      '<details class="cr-tool-card cr-tool-card--' + status + '">' +
        '<summary class="cr-tool-card-head">' +
          '<span class="cr-tool-card-icon cr-tool-card-icon--' + status + '">' + (status === 'success' ? '🔧' : '⚠️') + '</span>' +
          '<span class="cr-tool-card-title-group">' +
            '<span class="cr-tool-card-title">' + esc(toolName) + '</span>' +
            (tc.durationMs ? '<span class="cr-tool-card-subtitle">' + tc.durationMs + 'ms</span>' : '') +
          '</span>' +
          '<span class="cr-tool-card-status cr-tool-card-status--' + status + '">' + esc(statusLabel) + '</span>' +
          '<span class="cr-tool-card-chevron"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg></span>' +
        '</summary>' +
        '<div class="cr-tool-card-body" style="display:block;">' +
          (inputStr && inputStr !== '{}' ?
            '<div class="cr-tool-card-input-block">' +
              '<div class="cr-tool-card-block-label">Tool Input</div>' +
              '<pre class="cr-tool-card-args-pre"><code>' + esc(inputStr) + '</code></pre>' +
            '</div>' : '') +
          '<div class="cr-tool-card-result cr-tool-card-output-block" style="display:block;">' +
            '<div class="cr-tool-card-block-label">Tool Output</div>' +
            '<pre class="cr-tool-card-result-pre">' + esc(outputStr || '(No output recorded)') + '</pre>' +
          '</div>' +
          (tc.checkpointId ?
            '<div class="cr-tool-undo-bar" data-cp-id="' + esc(tc.checkpointId) + '" data-file-path="' + esc(tc.filePath || '') + '" style="margin-top:4px;display:flex;align-items:center;">' +
              (tc.undone || tc.restored ?
                '<span class="cr-action-done" style="font-size:11px;padding:2px 6px;color:#3fb950;display:inline-flex;align-items:center;">✓ Restored</span>' :
                '<button type="button" class="cr-action-btn cr-action-undo" data-cp-id="' + esc(tc.checkpointId) + '" data-file-path="' + esc(tc.filePath || '') + '">↩ Undo</button>') +
            '</div>' : '') +
        '</div>' +
      '</details>'
    );
  }

  function formatCodeBlock(match, lang, code) {
    var l = (lang || 'text').trim();
    var c = code.trim();
    if ((l.toLowerCase() === 'json' || !l) && (c.startsWith('{') || c.startsWith('['))) {
      try {
        c = JSON.stringify(JSON.parse(c), null, 2);
        if (!l) l = 'json';
      } catch (_) {}
    }
    return (
      '<div class="md-code-block">' +
        '<div class="md-code-header">' +
          '<span class="md-code-lang">' + esc(l) + '</span>' +
        '</div>' +
        '<pre><code class="language-' + esc(l) + '">' + esc(c) + '</code></pre>' +
      '</div>'
    );
  }

  function formatSubagentMarkdown(text) {
    if (!text) return '';
    var str = String(text);
    var trimmed = str.trim();

    var codeBlockMatch = trimmed.match(/^```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```$/);
    if (codeBlockMatch) {
      var detectedLang = codeBlockMatch[1] || 'json';
      var innerCode = codeBlockMatch[2].trim();
      try {
        var parsed = JSON.parse(innerCode);
        str = '```' + detectedLang + '\n' + JSON.stringify(parsed, null, 2) + '\n```';
      } catch (_) {
        str = '```' + detectedLang + '\n' + innerCode + '\n```';
      }
    } else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        var rawParsed = JSON.parse(trimmed);
        str = '```json\n' + JSON.stringify(rawParsed, null, 2) + '\n```';
      } catch (_) {}
    }

    if (typeof window !== 'undefined' && typeof window.renderMarkdown === 'function') {
      try {
        var res = window.renderMarkdown(str);
        if (res) return res;
      } catch (_) {}
    }
    if (typeof renderMarkdown === 'function') {
      try {
        var res2 = renderMarkdown(str);
        if (res2) return res2;
      } catch (_) {}
    }

    var cbRegex = /```([a-zA-Z0-9_-]*)[ \t]*\n?([\s\S]*?)```/g;
    if (cbRegex.test(str)) {
      return str.replace(/```([a-zA-Z0-9_-]*)[ \t]*\n?([\s\S]*?)```/g, formatCodeBlock);
    }

    return '<p>' + esc(str) + '</p>';
  }

  function buildSubagentDiffCardHtml(diff) {
    if (!diff) return '';
    var diffId = diff.id || 'diff_' + Date.now();
    var filePath = diff.file_path || 'unknown';
    var isNew = diff.is_new_file || false;
    var originalText = diff.original_content || '';
    var modifiedText = diff.new_content || '';
    var status = diff.status || 'pending';

    var origLines = originalText.split('\n');
    var modLines = modifiedText.split('\n');
    var maxLen = Math.max(origLines.length, modLines.length);
    var additions = 0;
    var deletions = 0;
    var linesHtml = '';

    for (var i = 0; i < maxLen; i++) {
      var o = origLines[i] || '';
      var m = modLines[i] || '';
      if (o === m) {
        linesHtml += '<div class="cr-diff-line cr-diff-line-context">' +
          '<span class="cr-diff-ln">' + (i + 1) + '</span>' +
          '<span class="cr-diff-ln">' + (i + 1) + '</span>' +
          '<span class="cr-diff-code">' + esc(o) + '</span>' +
        '</div>';
      } else if (!o && m) {
        additions++;
        linesHtml += '<div class="cr-diff-line cr-diff-line-add">' +
          '<span class="cr-diff-ln"></span>' +
          '<span class="cr-diff-ln">' + (i + 1) + '</span>' +
          '<span class="cr-diff-code">' + esc(m) + '</span>' +
        '</div>';
      } else if (o && !m) {
        deletions++;
        linesHtml += '<div class="cr-diff-line cr-diff-line-del">' +
          '<span class="cr-diff-ln">' + (i + 1) + '</span>' +
          '<span class="cr-diff-ln"></span>' +
          '<span class="cr-diff-code">' + esc(o) + '</span>' +
        '</div>';
      } else {
        deletions++;
        additions++;
        linesHtml += '<div class="cr-diff-line cr-diff-line-del">' +
          '<span class="cr-diff-ln">' + (i + 1) + '</span>' +
          '<span class="cr-diff-ln"></span>' +
          '<span class="cr-diff-code">' + esc(o) + '</span>' +
        '</div>' +
        '<div class="cr-diff-line cr-diff-line-add">' +
          '<span class="cr-diff-ln"></span>' +
          '<span class="cr-diff-ln">' + (i + 1) + '</span>' +
          '<span class="cr-diff-code">' + esc(m) + '</span>' +
        '</div>';
      }
    }

    var actionsHtml = '';
    if (status === 'pending') {
      actionsHtml = '<div class="cr-diff-actions">' +
        '<button type="button" class="cr-btn cr-btn-allow cr-diff-accept" data-diff-id="' + esc(diffId) + '">Accept</button>' +
        '<button type="button" class="cr-btn cr-btn-deny cr-diff-reject" data-diff-id="' + esc(diffId) + '">Reject</button>' +
        '<button type="button" class="cr-diff-full-btn" data-diff-id="' + esc(diffId) + '" title="Open in VS Code diff editor">Open Full Diff</button>' +
        '<span class="cr-diff-status" style="display:none"></span>' +
      '</div>';
    } else {
      var isApproved = (status === 'approved' || status === 'accepted' || status === 'applied');
      var isUndone = !!(diff.undone || diff.restored || status === 'restored');
      var statusText = isUndone ? '✓ RESTORED' : (isApproved ? '✓ APPROVED' : (status === 'rejected' ? '✗ REJECTED' : esc(status.toUpperCase())));
      var statusCls = isUndone ? 'allowed cr-diff-status--restored' : (isApproved ? 'allowed cr-diff-status--approved' : (status === 'rejected' ? 'denied cr-diff-status--rejected' : ('cr-diff-status--' + esc(status))));
      var undoBtnHtml = '';
      if (isUndone) {
        undoBtnHtml = '<span class="cr-action-done" style="margin-left:8px;font-size:11px;padding:2px 6px;color:#3fb950;display:inline-flex;align-items:center;">✓ Restored</span>';
      } else if (isApproved || diff.checkpointId) {
        var cpId = diff.checkpointId || '';
        undoBtnHtml = '<button type="button" class="cr-action-btn cr-action-undo" data-cp-id="' + esc(cpId) + '" data-file-path="' + esc(filePath) + '" style="margin-left:8px;font-size:11px;padding:2px 6px;">↩ Undo</button>';
      }
      actionsHtml = '<div class="cr-diff-actions" style="display:flex;align-items:center;">' +
        '<span class="cr-diff-status cr-permission-status ' + statusCls + '">' + statusText + '</span>' +
        undoBtnHtml +
      '</div>';
    }

    var fileSvg = '<svg class="cr-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';

    return '<div class="cr-diff-card" data-diff-id="' + esc(diffId) + '" data-diff-status="' + esc(status) + '" data-file-path="' + esc(filePath) + '" style="margin:8px 0;">' +
      '<div class="cr-diff-head">' +
        fileSvg +
        '<span class="cr-diff-title">' + esc(filePath) + '</span>' +
        '<span class="cr-diff-stats">' +
          '<span class="cr-diff-stat-add">+' + additions + '</span>' +
          '<span class="cr-diff-stat-del">-' + deletions + '</span>' +
        '</span>' +
      '</div>' +
      '<details class="cr-diff-details" open>' +
        '<summary class="cr-diff-summary">' + (isNew ? 'New File' : 'View Changes') + '</summary>' +
        '<div class="cr-diff-body">' + linesHtml + '</div>' +
      '</details>' +
      actionsHtml +
    '</div>';
  }

  function buildSubagentDropdownCardHtml(subagent, isOpen) {
    if (!subagent) return '';
    var agentId = subagent.agentId || subagent.id || 'subagent';
    var name = subagent.name || (subagent.identity && subagent.identity.name) || (subagent.trace && subagent.trace.name) || agentId;
    var role = formatSubagentRole(subagent.role || (subagent.identity && subagent.identity.role) || (subagent.trace && subagent.trace.role));
    var roleLower = role.toLowerCase();
    var status = formatSubagentStatus(subagent.status);
    var statusLower = status.toLowerCase();
    var task = subagent.task || (subagent.trace && subagent.trace.user && subagent.trace.user.query) || 'Autonomous Task';
    var isRunning = (status === 'RUNNING' || statusLower === 'running');
    var openAttr = isOpen ? ' open' : '';
    var focusedClass = isRunning ? ' cr-subagent-card--focused' : '';

    var idBadgeHtml = '';
    if (agentId && name !== agentId) {
      idBadgeHtml = '<span class="cr-subagent-id-badge" title="Subagent ID: ' + esc(agentId) + '">#' + esc(agentId) + '</span>';
    } else if (agentId) {
      idBadgeHtml = '<span class="cr-subagent-id-badge" title="Subagent ID: ' + esc(agentId) + '">ID: ' + esc(agentId) + '</span>';
    }

    var trace = subagent.trace || null;
    var steps = (trace && Array.isArray(trace.steps)) ? trace.steps : [];
    var totalTokens = (trace && trace.metrics && trace.metrics.totalTokens) ? trace.metrics.totalTokens : { input: 0, output: 0, total: 0 };
    var durationSec = (trace && trace.durationMs) ? (trace.durationMs / 1000).toFixed(1) : 0;

    var actionsHtml = '';
    if (status === 'RUNNING') {
      actionsHtml = (
        '<button type="button" class="cr-subagent-action-btn cr-subagent-btn cr-subagent-pause-btn" data-agent-id="' + esc(agentId) + '" title="Pause subagent">⏸ Pause</button>' +
        '<button type="button" class="cr-subagent-action-btn cr-subagent-btn cr-subagent-stop-btn cr-subagent-btn--danger" data-agent-id="' + esc(agentId) + '" title="Stop subagent">⏹ Stop</button>'
      );
    } else if (status === 'PAUSED') {
      actionsHtml = (
        '<button type="button" class="cr-subagent-action-btn cr-subagent-btn cr-subagent-resume-btn cr-subagent-btn--primary" data-agent-id="' + esc(agentId) + '" title="Resume subagent">▶ Resume</button>' +
        '<button type="button" class="cr-subagent-action-btn cr-subagent-btn cr-subagent-stop-btn cr-subagent-btn--danger" data-agent-id="' + esc(agentId) + '" title="Stop subagent">⏹ Stop</button>'
      );
    }

    // Error handling
    var err = subagent.error || (trace && (trace.error || (trace.status === 'failed' && trace.finalResponse && trace.finalResponse.text))) || (subagent.result && (subagent.result.failure && subagent.result.failure.message)) || null;
    if (!err && (status === 'FAILED' || (trace && trace.status === 'failed'))) {
      err = (trace && trace.finalResponse && trace.finalResponse.text) ? trace.finalResponse.text : 'Connection or execution error.';
    }

    var errorBannerHtml = '';
    if (err) {
      errorBannerHtml = (
        '<div class="cr-subagent-error-banner" style="background:#2d1515;border:1px solid #7f1d1d;border-radius:8px;padding:12px 14px;margin:8px 0;">' +
          '<div style="display:flex;align-items:center;gap:8px;font-weight:600;color:#f87171;margin-bottom:6px;">' +
            '<span>⚠️</span>' +
            '<span>Error Response</span>' +
          '</div>' +
          '<div style="font-size:12px;color:#fca5a5;line-height:1.4;font-family:monospace;">' + esc(typeof err === 'string' ? err : (err.message || JSON.stringify(err))) + '</div>' +
        '</div>'
      );
    }

    // Thinking and tools
    var innerItemsHtml = '';
    if (steps.length > 0) {
      for (var s = 0; s < steps.length; s++) {
        var step = steps[s];

        if (step.llmCall && step.llmCall.thinking) {
          innerItemsHtml += (
            '<details class="cr-think-block cr-subagent-think-block cr-thinking-block cr-subagent-thinking" open>' +
              '<summary class="cr-think-summary cr-thinking-header">' +
                '<span class="cr-think-icon cr-thinking-icon">🕒</span>' +
                '<span class="cr-think-label cr-thinking-label">Thought process</span>' +
                '<span class="cr-think-chevron cr-thinking-chevron"></span>' +
              '</summary>' +
              '<div class="cr-thinking-body"><pre class="cr-think-pre"><code>' + esc(step.llmCall.thinking) + '</code></pre></div>' +
            '</details>'
          );
        }

        var toolList = step.toolCalls || step.tools || [];
        if (toolList && toolList.length > 0) {
          innerItemsHtml += '<div class="cr-subagent-tools-section">';
          for (var t = 0; t < toolList.length; t++) {
            innerItemsHtml += buildSubagentToolCardHtml(toolList[t]);
          }
          innerItemsHtml += '</div>';
        }
      }
      if (err) {
        innerItemsHtml += errorBannerHtml;
      }
    } else if (err) {
      innerItemsHtml = errorBannerHtml;
    } else if (status === 'STOPPED') {
      innerItemsHtml = (
        '<div class="cr-subagent-timeline-empty" style="color:#94a3b8;padding:8px 0;">' +
          '<span style="font-size:14px;margin-right:6px;">⏹</span>' +
          '<span>Subagent execution was stopped.</span>' +
        '</div>'
      );
    } else if (status === 'FAILED') {
      innerItemsHtml = (
        '<div class="cr-subagent-timeline-empty" style="color:#f87171;padding:8px 0;">' +
          '<span style="font-size:14px;margin-right:6px;">❌</span>' +
          '<span>Subagent execution failed.</span>' +
        '</div>'
      );
    } else if (status === 'COMPLETED' || (subagent.result && subagent.result.success !== false)) {
      innerItemsHtml = (
        '<div class="cr-subagent-timeline-empty" style="color:#4ade80;padding:8px 0;">' +
          '<span style="font-size:14px;margin-right:6px;">✓</span>' +
          '<span>Subagent completed task successfully.</span>' +
        '</div>'
      );
    } else {
      innerItemsHtml = (
        '<div class="cr-subagent-timeline-empty" style="padding:8px 0;">' +
          '<span class="cr-subagent-empty-dot"></span>' +
          '<span>Initializing subagent agentLoop and workspace context...</span>' +
        '</div>'
      );
    }

    var diffList = (subagent && subagent.diffs) || (trace && trace.diffs) || [];
    if (diffList && diffList.length > 0) {
      innerItemsHtml += '<div class="cr-subagent-diffs-section">';
      innerItemsHtml += '<div class="cr-subagent-block-label" style="font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground,#888);margin:8px 0 4px;">File Changes &amp; Diffs (' + diffList.length + ')</div>';
      for (var df = 0; df < diffList.length; df++) {
        innerItemsHtml += buildSubagentDiffCardHtml(diffList[df]);
      }
      innerItemsHtml += '</div>';
    }

    // Final response
    var finalResponseHtml = '';
    var finalResponseText = (trace && trace.finalResponse && (trace.finalResponse.content || trace.finalResponse.text)) || (subagent.result && (subagent.result.content || subagent.result.summary || subagent.result.output)) || '';
    if (finalResponseText) {
      var renderedMarkdown = formatSubagentMarkdown(finalResponseText);
      finalResponseHtml = (
        '<div class="cr-subagent-task-block" style="margin-top:6px;">' +
          '<div class="cr-subagent-block-label">Subagent Final Response</div>' +
          '<div class="cr-subagent-markdown-output md-content cr-content-block">' + renderedMarkdown + '</div>' +
        '</div>'
      );
    }

    var tokenGaugeHtml = (
      '<div class="cr-subagent-tokens-row cr-subagent-token-row">' +
        '<span class="cr-subagent-tokens-badge cr-subagent-token-item">' +
          '📊 Tokens: <strong>' + (totalTokens.total || (totalTokens.input + totalTokens.output) || 0).toLocaleString() + '</strong> (In: ' + (totalTokens.input || 0).toLocaleString() + ' • Out: ' + (totalTokens.output || 0).toLocaleString() + ')' +
          (durationSec ? ' • ⏱ ' + durationSec + 's' : '') +
        '</span>' +
        '<button type="button" class="cr-subagent-view-trace-link" data-subagent-id="' + esc(agentId) + '">View Subagent Traces ↗</button>' +
      '</div>'
    );

    return (
      '<details class="cr-subagent-card cr-subagent-card--' + statusLower + focusedClass + '" id="subagent_card_' + esc(agentId) + '" data-subagent-id="' + esc(agentId) + '"' + openAttr + '>' +
        '<summary class="cr-subagent-head cr-subagent-card-header">' +
          '<div class="cr-subagent-head-left cr-subagent-card-header-left">' +
            '<span class="cr-subagent-bot-icon">🤖</span>' +
            '<div class="cr-subagent-title-stack">' +
              '<div class="cr-subagent-title-row">' +
                '<span class="cr-subagent-status-dot cr-subagent-status-dot--' + statusLower + '"></span>' +
                '<span class="cr-subagent-name font-bold" title="' + esc(name) + (agentId ? ' (ID: ' + esc(agentId) + ')' : '') + '">' + esc(name) + '</span>' +
                idBadgeHtml +
                '<span class="cr-subagent-role-badge cr-subagent-role--' + roleLower + '">— ' + esc(role) + '</span>' +
              '</div>' +
              '<div class="cr-subagent-task" title="' + esc(task) + '">Task: "' + esc(truncateStr(task, 60)) + '"</div>' +
            '</div>' +
          '</div>' +
          '<div class="cr-subagent-head-right cr-subagent-card-header-right">' +
            '<span class="cr-subagent-status cr-subagent-status--' + statusLower + '">● ' + esc(status) + '</span>' +
            actionsHtml +
            '<span class="cr-subagent-chevron"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg></span>' +
          '</div>' +
        '</summary>' +
        '<div class="cr-subagent-body cr-subagent-card-body">' +
          '<div class="cr-subagent-timeline-track cr-subagent-timeline-container">' +
            '<div class="cr-subagent-task-block">' +
              '<div class="cr-subagent-block-label">Assigned Goal</div>' +
              '<div class="cr-subagent-task-text">' + esc(task) + '</div>' +
            '</div>' +
            innerItemsHtml +
            finalResponseHtml +
            tokenGaugeHtml +
          '</div>' +
        '</div>' +
      '</details>'
    );
  }

  function buildSubagentExecutionChatHtml(subagent) {
    if (!subagent) return '';
    var agentId = subagent.agentId || subagent.id || 'subagent';
    var role = formatSubagentRole(subagent.role);
    var status = formatSubagentStatus(subagent.status);
    var task = subagent.task || 'Autonomous Task';
    var trace = subagent.trace || null;
    var steps = (trace && Array.isArray(trace.steps)) ? trace.steps : [];
    var botAvatarSrc = window.CODERUN_BOT_AVATAR || 'bot-avatar.jpg';

    var innerItemsHtml = '';
    var totalTokens = (trace && trace.metrics && trace.metrics.totalTokens) ? trace.metrics.totalTokens : { input: 0, output: 0, total: 0 };
    var finalResponseText = '';

    if (trace && trace.finalResponse && (trace.finalResponse.content || trace.finalResponse.text)) {
      finalResponseText = trace.finalResponse.content || trace.finalResponse.text;
    } else if (subagent.result && subagent.result.content) {
      finalResponseText = subagent.result.content;
    }

    var err = subagent.error || (trace && (trace.error || (trace.status === 'failed' && trace.finalResponse && trace.finalResponse.text))) || (subagent.result && subagent.result.failure && subagent.result.failure.message) || null;
    if (!err && (status === 'FAILED' || (trace && trace.status === 'failed'))) {
      err = (trace && trace.finalResponse && trace.finalResponse.text) ? trace.finalResponse.text : 'Connection or execution error.';
    }

    var errorBannerHtml = '';
    if (err) {
      errorBannerHtml = (
        '<div class="cr-subagent-error-banner" style="background:#2d1515;border:1px solid #7f1d1d;border-radius:8px;padding:12px 14px;margin:8px 0;">' +
          '<div style="display:flex;align-items:center;gap:8px;font-weight:600;color:#f87171;margin-bottom:6px;">' +
            '<span>⚠️</span>' +
            '<span>Error Response</span>' +
          '</div>' +
          '<div style="font-size:12px;color:#fca5a5;line-height:1.4;">' + esc(typeof err === 'string' ? err : (err.message || JSON.stringify(err))) + '</div>' +
        '</div>'
      );
    }

    if (steps.length > 0) {
      for (var s = 0; s < steps.length; s++) {
        var step = steps[s];

        if (step.llmCall && step.llmCall.thinking) {
          innerItemsHtml += (
            '<details class="cr-thinking-block cr-subagent-thinking" open>' +
              '<summary class="cr-thinking-header">' +
                '<span class="cr-thinking-icon">🕒</span>' +
                '<span class="cr-thinking-label">Thought process</span>' +
                '<span class="cr-think-chevron cr-thinking-chevron"></span>' +
              '</summary>' +
              '<div class="cr-thinking-body">' + esc(step.llmCall.thinking) + '</div>' +
            '</details>'
          );
        }

        var toolList = step.toolCalls || step.tools || [];
        if (toolList && toolList.length > 0) {
          for (var t = 0; t < toolList.length; t++) {
            var tc = toolList[t];
            innerItemsHtml += buildSubagentToolCardHtml(tc);
          }
        }
      }
      var diffList = (subagent && subagent.diffs) || (trace && trace.diffs) || [];
      if (diffList && diffList.length > 0) {
        innerItemsHtml += '<div class="cr-subagent-diffs-section">';
        innerItemsHtml += '<div class="cr-subagent-block-label" style="font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground,#888);margin:8px 0 4px;">File Changes &amp; Diffs (' + diffList.length + ')</div>';
        for (var df = 0; df < diffList.length; df++) {
          innerItemsHtml += buildSubagentDiffCardHtml(diffList[df]);
        }
        innerItemsHtml += '</div>';
      }
      if (err) {
        innerItemsHtml += errorBannerHtml;
      }
    } else if (err) {
      innerItemsHtml = errorBannerHtml;
    } else if (status === 'STOPPED') {
      innerItemsHtml = (
        '<div class="cr-subagent-timeline-empty" style="color:#94a3b8;">' +
          '<span style="font-size:14px;margin-right:6px;">⏹</span>' +
          '<span>Subagent execution was stopped.</span>' +
        '</div>'
      );
    } else if (status === 'FAILED') {
      innerItemsHtml = (
        '<div class="cr-subagent-timeline-empty" style="color:#f87171;">' +
          '<span style="font-size:14px;margin-right:6px;">❌</span>' +
          '<span>Subagent execution failed.</span>' +
        '</div>'
      );
    } else {
      innerItemsHtml = (
        '<div class="cr-subagent-timeline-empty">' +
          '<span class="cr-subagent-empty-dot"></span>' +
          '<span>Initializing subagent agentLoop and workspace context...</span>' +
        '</div>'
      );
    }

    var finalResponseHtml = '';
    if (finalResponseText) {
      var renderedContent = formatSubagentMarkdown(finalResponseText);
      finalResponseHtml = '<div class="cr-subagent-markdown-output md-content cr-content-block">' + renderedContent + '</div>';
    }

    var tokenGaugeHtml = '';
    if (totalTokens && (totalTokens.total > 0 || totalTokens.input > 0)) {
      tokenGaugeHtml = (
        '<div class="cr-subagent-token-row">' +
          '<span class="cr-subagent-token-item">📊 Tokens: <strong>' + (totalTokens.total || (totalTokens.input + totalTokens.output)) + '</strong></span>' +
          '<span class="cr-subagent-token-sub">(In: ' + (totalTokens.input || 0) + ' • Out: ' + (totalTokens.output || 0) + ')</span>' +
        '</div>'
      );
    }

    return (
      '<div class="cr-subagent-chat-stream">' +
        '<div class="cr-row cr-row--user">' +
          '<div class="cr-user-bubble">' + esc(task) + '</div>' +
        '</div>' +
        '<div class="cr-row cr-row--bot">' +
          '<div class="cr-bot-avatar">' +
            '<img class="cr-bot-avatar-img" src="' + botAvatarSrc + '" alt="Bot" onerror="this.outerHTML=\'<svg class=\\\'cr-icon\\\' viewBox=\\\'0 0 24 24\\\' fill=\\\'currentColor\\\'><path d=\\\'M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7H4a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2zM7 14v2a1 1 0 1 0 2 0v-2H7zm8 0v2a1 1 0 1 0 2 0v-2h-2zM5 20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1H5v1z\\\'/></svg>\'"/>' +
          '</div>' +
          '<div class="cr-bot-body">' +
            innerItemsHtml +
            finalResponseHtml +
            tokenGaugeHtml +
            '<div class="cr-subagent-card-footer" style="margin-top:14px;padding-top:10px;border-top:1px solid #1e293b;">' +
              '<button type="button" class="cr-subagent-view-trace-link" data-subagent-id="' + esc(agentId) + '">View Subagent Traces ↗</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderSubagentsView(container, targetSubagentId) {
    if (!container) return;
    var activeId = state.activeConversationId;
    var subagents = getSubagentsForCurrentSession(activeId);

    if (!subagents || subagents.length === 0) {
      var botAvatarSrc = window.CODERUN_BOT_AVATAR || 'bot-avatar.jpg';
      var botAvatarHtml = '<img class="cr-bot-avatar-img cr-subagent-empty-avatar" src="' + botAvatarSrc + '" alt="Bot" onerror="this.outerHTML=\'<svg class=\\\'cr-icon\\\' viewBox=\\\'0 0 24 24\\\' fill=\\\'currentColor\\\' style=\\\'width:36px;height:36px;color:#58a6ff;\\\'><path d=\\\'M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7H4a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2zM7 14v2a1 1 0 1 0 2 0v-2H7zm8 0v2a1 1 0 1 0 2 0v-2h-2zM5 20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1H5v1z\\\'/></svg>\'"/>';
      container.innerHTML = (
        '<div class="cr-subagents-panel">' +
          '<div class="cr-subagents-toolbar">' +
            '<div class="cr-subagents-toolbar-left">' +
              '<span class="cr-subagents-title">Subagents</span>' +
              '<span class="cr-subagents-count-badge">0</span>' +
            '</div>' +
          '</div>' +
          '<div class="cr-subagents-empty">' +
            '<div class="cr-subagents-empty-icon">' +
              '<div class="cr-subagent-empty-avatar-wrap">' +
                botAvatarHtml +
              '</div>' +
            '</div>' +
            '<div class="cr-subagents-empty-title" data-empty="No subagents created">No subagents are created in this chat</div>' +
          '</div>' +
        '</div>'
      );
      return;
    }

    subagents.sort(function(a, b) {
      var ta = a.startedAt || 0;
      var tb = b.startedAt || 0;
      return ta - tb;
    });

    var existingOpen = container.querySelector ? container.querySelector('.cr-subagent-card[open]') : null;
    var openId = targetSubagentId || (existingOpen ? (existingOpen.getAttribute('data-subagent-id') || existingOpen.getAttribute('data-agent-id')) : state.activeSubagentId);
    if (targetSubagentId) {
      state.activeSubagentId = targetSubagentId;
    }

    var cardsHtml = '';
    for (var c = 0; c < subagents.length; c++) {
      var sub = subagents[c];
      var isSubOpen = Boolean(openId && (sub.agentId === openId || sub.id === openId));
      cardsHtml += buildSubagentDropdownCardHtml(sub, isSubOpen);
    }

    var html = (
      '<div class="cr-subagents-panel">' +
        '<div class="cr-subagents-toolbar">' +
          '<div class="cr-subagents-toolbar-left">' +
            '<span class="cr-subagents-title">Subagents</span>' +
            '<span class="cr-subagents-count-badge">' + subagents.length + '</span>' +
          '</div>' +
          '<div class="cr-subagents-toolbar-right">' +
            '<span class="cr-subagents-toolbar-desc">click on the drop to check the complete excution of subagents</span>' +
          '</div>' +
        '</div>' +
        '<div class="cr-subagents-list" id="crSubagentsList">' +
          cardsHtml +
        '</div>' +
      '</div>'
    );

    container.innerHTML = html;

    var resumeBtns = container.querySelectorAll('.cr-subagent-resume-btn');
    for (var r = 0; r < resumeBtns.length; r++) {
      resumeBtns[r].onclick = handleSubagentResumeClick;
    }

    var pauseBtns = container.querySelectorAll('.cr-subagent-pause-btn');
    for (var p = 0; p < pauseBtns.length; p++) {
      pauseBtns[p].onclick = handleSubagentPauseClick;
    }

    var stopBtns = container.querySelectorAll('.cr-subagent-stop-btn');
    for (var st = 0; st < stopBtns.length; st++) {
      stopBtns[st].onclick = handleSubagentStopClick;
    }

    var traceLinks = container.querySelectorAll('.cr-subagent-view-trace-link');
    for (var t = 0; t < traceLinks.length; t++) {
      traceLinks[t].onclick = handleSubagentViewTraceClick;
    }

    var diffAcceptBtns = container.querySelectorAll('.cr-diff-accept');
    for (var da = 0; da < diffAcceptBtns.length; da++) {
      function onSubDiffAcceptClick(ev) {
        var btn = ev.currentTarget;
        var dId = btn.getAttribute('data-diff-id');
        if (dId && window.VSCODE_API) {
          window.VSCODE_API.postMessage({ type: 'acceptDiff', diffId: dId, sessionId: activeId });
        }
        if (typeof window.updateSubagentDiffStatus === 'function') {
          window.updateSubagentDiffStatus(activeId, dId, 'approved');
        }
        var c = btn.closest('.cr-diff-card');
        if (c && typeof window.setDiffCardStatus === 'function') {
          window.setDiffCardStatus(c, 'approved');
        }
        try {
          var allCards = document.querySelectorAll('.cr-diff-card[data-diff-id="' + dId + '"]');
          for (var ac = 0; ac < allCards.length; ac++) {
            if (typeof window.setDiffCardStatus === 'function') {
              window.setDiffCardStatus(allCards[ac], 'approved');
            }
          }
          if (typeof window.refreshActiveAgentControls === 'function') {
            window.refreshActiveAgentControls();
          }
        } catch (_) {}
      }
      diffAcceptBtns[da].onclick = onSubDiffAcceptClick;
    }

    var diffRejectBtns = container.querySelectorAll('.cr-diff-reject');
    for (var dr = 0; dr < diffRejectBtns.length; dr++) {
      function onSubDiffRejectClick(ev) {
        var btn = ev.currentTarget;
        var dId = btn.getAttribute('data-diff-id');
        if (dId && window.VSCODE_API) {
          window.VSCODE_API.postMessage({ type: 'rejectDiff', diffId: dId, sessionId: activeId });
        }
        if (typeof window.updateSubagentDiffStatus === 'function') {
          window.updateSubagentDiffStatus(activeId, dId, 'rejected');
        }
        var c = btn.closest('.cr-diff-card');
        if (c && typeof window.setDiffCardStatus === 'function') {
          window.setDiffCardStatus(c, 'rejected');
        }
        try {
          var allCards = document.querySelectorAll('.cr-diff-card[data-diff-id="' + dId + '"]');
          for (var ac = 0; ac < allCards.length; ac++) {
            if (typeof window.setDiffCardStatus === 'function') {
              window.setDiffCardStatus(allCards[ac], 'rejected');
            }
          }
          if (typeof window.refreshActiveAgentControls === 'function') {
            window.refreshActiveAgentControls();
          }
        } catch (_) {}
      }
      diffRejectBtns[dr].onclick = onSubDiffRejectClick;
    }

    var diffFullBtns = container.querySelectorAll('.cr-diff-full-btn');
    for (var df = 0; df < diffFullBtns.length; df++) {
      function onSubDiffFullClick(ev) {
        var btn = ev.currentTarget;
        var dId = btn.getAttribute('data-diff-id');
        if (dId && window.VSCODE_API) {
          window.VSCODE_API.postMessage({ type: 'openDiffEditor', diffId: dId, sessionId: activeId });
        }
      }
      diffFullBtns[df].onclick = onSubDiffFullClick;
    }

    var undoBtns = container.querySelectorAll('.cr-action-undo');
    for (var u = 0; u < undoBtns.length; u++) {
      function onSubUndoClick(ev) {
        var btn = ev.currentTarget;
        var cpId = btn.getAttribute('data-cp-id');
        var fPath = btn.getAttribute('data-file-path');
        btn.disabled = true;
        btn.innerHTML = '↩ Undoing...';
        if (window.VSCODE_API) {
          window.VSCODE_API.postMessage({
            type: 'undoCheckpoint',
            filePath: fPath,
            checkpointId: cpId,
            sessionId: activeId
          });
        }
      }
      undoBtns[u].onclick = onSubUndoClick;
    }
  }

  function handleSubagentDropdownSelectChange() {
    var selId = this.value;
    state.activeSubagentId = selId;
    var container = document.getElementById("subagents-area-container");
    if (container) renderSubagentsView(container, selId);
  }

  function handleSubagentResumeClick(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    var agentId = this.getAttribute('data-agent-id');
    if (agentId && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: 'resumeSubagent', agentId: agentId, sessionId: state.activeConversationId });
    }
  }

  function handleSubagentPauseClick(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    var agentId = this.getAttribute('data-agent-id');
    if (agentId && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: 'pauseSubagent', agentId: agentId, sessionId: state.activeConversationId });
    }
  }

  function handleSubagentStopClick(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    var agentId = this.getAttribute('data-agent-id');
    if (agentId && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: 'stopSubagent', agentId: agentId, sessionId: state.activeConversationId, reason: 'Stopped by user from Subagents panel' });
    }
  }

  function handleSubagentViewTraceClick(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    var agentId = this.getAttribute('data-subagent-id');
    switchSubView('subagentTraces', agentId);
  }

  function handleSubagentEvent(event) {
    if (!event) return;
    var sId = event.sessionId || event.parentSessionId || state.activeConversationId;
    if (!sId) return;
    var subagents = getSubagentsForCurrentSession(sId);
    var agentId = event.agentId || event.subagent_id || (event.data && event.data.agentId);
    if (!agentId) return;
    var effStatus = event.status || (event.result && event.result.status) || (event.data && event.data.status) || (event.type === 'subagent_completed' ? 'completed' : event.type === 'subagent_failed' ? 'failed' : 'running');

    var found = false;
    for (var i = 0; i < subagents.length; i++) {
      if (subagents[i].agentId === agentId || subagents[i].id === agentId) {
        found = true;
        if (effStatus) subagents[i].status = effStatus;
        if (event.name) subagents[i].name = event.name;
        if (event.role) subagents[i].role = event.role;
        if (event.task) subagents[i].task = event.task;
        if (event.result) subagents[i].result = event.result;
        if (event.data) {
          for (var k in event.data) {
            subagents[i][k] = event.data[k];
          }
        }
        break;
      }
    }

    if (!found) {
      subagents.push({
        agentId: agentId,
        id: event.id || agentId,
        name: event.name || (event.result && event.result.name) || agentId,
        role: event.role || (event.data && event.data.role) || 'coder',
        status: effStatus,
        task: event.task || (event.data && event.data.task) || '',
        result: event.result || null,
        startedAt: Date.now()
      });
    }

    try {
      localStorage.setItem('coderun_subagents_' + sId, JSON.stringify(subagents));
    } catch (_) {}

    var subContainer = document.getElementById('subagents-area-container');
    if (subContainer && subContainer.style.display !== 'none' && state.activeConversationId === sId) {
      renderSubagentsView(subContainer);
    }
    var subTracesContainer = document.getElementById('subagent-traces-area-container');
    if (subTracesContainer && subTracesContainer.style.display !== 'none' && state.activeConversationId === sId) {
      renderSubagentTracesView(subTracesContainer);
    }
  }

  window.renderSubagentsView = renderSubagentsView;
  window.renderSubagentTracesView = renderSubagentTracesView;
  window.handleSubagentEvent = handleSubagentEvent;

  function handleCopyTraceCardClick(e) {
    if (e) e.stopPropagation();
    var card = this.closest("[data-copy]");
    if (card) {
      var copyData = card.getAttribute("data-copy") || "";
      copyTextToClipboard(copyData, this);
    }
  }

  function handleCopyFullTraceClick(e) {
    if (e) e.stopPropagation();
    var fullData = this.getAttribute("data-full-copy") || "";
    copyTextToClipboard(fullData, this);
  }

  function copyTextToClipboard(text, btnElement) {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      } else {
        var ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      if (btnElement) {
        var originalText = btnElement.textContent;
        btnElement.textContent = "✓ Copied!";
        setTimeout(restoreCopiedButtonText, 1500, btnElement, originalText);
      }
    } catch (_) {
      // Intentionally ignore clipboard write errors
    }
  }

  function restoreCopiedButtonText(btnElement, originalText) {
    btnElement.textContent = originalText;
  }

  function buildLlmCallCardHtml(llmCall, stepIndex) {
    if (!llmCall) return '';
    var rawJson = '';
    try { rawJson = JSON.stringify(llmCall, null, 2); } catch (_) { rawJson = ''; }

    var messagesHtml = '';
    if (llmCall.messages) {
      if (llmCall.messages.system) {
        messagesHtml += '<div class="cr-trace-msg-item"><span class="cr-trace-msg-label">System:</span> <span class="cr-trace-msg-val">' + esc(llmCall.messages.system) + '</span></div>';
      }
      if (llmCall.messages.user) {
        messagesHtml += '<div class="cr-trace-msg-item"><span class="cr-trace-msg-label">User:</span> <span class="cr-trace-msg-val">' + esc(llmCall.messages.user) + '</span></div>';
      }
      if (llmCall.messages.toolResults) {
        messagesHtml += '<div class="cr-trace-msg-item"><span class="cr-trace-msg-label">Tool results:</span> <span class="cr-trace-msg-val">' + esc(llmCall.messages.toolResults) + '</span></div>';
      }
    }

    var responseHtml = '';
    if (llmCall.thinking) {
      responseHtml += '<div class="cr-trace-thought-box"><span class="cr-trace-thought-title">🧠 Thinking</span><p class="cr-trace-thought-text">' + esc(llmCall.thinking) + '</p></div>';
    }
    if (llmCall.decision) {
      responseHtml += '<div class="cr-trace-decision-box"><span class="cr-trace-decision-label">Decision:</span> ' + esc(llmCall.decision) + '</div>';
    }

    var tokensHtml = '';
    if (llmCall.tokens) {
      tokensHtml = 
        '<div class="cr-trace-tokens-grid">' +
          '<div><span class="cr-trace-token-label">Input:</span> ' + (llmCall.tokens.input ? llmCall.tokens.input.toLocaleString() : '0') + '</div>' +
          '<div><span class="cr-trace-token-label">Output:</span> ' + (llmCall.tokens.output ? llmCall.tokens.output.toLocaleString() : '0') + '</div>' +
        '</div>';
    }

    return (
      '<div class="cr-trace-llm-card" data-copy="' + esc(rawJson) + '">' +
        '<div class="cr-trace-card-topbar">' +
          '<div class="cr-trace-card-title"><span class="cr-trace-card-icon">🤖</span> LLM Call #' + stepIndex + '</div>' +
          '<button type="button" class="cr-trace-copy-btn" title="Copy LLM Call">📋</button>' +
        '</div>' +
        '<div class="cr-trace-field">' +
          '<span class="cr-trace-field-label">Model:</span> ' + esc(llmCall.model || 'Unknown') +
          (llmCall.provider ? ' <span class="cr-trace-badge provider" style="font-size:10px; margin-left:6px; padding:1px 5px;">' + esc(llmCall.provider) + '</span>' : '') +
        '</div>' +
        (messagesHtml ? '<div class="cr-trace-section"><div class="cr-trace-section-title">Messages</div>' + messagesHtml + '</div>' : '') +
        (responseHtml ? '<div class="cr-trace-section"><div class="cr-trace-section-title">Response</div>' + responseHtml + '</div>' : '') +
        (tokensHtml ? '<div class="cr-trace-section"><div class="cr-trace-section-title">Tokens</div>' + tokensHtml + '</div>' : '') +
      '</div>'
    );
  }

  function buildToolCallCardHtml(toolCall) {
    if (!toolCall) return '';
    var rawJson = '';
    try { rawJson = JSON.stringify(toolCall, null, 2); } catch (_) { rawJson = ''; }

    var inputStr = '';
    try { inputStr = JSON.stringify(toolCall.input || {}, null, 2); } catch (_) { inputStr = String(toolCall.input || ''); }

    var durationText = toolCall.durationMs ? (toolCall.durationMs >= 1000 ? (toolCall.durationMs / 1000).toFixed(1) + 's' : toolCall.durationMs + 'ms') : '';
    var successMark = toolCall.success ? '✓' : '✗';
    var statusClass = toolCall.success ? 'success' : 'failed';

    var outputStr = '';
    if (typeof toolCall.output === 'string') {
      outputStr = toolCall.output;
    } else if (toolCall.output !== null && toolCall.output !== undefined) {
      try {
        outputStr = JSON.stringify(toolCall.output, null, 2);
      } catch (_) {
        outputStr = String(toolCall.output);
      }
    }

    return (
      '<div class="cr-trace-tool-card" data-copy="' + esc(rawJson) + '">' +
        '<div class="cr-trace-card-topbar">' +
          '<div class="cr-trace-card-title"><span class="cr-trace-card-icon">🔧</span> ' + esc(toolCall.toolName || 'tool') + '</div>' +
          '<button type="button" class="cr-trace-copy-btn" title="Copy Tool Call">📋</button>' +
        '</div>' +
        (toolCall.command ? '<div class="cr-trace-field"><div class="cr-trace-field-label">Command:</div><pre class="cr-trace-command-box">' + esc(toolCall.command) + '</pre></div>' : '') +
        (inputStr && inputStr !== '{}' ? '<div class="cr-trace-field"><div class="cr-trace-field-label">Input:</div><pre class="cr-trace-input-box">' + esc(inputStr) + '</pre></div>' : '') +
        '<div class="cr-trace-field">' +
          '<div class="cr-trace-field-label">Output:</div>' +
          '<div class="cr-trace-output-box ' + statusClass + '">' +
            '<span class="cr-trace-status-mark">' + successMark + '</span> ' + esc(outputStr || 'No output') +
          '</div>' +
        '</div>' +
        (durationText ? '<div class="cr-trace-field"><span class="cr-trace-field-label">Duration:</span> ' + esc(durationText) + '</div>' : '') +
      '</div>'
    );
  }

  function buildTraceHtml(trace, activeRunIndex, totalRuns) {
    if (!trace) return '';
    var rawTraceJson = '';
    try { rawTraceJson = JSON.stringify(trace, null, 2); } catch (_) { rawTraceJson = ''; }

    var statusBadge = trace.status === 'completed' ? '<span class="cr-trace-badge completed">✓ COMPLETED</span>' :
                      trace.status === 'failed' ? '<span class="cr-trace-badge failed">✗ FAILED</span>' :
                      '<span class="cr-trace-badge running">● RUNNING</span>';

    var durationBadge = trace.durationMs ? '<span class="cr-trace-badge duration">⏱ ' + (trace.durationMs / 1000).toFixed(1) + 's</span>' : '';
    var providerBadge = trace.provider ? '<span class="cr-trace-badge provider">' + esc(trace.provider) + '</span>' : '';
    var modelBadge = trace.model ? '<span class="cr-trace-badge model">' + esc(trace.model) + '</span>' : '';
    var totalTokens = (trace.metrics && trace.metrics.totalTokens && trace.metrics.totalTokens.total) ? trace.metrics.totalTokens.total : 0;
    var tokensBadge = totalTokens ? '<span class="cr-trace-badge tokens">📊 ' + totalTokens.toLocaleString() + ' tokens</span>' : '';

    var runTabsHtml = '';
    if (totalRuns > 1) {
      runTabsHtml = '<div class="cr-trace-run-tabs">';
      for (var r = 0; r < totalRuns; r++) {
        var tabActive = (r === activeRunIndex) ? ' active' : '';
        runTabsHtml += '<button type="button" class="cr-trace-run-tab' + tabActive + '" data-run-index="' + r + '">Run #' + (r + 1) + '</button>';
      }
      runTabsHtml += '</div>';
    }

    var timelineHtml = '';

    // 1. User Input & Injected Context
    timelineHtml += 
      '<div class="cr-trace-node">' +
        '<div class="cr-trace-node-header"><span class="cr-trace-dot">●</span> User Input</div>' +
        '<div class="cr-trace-user-box">' +
          '<p class="cr-trace-user-prompt">' + esc(trace.user ? trace.user.query : '') + '</p>' +
          (trace.user && trace.user.context && trace.user.context.workspaceFolder ? '<div class="cr-trace-context-tag">📂 ' + esc(trace.user.context.workspaceFolder) + '</div>' : '') +
        '</div>' +
      '</div>';

    // 2. Steps Flow
    if (trace.steps && trace.steps.length) {
      for (var s = 0; s < trace.steps.length; s++) {
        var step = trace.steps[s];
        timelineHtml += '<div class="cr-trace-connector">▼</div>';
        timelineHtml += buildLlmCallCardHtml(step.llmCall, step.stepIndex || (s + 1));

        if (step.toolCalls && step.toolCalls.length) {
          for (var t = 0; t < step.toolCalls.length; t++) {
            timelineHtml += '<div class="cr-trace-connector">▼</div>';
            timelineHtml += buildToolCallCardHtml(step.toolCalls[t]);
          }
        }
      }
    }

    // 3. Error Card or Final Response
    if (trace.error || trace.status === 'failed') {
      var errDisplay = trace.error || (trace.finalResponse && (trace.finalResponse.error || trace.finalResponse.text)) || 'An error occurred during execution.';
      timelineHtml += '<div class="cr-trace-connector">▼</div>';
      timelineHtml += 
        '<div class="cr-trace-node cr-trace-node-error">' +
          '<div class="cr-trace-node-header"><span class="cr-trace-error-icon">❌</span> Error Response</div>' +
          '<div class="cr-trace-error-box">' +
            '<div class="cr-trace-error-banner">' +
              '<span class="cr-trace-error-symbol">⚠️</span> ' + esc(errDisplay) +
            '</div>' +
          '</div>' +
        '</div>';
    } else if (trace.finalResponse && (trace.finalResponse.text || trace.status === 'completed')) {
      var finalRespText = trace.finalResponse.text || '(Task completed)';
      var finalHtml = (typeof window.renderMarkdown === 'function') 
        ? window.renderMarkdown(finalRespText) 
        : '<p class="cr-trace-final-text">' + esc(finalRespText) + '</p>';
      timelineHtml += '<div class="cr-trace-connector">▼</div>';
      timelineHtml += 
        '<div class="cr-trace-node">' +
          '<div class="cr-trace-node-header"><span class="cr-trace-bot-icon">🤖</span> Final Response</div>' +
          '<div class="cr-trace-final-box md-content cr-content-block">' +
            finalHtml +
          '</div>' +
        '</div>';
    }

    return (
      '<div class="cr-trace-container">' +
        runTabsHtml +
        '<div class="cr-trace-run-header">' +
          '<div class="cr-trace-header-left">' +
            '<span class="cr-trace-run-title">Agent Run #' + (activeRunIndex + 1) + '</span>' +
            providerBadge +
            modelBadge +
            statusBadge +
            durationBadge +
            tokensBadge +
          '</div>' +
          '<button type="button" class="cr-trace-copy-full-btn" data-full-copy="' + esc(rawTraceJson) + '">📋 Copy Run</button>' +
        '</div>' +
        '<div class="cr-trace-flow">' +
          timelineHtml +
        '</div>' +
      '</div>'
    );
  }

  function saveTraceToLocalStorage(sessionId, trace) {
    if (!sessionId || !trace) return;
    try {
      var existing = JSON.parse(localStorage.getItem("coderun_traces_" + sessionId) || "[]");
      var foundIdx = -1;
      for (var i = 0; i < existing.length; i++) {
        if (existing[i].id === trace.id) {
          foundIdx = i;
          break;
        }
      }

      if (foundIdx >= 0) {
        existing[foundIdx] = trace;
      } else {
        existing.push(trace);
      }
      localStorage.setItem("coderun_traces_" + sessionId, JSON.stringify(existing));

      var allTraces = JSON.parse(localStorage.getItem("coderun_all_traces") || "[]");
      var gIdx = -1;
      for (var j = 0; j < allTraces.length; j++) {
        if (allTraces[j].id === trace.id) {
          gIdx = j;
          break;
        }
      }
      var summaryRecord = {
        id: trace.id,
        sessionId: trace.sessionId,
        startedAt: trace.startedAt,
        durationMs: trace.durationMs,
        status: trace.status,
        provider: trace.provider,
        model: trace.model,
        query: trace.user ? trace.user.query : ''
      };
      if (gIdx >= 0) {
        allTraces[gIdx] = summaryRecord;
      } else {
        allTraces.push(summaryRecord);
      }
      localStorage.setItem("coderun_all_traces", JSON.stringify(allTraces));
    } catch (_) {
      // Intentionally ignore storage write errors
    }
  }

  function saveSubagentTraceToLocalStorage(parentSessionId, trace) {
    if (!parentSessionId || !trace) return;
    try {
      var traces = JSON.parse(localStorage.getItem('coderun_subagent_traces_' + parentSessionId) || '[]');
      var foundIndex = -1;
      for (var i = 0; i < traces.length; i++) {
        if (traces[i].id === trace.id) {
          foundIndex = i;
          break;
        }
      }
      if (foundIndex >= 0) traces[foundIndex] = trace;
      else traces.push(trace);
      localStorage.setItem('coderun_subagent_traces_' + parentSessionId, JSON.stringify(traces));
    } catch (_) {
      // Intentionally ignore storage write errors
    }
  }

  function reconstructTracesFromConversation(conv) {
    if (!conv || !conv.messages || !conv.messages.length) return [];
    var runs = [];
    var currentRun = null;
    var currentStep = null;
    var convModel = conv.model || (conv.provider ? conv.provider : 'Model');
    var convProvider = conv.provider || 'ollama';

    for (var i = 0; i < conv.messages.length; i++) {
      var msg = conv.messages[i];
      if (msg.role === 'user') {
        if (currentRun) {
          runs.push(currentRun);
        }
        var nextAssistantMsg = conv.messages[i + 1];
        var runModel = msg.model || (nextAssistantMsg && nextAssistantMsg.model) || convModel;
        var runProvider = msg.provider || (nextAssistantMsg && nextAssistantMsg.provider) || convProvider;
        currentRun = {
          id: 'run_hist_' + (runs.length + 1),
          sessionId: conv.id,
          startedAt: msg.timestamp || Date.now(),
          completedAt: 0,
          durationMs: 0,
          status: 'running',
          provider: runProvider,
          model: runModel,
          user: {
            query: msg.content || '',
            images: msg.images || [],
            context: { workspaceFolder: state.workspaceFolder || '' }
          },
          steps: [],
          finalResponse: { text: '', thinking: '', durationMs: 0 },
          metrics: { totalDurationMs: 0, totalTokens: { input: 0, output: 0, total: 0 }, toolsExecuted: 0, filesTouched: [] }
        };
        currentStep = null;
      } else if (currentRun) {
        if (msg.role === 'assistant') {
          if (msg.model) currentRun.model = msg.model;
          if (msg.provider) currentRun.provider = msg.provider;
          if (msg.tool_calls && msg.tool_calls.length) {
            var stepIndex = currentRun.steps.length + 1;
            var stepTools = [];
            for (var t = 0; t < msg.tool_calls.length; t++) {
              var tc = msg.tool_calls[t];
              var parsedArgs = {};
              try {
                parsedArgs = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
              } catch (_) {
                parsedArgs = tc.function.arguments || {};
              }
              stepTools.push({
                id: tc.id || 'tool_' + t,
                toolName: tc.function.name,
                command: (parsedArgs && (parsedArgs.command || parsedArgs.file_path || parsedArgs.folder_path || parsedArgs.pattern)) || '',
                input: parsedArgs,
                output: '',
                success: true,
                durationMs: 0
              });
              currentRun.metrics.toolsExecuted += 1;
            }
            currentStep = {
              stepIndex: stepIndex,
              llmCall: {
                model: currentRun.model,
                provider: currentRun.provider,
                messages: { system: 'System context', user: currentRun.user.query, toolResults: null },
                thinking: msg.thinking || '',
                decision: stepTools.map(formatTraceToolDecision).join(', '),
                tokens: { input: 0, output: 0, total: 0 },
                durationMs: 0
              },
              toolCalls: stepTools
            };
            currentRun.steps.push(currentStep);
          } else {
            var isErrMsg = !!(msg.error || (typeof msg.content === 'string' && (msg.content.indexOf('Error from provider') !== -1 || msg.content.indexOf('Error: ') === 0 || msg.content.indexOf('Upstream request failed') !== -1)));
            currentRun.completedAt = msg.timestamp || Date.now();
            currentRun.durationMs = currentRun.completedAt - currentRun.startedAt;
            if (isErrMsg) {
              currentRun.status = 'failed';
              currentRun.error = msg.error || msg.content;
              currentRun.finalResponse.text = msg.content || msg.error;
              currentRun.finalResponse.error = msg.error || msg.content;
            } else {
              currentRun.status = 'completed';
              currentRun.finalResponse.text = msg.content || '';
              currentRun.finalResponse.thinking = msg.thinking || '';
              if (msg.thinking || msg.content) {
                currentRun.steps.push({
                  stepIndex: currentRun.steps.length + 1,
                  llmCall: {
                    model: currentRun.model,
                    provider: currentRun.provider,
                    messages: { system: 'System context', user: currentRun.user.query, toolResults: null },
                    thinking: msg.thinking || '',
                    decision: 'Generate response',
                    tokens: { input: 0, output: 0, total: 0 },
                    durationMs: 0
                  },
                  toolCalls: []
                });
              }
            }
          }
        } else if (msg.role === 'tool' && currentStep) {
          for (var st = 0; st < currentStep.toolCalls.length; st++) {
            if (currentStep.toolCalls[st].id === msg.tool_call_id || !currentStep.toolCalls[st].output) {
              currentStep.toolCalls[st].output = msg.content || 'Completed';
              break;
            }
          }
        }
      }
    }

    if (currentRun) {
      runs.push(currentRun);
    }

    return runs;
  }

  function handleRailChatClick() {
    switchPanel("panel-chat", this);
  }

  function handleRailSettingsClick() {
    switchPanel("panel-settings", this);
  }

  function handleRailRulesClick() {
    switchPanel("panel-rules", this);
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: "loadRules" });
    }
  }

  function handleRailMcpClick() {
    switchPanel("panel-mcp", this);
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: "loadMcpServers" });
    }
  }

  function handleRailSubagentsClick() {
    switchPanel("panel-subagents", this);
    renderSubagentSettings();
  }

  function renderSubagentSettings() {
    var provSelect = document.getElementById("subagentCfgProvider");
    var modelInput = document.getElementById("subagentModelInput");
    var maxConcurrentEl = document.getElementById("subagentCfgMaxConcurrent");
    var maxIterEl = document.getElementById("subagentCfgMaxIterations");
    var maxDepthEl = document.getElementById("subagentCfgMaxDepth");

    if (!provSelect) return;

    // Build provider options strictly from savedProviderConfigs (no unconfigured general providers)
    var configs = state.savedProviderConfigs || {};
    var keys = Object.keys(configs);
    var html = '<option value="">(Inherit from Main Agent)</option>';

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var cfg = configs[key] || {};
      var label = key;
      if (key.startsWith('compatible:')) {
        var name = key.substring(11);
        var type = cfg.apiType || 'openai';
        var typeLabel = type === 'anthropic' ? 'Anthropic' : (type === 'gemini' ? 'Gemini' : 'Compatible');
        label = name + ' (' + typeLabel + ')';
      } else {
        label = key.charAt(0).toUpperCase() + key.slice(1);
      }
      html += '<option value="' + esc(key) + '">' + esc(label) + '</option>';
    }
    provSelect.innerHTML = html;

    // Set current values from state
    var currentSubProv = (state.settings && state.settings.subagentProvider) || '';
    if (currentSubProv && !configs[currentSubProv]) {
      currentSubProv = '';
      if (state.settings) state.settings.subagentProvider = '';
    }
    provSelect.value = currentSubProv;

    // If subagentProvider is (Inherit from Main Agent), subagentModel must also be (Inherit from Main Agent)
    var currentSubModel = (state.settings && state.settings.subagentModel) || '';
    if (!currentSubProv) {
      currentSubModel = '';
      if (state.settings) state.settings.subagentModel = '';
    }

    if (modelInput) {
      modelInput.value = currentSubModel || '(Inherit from Main Agent)';
    }

    if (maxConcurrentEl) maxConcurrentEl.value = (state.settings && state.settings.subagentMaxConcurrent) || 10;
    if (maxIterEl) maxIterEl.value = (state.settings && state.settings.subagentMaxIterations) || 20;
    if (maxDepthEl) maxDepthEl.value = (state.settings && state.settings.subagentMaxDepth !== undefined) ? state.settings.subagentMaxDepth : 1;

    // Update active banner and render model combobox list
    updateSubagentActiveBanner();
    renderSubagentModelOptions();
  }

  function updateSubagentActiveBanner() {
    var provDisplay = document.getElementById("subagentActiveProviderDisplay");
    var modelDisplay = document.getElementById("subagentActiveModelDisplay");
    if (!provDisplay || !modelDisplay) return;

    var subProv = (state.settings && state.settings.subagentProvider) || '';
    var subModel = (state.settings && state.settings.subagentModel) || '';

    if (subProv) {
      var label = subProv;
      if (subProv.startsWith('compatible:')) {
        label = subProv.substring(11);
      } else {
        label = subProv.charAt(0).toUpperCase() + subProv.slice(1);
      }
      provDisplay.textContent = label;
      provDisplay.classList.add('cr-subagent-badge-active');
    } else {
      provDisplay.textContent = '(Inherited)';
      provDisplay.classList.remove('cr-subagent-badge-active');
    }

    if (subModel && subProv) {
      modelDisplay.textContent = subModel;
      modelDisplay.classList.add('cr-subagent-badge-active');
    } else {
      modelDisplay.textContent = '(Inherited)';
      modelDisplay.classList.remove('cr-subagent-badge-active');
    }
  }

  function handleSubagentProviderChange() {
    var provSelect = document.getElementById("subagentCfgProvider");
    var modelInput = document.getElementById("subagentModelInput");
    if (!provSelect) return;

    var selectedProv = provSelect.value;
    if (!state.settings) state.settings = {};
    state.settings.subagentProvider = selectedProv;

    if (!selectedProv) {
      // (Inherit from Main Agent) -> automatically inherit model too
      state.settings.subagentModel = '';
      if (modelInput) {
        modelInput.value = '(Inherit from Main Agent)';
      }
    } else {
      // Saved provider selected -> prefill with saved provider's model if available, or first available model
      var configs = state.savedProviderConfigs || {};
      var savedCfg = configs[selectedProv] || {};
      var provModels = (state.modelsByProvider && state.modelsByProvider[selectedProv]) || [];
      var newModel = savedCfg.model || (provModels.length ? provModels[0] : '');
      state.settings.subagentModel = newModel;
      if (modelInput) {
        modelInput.value = newModel || '(Inherit from Main Agent)';
      }
    }

    updateSubagentActiveBanner();
    renderSubagentModelOptions();
  }

  function handleSubagentModelInputClick(e) {
    if (e) e.stopPropagation();
    var list = document.getElementById("subagentModelDropdownList");
    if (list) {
      var isHidden = list.style.display === "none";
      list.style.display = isHidden ? "block" : "none";
      if (isHidden) {
        var filterInput = document.getElementById("subagentModelFilterInput");
        if (filterInput) {
          setTimeout(focusSubagentModelFilterInput, 40, filterInput);
        }
      }
    }
  }

  function focusSubagentModelFilterInput(filterInput) {
    if (filterInput) filterInput.focus();
  }

  function handleSubagentModelFilterInput(e) {
    if (e) e.stopPropagation();
    state.subagentModelSearchFilter = (e.target.value || "").trim().toLowerCase();
    renderSubagentModelOptions();
    var dropdown = document.getElementById("subagentModelDropdownList");
    if (dropdown) dropdown.style.display = "block";
    var input = document.getElementById("subagentModelFilterInput");
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function handleSubagentModelItemClick() {
    var model = this.dataset.model || "";
    var provider = this.dataset.provider || "";

    if (!state.settings) state.settings = {};
    state.settings.subagentModel = model;

    if (model && provider) {
      var provSelect = document.getElementById("subagentCfgProvider");
      if (provSelect && provSelect.value !== provider) {
        provSelect.value = provider;
        state.settings.subagentProvider = provider;
      }
    } else if (!model) {
      // (Inherit from Main Agent)
      state.settings.subagentModel = "";
      var provSelect2 = document.getElementById("subagentCfgProvider");
      if (provSelect2) {
        provSelect2.value = "";
        state.settings.subagentProvider = "";
      }
    }

    var modelInput = document.getElementById("subagentModelInput");
    if (modelInput) {
      modelInput.value = model || "(Inherit from Main Agent)";
    }

    var list = document.getElementById("subagentModelDropdownList");
    if (list) list.style.display = "none";

    updateSubagentActiveBanner();
    renderSubagentModelOptions();
  }

  function handleSubagentGroupHeaderClick() {
    var items = this.nextElementSibling;
    if (items) {
      var isHidden = items.style.display === "none";
      items.style.display = isHidden ? "block" : "none";
      var arrow = this.querySelector(".cr-group-arrow");
      if (arrow) arrow.textContent = isHidden ? "▼" : "▶";
    }
  }

  function renderSubagentModelOptions() {
    var list = document.getElementById("subagentModelDropdownList");
    if (!list) return;
    list.innerHTML = "";

    // Sticky search filter input
    var searchBox = document.createElement("div");
    searchBox.className = "cr-model-search-box";
    var searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.id = "subagentModelFilterInput";
    searchInput.className = "cr-model-search-input";
    searchInput.placeholder = "🔍 Search models...";
    searchInput.value = state.subagentModelSearchFilter || "";
    searchInput.oninput = handleSubagentModelFilterInput;
    searchInput.onclick = handleSearchInputClick;
    searchBox.appendChild(searchInput);
    list.appendChild(searchBox);

    var filterQuery = (state.subagentModelSearchFilter || "").toLowerCase();
    var currentSubModel = (state.settings && state.settings.subagentModel) || "";
    var currentSubProv = (state.settings && state.settings.subagentProvider) || "";

    // 1. Top option: (Inherit from Main Agent)
    if (!filterQuery || "inherit from main agent".indexOf(filterQuery) !== -1) {
      var inheritItem = document.createElement("div");
      var isInheritSelected = !currentSubModel || !currentSubProv;
      inheritItem.className = "cr-combobox-item" + (isInheritSelected ? " active" : "");
      inheritItem.dataset.model = "";
      inheritItem.dataset.provider = "";
      inheritItem.onclick = handleSubagentModelItemClick;

      if (isInheritSelected) {
        var checkSpan = document.createElement("span");
        checkSpan.className = "cr-model-check";
        checkSpan.textContent = "✓";
        inheritItem.appendChild(checkSpan);
      } else {
        var spacerSpan = document.createElement("span");
        spacerSpan.className = "cr-model-check-spacer";
        inheritItem.appendChild(spacerSpan);
      }

      var nameSpan = document.createElement("span");
      nameSpan.className = "cr-model-name";
      nameSpan.style.fontStyle = "italic";
      nameSpan.textContent = "(Inherit from Main Agent)";
      inheritItem.appendChild(nameSpan);
      list.appendChild(inheritItem);
    }

    // Determine which providers to show
    var providers = [];
    if (currentSubProv) {
      providers.push(currentSubProv);
    } else {
      var savedConfigs = state.savedProviderConfigs || {};
      var savedKeys = Object.keys(savedConfigs);
      var modelProviders = Object.keys(state.modelsByProvider || {});
      var provSet = {};
      for (var ski = 0; ski < savedKeys.length; ski++) provSet[savedKeys[ski]] = true;
      for (var mpi = 0; mpi < modelProviders.length; mpi++) {
        if (savedConfigs[modelProviders[mpi]] || modelProviders[mpi] === state.provider) {
          provSet[modelProviders[mpi]] = true;
        }
      }
      providers = Object.keys(provSet);
    }

    for (var p = 0; p < providers.length; p++) {
      var providerName = providers[p];
      var models = (state.modelsByProvider && state.modelsByProvider[providerName]) || [];
      var provError = (state.providerErrors && state.providerErrors[providerName]) || "";

      if (!models.length && !provError) continue;

      var filtered = [];
      for (var m = 0; m < models.length; m++) {
        if (!filterQuery || models[m].toLowerCase().indexOf(filterQuery) !== -1) {
          filtered.push(models[m]);
        }
      }
      if (!filtered.length && !provError) continue;

      var groupContainer = document.createElement("div");
      groupContainer.className = "cr-combobox-group";

      var header = document.createElement("div");
      header.className = "cr-combobox-group-header" + (provError && !models.length ? " has-error" : "");
      header.dataset.provider = providerName;
      var badgeText = (provError && !models.length) ? ' <span class="cr-group-error-badge">⚠️ Error</span>' : ' <span class="cr-group-count">(' + filtered.length + ')</span>';
      header.innerHTML = '<span class="cr-group-arrow">▼</span> ' + getProviderLabel(providerName) + badgeText;
      header.onclick = handleSubagentGroupHeaderClick;
      groupContainer.appendChild(header);

      var itemsContainer = document.createElement("div");
      itemsContainer.className = "cr-combobox-group-items";

      for (var f = 0; f < filtered.length; f++) {
        var modName = filtered[f];
        var item = document.createElement("div");
        var isSelected = currentSubModel === modName && (currentSubProv === providerName || !currentSubProv);

        item.className = "cr-combobox-item" + (isSelected ? " active" : "");
        item.dataset.model = modName;
        item.dataset.provider = providerName;
        item.onclick = handleSubagentModelItemClick;

        if (isSelected) {
          var chk = document.createElement("span");
          chk.className = "cr-model-check";
          chk.textContent = "✓";
          item.appendChild(chk);
        } else {
          var spc = document.createElement("span");
          spc.className = "cr-model-check-spacer";
          item.appendChild(spc);
        }

        var nm = document.createElement("span");
        nm.className = "cr-model-name";
        nm.textContent = modName;
        nm.title = modName;
        item.appendChild(nm);

        itemsContainer.appendChild(item);
      }

      groupContainer.appendChild(itemsContainer);
      list.appendChild(groupContainer);
    }
  }

  function handleSaveSubagentSettingsClick() {
    var provSelect = document.getElementById("subagentCfgProvider");
    var maxConcurrentEl = document.getElementById("subagentCfgMaxConcurrent");
    var maxIterEl = document.getElementById("subagentCfgMaxIterations");
    var maxDepthEl = document.getElementById("subagentCfgMaxDepth");

    var newSubProv = provSelect ? provSelect.value : '';
    var newSubModel = (state.settings && state.settings.subagentModel) || '';
    if (!newSubProv) {
      newSubModel = '';
    }
    var newMaxConcurrent = maxConcurrentEl ? (parseInt(maxConcurrentEl.value) || 10) : 10;
    var newMaxIter = maxIterEl ? (parseInt(maxIterEl.value) || 20) : 20;
    var newMaxDepth = maxDepthEl ? (parseInt(maxDepthEl.value) || 1) : 1;

    // Clamp values to valid ranges
    if (newMaxConcurrent < 1) newMaxConcurrent = 1;
    if (newMaxConcurrent > 50) newMaxConcurrent = 50;
    if (newMaxIter < 1) newMaxIter = 1;
    if (newMaxIter > 100) newMaxIter = 100;
    if (newMaxDepth < 0) newMaxDepth = 0;
    if (newMaxDepth > 3) newMaxDepth = 3;

    // Update state
    if (!state.settings) state.settings = {};
    state.settings.subagentProvider = newSubProv;
    state.settings.subagentModel = newSubModel;
    state.settings.subagentMaxConcurrent = newMaxConcurrent;
    state.settings.subagentMaxIterations = newMaxIter;
    state.settings.subagentMaxDepth = newMaxDepth;

    // Update banner immediately
    updateSubagentActiveBanner();

    // Send to VS Code backend
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({
        type: "saveSettings",
        settings: {
          subagentProvider: newSubProv,
          subagentModel: newSubModel,
          subagentMaxConcurrent: newMaxConcurrent,
          subagentMaxIterations: newMaxIter,
          subagentMaxDepth: newMaxDepth
        }
      });
    }

    // Visual feedback on save button
    var button = document.getElementById("saveSubagentSettingsBtn");
    if (button) {
      button.textContent = "Saved";
      setTimeout(resetSubagentSaveButton, 1200);
    }
  }

  function resetSubagentSaveButton() {
    var button = document.getElementById("saveSubagentSettingsBtn");
    if (button) {
      button.textContent = "Save Subagent Settings";
    }
  }

  function handleGlobalToolsToggleChange() {
    var isEnabled = this.checked;
    if (!state.settings) state.settings = {};
    state.settings.enableTools = isEnabled;
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({
        type: "saveSettings",
        settings: { enableTools: isEnabled }
      });
    }
  }

  function handleTemplateCardClick() {
    var tName = this.getAttribute("data-template");
    selectMcpTemplate(tName);
  }

  function handleTransportCardStdioClick() {
    setMcpTransportType("stdio");
  }

  function handleTransportCardSseClick() {
    setMcpTransportType("sse");
  }

  function handleAddEnvVarClick() {
    addEnvVarRow("", "");
  }

  function handleEnvRowsContainerClick(e) {
    var target = e.target;
    var btn = target ? target.closest(".cr-mcp-env-del-btn") : null;
    if (btn) {
      var row = btn.closest(".cr-mcp-env-row");
      if (row && row.parentNode) {
        row.parentNode.removeChild(row);
      }
    }
  }

  function handleAdvancedDetailsToggle() {
    var toggleText = document.getElementById("mcpAdvToggleText");
    if (toggleText) {
      toggleText.textContent = this.open ? "Hide" : "Show";
    }
  }

  function handleViewAllTemplatesClick() {
    selectMcpTemplate("custom");
  }

  function handleModalOverlayClick(e) {
    if (e.target === this) {
      closeAddMcpModal();
    }
  }

  function clearEnvVarRows() {
    var container = document.getElementById("mcpEnvRowsContainer");
    if (container) container.innerHTML = "";
  }

  function addEnvVarRow(key, val) {
    var container = document.getElementById("mcpEnvRowsContainer");
    if (!container) return;
    var row = document.createElement("div");
    row.className = "cr-mcp-env-row";
    row.innerHTML =
      '<input type="text" class="cr-mcp-form-input cr-mcp-env-key" placeholder="KEY" value="' + esc(key || "") + '">' +
      '<input type="text" class="cr-mcp-form-input cr-mcp-env-val" placeholder="Value" value="' + esc(val || "") + '">' +
      '<button type="button" class="cr-mcp-env-del-btn" title="Delete variable">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<polyline points="3 6 5 6 21 6"></polyline>' +
          '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>' +
        '</svg>' +
      '</button>';
    container.appendChild(row);
  }

  function getEnvVarsFromRows() {
    var container = document.getElementById("mcpEnvRowsContainer");
    if (!container) return {};
    var rows = container.querySelectorAll(".cr-mcp-env-row");
    var envObj = {};
    for (var i = 0; i < rows.length; i++) {
      var keyInput = rows[i].querySelector(".cr-mcp-env-key");
      var valInput = rows[i].querySelector(".cr-mcp-env-val");
      var k = keyInput ? keyInput.value.trim() : "";
      var v = valInput ? valInput.value : "";
      if (k) {
        envObj[k] = v;
      }
    }
    return envObj;
  }

  function setMcpTransportType(type) {
    var cardStdio = document.getElementById("mcpTransportCardStdio");
    var cardSse = document.getElementById("mcpTransportCardSse");
    var radioStdio = document.getElementById("mcpRadioStdio");
    var radioSse = document.getElementById("mcpRadioSse");
    var stdioFields = document.getElementById("mcpStdioFields");
    var sseFields = document.getElementById("mcpSseFields");

    var isStdio = (type !== "sse");
    if (cardStdio) {
      if (isStdio) cardStdio.classList.add("active");
      else cardStdio.classList.remove("active");
    }
    if (cardSse) {
      if (!isStdio) cardSse.classList.add("active");
      else cardSse.classList.remove("active");
    }
    if (radioStdio) radioStdio.checked = isStdio;
    if (radioSse) radioSse.checked = !isStdio;

    if (stdioFields) stdioFields.style.display = isStdio ? "block" : "none";
    if (sseFields) sseFields.style.display = isStdio ? "none" : "block";
  }

  function isPythonCommandStr(cmd) {
    if (!cmd || typeof cmd !== "string") return false;
    var lower = cmd.toLowerCase().trim();
    return (
      lower === "python" ||
      lower === "python3" ||
      lower === "py" ||
      lower === "uvx" ||
      lower.endsWith(".py") ||
      lower.includes("python.exe") ||
      lower.includes("python3.exe")
    );
  }

  function setMcpRuntime(rName) {
    currentMcpRuntime = (rName === "python") ? "python" : "node";
    var nodeBtn = document.getElementById("mcpRuntimeNodeBtn");
    var pyBtn = document.getElementById("mcpRuntimePythonBtn");
    if (nodeBtn) {
      if (currentMcpRuntime === "node") nodeBtn.classList.add("active");
      else nodeBtn.classList.remove("active");
    }
    if (pyBtn) {
      if (currentMcpRuntime === "python") pyBtn.classList.add("active");
      else pyBtn.classList.remove("active");
    }
    applyMcpTemplateFields(currentMcpTemplate, currentMcpRuntime);
  }

  function handleRuntimeNodeClick() {
    setMcpRuntime("node");
  }

  function handleRuntimePythonClick() {
    setMcpRuntime("python");
  }

  function applyMcpTemplateFields(tName, runtime) {
    var isPy = (runtime === "python");
    var nameInput = document.getElementById("mcpServerName");
    var cmdInput = document.getElementById("mcpCommand");
    var argsInput = document.getElementById("mcpArgs");
    var urlInput = document.getElementById("mcpUrl");
    var headersInput = document.getElementById("mcpHeaders");

    setMcpTransportType("stdio");
    clearEnvVarRows();

    if (tName === "github") {
      if (nameInput) nameInput.value = "github";
      if (cmdInput) cmdInput.value = isPy ? "uvx" : "npx";
      if (argsInput) argsInput.value = isPy ? "mcp-server-github" : "-y @modelcontextprotocol/server-github";
      addEnvVarRow("GITHUB_PERSONAL_ACCESS_TOKEN", "your_token_here");
    } else if (tName === "web-fetch") {
      if (nameInput) nameInput.value = "web-fetch";
      if (cmdInput) cmdInput.value = isPy ? "uvx" : "npx";
      if (argsInput) argsInput.value = isPy ? "mcp-server-fetch" : "-y @infoinlet/mcp-fetch";
    } else if (tName === "memory") {
      if (nameInput) nameInput.value = "memory";
      if (cmdInput) cmdInput.value = isPy ? "uvx" : "npx";
      if (argsInput) argsInput.value = isPy ? "mcp-server-memory" : "-y @modelcontextprotocol/server-memory";
    } else if (tName === "postgres") {
      if (nameInput) nameInput.value = "postgres";
      if (cmdInput) cmdInput.value = isPy ? "python" : "npx";
      if (argsInput) argsInput.value = isPy ? "-u -m mcp_server_postgres postgresql://localhost/mydb" : "-y @modelcontextprotocol/server-postgres postgresql://localhost/mydb";
    } else if (tName === "mysql") {
      if (nameInput) nameInput.value = "mysql";
      if (cmdInput) cmdInput.value = isPy ? "python" : "npx";
      if (argsInput) argsInput.value = isPy ? "-u -m mcp_server_mysql mysql://root:password@localhost:3306/mydb" : "-y @modelcontextprotocol/server-mysql mysql://root:password@localhost:3306/mydb";
    } else {
      if (nameInput) nameInput.value = "";
      if (cmdInput) cmdInput.value = isPy ? "python" : "npx";
      if (argsInput) argsInput.value = isPy ? "-u server.py" : "";
      if (urlInput) urlInput.value = "";
      if (headersInput) headersInput.value = "";
      addEnvVarRow("", "");
    }
  }

  function selectMcpTemplate(tName) {
    currentMcpTemplate = tName || "custom";
    var cards = document.querySelectorAll(".cr-mcp-template-card");
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute("data-template") === currentMcpTemplate) {
        cards[i].classList.add("active");
      } else {
        cards[i].classList.remove("active");
      }
    }

    applyMcpTemplateFields(currentMcpTemplate, currentMcpRuntime);
  }

  function handleMcpTransportChange() {
    var radioStdio = document.getElementById("mcpRadioStdio");
    setMcpTransportType(radioStdio && radioStdio.checked ? "stdio" : "sse");
  }

  function openAddMcpModal() {
    var overlay = document.getElementById("mcpModalOverlay");
    var errEl = document.getElementById("mcpModalError");
    if (errEl) {
      errEl.textContent = "";
      errEl.style.display = "none";
    }
    var permInput = document.getElementById("mcpAlwaysAsk");
    if (permInput) permInput.checked = true;

    var advDetails = document.getElementById("mcpAdvancedDetails");
    if (advDetails) advDetails.open = false;
    var toggleText = document.getElementById("mcpAdvToggleText");
    if (toggleText) toggleText.textContent = "Show";

    currentMcpRuntime = "node";
    var nodeBtn = document.getElementById("mcpRuntimeNodeBtn");
    var pyBtn = document.getElementById("mcpRuntimePythonBtn");
    if (nodeBtn) nodeBtn.classList.add("active");
    if (pyBtn) pyBtn.classList.remove("active");

    selectMcpTemplate("github");

    if (overlay) overlay.style.display = "flex";
  }

  function openEditMcpModal(server) {
    if (!server) return;
    var overlay = document.getElementById("mcpModalOverlay");
    var errEl = document.getElementById("mcpModalError");
    if (errEl) {
      errEl.textContent = "";
      errEl.style.display = "none";
    }

    var nameInput = document.getElementById("mcpServerName");
    var cmdInput = document.getElementById("mcpCommand");
    var argsInput = document.getElementById("mcpArgs");
    var urlInput = document.getElementById("mcpUrl");
    var permInput = document.getElementById("mcpAlwaysAsk");
    var cwdInput = document.getElementById("mcpCwd");
    var timeoutInput = document.getElementById("mcpTimeout");

    if (nameInput) nameInput.value = server.name || server.id || "";
    if (cmdInput) cmdInput.value = server.command || "";
    if (argsInput) argsInput.value = Array.isArray(server.args) ? server.args.join(" ") : (server.args || "");
    if (urlInput) urlInput.value = server.url || "";
    if (permInput) permInput.checked = !server.alwaysAllow;
    if (cwdInput) cwdInput.value = server.cwd || "";
    if (timeoutInput) timeoutInput.value = server.timeout || 15;

    var isPy = isPythonCommandStr(server.command || "");
    currentMcpRuntime = isPy ? "python" : "node";
    var nodeBtn = document.getElementById("mcpRuntimeNodeBtn");
    var pyBtn = document.getElementById("mcpRuntimePythonBtn");
    if (nodeBtn) {
      if (isPy) nodeBtn.classList.remove("active");
      else nodeBtn.classList.add("active");
    }
    if (pyBtn) {
      if (isPy) pyBtn.classList.add("active");
      else pyBtn.classList.remove("active");
    }

    setMcpTransportType(server.transport === "sse" ? "sse" : "stdio");
    clearEnvVarRows();

    var envObj = server.env || {};
    var envKeys = Object.keys(envObj);
    if (envKeys.length > 0) {
      for (var k = 0; k < envKeys.length; k++) {
        addEnvVarRow(envKeys[k], envObj[envKeys[k]]);
      }
    } else {
      addEnvVarRow("", "");
    }

    var cards = document.querySelectorAll(".cr-mcp-template-card");
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.remove("active");
    }

    if (overlay) overlay.style.display = "flex";
  }

  function closeAddMcpModal() {
    var overlay = document.getElementById("mcpModalOverlay");
    if (overlay) overlay.style.display = "none";
  }

  function handleSaveMcpServer() {
    var nameInput = document.getElementById("mcpServerName");
    var nameVal = nameInput ? nameInput.value.trim() : "";
    var errEl = document.getElementById("mcpModalError");

    if (!nameVal) {
      if (errEl) {
        errEl.textContent = "Please enter a server name.";
        errEl.style.display = "block";
        errEl.style.color = "#f85149";
      }
      return;
    }

    var radioSse = document.getElementById("mcpRadioSse");
    var isSse = radioSse && radioSse.checked;

    var serverData = {
      name: nameVal,
      transport: isSse ? "sse" : "stdio",
      alwaysAllow: !((document.getElementById("mcpAlwaysAsk") || {}).checked),
      enabled: true
    };

    if (isSse) {
      var urlInput = document.getElementById("mcpUrl");
      var urlVal = urlInput ? urlInput.value.trim() : "";
      if (!urlVal) {
        if (errEl) {
          errEl.textContent = "Please enter the server URL.";
          errEl.style.display = "block";
          errEl.style.color = "#f85149";
        }
        return;
      }
      serverData.url = urlVal;

      var headersInput = document.getElementById("mcpHeaders");
      var headersVal = headersInput ? headersInput.value.trim() : "";
      if (headersVal) {
        var hObj = {};
        var pairs = headersVal.split(",");
        for (var i = 0; i < pairs.length; i++) {
          var p = pairs[i].split(":");
          if (p.length >= 2) {
            var k = p[0].trim();
            var v = p.slice(1).join(":").trim();
            if (k) hObj[k] = v;
          }
        }
        serverData.headers = hObj;
      }
    } else {
      var cmdInput = document.getElementById("mcpCommand");
      var cmdVal = cmdInput ? cmdInput.value.trim() : "";
      if (!cmdVal) {
        if (errEl) {
          errEl.textContent = "Please enter a command (e.g. python, node, npx).";
          errEl.style.display = "block";
          errEl.style.color = "#f85149";
        }
        return;
      }
      serverData.command = cmdVal;

      var argsInput = document.getElementById("mcpArgs");
      var argsVal = argsInput ? argsInput.value.trim() : "";
      if (argsVal) {
        serverData.args = argsVal.split(/[\s,]+/).filter(Boolean);
      } else {
        serverData.args = [];
      }

      var envObj = getEnvVarsFromRows();
      if (Object.keys(envObj).length > 0) {
        serverData.env = envObj;
      }
    }

    var cwdInput = document.getElementById("mcpCwd");
    var cwdVal = cwdInput ? cwdInput.value.trim() : "";
    if (cwdVal) {
      serverData.cwd = cwdVal;
    }
    var timeoutInput = document.getElementById("mcpTimeout");
    var timeoutVal = timeoutInput ? parseInt(timeoutInput.value, 10) : 15;
    if (timeoutVal && !isNaN(timeoutVal)) {
      serverData.timeout = timeoutVal;
    }

    if (errEl) {
      errEl.textContent = "Connecting to MCP server and discovering tools...";
      errEl.style.display = "block";
      errEl.style.color = "#d29922";
    }

    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({
        type: "addMcpServer",
        server: serverData
      });
    }
  }

  function handleToggleMcpServer(serverId, enabled) {
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({
        type: "toggleMcpServer",
        serverId: serverId,
        enabled: enabled
      });
    }
  }

  function handleRemoveMcpServer(serverId) {
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({
        type: "removeMcpServer",
        serverId: serverId
      });
    }
  }

  function handleRefreshMcpServer(serverId) {
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({
        type: "refreshMcpServer",
        serverId: serverId
      });
    }
  }

  function handleToggleMcpTool(serverId, toolName, enabled) {
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({
        type: "toggleMcpTool",
        serverId: serverId,
        toolName: toolName,
        enabled: enabled
      });
    }
  }

  function handleToggleBuiltinTool(toolName, enabled) {
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({
        type: "toggleBuiltinTool",
        toolName: toolName,
        enabled: enabled
      });
    }
  }

  function handleToggleAllBuiltinTools(enabled) {
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({
        type: "toggleAllBuiltinTools",
        enabled: enabled
      });
    }
  }

  function renderMcpPanel(servers, builtinTools) {
    var container = document.getElementById("mcpServerList");
    if (!container) return;

    var sList = Array.isArray(servers) ? servers : (state.mcpServers || []);
    var bTools = Array.isArray(builtinTools) ? builtinTools : (state.builtinAgentTools || []);

    var html = "";

    // ── 1. Core Agent Built-in Tools Card ──────────────────────────────
    if (bTools.length > 0) {
      var bActiveCount = 0;
      for (var bi = 0; bi < bTools.length; bi++) {
        if (bTools[bi].enabled !== false) bActiveCount++;
      }

      var catIcons = {
        filesystem: '📁',
        search: '🔍',
        terminal: '💻',
        planning: '📋',
        utility: '⚡',
        database: '🗄️'
      };
      var catLabels = {
        filesystem: 'Filesystem Tools',
        search: 'Search & Code Intelligence',
        terminal: 'Terminal & Command Execution',
        planning: 'Plan & Checklist Management',
        utility: 'Utilities & Network',
        database: 'Database Queries'
      };

      var catMap = {};
      for (var ti = 0; ti < bTools.length; ti++) {
        var bt = bTools[ti];
        var cat = bt.category || 'utility';
        if (!catMap[cat]) catMap[cat] = [];
        catMap[cat].push(bt);
      }

      var isOpen = state.builtinToolsOpen === true;
      var openAttr = isOpen ? "open" : "";

      html += '<div class="cr-builtin-tools-card">' +
        '<details class="cr-builtin-tools-dropdown" id="crBuiltinToolsDropdown" ' + openAttr + '>' +
          '<summary class="cr-builtin-tools-summary">' +
            '<div class="cr-builtin-card-title-group">' +
              '<svg class="cr-builtin-card-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e6edf3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>' +
              '</svg>' +
              '<strong class="cr-builtin-card-title">Core Agent Built-in Tools</strong>' +
            '</div>' +
            '<div class="cr-builtin-card-right-group">' +
              '<span class="cr-builtin-counter-badge">' + bActiveCount + '/' + bTools.length + ' active</span>' +
              '<svg class="cr-builtin-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>' +
            '</div>' +
          '</summary>' +
          '<div class="cr-builtin-dropdown-body">' +
            '<div class="cr-builtin-controls-bar">' +
              '<div class="cr-builtin-search-wrap">' +
                '<svg class="cr-builtin-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
                '<input type="text" id="crBuiltinToolsSearch" class="cr-builtin-search-input" placeholder="Search built-in tools...">' +
              '</div>' +
              '<div class="cr-builtin-bulk-btns">' +
                '<button type="button" class="cr-mini-text-btn cr-builtin-bulk-btn" data-action="enable-all">Enable All</button>' +
                '<button type="button" class="cr-mini-text-btn cr-builtin-bulk-btn" data-action="disable-all">Disable All</button>' +
              '</div>' +
            '</div>';

      for (var catKey in catMap) {
        var cList = catMap[catKey];
        var cActiveCount = 0;
        for (var ci = 0; ci < cList.length; ci++) {
          if (cList[ci].enabled !== false) cActiveCount++;
        }
        var icon = catIcons[catKey] || '🔧';
        var label = catLabels[catKey] || catKey.toUpperCase();

        html += '<details class="cr-builtin-category-group" data-cat="' + esc(catKey) + '" open>' +
          '<summary class="cr-builtin-category-summary">' +
            '<div class="cr-builtin-category-left">' +
              '<span class="cr-builtin-category-icon">' + icon + '</span>' +
              '<strong class="cr-builtin-category-name">' + esc(label) + '</strong>' +
              '<span class="cr-builtin-category-count">(' + cActiveCount + '/' + cList.length + ' active)</span>' +
            '</div>' +
            '<svg class="cr-builtin-category-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
          '</summary>' +
          '<div class="cr-builtin-category-tools">';

        for (var cj = 0; cj < cList.length; cj++) {
          var tObj = cList[cj];
          var isActive = tObj.enabled !== false;
          var checkedAttr = isActive ? "checked" : "";
          var permText = tObj.dangerous ? "ASK PERMISSION" : "SAFE";

          html += '<div class="cr-builtin-tool-row' + (isActive ? ' active-tool' : ' disabled-tool') + '" data-tool-name="' + esc(tObj.name) + '" data-tool-desc="' + esc(tObj.description || '') + '">' +
            '<div class="cr-builtin-tool-header-row">' +
              '<div class="cr-builtin-tool-left">' +
                '<label class="cr-switch sm">' +
                  '<input type="checkbox" class="cr-builtin-tool-toggle cr-switch-input" data-tool="' + esc(tObj.name) + '" ' + checkedAttr + '>' +
                  '<span class="cr-switch-slider"></span>' +
                '</label>' +
                '<span class="cr-builtin-tool-name">' + esc(tObj.name) + '</span>' +
              '</div>' +
              '<div class="cr-builtin-tool-badges">' +
                '<span class="cr-builtin-perm-tag ' + (tObj.dangerous ? 'dangerous' : 'safe') + '">' + esc(permText) + '</span>' +
                '<span class="cr-mcp-tool-status ' + (isActive ? 'active' : 'inactive') + '">' +
                  (isActive ? 'Active' : 'Disabled') +
                '</span>' +
              '</div>' +
            '</div>' +
            '<div class="cr-builtin-tool-desc">' + esc(tObj.description || "Core agent tool.") + '</div>' +
          '</div>';
        }

        html += '</div></details>';
      }

      html += '<div id="crBuiltinNoMatch" class="cr-builtin-no-match" style="display:none;">No matching tools found.</div>';
      html += '</div></details></div>';
    }

    // ── 2. MCP SERVERS Header Row with Search ───────────────────────────
    html += '<div class="cr-mcp-servers-header-row">' +
      '<div class="cr-mcp-servers-title">MCP SERVERS</div>' +
      '<div class="cr-mcp-search-wrap">' +
        '<svg class="cr-mcp-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
        '<input type="text" id="crMcpServerSearch" class="cr-mcp-search-input" placeholder="Search servers...">' +
      '</div>' +
    '</div>';

    if (sList.length === 0) {
      html += '<div class="cr-mcp-empty">No MCP servers added yet. Click "+ Add MCP" to connect custom tools.</div>';
    } else {
      for (var i = 0; i < sList.length; i++) {
        var s = sList[i];
        var isBuiltin = !!s.builtin;
        var isConnected = !!s.connected;
        var isEnabled = s.enabled !== false;
        var statusDotClass = !isEnabled ? "disabled" : (isConnected ? "connected" : (s.connecting ? "connecting" : "error"));
        var transportLabel = (s.transport || "stdio").toUpperCase();
        var isChecked = isEnabled ? "checked" : "";
        var detailLine = s.transport === "sse" ? (s.url || "") : ((s.command || "") + " " + ((s.args || []).join(" ")));
        var permBadge = s.alwaysAllow ? "ALWAYS ALLOWED" : "ASK PERMISSION";
        var typeBadge = isBuiltin ? '<span class="cr-mcp-badge-free">100% FREE</span>' : '<span class="cr-mcp-badge-local">CUSTOM</span>';

        html += '<div class="cr-mcp-card' + (!isEnabled ? ' disabled-server' : '') + '" data-server-id="' + esc(s.id) + '" data-server-name="' + esc(s.name || s.id) + '" data-server-desc="' + esc(s.description || '') + '" data-server-cmd="' + esc(detailLine) + '">' +
          '<div class="cr-mcp-card-top-row">' +
            '<div class="cr-mcp-card-left-group">' +
              '<span class="cr-mcp-status-dot ' + statusDotClass + '" title="' + (isEnabled ? (isConnected ? 'Connected' : 'Connecting/Error') : 'Disabled') + '"></span>' +
              '<strong class="cr-mcp-card-name">' + esc(s.name || s.id) + '</strong>' +
              typeBadge +
            '</div>' +
            '<div class="cr-mcp-card-right-group">' +
              '<label class="cr-switch sm" title="Enable or disable ' + esc(s.name || s.id) + '">' +
                '<input type="checkbox" class="cr-mcp-toggle cr-switch-input" data-server="' + esc(s.id) + '" ' + isChecked + '>' +
                '<span class="cr-switch-slider"></span>' +
              '</label>' +
              '<span class="cr-mcp-toggle-status-text">' + (isEnabled ? 'Enabled' : 'Disabled') + '</span>' +
              '<div class="cr-mcp-dots-menu-wrap">' +
                '<button type="button" class="cr-mcp-dots-btn" data-server="' + esc(s.id) + '" title="Server actions">⋮</button>' +
                '<div class="cr-mcp-dropdown-menu" id="mcpMenu_' + esc(s.id) + '" style="display:none;">' +
                  '<button type="button" class="cr-mcp-menu-item cr-mcp-edit-btn" data-server="' + esc(s.id) + '">✏️ Edit Server</button>' +
                  '<button type="button" class="cr-mcp-menu-item cr-mcp-refresh-btn" data-server="' + esc(s.id) + '">↻ Reconnect & Refresh</button>';

        if (!isBuiltin) {
          html += '<button type="button" class="cr-mcp-menu-item cr-mcp-delete-btn" data-server="' + esc(s.id) + '">🗑️ Remove Server</button>';
        }

        html += '</div>' +
              '</div>' +
            '</div>' +
          '</div>';

        html += '<div class="cr-mcp-tags-row">' +
          '<span class="cr-mcp-pill-stdio">' + esc(transportLabel) + '</span>' +
          '<span class="cr-mcp-pill-perm">' + esc(permBadge) + '</span>' +
        '</div>';

        if (s.description) {
          html += '<div class="cr-mcp-card-desc">' + esc(s.description) + '</div>';
        }

        html += '<div class="cr-mcp-cmd-box">' +
          '<code class="cr-mcp-cmd-code">' + esc(detailLine) + '</code>' +
          '<button type="button" class="cr-mcp-copy-btn" data-copy="' + esc(detailLine) + '" title="Copy command">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>' +
          '</button>' +
        '</div>';

        if (s.error) {
          html += '<div class="cr-mcp-card-error"><strong>Error:</strong> ' + esc(s.error) + '</div>';
        }

        var tools = s.tools || [];
        if (tools.length > 0) {
          var activeCount = 0;
          for (var ac = 0; ac < tools.length; ac++) {
            if (tools[ac].enabled !== false) activeCount++;
          }
          html += '<details class="cr-mcp-tools-details">' +
            '<summary class="cr-mcp-tools-summary">' +
              '<span class="cr-mcp-tools-caret">▶</span>' +
              '<span>Tools (' + activeCount + '/' + tools.length + ' active)</span>' +
            '</summary>' +
            '<div class="cr-mcp-tools-list">';
          for (var t = 0; t < tools.length; t++) {
            var toolItem = tools[t];
            var isToolActive = toolItem.enabled !== false;
            var toolChecked = isToolActive ? "checked" : "";
            html += '<div class="cr-mcp-tool-item' + (isToolActive ? '' : ' disabled-tool') + '">' +
              '<div class="cr-mcp-tool-top-row">' +
                '<label class="cr-mcp-tool-check-label">' +
                  '<input type="checkbox" class="cr-mcp-tool-toggle" data-server="' + esc(s.id) + '" data-tool="' + esc(toolItem.name) + '" ' + toolChecked + '> ' +
                  '<strong class="cr-mcp-tool-name">' + esc(toolItem.name) + '</strong>' +
                '</label>' +
                '<span class="cr-mcp-tool-status ' + (isToolActive ? 'active' : 'inactive') + '">' +
                  (isToolActive ? 'Active' : 'Disabled') +
                '</span>' +
              '</div>' +
              '<div class="cr-mcp-tool-desc">' + esc(toolItem.description || "No description provided.") + '</div>' +
            '</div>';
          }
          html += '</div></details>';
        }

        html += '</div>';
      }
    }

    container.innerHTML = html;

    function onBuiltinToolToggleChange() {
      var tName = this.getAttribute("data-tool");
      handleToggleBuiltinTool(tName, this.checked);
    }

    function onToggleChange() {
      var sId = this.getAttribute("data-server");
      handleToggleMcpServer(sId, this.checked);
    }

    function onEditClick(e) {
      if (e) e.stopPropagation();
      var sId = this.getAttribute("data-server");
      var menu = document.getElementById("mcpMenu_" + sId);
      if (menu) menu.style.display = "none";
      var sObj = null;
      for (var si = 0; si < sList.length; si++) {
        if (sList[si].id === sId) {
          sObj = sList[si];
          break;
        }
      }
      if (sObj) openEditMcpModal(sObj);
    }

    function onDeleteClick(e) {
      if (e) e.stopPropagation();
      var sId = this.getAttribute("data-server");
      var menu = document.getElementById("mcpMenu_" + sId);
      if (menu) menu.style.display = "none";
      handleRemoveMcpServer(sId);
    }

    function onRefreshClick(e) {
      if (e) e.stopPropagation();
      var sId = this.getAttribute("data-server");
      var menu = document.getElementById("mcpMenu_" + sId);
      if (menu) menu.style.display = "none";
      handleRefreshMcpServer(sId);
    }

    function onToolToggleChange() {
      var sId = this.getAttribute("data-server");
      var tName = this.getAttribute("data-tool");
      handleToggleMcpTool(sId, tName, this.checked);
    }

    function onBulkBtnClick(e) {
      if (e) e.stopPropagation();
      var action = this.getAttribute("data-action");
      if (action === "enable-all") {
        handleToggleAllBuiltinTools(true);
      } else if (action === "disable-all") {
        handleToggleAllBuiltinTools(false);
      }
    }

    function onMainDropdownToggle() {
      state.builtinToolsOpen = this.open;
    }

    function onSearchInput(e) {
      var query = (e.target.value || "").trim().toLowerCase();
      var toolRows = container.querySelectorAll(".cr-builtin-tool-row");
      var matchedTotal = 0;
      var catGroups = container.querySelectorAll(".cr-builtin-category-group");

      for (var tri = 0; tri < toolRows.length; tri++) {
        var tr = toolRows[tri];
        var tName = (tr.getAttribute("data-tool-name") || "").toLowerCase();
        var tDesc = (tr.getAttribute("data-tool-desc") || "").toLowerCase();
        var matches = !query || tName.indexOf(query) !== -1 || tDesc.indexOf(query) !== -1;
        tr.style.display = matches ? "" : "none";
        if (matches) matchedTotal++;
      }

      for (var cgi = 0; cgi < catGroups.length; cgi++) {
        var cg = catGroups[cgi];
        var visibleChildren = cg.querySelectorAll(".cr-builtin-tool-row");
        var hasVisible = false;
        for (var vci = 0; vci < visibleChildren.length; vci++) {
          if (visibleChildren[vci].style.display !== "none") {
            hasVisible = true;
            break;
          }
        }
        cg.style.display = hasVisible ? "" : "none";
      }

      var noMatchEl = container.querySelector("#crBuiltinNoMatch");
      if (noMatchEl) {
        noMatchEl.style.display = (matchedTotal === 0 && query) ? "block" : "none";
      }
    }

    function onServerSearchInput(e) {
      var q = (e.target.value || "").trim().toLowerCase();
      var cards = container.querySelectorAll(".cr-mcp-card");
      for (var ci = 0; ci < cards.length; ci++) {
        var c = cards[ci];
        var sName = (c.getAttribute("data-server-name") || "").toLowerCase();
        var sDesc = (c.getAttribute("data-server-desc") || "").toLowerCase();
        var sCmd = (c.getAttribute("data-server-cmd") || "").toLowerCase();
        var match = !q || sName.indexOf(q) !== -1 || sDesc.indexOf(q) !== -1 || sCmd.indexOf(q) !== -1;
        c.style.display = match ? "" : "none";
      }
    }

    function onCopyCmdClick(e) {
      if (e) e.stopPropagation();
      var text = this.getAttribute("data-copy");
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      }
      var btn = this;
      btn.innerHTML = '<span style="color:#3fb950;font-size:11px;">✓</span>';
      setTimeout(function restoreCopyIcon() {
        btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      }, 1200);
    }

    function onDotsBtnClick(e) {
      if (e) e.stopPropagation();
      var sId = this.getAttribute("data-server");
      var menu = document.getElementById("mcpMenu_" + sId);
      if (!menu) return;
      var isShowing = menu.style.display === "block";
      var allMenus = container.querySelectorAll(".cr-mcp-dropdown-menu");
      for (var mi = 0; mi < allMenus.length; mi++) {
        allMenus[mi].style.display = "none";
      }
      menu.style.display = isShowing ? "none" : "block";
    }

    function onContainerDocClick() {
      var allMenus = container.querySelectorAll(".cr-mcp-dropdown-menu");
      for (var mi = 0; mi < allMenus.length; mi++) {
        allMenus[mi].style.display = "none";
      }
    }

    container.onclick = onContainerDocClick;

    var mainDropdown = container.querySelector("#crBuiltinToolsDropdown");
    if (mainDropdown) {
      mainDropdown.ontoggle = onMainDropdownToggle;
    }

    var searchInput = container.querySelector("#crBuiltinToolsSearch");
    if (searchInput) {
      searchInput.oninput = onSearchInput;
    }

    var serverSearch = container.querySelector("#crMcpServerSearch");
    if (serverSearch) {
      serverSearch.oninput = onServerSearchInput;
    }

    var copyBtns = container.querySelectorAll(".cr-mcp-copy-btn");
    for (var cpi = 0; cpi < copyBtns.length; cpi++) {
      copyBtns[cpi].onclick = onCopyCmdClick;
    }

    var dotsBtns = container.querySelectorAll(".cr-mcp-dots-btn");
    for (var dti = 0; dti < dotsBtns.length; dti++) {
      dotsBtns[dti].onclick = onDotsBtnClick;
    }

    var bulkBtns = container.querySelectorAll(".cr-builtin-bulk-btn");
    for (var bii = 0; bii < bulkBtns.length; bii++) {
      bulkBtns[bii].onclick = onBulkBtnClick;
    }

    var bToggles = container.querySelectorAll(".cr-builtin-tool-toggle");
    for (var bIdx = 0; bIdx < bToggles.length; bIdx++) {
      bToggles[bIdx].onchange = onBuiltinToolToggleChange;
    }

    var toggles = container.querySelectorAll(".cr-mcp-toggle");
    for (var j = 0; j < toggles.length; j++) {
      toggles[j].onchange = onToggleChange;
    }

    var editBtns = container.querySelectorAll(".cr-mcp-edit-btn");
    for (var eb = 0; eb < editBtns.length; eb++) {
      editBtns[eb].onclick = onEditClick;
    }

    var delBtns = container.querySelectorAll(".cr-mcp-delete-btn");
    for (var k = 0; k < delBtns.length; k++) {
      delBtns[k].onclick = onDeleteClick;
    }

    var refBtns = container.querySelectorAll(".cr-mcp-refresh-btn");
    for (var m = 0; m < refBtns.length; m++) {
      refBtns[m].onclick = onRefreshClick;
    }

    var toolToggles = container.querySelectorAll(".cr-mcp-tool-toggle");
    for (var n = 0; n < toolToggles.length; n++) {
      toolToggles[n].onchange = onToolToggleChange;
    }
  }

  function formatRulesTimestamp(d) {
    if (!d) d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    h = h ? h : 12;
    var mStr = m < 10 ? '0' + m : String(m);
    var hStr = h < 10 ? '0' + h : String(h);
    return hStr + ':' + mStr + ' ' + ampm;
  }

  function updateRulesGutter(textareaId, gutterId) {
    var ta = document.getElementById(textareaId);
    var gut = document.getElementById(gutterId);
    if (!ta || !gut) return;
    var lines = (ta.value || '').split('\n').length;
    if (lines < 6) lines = 6;
    var html = '';
    for (var i = 1; i <= lines; i++) {
      html += '<div class="cr-gutter-num">' + i + '</div>';
    }
    gut.innerHTML = html;
  }

  function setRulesStatus(level, statusType, timeText) {
    var dotEl = document.getElementById(level === 'global' ? "rulesGlobalStatusDot" : "rulesWorkspaceStatusDot");
    var textEl = document.getElementById(level === 'global' ? "rulesGlobalStatusText" : "rulesWorkspaceStatusText");
    var timeEl = document.getElementById(level === 'global' ? "rulesGlobalStatusTime" : "rulesWorkspaceStatusTime");
    if (!dotEl || !textEl) return;

    if (statusType === 'saved') {
      dotEl.className = "cr-rules-status-dot saved";
      textEl.textContent = "Saved";
      if (timeEl) timeEl.textContent = "Last saved: " + (timeText || formatRulesTimestamp());
    } else if (statusType === 'editing') {
      dotEl.className = "cr-rules-status-dot editing";
      textEl.textContent = "Unsaved changes";
      if (timeEl) timeEl.textContent = "";
    } else {
      dotEl.className = "cr-rules-status-dot clean";
      textEl.textContent = "No changes";
      if (timeEl) timeEl.textContent = "";
    }
  }

  function handleRulesGlobalTextareaInput() {
    updateRulesGutter("rulesGlobalTextarea", "rulesGlobalGutter");
    setRulesStatus("global", "editing");
  }

  function handleRulesWorkspaceTextareaInput() {
    updateRulesGutter("rulesWorkspaceTextarea", "rulesWorkspaceGutter");
    setRulesStatus("workspace", "editing");
  }

  function handleRulesGlobalScroll() {
    var ta = document.getElementById("rulesGlobalTextarea");
    var gut = document.getElementById("rulesGlobalGutter");
    if (ta && gut) gut.scrollTop = ta.scrollTop;
  }

  function handleRulesWorkspaceScroll() {
    var ta = document.getElementById("rulesWorkspaceTextarea");
    var gut = document.getElementById("rulesWorkspaceGutter");
    if (ta && gut) gut.scrollTop = ta.scrollTop;
  }

  function handleRulesGlobalKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSaveGlobalRules();
    }
  }

  function handleRulesWorkspaceKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSaveWorkspaceRules();
    }
  }

  function handleOpenGlobalRulesFile() {
    var path = state.globalRulesPath || '~/.coderun/rules';
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: "openFile", path: path });
    }
  }

  function handleOpenWorkspaceRulesFile() {
    var path = state.workspaceRulesPath || '.coderunrules';
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: "openFile", path: path });
    }
  }

  function handleSaveGlobalRules() {
    var textarea = document.getElementById("rulesGlobalTextarea");
    var content = textarea ? textarea.value : '';
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: "saveRules", level: "global", content: content });
    }
    setRulesStatus("global", "saved");
    showRulesSaveConfirmation("saveGlobalRulesBtn", "Save");
  }

  function handleSaveWorkspaceRules() {
    var textarea = document.getElementById("rulesWorkspaceTextarea");
    var content = textarea ? textarea.value : '';
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: "saveRules", level: "workspace", content: content });
    }
    setRulesStatus("workspace", "saved");
    showRulesSaveConfirmation("saveWorkspaceRulesBtn", "Save");
  }

  function showRulesSaveConfirmation(btnId, originalText) {
    var button = document.getElementById(btnId);
    if (button) {
      button.innerHTML = '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-1px;margin-right:4px;"><polyline points="20 6 9 17 4 12"/></svg>Saved ✓';
      button.classList.add("saved");
      function resetRulesSaveBtn() {
        var btn = document.getElementById(btnId);
        if (btn) {
          btn.innerHTML = '<svg class="cr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;margin-right:4px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>' + originalText;
          btn.classList.remove("saved");
        }
      }
      setTimeout(resetRulesSaveBtn, 1500);
    }
  }

  function handleModelInputClick(e) {
    if (e) e.stopPropagation();
    var list = document.getElementById("modelDropdownList");
    if (list) {
      var isHidden = list.style.display === "none";
      list.style.display = isHidden ? "block" : "none";
      if (isHidden) {
        var filterInput = document.getElementById("modelFilterInput");
        if (filterInput) {
          setTimeout(focusModelFilterInput, 40, filterInput);
        }
      }
    }
  }

  function handleModelInputInput() {
    var modelInput = document.getElementById("modelInput");
    if (modelInput) {
      state.selectedModel = modelInput.value;
      saveSelectedModel();
      updateModelBadge();
    }
  }

  function handleDocumentClickCloseDropdown(e) {
    var list = document.getElementById("modelDropdownList");
    if (list && !e.target.closest(".cr-model-bar .cr-combobox")) {
      list.style.display = "none";
    }
    var subList = document.getElementById("subagentModelDropdownList");
    if (subList && !e.target.closest(".cr-subagent-combobox")) {
      subList.style.display = "none";
    }
  }

  function handleModelItemClick() {
    var model = this.dataset.model;
    var provider = this.dataset.provider;
    state.selectedModel = model;
    state.selectedProvider = provider;
    state.settings.model = model;

    var modelInput = document.getElementById("modelInput");
    if (modelInput) modelInput.value = model;

    var cfgModelEl = document.getElementById("cfgModel");
    if (cfgModelEl && (state.settings.provider === provider || (!state.settings.provider && provider === 'ollama'))) {
      cfgModelEl.value = model;
    }

    var list = document.getElementById("modelDropdownList");
    if (list) list.style.display = "none";

    saveSelectedModel();
    updateModelBadge();
    renderModelOptions();
  }

  function handleCfgProviderChange() {
    var providerEl = document.getElementById("cfgProvider");
    var provider = providerEl ? providerEl.value : '';
    var configs = state.savedProviderConfigs || {};
    var saved = configs[provider] || null;
    var defaultUrl = PROVIDER_DEFAULT_URLS[provider] !== undefined ? PROVIDER_DEFAULT_URLS[provider] : '';

    state.settings.provider = provider;
    state.provider = provider;

    if (saved) {
      state.settings.baseUrl = saved.baseUrl || defaultUrl;
      state.settings.apiKey = '';
      state.settings.model = saved.model || '';
      state.settings.apiType = saved.apiType || 'openai';
      var keyMap = state.providerHasKeyMap || {};
      state.hasApiKey = !!keyMap[provider];
    } else {
      state.settings.baseUrl = defaultUrl;
      state.settings.apiKey = '';
      state.settings.model = '';
      state.settings.apiType = 'openai';
      state.hasApiKey = false;
    }

    updateSettingsUI();
  }

  function handleSaveSettingsClick() {
    var newProvider = document.getElementById("cfgProvider").value;
    var compNameEl = document.getElementById("cfgCompatibleName");
    var compApiTypeEl = document.getElementById("cfgCompatibleApiType");
    var customApiType = 'openai';
    if (newProvider === 'compatible' || newProvider.startsWith('compatible:')) {
      var customName = compNameEl ? compNameEl.value.trim() : '';
      customApiType = compApiTypeEl ? compApiTypeEl.value : 'openai';
      if (customName) {
        newProvider = 'compatible:' + customName;
      } else {
        newProvider = 'compatible';
      }
    }

    var defaultUrl = PROVIDER_DEFAULT_URLS[newProvider] !== undefined ? PROVIDER_DEFAULT_URLS[newProvider] : DEFAULT_BASE_URL;
    var newBaseUrl = document.getElementById("cfgBaseUrl").value.trim();
    var newApiKey = document.getElementById("cfgApiKey").value.trim();
    var newModel = document.getElementById("cfgModel").value.trim();
    var newMaxIter = parseInt(document.getElementById("cfgMaxIterations").value) || 20;
    var newStreaming = document.getElementById("cfgStreaming").checked;
    var newShowThinking = document.getElementById("cfgShowThinking").checked;
    var newConfirm = document.getElementById("cfgConfirmDangerous").checked;

    state.provider = newProvider;
    state.baseUrl = newBaseUrl || defaultUrl;
    state.settings.provider = newProvider;
    state.settings.baseUrl = newBaseUrl || defaultUrl;
    state.settings.model = newModel;
    state.settings.maxIterations = newMaxIter;
    state.settings.streaming = newStreaming;
    state.settings.showThinking = newShowThinking;
    state.settings.confirmDangerous = newConfirm;
    state.settings.apiType = customApiType;

    if (newModel) {
      state.selectedModel = newModel;
      state.selectedProvider = newProvider;
    }

    if (state.isVsCode && window.VSCODE_API) {
      var apiKeyToSend = newApiKey;
      var keyMap = state.providerHasKeyMap || {};
      var hasExistingKey = keyMap[newProvider];

      if (hasExistingKey && newApiKey === "") {
        apiKeyToSend = "";
      } else if (hasExistingKey && newApiKey === "••••••••") {
        apiKeyToSend = "••••••••";
      }

      window.VSCODE_API.postMessage({
        type: "saveSettings",
        settings: {
          provider: newProvider,
          baseUrl: newBaseUrl || defaultUrl,
          model: newModel,
          maxIterations: newMaxIter,
          streaming: newStreaming,
          showThinking: newShowThinking,
          confirmDangerous: newConfirm,
          apiType: customApiType
        },
        apiKey: apiKeyToSend
      });

      if (newApiKey && newApiKey !== "••••••••") {
        window.VSCODE_API.postMessage({ type: "saveApiKey", apiKey: newApiKey });
      } else if (newApiKey === "" && hasExistingKey) {
        window.VSCODE_API.postMessage({ type: "saveApiKey", apiKey: "" });
      }
    } else {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({
          provider: newProvider,
          baseUrl: newBaseUrl || defaultUrl,
          apiKey: newApiKey,
          model: newModel
        }));
      } catch (_) {
        // Intentionally ignore localStorage quota/access restrictions when saving settings
      }
      loadModels();
    }

    var button = document.getElementById("saveSettingsBtn");
    if (button) {
      button.textContent = "Saved";
      setTimeout(resetSaveSettingsButton, 1200);
    }
    updateModelBadge();
    updateModelSelectValue();
  }

  function resetSaveSettingsButton() {
    var button = document.getElementById("saveSettingsBtn");
    if (button) {
      button.textContent = "Save Settings";
    }
  }

  function handleClearAllConvClick() {
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: "confirmClearAll" });
      return;
    }
    if (confirm("Delete all conversations?")) performClearAll();
  }


  function handleDocumentKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
      event.preventDefault();
      createNewChat();
    }
  }

  function switchPanel(panelId, button) {
    var panels = document.querySelectorAll(".cr-panel");
    for (var i = 0; i < panels.length; i++) {
      panels[i].classList.remove("active");
    }
    var railBtns = document.querySelectorAll(".cr-rail-btn");
    for (var j = 0; j < railBtns.length; j++) {
      railBtns[j].classList.remove("active");
    }
    document.getElementById(panelId).classList.add("active");
    if (button) button.classList.add("active");
  }

  function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    saveStateToVscode();
    var sidebar = document.getElementById("cr-chat-sidebar");
    sidebar.classList.toggle("open", state.sidebarOpen);
    sidebar.classList.toggle("closed", !state.sidebarOpen);
  }

  function handleHealthCheckResponse(response) {
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }

  function handleHealthCheckData(data) {
    var dot = document.getElementById("status-dot");
    var text = document.getElementById("status-text");
    state.isOnline = true;
    if (dot) dot.className = "cr-status-dot";
    if (text) text.textContent = "Online";
    var allModels = [];
    state.modelContextWindows = state.modelContextWindows || {};
    if (data.models) {
      for (var i = 0; i < data.models.length; i++) {
        var mItem = data.models[i];
        var mName = typeof mItem === 'object' ? (mItem.name || mItem.id || '') : String(mItem);
        if (mName) allModels.push(mName);
        if (typeof mItem === 'object' && mName) {
          var ctx = mItem.context_window || mItem.context_length || (mItem.details && mItem.details.context_length);
          if (ctx) state.modelContextWindows[mName] = ctx;
        }
      }
    }
    state.models = allModels;
    state.modelsByProvider = { ollama: allModels };
    try {
      localStorage.setItem('coderun_model_context_windows', JSON.stringify(state.modelContextWindows));
    } catch (_) {}
    renderModelOptions();
  }

  function handleHealthCheckError() {
    var dot = document.getElementById("status-dot");
    var text = document.getElementById("status-text");
    state.isOnline = false;
    if (dot) dot.className = "cr-status-dot offline";
    if (text) text.textContent = "Offline";
    var select = document.getElementById("modelSelect");
    if (select) select.innerHTML = '<option value="">Unable to load models</option>';
  }

  function checkHealth() {
    var dot = document.getElementById("status-dot");
    var text = document.getElementById("status-text");
    if (dot) dot.className = "cr-status-dot connecting";
    if (text) text.textContent = "Connecting";

    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: "checkHealth" });
      return;
    }

    fetch(state.baseUrl + "/api/tags")
      .then(handleHealthCheckResponse)
      .then(handleHealthCheckData)
      .catch(handleHealthCheckError);
  }

  var lastRefreshTime = 0;
  function loadModels() {
    var now = Date.now();
    if (now - lastRefreshTime < 1500) {
      return;
    }
    lastRefreshTime = now;
    var list = document.getElementById("modelDropdownList");
    if (list) list.innerHTML = '<div class="cr-combobox-item loading">Loading models...</div>';
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: "refreshAllModels" });
      return;
    }
    checkHealth();
  }

  function getProviderLabel(providerName) {
    var displayLabel = providerName;
    if (providerName.startsWith('compatible:')) {
      var name = providerName.substring(11);
      var saved = (state.savedProviderConfigs || {})[providerName] || {};
      var type = saved.apiType || 'openai';
      var typeLabel = type === 'anthropic' ? 'Anthropic' : (type === 'gemini' ? 'Gemini' : 'Compatible');
      displayLabel = name + ' (' + typeLabel + ')';
    } else {
      displayLabel = providerName.charAt(0).toUpperCase() + providerName.slice(1);
    }
    return displayLabel;
  }

  function isModelPinned(provider, model) {
    if (!state.pinnedModels || !state.pinnedModels[provider]) return false;
    var list = state.pinnedModels[provider];
    for (var i = 0; i < list.length; i++) {
      if (list[i] === model) return true;
    }
    return false;
  }

  function handlePinClick(e) {
    if (e) e.stopPropagation();
    var provider = this.dataset.provider;
    var model = this.dataset.model;
    if (!provider || !model) return;

    if (!state.pinnedModels) state.pinnedModels = {};
    var list = state.pinnedModels[provider] || [];
    var idx = list.indexOf(model);
    if (idx !== -1) {
      list.splice(idx, 1);
    } else {
      list.unshift(model);
    }
    state.pinnedModels[provider] = list;

    try {
      localStorage.setItem("coderun_pinned_models", JSON.stringify(state.pinnedModels));
    } catch (_) {}

    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({
        type: "savePinnedModels",
        pinnedModels: state.pinnedModels
      });
    }

    renderModelOptions();
    var dropdown = document.getElementById("modelDropdownList");
    if (dropdown) dropdown.style.display = "block";
  }

  function handleModelFilterInput(e) {
    if (e) e.stopPropagation();
    state.modelSearchFilter = (e.target.value || "").trim().toLowerCase();
    renderModelOptions();
    var dropdown = document.getElementById("modelDropdownList");
    if (dropdown) dropdown.style.display = "block";
    var input = document.getElementById("modelFilterInput");
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function handleSearchInputClick(e) {
    if (e) e.stopPropagation();
  }

  function createModelItemElement(modelName, providerName, isPinned) {
    var item = document.createElement("div");
    var activeModel = state.selectedModel || state.settings.model || "";
    var currentSelectedProv = state.selectedProvider || state.provider || state.settings.provider || "ollama";
    var isSelected = activeModel === modelName && (!state.selectedProvider || state.selectedProvider === providerName || currentSelectedProv === providerName);

    item.className = "cr-combobox-item" + (isSelected ? " active" : "") + (isPinned ? " is-pinned" : "");
    item.dataset.model = modelName;
    item.dataset.provider = providerName;
    item.onclick = handleModelItemClick;

    if (isSelected) {
      var checkSpan = document.createElement("span");
      checkSpan.className = "cr-model-check";
      checkSpan.textContent = "✓";
      item.appendChild(checkSpan);
    } else {
      var spacerSpan = document.createElement("span");
      spacerSpan.className = "cr-model-check-spacer";
      item.appendChild(spacerSpan);
    }

    var nameSpan = document.createElement("span");
    nameSpan.className = "cr-model-name";
    nameSpan.textContent = modelName;
    nameSpan.title = modelName + (isSelected ? " (Currently selected)" : "");
    item.appendChild(nameSpan);

    var mod = (state.modelModalities && state.modelModalities[modelName]) || '';
    if (!mod) {
      if (/(?:^|[-_])video(?:[-_]|$)|sora|kling|runway|cogvideo|luma|pika/i.test(modelName)) mod = 'video';
      else if (/(?:^|[-_])image(?:[-_]|$)|dall-?e|imagen|flux|stable-diffusion|sdxl/i.test(modelName)) mod = 'image';
      else if (/(?:^|[-_])embed(?:ding)?(?:[-_]|$)|text-similarity|bge-/i.test(modelName)) mod = 'embedding';
    }
    if (mod === 'image') {
      var badgeImg = document.createElement("span");
      badgeImg.className = "cr-model-badge cr-badge-image";
      badgeImg.textContent = "🖼️ Image";
      badgeImg.title = "Image Generation Model (uses /v1/images/generations)";
      item.appendChild(badgeImg);
    } else if (mod === 'video') {
      var badgeVid = document.createElement("span");
      badgeVid.className = "cr-model-badge cr-badge-video";
      badgeVid.textContent = "🎬 Video";
      badgeVid.title = "Video Generation Model (uses /v1/videos)";
      item.appendChild(badgeVid);
    } else if (mod === 'embedding') {
      var badgeEmb = document.createElement("span");
      badgeEmb.className = "cr-model-badge cr-badge-embedding";
      badgeEmb.textContent = "🔍 Embed";
      badgeEmb.title = "Embedding Model";
      item.appendChild(badgeEmb);
    }

    var pinBtn = document.createElement("span");
    pinBtn.className = "cr-model-pin-btn" + (isPinned ? " pinned" : "");
    pinBtn.title = isPinned ? "Unpin model" : "Pin model to top";
    pinBtn.textContent = isPinned ? "★" : "☆";
    pinBtn.dataset.model = modelName;
    pinBtn.dataset.provider = providerName;
    pinBtn.onclick = handlePinClick;
    item.appendChild(pinBtn);

    return item;
  }

  function renderModelOptions() {
    var list = document.getElementById("modelDropdownList");
    if (!list) return;
    list.innerHTML = "";

    var modelProviders = Object.keys(state.modelsByProvider || {});
    var errorProviders = Object.keys(state.providerErrors || {});
    var allProviderSet = {};
    for (var mpi = 0; mpi < modelProviders.length; mpi++) allProviderSet[modelProviders[mpi]] = true;
    for (var epi = 0; epi < errorProviders.length; epi++) allProviderSet[errorProviders[epi]] = true;
    var providers = Object.keys(allProviderSet);

    if (!providers.length) {
      list.innerHTML = '<div class="cr-combobox-item empty">No models available</div>';
      state.selectedModel = "";
      updateModelBadge();
      return;
    }

    // Sticky search filter input
    var searchBox = document.createElement("div");
    searchBox.className = "cr-model-search-box";
    var searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.id = "modelFilterInput";
    searchInput.className = "cr-model-search-input";
    searchInput.placeholder = "🔍 Search models...";
    searchInput.value = state.modelSearchFilter || "";
    searchInput.oninput = handleModelFilterInput;
    searchInput.onclick = handleSearchInputClick;
    searchBox.appendChild(searchInput);
    list.appendChild(searchBox);

    var filterQuery = (state.modelSearchFilter || "").toLowerCase();
    var totalMatches = 0;
    var errorCount = 0;

    for (var p = 0; p < providers.length; p++) {
      var providerName = providers[p];
      var models = state.modelsByProvider[providerName] || [];
      var provError = (state.providerErrors && state.providerErrors[providerName]) || '';

      if (!models.length && !provError) continue;

      var filtered = [];
      for (var m = 0; m < models.length; m++) {
        if (!filterQuery || models[m].toLowerCase().indexOf(filterQuery) !== -1) {
          filtered.push(models[m]);
        }
      }
      if (!filtered.length && !provError) continue;
      totalMatches += filtered.length;
      if (provError && !models.length) errorCount++;

      var groupContainer = document.createElement("div");
      groupContainer.className = "cr-combobox-group";

      var isExpanded = filterQuery.length > 0 || !!state.openProviderGroups[providerName] || state.selectedProvider === providerName || (!state.selectedProvider && providerName === 'ollama');

      var header = document.createElement("div");
      header.className = "cr-combobox-group-header" + (provError && !models.length ? " has-error" : "");
      header.dataset.provider = providerName;
      var badgeText = (provError && !models.length) ? ' <span class="cr-group-error-badge">⚠️ Error</span>' : ' <span class="cr-group-count">(' + filtered.length + ')</span>';
      header.innerHTML = '<span class="cr-group-arrow">' + (isExpanded ? "▼" : "▶") + '</span> ' + getProviderLabel(providerName) + badgeText;
      header.onclick = handleGroupHeaderClick;
      groupContainer.appendChild(header);

      var itemsContainer = document.createElement("div");
      itemsContainer.className = "cr-combobox-group-items";
      itemsContainer.style.display = isExpanded ? "block" : "none";

      if (provError && !models.length) {
        var errItem = document.createElement("div");
        errItem.className = "cr-combobox-item error";
        errItem.title = provError;
        errItem.innerHTML = '⚠️ <span class="cr-error-text">' + esc(provError) + '</span>';
        itemsContainer.appendChild(errItem);
      }

      var pinnedList = (state.pinnedModels && state.pinnedModels[providerName]) || [];
      var pinnedModels = [];
      var otherModels = [];

      for (var f = 0; f < filtered.length; f++) {
        var modName = filtered[f];
        if (isModelPinned(providerName, modName)) {
          pinnedModels.push(modName);
        } else {
          otherModels.push(modName);
        }
      }

      // 1. Render Pinned Models (if any)
      if (pinnedModels.length > 0) {
        var pinTitle = document.createElement("div");
        pinTitle.className = "cr-combobox-subgroup-title";
        pinTitle.innerHTML = '<span>⭐ Pinned (' + pinnedModels.length + ')</span>';
        itemsContainer.appendChild(pinTitle);

        for (var pi = 0; pi < pinnedModels.length; pi++) {
          itemsContainer.appendChild(createModelItemElement(pinnedModels[pi], providerName, true));
        }
      }

      // 2. Render Other Models
      if (otherModels.length > 0) {
        if (pinnedModels.length > 0) {
          var allTitle = document.createElement("div");
          allTitle.className = "cr-combobox-subgroup-title";
          allTitle.innerHTML = '<span>📁 All Models (' + otherModels.length + ')</span>';
          itemsContainer.appendChild(allTitle);
        }
        for (var oi = 0; oi < otherModels.length; oi++) {
          itemsContainer.appendChild(createModelItemElement(otherModels[oi], providerName, false));
        }
      }

      groupContainer.appendChild(itemsContainer);
      list.appendChild(groupContainer);
    }

    if (totalMatches === 0 && errorCount === 0) {
      var emptyItem = document.createElement("div");
      emptyItem.className = "cr-combobox-item empty";
      emptyItem.textContent = "No models match '" + filterQuery + "'";
      list.appendChild(emptyItem);
    }

    // Determine current model only if not yet set
    if (!state.selectedModel) {
      var foundModel = "";
      var foundProvider = "";
      for (var p = 0; p < providers.length; p++) {
        var mList = state.modelsByProvider[providers[p]];
        if (mList && mList.length) {
          foundModel = mList[0];
          foundProvider = providers[p];
          break;
        }
      }
      if (foundModel) {
        state.selectedModel = foundModel;
        state.selectedProvider = foundProvider;
      }
    }

    updateModelSelectValue();
    updateModelBadge();
  }

  function handleGroupHeaderClick(e) {
    if (e) e.stopPropagation();
    var providerName = this.dataset.provider;
    var items = this.nextElementSibling;
    var arrow = this.querySelector(".cr-group-arrow");
    if (items && arrow) {
      var isHidden = items.style.display === "none";
      items.style.display = isHidden ? "block" : "none";
      arrow.textContent = isHidden ? "▼" : "▶";
      if (providerName) {
        state.openProviderGroups = state.openProviderGroups || {};
        state.openProviderGroups[providerName] = isHidden;
      }
    }
  }

  function modelExists(value) {
    if (!state.models) return false;
    for (var i = 0; i < state.models.length; i++) {
      if (state.models[i] === value) return true;
    }
    return false;
  }

  function updateModelSelectValue() {
    var modelInput = document.getElementById("modelInput");
    if (modelInput) {
      var hasModels = state.models && state.models.length > 0;
      if (!hasModels) {
        modelInput.value = "";
        modelInput.placeholder = "Model not available";
        modelInput.disabled = true;
      } else {
        modelInput.value = state.selectedModel || "";
        modelInput.placeholder = "Select model...";
        modelInput.disabled = false;

        var curMod = (state.modelModalities && state.modelModalities[state.selectedModel]) || '';
        if (!curMod) {
          if (/(?:^|[-_])video(?:[-_]|$)|sora|kling/i.test(state.selectedModel || '')) curMod = 'video';
          else if (/(?:^|[-_])image(?:[-_]|$)|dall-?e|flux/i.test(state.selectedModel || '')) curMod = 'image';
        }
        var promptTextarea = document.getElementById("promptInput");
        if (promptTextarea) {
          if (curMod === 'image') {
            promptTextarea.placeholder = "Describe the image you want to generate...";
          } else if (curMod === 'video') {
            promptTextarea.placeholder = "Describe the video you want to generate...";
          } else {
            promptTextarea.placeholder = "Ask anything...";
          }
        }
      }
    }
  }

  function updateModelBadge() {
    var badge = document.getElementById("headerModelBadge");
    if (!badge) return;
    badge.textContent = state.selectedModel || state.settings.model || "No model";
  }

  function handleThreadItemClick(event) {
    var button = event.target.closest("[data-action]");
    if (button) {
      if (button.dataset.action === "rename") startRename(button.dataset.id);
      if (button.dataset.action === "delete") deleteConversation(button.dataset.id);
      return;
    }
    if (state.renamingId !== this.dataset.id) selectConversation(this.dataset.id);
  }

  function focusModelFilterInput(filterInput) {
    filterInput.focus();
    filterInput.select();
  }

  function formatTraceToolDecision(stepTool) {
    return 'Call ' + stepTool.toolName;
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) return "";
    var date = new Date(timestamp);
    if (isNaN(date.getTime())) return "";
    var now = new Date();
    var diffMs = now.getTime() - date.getTime();
    var diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      var hours = date.getHours();
      var minutes = date.getMinutes();
      var ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12;
      hours = hours ? hours : 12;
      var strMinutes = minutes < 10 ? "0" + minutes : minutes;
      return hours + ":" + strMinutes + " " + ampm;
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return days[date.getDay()];
    } else {
      var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return months[date.getMonth()] + " " + date.getDate();
    }
  }

  function getConversationPreview(conversation) {
    if (!conversation) return "";
    if (conversation.messages && conversation.messages.length) {
      var lastUserMsg = null;
      var lastMsg = conversation.messages[conversation.messages.length - 1];
      for (var i = conversation.messages.length - 1; i >= 0; i--) {
        if (conversation.messages[i].role === "user" && conversation.messages[i].content) {
          lastUserMsg = conversation.messages[i];
          break;
        }
      }
      var targetMsg = lastUserMsg || lastMsg;
      if (targetMsg && targetMsg.content) {
        var clean = targetMsg.content.replace(/\s+/g, " ").trim();
        return clean.length > 55 ? clean.slice(0, 52) + "..." : clean;
      }
    }
    return "No messages yet";
  }

  function getConversationTime(conversation) {
    if (!conversation) return "";
    if (conversation.messages && conversation.messages.length) {
      var lastMsg = conversation.messages[conversation.messages.length - 1];
      if (lastMsg && lastMsg.timestamp) {
        return formatRelativeTime(lastMsg.timestamp);
      }
    }
    if (conversation.createdAt) {
      return formatRelativeTime(conversation.createdAt);
    }
    return "";
  }

  function renderSidebar() {
    var list = document.getElementById("thread-list");
    if (!list) return;
    list.innerHTML = "";

    if (!state.conversations.length) {
      list.innerHTML = '<div class="cr-empty">No chats yet</div>';
      return;
    }

    for (var i = 0; i < state.conversations.length; i++) {
      var conversation = state.conversations[i];
      var item = document.createElement("div");
      item.className = "cr-thread-item" + (state.activeConversationId === conversation.id ? " active" : "");
      item.dataset.id = conversation.id;

      if (state.renamingId === conversation.id) {
        var input = document.createElement("input");
        input.className = "cr-rename-input";
        input.id = "rename-input-" + conversation.id;
        input.value = state.renameValue;
        item.appendChild(input);
      } else {
        var preview = getConversationPreview(conversation);
        var timeStr = getConversationTime(conversation);
        var subList = getSubagentsForCurrentSession(conversation.id);
        var subCountBadge = (subList && subList.length > 0)
          ? '<span class="cr-thread-subagent-badge" title="' + subList.length + ' subagent(s)">👥 ' + subList.length + '</span>'
          : '';
        item.innerHTML =
          '<span class="cr-thread-icon">💬</span>' +
          '<div class="cr-thread-content">' +
            '<div class="cr-thread-top-row">' +
              '<span class="cr-thread-title">' + esc(conversation.title || "New chat") + '</span>' +
              subCountBadge +
              (timeStr ? '<span class="cr-thread-time">' + esc(timeStr) + '</span>' : '') +
            '</div>' +
            '<span class="cr-thread-preview">' + esc(preview) + '</span>' +
          '</div>' +
          '<span class="cr-thread-actions">' +
            '<button class="cr-thread-dots" title="Rename" data-action="rename" data-id="' + esc(conversation.id) + '">✎</button>' +
            '<button class="cr-thread-delete" title="Delete" data-action="delete" data-id="' + esc(conversation.id) + '">×</button>' +
          '</span>';
      }

      list.appendChild(item);
    }

    var items = list.querySelectorAll(".cr-thread-item");
    for (var j = 0; j < items.length; j++) {
      items[j].onclick = handleThreadItemClick;
    }

    if (state.renamingId) bindRenameInput();
  }

  function handleRenameInputBlur() {
    saveRename(state.renamingId);
  }

  function handleRenameInputKeyDown(event) {
    if (event.key === "Enter") saveRename(state.renamingId);
    if (event.key === "Escape") {
      state.renamingId = null;
      renderSidebar();
    }
  }

  function bindRenameInput() {
    var input = document.getElementById("rename-input-" + state.renamingId);
    if (!input) return;
    input.focus();
    input.select();
    input.onblur = handleRenameInputBlur;
    input.onkeydown = handleRenameInputKeyDown;
  }

  function handleChatStreamStart() {
  }

  function handleChatStreamEnd() {
  }

  function handleChatStreamError() {
  }

  function createNewChatWithPrompt(initialPrompt) {
    var conversation = {
      id: sharedGenId(),
      title: "New chat",
      messages: [],
      createdAt: Date.now()
    };
    state.conversations.unshift(conversation);
    saveConversations();
    selectConversation(conversation.id);
    if (initialPrompt) {
      function onSetPromptTimeout() {
        var input = document.querySelector(".cr-input");
        if (input) {
          input.value = initialPrompt;
          var count = document.querySelector(".cr-char-count");
          if (count) count.textContent = initialPrompt.length;
          input.focus();
          if (typeof input.setSelectionRange === "function") {
            var len = input.value.length;
            input.setSelectionRange(len, len);
          }
        }
      }
      setTimeout(onSetPromptTimeout, 60);
    }
  }

  function handleDashboardAvatarError(img) {
    if (!img) return;
    if (window.CODERUN_LOGO_URI && img.src !== window.CODERUN_LOGO_URI) {
      img.src = window.CODERUN_LOGO_URI;
      return;
    }
    var wrapper = img.parentNode;
    if (wrapper) {
      img.style.display = "none";
      var existingSvg = wrapper.querySelector(".cr-welcome-avatar-svg");
      if (!existingSvg) {
        var svgWrap = document.createElement("div");
        svgWrap.className = "cr-welcome-avatar-svg";
        svgWrap.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7H4a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2zM7 14v2a1 1 0 1 0 2 0v-2H7zm8 0v2a1 1 0 1 0 2 0v-2h-2zM5 20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1H5v1z"/></svg>';
        wrapper.appendChild(svgWrap);
      }
    }
  }

  function renderDashboardWelcome(container) {
    if (!container) return;
    var botAvatarSrc = (window.CODERUN_BOT_AVATAR || window.CODERUN_LOGO_URI || "bot-avatar.jpg");
    container.innerHTML =
      '<div class="cr-welcome-screen">' +
        '<div class="cr-welcome-container">' +
          '<div class="cr-welcome-hero">' +
            '<div class="cr-welcome-avatar-wrapper">' +
              '<div class="cr-welcome-avatar-glow"></div>' +
              '<img class="cr-welcome-avatar-img" src="' + botAvatarSrc + '" alt="Robot Mascot"/>' +
            '</div>' +
            '<h1 class="cr-welcome-title">Welcome to <span class="cr-welcome-brand">AI-AGENT</span></h1>' +
            '<p class="cr-welcome-subtitle">Your intelligent coding companion</p>' +
          '</div>' +
          '<div class="cr-welcome-capabilities">' +
            '<button type="button" class="cr-welcome-cap-card" data-prompt="Write code for ">' +
              '<div class="cr-welcome-cap-icon-box cr-cap-icon-code">' +
                '<svg class="cr-welcome-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' +
              '</div>' +
              '<span class="cr-welcome-cap-label">Write Code</span>' +
            '</button>' +
            '<button type="button" class="cr-welcome-cap-card" data-prompt="Explain this code: ">' +
              '<div class="cr-welcome-cap-icon-box cr-cap-icon-explain">' +
                '<svg class="cr-welcome-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' +
              '</div>' +
              '<span class="cr-welcome-cap-label">Explain</span>' +
            '</button>' +
            '<button type="button" class="cr-welcome-cap-card" data-prompt="Build a ">' +
              '<div class="cr-welcome-cap-icon-box cr-cap-icon-build">' +
                '<svg class="cr-welcome-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8L19 13"/><circle cx="15" cy="9" r="1"/><path d="M17.8 6.2L19 5"/><path d="M3 21l9-9"/><path d="M12.2 6.2L11 5"/></svg>' +
              '</div>' +
              '<span class="cr-welcome-cap-label">Build</span>' +
            '</button>' +
            '<button type="button" class="cr-welcome-cap-card" data-prompt="Write a script to automate ">' +
              '<div class="cr-welcome-cap-icon-box cr-cap-icon-automate">' +
                '<svg class="cr-welcome-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' +
              '</div>' +
              '<span class="cr-welcome-cap-label">Automate</span>' +
            '</button>' +
          '</div>' +
          '<div class="cr-welcome-divider">' +
            '<span class="cr-welcome-divider-line"></span>' +
            '<span class="cr-welcome-divider-text">Try asking something like</span>' +
            '<span class="cr-welcome-divider-line"></span>' +
          '</div>' +
          '<div class="cr-welcome-prompts-grid">' +
            '<button type="button" class="cr-welcome-prompt-card" data-prompt="Create a React login page">' +
              '<div class="cr-prompt-icon-box cr-prompt-icon-code">' +
                '<svg class="cr-welcome-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' +
              '</div>' +
              '<span class="cr-prompt-text">Create a React login page</span>' +
              '<div class="cr-prompt-arrow">' +
                '<svg class="cr-welcome-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>' +
              '</div>' +
            '</button>' +
            '<button type="button" class="cr-welcome-prompt-card" data-prompt="Find and fix bugs in my code">' +
              '<div class="cr-prompt-icon-box cr-prompt-icon-bug">' +
                '<svg class="cr-welcome-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="8" height="14" x="8" y="6" rx="4"/><path d="m19 7-3 2"/><path d="m5 7 3 2"/><path d="m19 19-3-2"/><path d="m5 19 3-2"/><path d="M20 13h-4"/><path d="M4 13h4"/><path d="m10 4 1 2"/><path d="m14 4-1 2"/></svg>' +
              '</div>' +
              '<span class="cr-prompt-text">Find and fix bugs in my code</span>' +
              '<div class="cr-prompt-arrow">' +
                '<svg class="cr-welcome-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>' +
              '</div>' +
            '</button>' +
            '<button type="button" class="cr-welcome-prompt-card" data-prompt="Explain this code to me">' +
              '<div class="cr-prompt-icon-box cr-prompt-icon-explain">' +
                '<svg class="cr-welcome-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' +
              '</div>' +
              '<span class="cr-prompt-text">Explain this code to me</span>' +
              '<div class="cr-prompt-arrow">' +
                '<svg class="cr-welcome-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>' +
              '</div>' +
            '</button>' +
            '<button type="button" class="cr-welcome-prompt-card" data-prompt="Write a script to automate this task">' +
              '<div class="cr-prompt-icon-box cr-prompt-icon-term">' +
                '<svg class="cr-welcome-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>' +
              '</div>' +
              '<span class="cr-prompt-text">Write a script to automate this task</span>' +
              '<div class="cr-prompt-arrow">' +
                '<svg class="cr-welcome-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>' +
              '</div>' +
            '</button>' +
          '</div>' +
          '<div class="cr-welcome-tip">' +
            '<div class="cr-welcome-tip-icon">' +
              '<svg class="cr-welcome-svg cr-bulb-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/></svg>' +
            '</div>' +
            '<div class="cr-welcome-tip-text">' +
              '<strong>Tip:</strong> You can ask anything \u2014 code, explanations, debugging, or even project ideas!' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var avatarImg = container.querySelector(".cr-welcome-avatar-img");
    if (avatarImg) {
      function onAvatarError() {
        handleDashboardAvatarError(avatarImg);
      }
      avatarImg.addEventListener("error", onAvatarError);
    }

    function onWelcomeCardClick(e) {
      var btn = e.target.closest("button[data-prompt]");
      if (!btn) return;
      var prompt = btn.getAttribute("data-prompt");
      createNewChatWithPrompt(prompt || "");
    }
    var welcomeScreen = container.querySelector(".cr-welcome-screen");
    if (welcomeScreen) {
      welcomeScreen.addEventListener("click", onWelcomeCardClick);
    }
    container.scrollTop = 0;
  }

  function selectConversation(id) {
    state.activeConversationId = id || null;
    state.renamingId = null;
    saveStateToVscode();
    renderSidebar();

    var container = document.getElementById("chat-area-container");
    if (!container) return;

    if (!id) {
      renderDashboardWelcome(container);
      return;
    }

    var conversation = null;
    for (var i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id === id) {
        conversation = state.conversations[i];
        break;
      }
    }
    if (conversation && typeof window.renderChatSpace === "function") {
      window.renderChatSpace(container, conversation, {
        model: state.selectedModel,
        workspaceFolder: state.workspaceFolder,
        baseUrl: state.baseUrl,
        onStreamStart: handleChatStreamStart,
        onStreamEnd: handleChatStreamEnd,
        onStreamError: handleChatStreamError
      });
    }

    var tracesArea = document.getElementById("traces-area-container");
    if (tracesArea && tracesArea.style.display !== "none") {
      renderTracesView(tracesArea);
    }

    var subagentsArea = document.getElementById("subagents-area-container");
    if (subagentsArea && subagentsArea.style.display !== "none") {
      renderSubagentsView(subagentsArea);
    }

    var subagentTracesArea = document.getElementById("subagent-traces-area-container");
    if (subagentTracesArea && subagentTracesArea.style.display !== "none") {
      renderSubagentTracesView(subagentTracesArea);
    }
  }

  function createNewChat() {
    var conversation = {
      id: sharedGenId(),
      title: "New chat",
      messages: [],
      createdAt: Date.now()
    };
    state.conversations.unshift(conversation);
    saveConversations();
    selectConversation(conversation.id);
  }

  function startRename(id) {
    var conversation = null;
    for (var i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id === id) {
        conversation = state.conversations[i];
        break;
      }
    }
    state.renamingId = id;
    state.renameValue = conversation ? conversation.title || "" : "";
    renderSidebar();
  }

  function saveRename(id) {
    var input = document.getElementById("rename-input-" + id);
    var title = input ? input.value.trim() : "";
    var conversation = null;
    for (var i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id === id) {
        conversation = state.conversations[i];
        break;
      }
    }
    if (conversation && title) {
      conversation.title = title;
      saveConversations();
    }
    state.renamingId = null;
    renderSidebar();
  }

  function deleteConversation(id) {
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: "confirmDelete", id: id });
      return;
    }
    if (confirm("Delete this conversation?")) performDelete(id);
  }

  function performDelete(id) {
    var deletingActiveConversation = state.activeConversationId === id;
    var remaining = [];
    for (var i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id !== id) {
        remaining.push(state.conversations[i]);
      }
    }
    state.conversations = remaining;
    if (deletingActiveConversation) {
      if (state.isVsCode && window.VSCODE_API) {
        window.VSCODE_API.postMessage({ type: "stopChat", sessionId: id, conversationId: id });
      }
      if (window.activeChatStreamCallback) window.activeChatStreamCallback = null;
      state.activeConversationId = state.conversations[0] ? state.conversations[0].id : null;
    }
    saveConversations();
    renderSidebar();
    if (deletingActiveConversation) {
      selectConversation(state.activeConversationId);
    }
  }

  function performClearAll() {
    state.conversations = [];
    state.activeConversationId = null;
    saveConversations();
    renderSidebar();
    selectConversation(null);
  }

  window.performDeleteConversation = performDelete;
  window.performClearAllConversations = performClearAll;



  function updateAgentTimelineStub() {}
  function clearAgentTimelineStub() {}
  window.updateAgentTimeline = updateAgentTimelineStub;
  window.clearAgentTimeline = clearAgentTimelineStub;

  // ── Terminal output is now rendered ONLY via inline tool cards ────
  //    inside each assistant message. The fixed terminal panel is no
  //    longer used. These stubs prevent errors if any code still calls
  //    them.
  function appendTerminalLineStub() {}
  function forwardTerminalEventStub() {}
  function clearTerminalStub() {}
  window.appendTerminalLine = appendTerminalLineStub;
  window.forwardTerminalEvent = forwardTerminalEventStub;
  window.clearTerminal = clearTerminalStub;
  function clearTerminal() {}

  function getDashboardModel() { return state.selectedModel; }
  function getDashboardProvider() { return state.selectedProvider; }
  function getDashboardWorkspace() { return state.workspaceFolder; }
  function getDashboardBaseUrl() { return state.baseUrl; }
  function getDashboardAlwaysDecisions() { return state.alwaysDecisions || {}; }

  window.getDashboardModel = getDashboardModel;
  window.getDashboardProvider = getDashboardProvider;
  window.getDashboardWorkspace = getDashboardWorkspace;
  window.getDashboardBaseUrl = getDashboardBaseUrl;
  window.getDashboardAlwaysDecisions = getDashboardAlwaysDecisions;

  function saveConversationMessage(convId, role, content, extra) {
    extra = extra || {};
    var conversation = null;
    for (var i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id === convId) {
        conversation = state.conversations[i];
        break;
      }
    }
    if (!conversation) return;
    if (!conversation.messages) conversation.messages = [];
    if (!conversation.model && state.selectedModel) conversation.model = state.selectedModel;
    if (!conversation.provider && state.selectedProvider) conversation.provider = state.selectedProvider;

    var message = { 
      role: role, 
      content: content || "", 
      timestamp: Date.now(),
      model: extra.model || state.selectedModel || '',
      provider: extra.provider || state.selectedProvider || ''
    };
    if (extra.thinking) message.thinking = extra.thinking;
    if (extra.sources) message.sources = extra.sources;
    if (extra.image) message.image = extra.image;
    if (extra.images) message.images = extra.images;
    if (extra.media) message.media = extra.media;
    if (extra.tool_calls) message.tool_calls = extra.tool_calls;
    if (extra.tool_call_id) message.tool_call_id = extra.tool_call_id;
    if (extra.tool_name) message.tool_name = extra.tool_name;
    if (extra.result) message.result = extra.result;
    if (extra.error) message.error = extra.error;

    var last = conversation.messages[conversation.messages.length - 1];
    if (last && last.role === role) {
      if (content) last.content = content;
      if (message.thinking) last.thinking = message.thinking;
      if (message.sources) last.sources = message.sources;
      if (message.media) last.media = message.media;
      if (message.tool_calls) last.tool_calls = message.tool_calls;
      if (message.tool_name) last.tool_name = message.tool_name;
      if (message.result) last.result = message.result;
      if (message.error) last.error = message.error;
    } else {
      conversation.messages.push(message);
    }

    if (conversation.title === "New chat" && role === "user" && content) {
      conversation.title = content.slice(0, 44) + (content.length > 44 ? "..." : "");
    }

    saveConversations();
    renderSidebar();
  }
  window.saveConversationMessage = saveConversationMessage;

  function saveConversationMessageBatch(convId, newMessages, plan) {
    var conversation = null;
    for (var i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id === convId) {
        conversation = state.conversations[i];
        break;
      }
    }
    if (!conversation) return;
    if (!conversation.messages) conversation.messages = [];
    if (!conversation.model && state.selectedModel) conversation.model = state.selectedModel;
    if (!conversation.provider && state.selectedProvider) conversation.provider = state.selectedProvider;

    console.log('[SAVE_BATCH] convId:', convId, 'newMessages count:', newMessages ? newMessages.length : 0);
    if (newMessages) {
      for (var dbg = 0; dbg < newMessages.length; dbg++) {
        var m = newMessages[dbg];
        if (m.role === 'assistant') {
          console.log('[SAVE_BATCH] assistant msg #' + dbg + ' has thinking:', !!m.thinking, 'content length:', (m.content || '').length, 'tool_calls:', !!(m.tool_calls && m.tool_calls.length));
          if (m.thinking) console.log('[SAVE_BATCH] thinking preview:', String(m.thinking).substring(0, 100));
        }
      }
    }

    if (newMessages && newMessages.length) {
      if (newMessages[0] && newMessages[0].role === 'user') {
        var mergedAll = [];
        for (var ma = 0; ma < newMessages.length; ma++) {
          var nMsg = Object.assign({}, newMessages[ma]);
          var oldMsg = (conversation.messages && conversation.messages[ma]) ? conversation.messages[ma] : null;
          if (!nMsg.model) {
            nMsg.model = (oldMsg && oldMsg.model) || (nMsg.role === 'user' ? state.selectedModel : '') || '';
          }
          if (!nMsg.provider) {
            nMsg.provider = (oldMsg && oldMsg.provider) || (nMsg.role === 'user' ? state.selectedProvider : '') || '';
          }
          if (!nMsg.error && oldMsg && oldMsg.error) {
            nMsg.error = oldMsg.error;
          }
          if (!nMsg.thinking && oldMsg && oldMsg.thinking) {
            nMsg.thinking = oldMsg.thinking;
          }
          if (!nMsg.media && oldMsg && oldMsg.media) {
            nMsg.media = oldMsg.media;
          }
          mergedAll.push(nMsg);
        }
        conversation.messages = mergedAll;
      } else {
        var lastUserIdx = -1;
        for (var i = conversation.messages.length - 1; i >= 0; i--) {
          if (conversation.messages[i].role === 'user') {
            lastUserIdx = i;
            break;
          }
        }

        var msgsToAppend = [];
        for (var k = 0; k < newMessages.length; k++) {
          if (newMessages[k]) {
            var item = Object.assign({}, newMessages[k]);
            if (!item.model) item.model = state.selectedModel || '';
            if (!item.provider) item.provider = state.selectedProvider || '';
            msgsToAppend.push(item);
          }
        }

        if (lastUserIdx !== -1) {
          conversation.messages = conversation.messages.slice(0, lastUserIdx + 1).concat(msgsToAppend);
        } else {
          conversation.messages = conversation.messages.concat(msgsToAppend);
        }
      }
    }

    var assistantMsgs = [];
    for (var i = 0; i < conversation.messages.length; i++) {
      if (conversation.messages[i].role === 'assistant') {
        assistantMsgs.push(conversation.messages[i]);
      }
    }

    var thinkingCount = 0;
    for (var i = 0; i < assistantMsgs.length; i++) {
      if (assistantMsgs[i].thinking) {
        thinkingCount++;
      }
    }
    console.log('[SAVE_BATCH] After merge: total messages:', conversation.messages.length, 'assistant:', assistantMsgs.length, 'with thinking:', thinkingCount);

    if (plan !== undefined) {
      conversation.plan = plan;
    }

    saveConversations();
    renderSidebar();
  }
  window.saveConversationMessageBatch = saveConversationMessageBatch;

  function updateConversationUsage(convId, usage) {
    if (!convId || !usage) return;
    for (var i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id === convId) {
        state.conversations[i].usage = usage;
        saveConversations();
        break;
      }
    }
  }
  window.updateConversationUsage = updateConversationUsage;

  function updateConversationTitle(convId, title) {
    var conversation = null;
    for (var i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id === convId) {
        conversation = state.conversations[i];
        break;
      }
    }
    if (conversation && title) {
      conversation.title = title;
      saveConversations();
      renderSidebar();
    }
  }
  window.updateConversationTitle = updateConversationTitle;

  function webviewAlert(message) {
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: "showAlert", message: message });
      return;
    }
    alert(message);
  }
  window.webviewAlert = webviewAlert;

  function handleWindowMessage(event) {
    var message = event.data || {};
    if (message.type === "loadConversations") {
      window.loadConversationsFromExtension(message.conversations, message.selectedModel, message.selectedProvider);
    }
    if (message.type === "loadPinnedModels") {
      if (message.pinnedModels && typeof message.pinnedModels === 'object') {
        state.pinnedModels = message.pinnedModels;
        try {
          localStorage.setItem("coderun_pinned_models", JSON.stringify(state.pinnedModels));
        } catch (_) {}
        renderModelOptions();
      }
    }
    if (message.type === "workspaceFolder") {
      window.setDashboardWorkspace(message.path);
    }
    if (message.type === "deleteConversationConfirmed") {
      performDelete(message.id);
    }
    if (message.type === "clearAllConversationsConfirmed") {
      performClearAll();
    }
    if (message.type === "newChat") {
      createNewChat();
    }
    if (message.type === "currentSettings") {
      window.applyVscodeSettings(message.settings);
      if (message.providerHasKeyMap) {
        state.providerHasKeyMap = message.providerHasKeyMap;
      }
      if (message.providerConfigs) {
        var newConfigs = message.providerConfigs;
        if (state.savedProviderConfigs) {
          for (var oldProv in state.savedProviderConfigs) {
            if (!newConfigs[oldProv] && state.modelsByProvider) {
              delete state.modelsByProvider[oldProv];
            }
          }
        }
        state.modelsByProvider = state.modelsByProvider || {};
        state.savedProviderConfigs = newConfigs;
        renderSavedProviders();
        state.models = [];
        for (var provKey in state.modelsByProvider) {
          if (state.modelsByProvider[provKey] && state.modelsByProvider[provKey].length) {
            state.models = state.models.concat(state.modelsByProvider[provKey]);
          }
        }
        renderModelOptions();
      }
    }
    if (message.type === "healthStatus") {
      var dot = document.getElementById("status-dot");
      var text = document.getElementById("status-text");
      if (!state.providerErrors) state.providerErrors = {};
      if (!state.modelsByProvider) state.modelsByProvider = {};

      var currentProv = message.provider || "ollama";
      var isActiveProvider = (currentProv === state.provider || currentProv === state.selectedProvider);

      if (message.online && message.models) {
        delete state.providerErrors[currentProv];
        var parsedModels = [];
        state.modelContextWindows = state.modelContextWindows || {};
        state.modelModalities = state.modelModalities || {};
        for (var mi = 0; mi < message.models.length; mi++) {
          var item = message.models[mi];
          if (typeof item === 'object' && item !== null) {
            var mId = item.id || item.name || '';
            if (mId) parsedModels.push(mId);
            var ctx = item.context_window || item.context_length || item.inputTokenLimit;
            if (ctx && mId) {
              state.modelContextWindows[mId] = ctx;
            }
            if (mId) {
              var modVal = item.modality || '';
              if (!modVal) {
                if (/(?:^|[-_])video(?:[-_]|$)|sora|kling|runway|cogvideo|luma|pika/i.test(mId)) modVal = 'video';
                else if (/(?:^|[-_])image(?:[-_]|$)|dall-?e|imagen|flux|stable-diffusion|sdxl/i.test(mId)) modVal = 'image';
                else if (/(?:^|[-_])embed(?:ding)?(?:[-_]|$)|text-similarity|bge-/i.test(mId)) modVal = 'embedding';
                else modVal = 'chat';
              }
              state.modelModalities[mId] = modVal;
            }
          } else if (item) {
            var itemStr = String(item);
            parsedModels.push(itemStr);
            var modVal2 = 'chat';
            if (/(?:^|[-_])video(?:[-_]|$)|sora|kling|runway|cogvideo|luma|pika/i.test(itemStr)) modVal2 = 'video';
            else if (/(?:^|[-_])image(?:[-_]|$)|dall-?e|imagen|flux|stable-diffusion|sdxl/i.test(itemStr)) modVal2 = 'image';
            else if (/(?:^|[-_])embed(?:ding)?(?:[-_]|$)|text-similarity|bge-/i.test(itemStr)) modVal2 = 'embedding';
            state.modelModalities[itemStr] = modVal2;
          }
        }
        state.modelsByProvider[currentProv] = parsedModels;
        try {
          localStorage.setItem('coderun_model_context_windows', JSON.stringify(state.modelContextWindows));
          localStorage.setItem('coderun_model_modalities', JSON.stringify(state.modelModalities));
        } catch (_) {}

        if (isActiveProvider) {
          state.isOnline = true;
          if (dot) {
            dot.className = "cr-status-dot";
            dot.title = "Online";
          }
          if (text) {
            text.textContent = "Online";
            text.title = "Online";
          }
        }
      } else {
        var errorMsg = message.error || "Unable to load models";
        state.providerErrors[currentProv] = errorMsg;
        if (!state.modelsByProvider[currentProv] || !state.modelsByProvider[currentProv].length) {
          state.modelsByProvider[currentProv] = [];
        }

        if (isActiveProvider) {
          state.isOnline = false;
          if (dot) {
            dot.className = "cr-status-dot offline";
            dot.title = errorMsg;
          }
          if (text) {
            text.textContent = "Offline";
            text.title = errorMsg;
          }
        }
        console.error("[CODERUN] Health check failed:", errorMsg, "Provider:", message.provider);
      }

      state.models = [];
      for (var provKey in state.modelsByProvider) {
        if (state.modelsByProvider[provKey] && state.modelsByProvider[provKey].length) {
          state.models = state.models.concat(state.modelsByProvider[provKey]);
        }
      }
      renderModelOptions();
      renderSavedProviders();
    }
    if (message.type === "permissionState") {
      state.alwaysDecisions = message.decisions || {};
    }
    if (message.type === "agentEvent" && message.event && message.event.type === "trace_updated") {
      var evTrace = message.event.trace;
      var evSessionId = message.event.sessionId || (evTrace && evTrace.sessionId);
      if (evTrace && evSessionId) {
        var parentSessionId = evTrace.parentSessionId || '';
        if (evTrace.agentType === 'subagent' && parentSessionId) {
          saveSubagentTraceToLocalStorage(parentSessionId, evTrace);
        } else {
          saveTraceToLocalStorage(evSessionId, evTrace);
        }
        var tracesContainer = document.getElementById("traces-area-container");
        if (tracesContainer && tracesContainer.style.display !== "none" && state.activeConversationId === evSessionId) {
          var allSessionTraces = JSON.parse(localStorage.getItem("coderun_traces_" + evSessionId) || "[]");
          if (allSessionTraces.length > 0) {
            state.activeTraceRunIndex = allSessionTraces.length - 1;
          }
          renderTracesView(tracesContainer);
        }
        if (evTrace.agentType === 'subagent' && parentSessionId && state.activeConversationId === parentSessionId) {
          var subagentsContainer = document.getElementById('subagents-area-container');
          var subagentTracesContainer = document.getElementById('subagent-traces-area-container');
          if (subagentsContainer && subagentsContainer.style.display !== 'none') renderSubagentsView(subagentsContainer);
          if (subagentTracesContainer && subagentTracesContainer.style.display !== 'none') renderSubagentTracesView(subagentTracesContainer);
        }
      }
    }
    if (message.type === "agentEvent" && message.event && message.event.type === "request_diff") {
      var diffEv = message.event;
      var diffParentSid = diffEv.parentSessionId || diffEv.rootSessionId || state.activeConversationId;
      if (diffEv.agentType === 'subagent' || diffEv.subagentId || diffEv.subagentName) {
        if (typeof window.saveSubagentDiff === 'function') {
          window.saveSubagentDiff(diffParentSid, diffEv);
        }
        var subAreaContainer = document.getElementById('subagents-area-container');
        if (subAreaContainer && subAreaContainer.style.display !== 'none' && state.activeConversationId === diffParentSid) {
          renderSubagentsView(subAreaContainer);
        }
      }
    }
    if (message.type === "agentEvent" && message.event && message.event.type === "stream_error") {
      var activeId = state.activeConversationId;
      var errMsg = message.event.error || "An error occurred";
      if (activeId) {
        try {
          var currentTraces = JSON.parse(localStorage.getItem("coderun_traces_" + activeId) || "[]");
          if (currentTraces.length > 0) {
            var lastTrace = currentTraces[currentTraces.length - 1];
            if (lastTrace.status === "running") {
              lastTrace.status = "failed";
              lastTrace.error = errMsg;
              if (!lastTrace.finalResponse) lastTrace.finalResponse = {};
              lastTrace.finalResponse.text = "❌ " + errMsg;
              lastTrace.finalResponse.error = errMsg;
              lastTrace.completedAt = Date.now();
              lastTrace.durationMs = lastTrace.completedAt - lastTrace.startedAt;
              localStorage.setItem("coderun_traces_" + activeId, JSON.stringify(currentTraces));
              var tc = document.getElementById("traces-area-container");
              if (tc && tc.style.display !== "none") {
                renderTracesView(tc);
              }
            }
          }
        } catch (_) {
          // Intentionally ignore storage write errors
        }
      }
    }
    if (message.type === "loadedTraces") {
      if (message.sessionId && message.traces && Array.isArray(message.traces)) {
        try {
          var incomingTraces = message.traces;
          var curSavedTraces = JSON.parse(localStorage.getItem("coderun_traces_" + message.sessionId) || "[]");
          var effectiveTraces = incomingTraces;
          if (incomingTraces.length === 0 && curSavedTraces.length > 0) {
            effectiveTraces = curSavedTraces;
          } else if (incomingTraces.length > 0 && curSavedTraces.length > 0) {
            var merged = curSavedTraces.slice();
            for (var mti = 0; mti < incomingTraces.length; mti++) {
              var inT = incomingTraces[mti];
              var inIdx = -1;
              for (var cti = 0; cti < merged.length; cti++) {
                if (merged[cti].id === inT.id) {
                  inIdx = cti;
                  break;
                }
              }
              if (inIdx >= 0) {
                merged[inIdx] = inT;
              } else {
                merged.push(inT);
              }
            }
            effectiveTraces = merged;
          }
          localStorage.setItem("coderun_traces_" + message.sessionId, JSON.stringify(effectiveTraces));
          var tContainer = document.getElementById("traces-area-container");
          if (tContainer && tContainer.style.display !== "none" && state.activeConversationId === message.sessionId) {
            renderTracesView(tContainer);
          }
        } catch (_) {
          // Intentionally ignore storage write errors
        }
      }
    }
    if (message.type === "loadedSubagents") {
      if (message.sessionId && message.subagents && Array.isArray(message.subagents)) {
        try {
          var incSubs = message.subagents;
          var curSubs = JSON.parse(localStorage.getItem("coderun_subagents_" + message.sessionId) || "[]");
          var mergedSubs = curSubs.slice();
          for (var is = 0; is < incSubs.length; is++) {
            var incSub = incSubs[is];
            var fIdx = -1;
            for (var cs = 0; cs < mergedSubs.length; cs++) {
              if (mergedSubs[cs].agentId === incSub.agentId || mergedSubs[cs].id === incSub.id || mergedSubs[cs].sessionId === incSub.sessionId) {
                fIdx = cs;
                break;
              }
            }
            if (fIdx >= 0) {
              var existingDiffs = (mergedSubs[fIdx].diffs || []).slice();
              var incomingDiffs = incSub.diffs || [];
              var mergedDiffs = existingDiffs.slice();
              for (var ind = 0; ind < incomingDiffs.length; ind++) {
                var incD = incomingDiffs[ind];
                var foundDiff = false;
                for (var md = 0; md < mergedDiffs.length; md++) {
                  if (mergedDiffs[md].id === incD.id) {
                    foundDiff = true;
                    if (mergedDiffs[md].status && mergedDiffs[md].status !== 'pending' && incD.status === 'pending') {
                      incD.status = mergedDiffs[md].status;
                    }
                    mergedDiffs[md] = Object.assign({}, mergedDiffs[md], incD);
                    break;
                  }
                }
                if (!foundDiff) {
                  mergedDiffs.push(incD);
                }
              }
              mergedSubs[fIdx] = Object.assign({}, mergedSubs[fIdx], incSub);
              if (mergedDiffs.length > 0) {
                mergedSubs[fIdx].diffs = mergedDiffs;
              }
            } else {
              mergedSubs.push(incSub);
            }
          }
          localStorage.setItem("coderun_subagents_" + message.sessionId, JSON.stringify(mergedSubs));
          var subContainer = document.getElementById("subagents-area-container");
          if (subContainer && subContainer.style.display !== "none" && state.activeConversationId === message.sessionId) {
            renderSubagentsView(subContainer);
          }
        } catch (_) {
          // Intentionally ignore storage write errors
        }
      }
    }
    if (message.type === "loadedSubagentTraces") {
      if (message.sessionId && message.traces && Array.isArray(message.traces)) {
        try {
          var incTraces = message.traces;
          var curSubTraces = JSON.parse(localStorage.getItem("coderun_subagent_traces_" + message.sessionId) || "[]");
          var mergedSubTraces = curSubTraces.slice();
          for (var st = 0; st < incTraces.length; st++) {
            var incT = incTraces[st];
            var sFound = -1;
            for (var cut = 0; cut < mergedSubTraces.length; cut++) {
              if (mergedSubTraces[cut].id === incT.id) {
                sFound = cut;
                break;
              }
            }
            if (sFound >= 0) {
              mergedSubTraces[sFound] = incT;
            } else {
              mergedSubTraces.push(incT);
            }
          }
          localStorage.setItem("coderun_subagent_traces_" + message.sessionId, JSON.stringify(mergedSubTraces));
          var subTracesContainer = document.getElementById("subagent-traces-area-container");
          if (subTracesContainer && subTracesContainer.style.display !== "none" && state.activeConversationId === message.sessionId) {
            renderSubagentTracesView(subTracesContainer);
          }
          var subagentsArea = document.getElementById("subagents-area-container");
          if (subagentsArea && subagentsArea.style.display !== "none" && state.activeConversationId === message.sessionId) {
            renderSubagentsView(subagentsArea);
          }
        } catch (_) {
          // Intentionally ignore storage write errors
        }
      }
    }
    if (message.type === "subagentEvent") {
      handleSubagentEvent(message);
    }
    if (message.type === "rulesLoaded") {
      var globalEl = document.getElementById("rulesGlobalTextarea");
      var wsEl = document.getElementById("rulesWorkspaceTextarea");
      var wsPathEl = document.getElementById("rulesWorkspacePath");
      var globalPathEl = document.getElementById("rulesGlobalPath");
      if (globalEl) {
        globalEl.value = message.globalRules || '';
        updateRulesGutter("rulesGlobalTextarea", "rulesGlobalGutter");
      }
      if (wsEl) {
        wsEl.value = message.workspaceRules || '';
        updateRulesGutter("rulesWorkspaceTextarea", "rulesWorkspaceGutter");
      }
      if (message.globalPath) {
        state.globalRulesPath = message.globalPath;
        if (globalPathEl) {
          globalPathEl.textContent = message.globalPath;
          globalPathEl.title = message.globalPath;
        }
      }
      if (wsPathEl) {
        if (message.hasWorkspace && message.workspacePath) {
          state.workspaceRulesPath = message.workspacePath;
          wsPathEl.textContent = message.workspacePath;
          wsPathEl.title = message.workspacePath;
          wsPathEl.classList.remove("disabled");
          if (wsEl) wsEl.disabled = false;
          var wsBtn = document.getElementById("saveWorkspaceRulesBtn");
          if (wsBtn) wsBtn.disabled = false;
        } else {
          wsPathEl.textContent = 'No workspace open';
          wsPathEl.title = 'Open a workspace folder to set project rules';
          wsPathEl.classList.add("disabled");
          if (wsEl) {
            wsEl.disabled = true;
            wsEl.placeholder = 'Open a workspace folder to set project rules';
          }
          var wsBtnDisabled = document.getElementById("saveWorkspaceRulesBtn");
          if (wsBtnDisabled) wsBtnDisabled.disabled = true;
        }
      }
      if (globalEl && globalEl.value) {
        setRulesStatus("global", "saved");
      } else {
        setRulesStatus("global", "clean");
      }
      if (wsEl && wsEl.value) {
        setRulesStatus("workspace", "saved");
      } else {
        setRulesStatus("workspace", "clean");
      }
    }
    if (message.type === "mcpServersLoaded") {
      state.mcpServers = message.servers || [];
      if (message.builtinAgentTools) {
        state.builtinAgentTools = message.builtinAgentTools;
      }
      renderMcpPanel(state.mcpServers, state.builtinAgentTools);
      closeAddMcpModal();
    }
    if (message.type === "mcpServerError") {
      var mcpErrEl = document.getElementById("mcpModalError");
      if (mcpErrEl) {
        mcpErrEl.textContent = message.error || "An error occurred while connecting to MCP server.";
        mcpErrEl.style.display = "block";
        mcpErrEl.style.color = "#f48771";
      }
    }
    if (message.type === "undoCheckpointResult" && message.filePath) {
      if (typeof window !== "undefined" && window.updateActionsBarStatus) {
        window.updateActionsBarStatus(message.filePath, message.success ? "Restored" : "Failed", message.checkpointId);
      }
    }
    if (message.type === "mediaSavedResult") {
      var allSaveBtns = document.querySelectorAll(".cr-btn-save-media");
      for (var bi = 0; bi < allSaveBtns.length; bi++) {
        var b = allSaveBtns[bi];
        var bPath = b.dataset.mediaPath || b.getAttribute("data-media-path") || "";
        if (b.dataset.saving === "true" || (message.sourcePath && bPath === message.sourcePath)) {
          b.dataset.saving = "false";
          var origHtml = b.dataset.origHtml || "📥 Save to Project";
          if (message.success) {
            b.innerHTML = "✓ Saved to " + (message.relPath || "workspace");
            b.classList.add("cr-btn-saved");
            function createResetSavedTimer(targetBtn, defaultText) {
              setTimeout(function onResetSaved() {
                targetBtn.innerHTML = defaultText;
                targetBtn.classList.remove("cr-btn-saved");
              }, 4000);
            }
            createResetSavedTimer(b, origHtml);
          } else {
            b.innerHTML = "❌ " + (message.error || "Failed to save");
            function createResetErrTimer(targetBtn, defaultText) {
              setTimeout(function onResetErr() {
                targetBtn.innerHTML = defaultText;
              }, 4000);
            }
            createResetErrTimer(b, origHtml);
          }
        }
      }
    }
    if (message.type === "mediaDataResult") {
      if (message.success && message.dataUri) {
        var cleanTarget = String(message.path || "").split("?")[0];
        var targetBase = cleanTarget.split("/").pop().split("\\").pop();
        for (var pmi = 0; pmi < pendingMediaImages.length; pmi++) {
          var item = pendingMediaImages[pmi];
          if (item && item.element) {
            var itemSrc = String(item.src || "").split("?")[0];
            var itemBase = itemSrc.split("/").pop().split("\\").pop();
            if (itemSrc === cleanTarget || itemBase === targetBase || (message.resolvedPath && itemSrc.indexOf(targetBase) !== -1)) {
              item.element.src = message.dataUri;
            }
          }
        }
        var allMedia = document.querySelectorAll("img.md-img, video.cr-media-video");
        for (var aii = 0; aii < allMedia.length; aii++) {
          var im = allMedia[aii];
          var imSrc = String(im.getAttribute("data-media-src") || im.src || "").split("?")[0];
          var imBase = imSrc.split("/").pop().split("\\").pop();
          if (imSrc === cleanTarget || imBase === targetBase) {
            im.src = message.dataUri;
          }
        }
      }
    }
  }
  window.addEventListener("message", handleWindowMessage);

  var pendingMediaImages = [];
  function requestMediaData(imgEl, rawSrc) {
    if (!imgEl || !rawSrc) return;
    pendingMediaImages.push({ element: imgEl, src: rawSrc });
    var api = window.VSCODE_API || window.vscode;
    if (api && api.postMessage) {
      api.postMessage({
        type: "getMediaData",
        path: rawSrc
      });
    }
  }
  window.requestMediaData = requestMediaData;

  function formatMediaTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return "0:00";
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  window.formatMediaTime = formatMediaTime;

  function bindVideoCardEvents(card) {
    if (!card || card.dataset.eventsBound === "1") return;
    card.dataset.eventsBound = "1";
    var video = card.querySelector("video.cr-media-video");
    if (!video) return;

    var playBtn = card.querySelector(".cr-vid-play");
    var overlayPlay = card.querySelector(".cr-video-overlay-play");
    var rewindBtn = card.querySelector(".cr-vid-rewind");
    var forwardBtn = card.querySelector(".cr-vid-forward");
    var progressInput = card.querySelector("input.cr-vid-progress");
    var progressFill = card.querySelector(".cr-vid-progress-fill");
    var timeCurrent = card.querySelector(".cr-vid-time-current");
    var timeDuration = card.querySelector(".cr-vid-time-duration");
    var muteBtn = card.querySelector(".cr-vid-mute");
    var fullscreenBtn = card.querySelector(".cr-vid-fullscreen");

    function updatePlayState() {
      if (video.paused) {
        if (playBtn) playBtn.textContent = "▶";
        if (overlayPlay) overlayPlay.style.display = "flex";
      } else {
        if (playBtn) playBtn.textContent = "⏸";
        if (overlayPlay) overlayPlay.style.display = "none";
      }
    }

    function togglePlayPause() {
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
      updatePlayState();
    }

    function onVideoLoadedMetadata() {
      if (timeDuration && video.duration) {
        timeDuration.textContent = formatMediaTime(video.duration);
      }
    }

    function onVideoTimeUpdate() {
      if (video.duration && !progressInput.dataset.dragging) {
        var pct = (video.currentTime / video.duration) * 100;
        if (progressInput) progressInput.value = pct;
        if (progressFill) progressFill.style.width = pct + "%";
        if (timeCurrent) timeCurrent.textContent = formatMediaTime(video.currentTime);
      }
    }

    function onVideoEnded() {
      if (playBtn) playBtn.textContent = "▶";
      if (overlayPlay) overlayPlay.style.display = "flex";
      if (progressInput) progressInput.value = 0;
      if (progressFill) progressFill.style.width = "0%";
    }

    video.addEventListener("loadedmetadata", onVideoLoadedMetadata);
    video.addEventListener("timeupdate", onVideoTimeUpdate);
    video.addEventListener("play", updatePlayState);
    video.addEventListener("pause", updatePlayState);
    video.addEventListener("ended", onVideoEnded);

    if (video.readyState >= 1) {
      onVideoLoadedMetadata();
    }

    if (playBtn) {
      playBtn.addEventListener("click", togglePlayPause);
    }
    if (overlayPlay) {
      overlayPlay.addEventListener("click", togglePlayPause);
    }
    var videoPreview = card.querySelector(".cr-video-preview");
    if (videoPreview) {
      function onPreviewClick(e) {
        if (e.target === videoPreview || e.target === video) {
          togglePlayPause();
        }
      }
      videoPreview.addEventListener("click", onPreviewClick);
    }

    if (rewindBtn) {
      function onRewindClick() {
        video.currentTime = Math.max(0, video.currentTime - 10);
        onVideoTimeUpdate();
      }
      rewindBtn.addEventListener("click", onRewindClick);
    }

    if (forwardBtn) {
      function onForwardClick() {
        var maxDur = video.duration || 0;
        video.currentTime = maxDur ? Math.min(maxDur, video.currentTime + 10) : (video.currentTime + 10);
        onVideoTimeUpdate();
      }
      forwardBtn.addEventListener("click", onForwardClick);
    }

    if (progressInput) {
      function onProgressInput() {
        progressInput.dataset.dragging = "1";
        var val = parseFloat(progressInput.value) || 0;
        if (progressFill) progressFill.style.width = val + "%";
        if (video.duration && timeCurrent) {
          var previewSec = (val / 100) * video.duration;
          timeCurrent.textContent = formatMediaTime(previewSec);
        }
      }

      function onProgressChange() {
        progressInput.dataset.dragging = "";
        var val = parseFloat(progressInput.value) || 0;
        if (video.duration) {
          video.currentTime = (val / 100) * video.duration;
        }
        if (progressFill) progressFill.style.width = val + "%";
      }

      progressInput.addEventListener("input", onProgressInput);
      progressInput.addEventListener("change", onProgressChange);
    }

    if (muteBtn) {
      function onMuteClick() {
        video.muted = !video.muted;
        muteBtn.textContent = video.muted ? "🔇" : "🔊";
      }
      muteBtn.addEventListener("click", onMuteClick);
    }

    if (fullscreenBtn) {
      function onFullscreenClick() {
        if (document.fullscreenElement) {
          if (document.exitFullscreen) document.exitFullscreen();
        } else {
          if (video.requestFullscreen) {
            video.requestFullscreen();
          } else if (card.requestFullscreen) {
            card.requestFullscreen();
          }
        }
      }
      fullscreenBtn.addEventListener("click", onFullscreenClick);
    }
  }

  function initAllVideoPlayers() {
    var cards = document.querySelectorAll(".cr-video-card[data-video-card='1']");
    for (var ci = 0; ci < cards.length; ci++) {
      bindVideoCardEvents(cards[ci]);
    }
  }
  window.initAllVideoPlayers = initAllVideoPlayers;

  document.addEventListener("click", function handleMediaClick(e) {
    var card = e.target.closest(".cr-video-card");
    if (card && card.dataset.eventsBound !== "1") {
      bindVideoCardEvents(card);
    }
    var saveBtn = e.target.closest(".cr-btn-save-media");
    if (saveBtn) {
      if (saveBtn.dataset.saving === "true") return;
      var mediaPath = saveBtn.dataset.mediaPath || saveBtn.getAttribute("data-media-path");
      if (mediaPath) {
        var cleanPath = mediaPath.split("?")[0].split("#")[0];
        var baseName = cleanPath.split("/").pop().split("\\").pop() || ("media_" + Date.now() + ".png");
        try {
          baseName = decodeURIComponent(baseName);
        } catch (_) {}
        var defaultRel = "assets/" + baseName;
        saveBtn.dataset.saving = "true";
        saveBtn.dataset.origHtml = saveBtn.innerHTML;
        saveBtn.innerHTML = "⏳ Saving to project...";
        var api = window.VSCODE_API || window.vscode;
        if (api && api.postMessage) {
          api.postMessage({
            type: "saveMediaToWorkspace",
            sourcePath: mediaPath,
            filePath: mediaPath,
            targetRelPath: defaultRel
          });
        }
      }
      return;
    }
    var copyBtn = e.target.closest(".cr-btn-copy-media");
    if (copyBtn) {
      var copyPath = copyBtn.dataset.mediaPath || copyBtn.getAttribute("data-media-path");
      if (copyPath && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(copyPath).then(function onCopied() {
          var oldText = copyBtn.textContent;
          copyBtn.textContent = "✓ Copied!";
          setTimeout(function resetCopied() { copyBtn.textContent = oldText; }, 2000);
        });
      }
      return;
    }
  });

  function getDashboardActiveConversationId() {
    return state.activeConversationId;
  }
  window.getDashboardActiveConversationId = getDashboardActiveConversationId;

  function selectDashboardConversation(id) {
    selectConversation(id);
  }
  window.selectDashboardConversation = selectDashboardConversation;

  function getDashboardConversations() {
    return state.conversations;
  }
  window.getDashboardConversations = getDashboardConversations;

  function saveDashboardConversations(convs) {
    if (convs) state.conversations = convs;
    saveConversations();
  }
  window.saveDashboardConversations = saveDashboardConversations;
  window.renderDashboardTraces = renderTracesView;
}

initializeDashboard();
