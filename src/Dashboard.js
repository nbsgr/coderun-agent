// Dashboard.js — CodeRun Agent Dashboard
// Settings (provider, baseUrl, model, apiKey) are read from VS Code user settings.
// The backend is the single source of truth for provider configuration.

(function() {
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

  try {
    var storedPinned = localStorage.getItem("coderun_pinned_models");
    if (storedPinned) {
      state.pinnedModels = JSON.parse(storedPinned);
    }
  } catch (_) {
    state.pinnedModels = {};
  }

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
    if (vscodeSettings.hasApiKey !== undefined) state.hasApiKey = vscodeSettings.hasApiKey;

    updateSettingsUI();
    updateModelBadge();
    updateModelSelectValue();
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
      var hasKey = cfg.apiKey ? '🔑' : '○';
      var defaultUrl = PROVIDER_DEFAULT_URLS[prov] || '';
      var rawUrl = cfg.baseUrl || defaultUrl;
      var url = rawUrl ? rawUrl.replace(/^https?:\/\//, '').substring(0, 30) : '(no URL)';
      html += '<div class="cr-saved-provider-item" data-provider="' + esc(prov) + '">' +
        '<span class="cr-saved-provider-name" title="' + esc(label) + '">' + hasKey + ' ' + esc(label) + '</span>' +
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
    state.settings.apiKey = cfg.apiKey || '';
    state.hasApiKey = !!cfg.apiKey;
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
                    '<button id="viewNavChatsBtn" class="cr-view-nav-btn active">Chats</button>' +
                    '<button id="viewNavTracesBtn" class="cr-view-nav-btn">Traces</button>' +
                  '</div>' +
                  '<div id="chat-area-container"></div>' +
                  '<div id="traces-area-container" style="display:none;"></div>' +
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
          '</main>' +
        '</div>' +
      '</div>'
    );
  }

  function initUI() {
    document.getElementById("rail-toggle").onclick = toggleSidebar;
    document.getElementById("rail-chat").onclick = handleRailChatClick;
    document.getElementById("rail-settings").onclick = handleRailSettingsClick;
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

    document.addEventListener("keydown", handleDocumentKeyDown);

    updateSettingsUI();
  }

  function handleViewNavChatsClick() {
    switchSubView("chats");
  }

  function handleViewNavTracesClick() {
    switchSubView("traces");
  }

  function switchSubView(viewName) {
    var chatsBtn = document.getElementById("viewNavChatsBtn");
    var tracesBtn = document.getElementById("viewNavTracesBtn");
    var chatArea = document.getElementById("chat-area-container");
    var tracesArea = document.getElementById("traces-area-container");

    if (viewName === "traces") {
      if (chatsBtn) chatsBtn.classList.remove("active");
      if (tracesBtn) tracesBtn.classList.add("active");
      if (chatArea) chatArea.style.display = "none";
      if (tracesArea) {
        tracesArea.style.display = "flex";
        renderTracesView(tracesArea);
        if (state.activeConversationId && state.isVsCode && window.VSCODE_API) {
          window.VSCODE_API.postMessage({ type: "getTraces", sessionId: state.activeConversationId });
        }
      }
    } else {
      if (chatsBtn) chatsBtn.classList.add("active");
      if (tracesBtn) tracesBtn.classList.remove("active");
      if (chatArea) chatArea.style.display = "flex";
      if (tracesArea) tracesArea.style.display = "none";
    }
  }

  function renderTracesView(container) {
    if (!container) return;
    var activeId = state.activeConversationId;
    var traces = [];
    try {
      if (activeId) {
        traces = JSON.parse(localStorage.getItem("coderun_traces_" + activeId) || "[]");
      }

      var hasValidTraces = false;
      if (traces && traces.length > 0) {
        for (var vi = 0; vi < traces.length; vi++) {
          if (traces[vi] && traces[vi].user && traces[vi].user.query) {
            hasValidTraces = true;
            break;
          }
        }
      }

      if (!hasValidTraces && activeId && state.conversations) {
        for (var c = 0; c < state.conversations.length; c++) {
          if (state.conversations[c].id === activeId) {
            traces = reconstructTracesFromConversation(state.conversations[c]);
            if (traces && traces.length) {
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
    } catch (_) {
      traces = [];
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
        setTimeout(function() {
          btnElement.textContent = originalText;
        }, 1500);
      }
    } catch (_) {
      // Intentionally ignore clipboard write errors
    }
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
            '<span class="cr-trace-status-mark">' + successMark + '</span> ' + esc(toolCall.output || 'No output') +
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
        // Mark any existing running turns as completed before pushing new run
        for (var k = 0; k < existing.length; k++) {
          if (existing[k].status === "running") {
            existing[k].status = existing[k].error ? "failed" : "completed";
            if (!existing[k].completedAt) existing[k].completedAt = Date.now();
            if (!existing[k].durationMs) existing[k].durationMs = existing[k].completedAt - (existing[k].startedAt || existing[k].completedAt);
          }
        }
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
            currentRun.status = 'completed';
            currentRun.completedAt = msg.timestamp || Date.now();
            currentRun.durationMs = currentRun.completedAt - currentRun.startedAt;
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
                decision: stepTools.map(function(st) { return 'Call ' + st.toolName; }).join(', '),
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

  function handleModelInputClick(e) {
    if (e) e.stopPropagation();
    var list = document.getElementById("modelDropdownList");
    if (list) {
      var isHidden = list.style.display === "none";
      list.style.display = isHidden ? "block" : "none";
      if (isHidden) {
        var filterInput = document.getElementById("modelFilterInput");
        if (filterInput) {
          setTimeout(function() {
            filterInput.focus();
            filterInput.select();
          }, 40);
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
    if (list && !e.target.closest(".cr-combobox")) {
      list.style.display = "none";
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
      state.settings.apiKey = saved.apiKey || '';
      state.settings.model = saved.model || '';
      state.settings.apiType = saved.apiType || 'openai';
      state.hasApiKey = !!saved.apiKey;
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
      var savedConfigs = state.savedProviderConfigs || {};
      var hasExistingKey = savedConfigs[newProvider] && savedConfigs[newProvider].apiKey;

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
    if (data.models) {
      for (var i = 0; i < data.models.length; i++) {
        allModels.push(data.models[i].name);
      }
    }
    state.models = allModels;
    state.modelsByProvider = { ollama: allModels };
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

  function loadModels() {
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
    var isSelected = state.selectedModel === modelName && (state.selectedProvider === providerName || (!state.selectedProvider && providerName === 'ollama'));
    item.className = "cr-combobox-item" + (isSelected ? " active" : "") + (isPinned ? " is-pinned" : "");
    item.dataset.model = modelName;
    item.dataset.provider = providerName;
    item.onclick = handleModelItemClick;

    var nameSpan = document.createElement("span");
    nameSpan.className = "cr-model-name";
    nameSpan.textContent = modelName;
    nameSpan.title = modelName;
    item.appendChild(nameSpan);

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

    var providers = Object.keys(state.modelsByProvider || {});
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

    for (var p = 0; p < providers.length; p++) {
      var providerName = providers[p];
      var models = state.modelsByProvider[providerName];
      if (!models || !models.length) continue;

      var filtered = [];
      for (var m = 0; m < models.length; m++) {
        if (!filterQuery || models[m].toLowerCase().indexOf(filterQuery) !== -1) {
          filtered.push(models[m]);
        }
      }
      if (!filtered.length) continue;
      totalMatches += filtered.length;

      var groupContainer = document.createElement("div");
      groupContainer.className = "cr-combobox-group";

      var isExpanded = filterQuery.length > 0 || !!state.openProviderGroups[providerName] || state.selectedProvider === providerName || (!state.selectedProvider && providerName === 'ollama');

      var header = document.createElement("div");
      header.className = "cr-combobox-group-header";
      header.dataset.provider = providerName;
      header.innerHTML = '<span class="cr-group-arrow">' + (isExpanded ? "▼" : "▶") + '</span> ' + getProviderLabel(providerName) + ' <span class="cr-group-count">(' + filtered.length + ')</span>';
      header.onclick = handleGroupHeaderClick;
      groupContainer.appendChild(header);

      var itemsContainer = document.createElement("div");
      itemsContainer.className = "cr-combobox-group-items";
      itemsContainer.style.display = isExpanded ? "block" : "none";

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

    if (totalMatches === 0) {
      var emptyItem = document.createElement("div");
      emptyItem.className = "cr-combobox-item empty";
      emptyItem.textContent = "No models match '" + filterQuery + "'";
      list.appendChild(emptyItem);
    }

    // Determine current model
    if (!state.selectedModel || !modelExists(state.selectedModel)) {
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
      state.selectedModel = foundModel;
      state.selectedProvider = foundProvider;
      saveSelectedModel();
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
        item.innerHTML =
          '<span class="cr-thread-title">' + esc(conversation.title || "New chat") + '</span>' +
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

  function selectConversation(id) {
    state.activeConversationId = id || null;
    state.renamingId = null;
    saveStateToVscode();
    renderSidebar();

    var container = document.getElementById("chat-area-container");
    if (!container) return;

    if (!id) {
      container.innerHTML =
        '<div class="cr-empty-chat">' +
          '<div class="cr-empty-mark">R</div>' +
          '<p class="cr-empty-chat-title">Ask CodeRun about this workspace</p>' +
          '<p class="cr-empty-chat-sub">Choose a model, then ask about code, files, terminal commands, or anything else.</p>' +
        '</div>';
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
    var remaining = [];
    for (var i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id !== id) {
        remaining.push(state.conversations[i]);
      }
    }
    state.conversations = remaining;
    if (state.activeConversationId === id) {
      state.activeConversationId = state.conversations[0] ? state.conversations[0].id : null;
    }
    saveConversations();
    renderSidebar();
    selectConversation(state.activeConversationId);
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
      state.isOnline = message.online;
      var dot = document.getElementById("status-dot");
      var text = document.getElementById("status-text");
      if (message.online && message.models) {
        if (dot) dot.className = "cr-status-dot";
        if (text) text.textContent = "Online";
        if (!state.modelsByProvider) state.modelsByProvider = {};
        state.modelsByProvider[message.provider || "ollama"] = message.models;
        state.models = [];
        for (var provKey in state.modelsByProvider) {
          if (state.modelsByProvider[provKey] && state.modelsByProvider[provKey].length) {
            state.models = state.models.concat(state.modelsByProvider[provKey]);
          }
        }
        renderModelOptions();
      } else {
        if (dot) dot.className = "cr-status-dot offline";
        if (text) text.textContent = "Offline";
        var list = document.getElementById("modelDropdownList");
        var errorMsg = message.error || "Unable to load models";
        if (list && (!state.models || !state.models.length)) {
          list.innerHTML = '<div class="cr-combobox-item empty">No models available</div>';
        }
        console.error("[CODERUN] Health check failed:", errorMsg, "Provider:", message.provider);
      }
    }
    if (message.type === "permissionState") {
      state.alwaysDecisions = message.decisions || {};
    }
    if (message.type === "agentEvent" && message.event && message.event.type === "trace_updated") {
      var evTrace = message.event.trace;
      var evSessionId = message.event.sessionId || (evTrace && evTrace.sessionId);
      if (evTrace && evSessionId) {
        saveTraceToLocalStorage(evSessionId, evTrace);
        var tracesContainer = document.getElementById("traces-area-container");
        if (tracesContainer && tracesContainer.style.display !== "none" && state.activeConversationId === evSessionId) {
          var allSessionTraces = JSON.parse(localStorage.getItem("coderun_traces_" + evSessionId) || "[]");
          if (allSessionTraces.length > 0) {
            state.activeTraceRunIndex = allSessionTraces.length - 1;
          }
          renderTracesView(tracesContainer);
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
          localStorage.setItem("coderun_traces_" + message.sessionId, JSON.stringify(message.traces));
          var tContainer = document.getElementById("traces-area-container");
          if (tContainer && tContainer.style.display !== "none" && state.activeConversationId === message.sessionId) {
            renderTracesView(tContainer);
          }
        } catch (_) {
          // Intentionally ignore storage write errors
        }
      }
    }
  }
  window.addEventListener("message", handleWindowMessage);

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
}());
