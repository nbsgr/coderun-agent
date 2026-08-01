// Dashboard.js — CodeRun Agent Dashboard
// Settings (provider, baseUrl, model, apiKey) are read from VS Code user settings.
// The backend is the single source of truth for provider configuration.

(function() {
  "use strict";

  var DEFAULT_BASE_URL = "http://localhost:11434";
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
          if (key === state.settings.provider) {
            hasCurrentAsCustom = true;
          }
        }
      }
      
      // If the current provider is compatible:XYZ but not saved yet
      if (state.settings.provider && state.settings.provider.startsWith('compatible:') && !hasCurrentAsCustom) {
        var name = state.settings.provider.substring(11);
        var type = state.settings.apiType || 'openai';
        var typeLabel = type === 'anthropic' ? 'Anthropic' : (type === 'gemini' ? 'Gemini' : 'Compatible');
        html += '<option value="' + esc(state.settings.provider) + '">' + esc(name) + ' (' + typeLabel + ')</option>';
      }
      
      html += '<option value="compatible">OpenAI/Anthropic/Gemini Compatible (New...)</option>';
      providerEl.innerHTML = html;
      providerEl.value = state.settings.provider || 'ollama';
    }

    var currentProvider = state.settings.provider || 'ollama';
    var isCompatible = currentProvider === 'compatible' || currentProvider.startsWith('compatible:');

    if (compNameGroup && compNameEl && compApiTypeGroup && compApiTypeEl) {
      if (isCompatible) {
        compNameGroup.style.display = 'flex';
        compApiTypeGroup.style.display = 'flex';
        if (currentProvider.startsWith('compatible:')) {
          compNameEl.value = currentProvider.substring(11);
          var saved = (state.savedProviderConfigs || {})[currentProvider] || {};
          compApiTypeEl.value = saved.apiType || 'openai';
        } else {
          compNameEl.value = '';
          compApiTypeEl.value = 'openai';
        }
      } else {
        compNameGroup.style.display = 'none';
        compApiTypeGroup.style.display = 'none';
        compNameEl.value = '';
        compApiTypeEl.value = 'openai';
      }
    }

    if (baseUrlEl) baseUrlEl.value = state.settings.baseUrl;

    // Check if the current selected provider has a saved key, otherwise show empty
    var configs = state.savedProviderConfigs || {};
    var hasApiKeyForCurrent = false;
    if (configs[currentProvider] && configs[currentProvider].apiKey) {
      hasApiKeyForCurrent = true;
    } else if (currentProvider === state.settings.provider && state.hasApiKey) {
      hasApiKeyForCurrent = true;
    }
    if (apiKeyEl) apiKeyEl.value = hasApiKeyForCurrent ? "••••••••" : "";

    if (modelEl) modelEl.value = state.settings.model;
    if (maxIterEl) maxIterEl.value = state.settings.maxIterations;
    if (streamingEl) streamingEl.checked = state.settings.streaming;
    if (showThinkingEl) showThinkingEl.checked = state.settings.showThinking;
    if (confirmEl) confirmEl.checked = state.settings.confirmDangerous;
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
      var url = cfg.baseUrl ? cfg.baseUrl.replace(/^https?:\/\//, '').substring(0, 30) : '(no URL)';
      html += '<div class="cr-saved-provider-item" data-provider="' + esc(prov) + '">' +
        '<span class="cr-saved-provider-name">' + hasKey + ' ' + esc(label) + '</span>' +
        '<span class="cr-saved-provider-url" title="' + esc(cfg.baseUrl || '') + '">' + esc(url) + '</span>' +
        '<button class="cr-saved-provider-load" title="Load this provider\'s settings">Load</button>' +
        '<button class="cr-saved-provider-remove" title="Remove this provider config">✕</button>' +
        '</div>';
    }
    section.innerHTML = html;

    var loadBtns = section.querySelectorAll('.cr-saved-provider-load');
    for (var li = 0; li < loadBtns.length; li++) {
      loadBtns[li].onclick = handleLoadProviderClick.bind(null, configs);
    }

    var removeBtns = section.querySelectorAll('.cr-saved-provider-remove');
    for (var ri = 0; ri < removeBtns.length; ri++) {
      removeBtns[ri].onclick = handleRemoveProviderClick.bind(null, configs);
    }
  }

  function handleLoadProviderClick(configs, e) {
    e.stopPropagation();
    var btn = e.currentTarget;
    var item = btn.closest('.cr-saved-provider-item');
    var prov = item ? item.dataset.provider : '';
    if (prov && configs[prov]) {
      loadProviderToForm(prov, configs[prov]);
    }
  }

  function handleRemoveProviderClick(configs, e) {
    e.stopPropagation();
    var btn = e.currentTarget;
    var item = btn.closest('.cr-saved-provider-item');
    var prov = item ? item.dataset.provider : '';
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
   * Load a saved provider's config into the settings form fields.
   */
  function loadProviderToForm(provider, cfg) {
    var providerEl = document.getElementById("cfgProvider");
    var baseUrlEl = document.getElementById("cfgBaseUrl");
    var apiKeyEl = document.getElementById("cfgApiKey");
    var modelEl = document.getElementById("cfgModel");
    if (providerEl) providerEl.value = provider;
    if (baseUrlEl) baseUrlEl.value = cfg.baseUrl || '';
    if (apiKeyEl) apiKeyEl.value = cfg.apiKey ? '••••••••' : '';
    if (modelEl) modelEl.value = cfg.model || '';
    state.settings.provider = provider;
    state.settings.baseUrl = cfg.baseUrl || '';
    state.hasApiKey = !!cfg.apiKey;
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
                    '<button id="stopGenerationBtn" class="cr-stop-gen-btn" title="Stop generation" style="display:none">Stop</button>' +
                  '</div>' +
                  '<div id="chat-area-container"></div>' +
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

    document.getElementById("stopGenerationBtn").onclick = handleStopGenerationClick;

    document.addEventListener("keydown", handleDocumentKeyDown);

    updateSettingsUI();
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

    var modelInput = document.getElementById("modelInput");
    if (modelInput) modelInput.value = model;

    var list = document.getElementById("modelDropdownList");
    if (list) list.style.display = "none";

    saveSelectedModel();
    updateModelBadge();
  }

  function handleCfgProviderChange() {
    var providerEl = document.getElementById("cfgProvider");
    var provider = providerEl ? providerEl.value : '';
    var compNameGroup = document.getElementById("cfgCompatibleNameGroup");
    var compNameEl = document.getElementById("cfgCompatibleName");
    var compApiTypeGroup = document.getElementById("cfgCompatibleApiTypeGroup");
    var compApiTypeEl = document.getElementById("cfgCompatibleApiType");
    
    var isCompatible = provider === 'compatible' || provider.startsWith('compatible:');
    if (compNameGroup && compNameEl && compApiTypeGroup && compApiTypeEl) {
      if (isCompatible) {
        compNameGroup.style.display = 'flex';
        compApiTypeGroup.style.display = 'flex';
        if (provider.startsWith('compatible:')) {
          compNameEl.value = provider.substring(11);
          var saved = (state.savedProviderConfigs || {})[provider] || {};
          compApiTypeEl.value = saved.apiType || 'openai';
        } else {
          compNameEl.value = '';
          compApiTypeEl.value = 'openai';
        }
      } else {
        compNameGroup.style.display = 'none';
        compApiTypeGroup.style.display = 'none';
        compNameEl.value = '';
        compApiTypeEl.value = 'openai';
      }
    }

    var defaults = {
      ollama: "http://localhost:11434",
      openai: "https://api.openai.com/v1",
      anthropic: "https://api.anthropic.com/v1",
      gemini: "https://generativelanguage.googleapis.com/v1beta",
      openrouter: "https://openrouter.ai/api/v1",
      xai: "https://api.x.ai/v1",
      groq: "https://api.groq.com/openai/v1",
      compatible: ""
    };
    
    var baseUrlEl = document.getElementById("cfgBaseUrl");
    if (baseUrlEl) {
      if (provider.startsWith('compatible:')) {
        var configs = state.savedProviderConfigs || {};
        if (configs[provider] && configs[provider].baseUrl) {
          baseUrlEl.value = configs[provider].baseUrl;
        } else {
          baseUrlEl.value = '';
        }
      } else if (defaults[provider] !== undefined) {
        baseUrlEl.value = defaults[provider];
      }
    }

    var apiKeyEl = document.getElementById("cfgApiKey");
    if (apiKeyEl) {
      if (provider.startsWith('compatible:')) {
        var configs = state.savedProviderConfigs || {};
        apiKeyEl.value = (configs[provider] && configs[provider].apiKey) ? "••••••••" : "";
      } else {
        apiKeyEl.value = "";
      }
    }

    var modelEl = document.getElementById("cfgModel");
    if (modelEl) {
      if (provider.startsWith('compatible:')) {
        var configs = state.savedProviderConfigs || {};
        modelEl.value = (configs[provider] && configs[provider].model) ? configs[provider].model : "";
      } else {
        modelEl.value = "";
      }
    }
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

    var newBaseUrl = document.getElementById("cfgBaseUrl").value.trim();
    var newApiKey = document.getElementById("cfgApiKey").value.trim();
    var newModel = document.getElementById("cfgModel").value.trim();
    var newMaxIter = parseInt(document.getElementById("cfgMaxIterations").value) || 20;
    var newStreaming = document.getElementById("cfgStreaming").checked;
    var newShowThinking = document.getElementById("cfgShowThinking").checked;
    var newConfirm = document.getElementById("cfgConfirmDangerous").checked;

    state.provider = newProvider;
    state.baseUrl = newBaseUrl || DEFAULT_BASE_URL;
    state.settings.provider = newProvider;
    state.settings.baseUrl = newBaseUrl || DEFAULT_BASE_URL;
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
          baseUrl: newBaseUrl || DEFAULT_BASE_URL,
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
          baseUrl: newBaseUrl || DEFAULT_BASE_URL,
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
      setTimeout(handleSaveSettingsTimeout.bind(null, button), 1200);
    }
    updateModelBadge();
    updateModelSelectValue();
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

    var newBaseUrl = document.getElementById("cfgBaseUrl").value.trim();
    var newApiKey = document.getElementById("cfgApiKey").value.trim();
    var newModel = document.getElementById("cfgModel").value.trim();
    var newMaxIter = parseInt(document.getElementById("cfgMaxIterations").value) || 20;
    var newStreaming = document.getElementById("cfgStreaming").checked;
    var newShowThinking = document.getElementById("cfgShowThinking").checked;
    var newConfirm = document.getElementById("cfgConfirmDangerous").checked;

    state.provider = newProvider;
    state.baseUrl = newBaseUrl || DEFAULT_BASE_URL;
    state.settings.provider = newProvider;
    state.settings.baseUrl = newBaseUrl || DEFAULT_BASE_URL;
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
          baseUrl: newBaseUrl || DEFAULT_BASE_URL,
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
          baseUrl: newBaseUrl || DEFAULT_BASE_URL,
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
      setTimeout(handleSaveSettingsTimeout.bind(null, button), 1200);
    }
    updateModelBadge();
    updateModelSelectValue();
  }

  function handleSaveSettingsTimeout(button) {
    button.textContent = "Save Settings";
  }

  function handleClearAllConvClick() {
    if (state.isVsCode && window.VSCODE_API) {
      window.VSCODE_API.postMessage({ type: "confirmClearAll" });
      return;
    }
    if (confirm("Delete all conversations?")) performClearAll();
  }

  function handleStopGenerationClick() {
    if (window.stopCurrentChatStream) window.stopCurrentChatStream();
    showStopButton(false);
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

    for (var p = 0; p < providers.length; p++) {
      var providerName = providers[p];
      var models = state.modelsByProvider[providerName];
      if (!models || !models.length) continue;

      var groupContainer = document.createElement("div");
      groupContainer.className = "cr-combobox-group";

      var header = document.createElement("div");
      header.className = "cr-combobox-group-header";
      header.dataset.provider = providerName;

      header.innerHTML = '<span class="cr-group-arrow">▶</span> ' + getProviderLabel(providerName) + ' models';
      header.onclick = handleGroupHeaderClick;
      groupContainer.appendChild(header);

      var itemsContainer = document.createElement("div");
      itemsContainer.className = "cr-combobox-group-items";
      itemsContainer.style.display = "none";

      for (var i = 0; i < models.length; i++) {
        var item = document.createElement("div");
        item.className = "cr-combobox-item";
        item.textContent = models[i];
        item.dataset.model = models[i];
        item.dataset.provider = providerName;
        item.onclick = handleModelItemClick;
        itemsContainer.appendChild(item);
      }
      groupContainer.appendChild(itemsContainer);
      list.appendChild(groupContainer);
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
    var items = this.nextElementSibling;
    var arrow = this.querySelector(".cr-group-arrow");
    if (items && arrow) {
      var isHidden = items.style.display === "none";
      items.style.display = isHidden ? "block" : "none";
      arrow.textContent = isHidden ? "▼" : "▶";
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
    showStopButton(true);
  }

  function handleChatStreamEnd() {
    showStopButton(false);
  }

  function handleChatStreamError() {
    showStopButton(false);
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

  function showStopButton(show) {
    var button = document.getElementById("stopGenerationBtn");
    if (button) button.style.display = show ? "inline-flex" : "none";
  }

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

    var message = { role: role, content: content || "", timestamp: Date.now() };
    if (extra.thinking) message.thinking = extra.thinking;
    if (extra.sources) message.sources = extra.sources;
    if (extra.image) message.image = extra.image;
    if (extra.images) message.images = extra.images;
    if (extra.tool_calls) message.tool_calls = extra.tool_calls;
    if (extra.tool_call_id) message.tool_call_id = extra.tool_call_id;
    if (extra.tool_name) message.tool_name = extra.tool_name;
    if (extra.result) message.result = extra.result;

    var last = conversation.messages[conversation.messages.length - 1];
    if (last && last.role === role) {
      if (content) last.content = content;
      if (message.thinking) last.thinking = message.thinking;
      if (message.sources) last.sources = message.sources;
      if (message.tool_calls) last.tool_calls = message.tool_calls;
      if (message.tool_name) last.tool_name = message.tool_name;
      if (message.result) last.result = message.result;
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

    var lastUserIdx = -1;
    for (var i = conversation.messages.length - 1; i >= 0; i--) {
      if (conversation.messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }

    var msgsToAppend = [];
    if (newMessages) {
      for (var k = 0; k < newMessages.length; k++) {
        if (newMessages[k]) msgsToAppend.push(newMessages[k]);
      }
    }

    if (lastUserIdx !== -1) {
      conversation.messages = conversation.messages.slice(0, lastUserIdx + 1).concat(msgsToAppend);
    } else {
      conversation.messages = conversation.messages.concat(msgsToAppend);
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
}());
