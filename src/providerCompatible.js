// providerCompatible.js — Generic OpenAI-compatible provider
// Works with LM Studio, vLLM, LocalAI, and any OpenAI-compatible endpoint

export async function* chat(config, messages, tools) {
  var url = config.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  var headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;

  var body = {
    model: config.model,
    messages: convertMessages(messages),
    stream: true
  };
  if (tools && tools.length) body.tools = tools;

  var response = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    var err = await response.text();
    throw new Error('API Error: HTTP ' + response.status + ' - ' + err);
  }

  var reader = response.body.getReader();
  var decoder = new TextDecoder('utf-8');
  var buffer = '';

  while (true) {
    var chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    var lines = buffer.split('\n');
    buffer = lines.pop();
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line === 'data: [DONE]') continue;
      if (line.startsWith('data: ')) {
        try {
          var data = JSON.parse(line.slice(6));
          yield parseChunk(data);
        } catch (e) {}
      }
    }
  }
}

export async function listModels(config) {
  var baseUrl = config.baseUrl.replace(/\/+$/, '');
  var headers = {};
  if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;

  // Cloudflare Workers AI custom models endpoint handler
  if (baseUrl.includes('cloudflare.com')) {
    try {
      var match = baseUrl.match(/\/accounts\/([^\/]+)/);
      if (match && match[1]) {
        var accountId = match[1];
        var cfUrl = 'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/ai/models/search?per_page=300';
        var res = await fetch(cfUrl, { headers: headers });
        if (res.ok) {
          var data = await res.json();
          if (data.result && Array.isArray(data.result)) {
            return data.result.map(function(m) { return m.name; });
          }
        }
      }
    } catch (e) {
      console.warn('[CODERUN] Failed to fetch models from Cloudflare Search API:', e.message);
    }
  }

  var url = baseUrl + '/models';
  try {
    var res = await fetch(url, { headers: headers });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    return data.data ? data.data.map(function(m) { return m.id || m.name; }) : [];
  } catch (e) {
    console.warn('[CODERUN] Failed to fetch models from compatible endpoint:', e.message);
    // Fallback to currently configured model if available
    return config.model ? [config.model] : [];
  }
}

export async function embeddings(config, texts) {
  var url = config.baseUrl.replace(/\/+$/, '') + '/embeddings';
  var headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;
  var res = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ model: config.model, input: texts })
  });
  var data = await res.json();
  return data.data ? data.data.map(function(d) { return d.embedding; }) : [];
}

export async function images(config, prompt) {
  throw new Error('Image generation not supported by this provider');
}

function parseChunk(data) {
  var result = {};
  var delta = data.choices?.[0]?.delta;
  if (!delta) return result;
  if (delta.content) result.content = delta.content;
  if (delta.thinking) result.thinking = delta.thinking;
  if (delta.reasoning_content) result.thinking = delta.reasoning_content;
  if (delta.reasoning) result.thinking = delta.reasoning;
  if (delta.tool_calls) result.tool_calls = delta.tool_calls;
  return result;
}

function convertMessages(messages) {
  return messages.map(function(m) {
    var msg = { role: m.role, content: m.content || '' };
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    var rawImages = m.images || (m.image ? [m.image] : null);
    if (rawImages && rawImages.length) {
      var parts = [];
      if (m.content) parts.push({ type: 'text', text: m.content });
      rawImages.forEach(function(img) {
        var dataUri = String(img).startsWith('data:') ? img : 'data:image/png;base64,' + img;
        parts.push({ type: 'image_url', image_url: { url: dataUri } });
      });
      msg.content = parts;
    }
    return msg;
  });
}