// providerGroq.js — Groq API provider (OpenAI-compatible with optimizations)
// Groq is fast inference for open-source models
// Base URL: https://api.groq.com/openai/v1

export async function* chat(config, messages, tools) {
  var url = config.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  var headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + config.apiKey
  };

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
    var err = await response.json().catch(function() { return {}; });
    var msg = err.error?.message || 'Groq Error: HTTP ' + response.status;
    // Groq-specific: some models don't support tools
    if (msg.includes('tool') || msg.includes('function')) {
      msg += '\n\nNote: Not all Groq models support tool use.\nTry: llama3-groq-70b-8192-tool-use-preview or llama3-groq-8b-8192-tool-use-preview';
    }
    throw new Error(msg);
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
  var url = config.baseUrl.replace(/\/+$/, '') + '/models';
  var res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + config.apiKey }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  var data = await res.json();
  return data.data ? data.data.map(function(m) { return m.id; }) : [];
}

export async function embeddings(config, texts) {
  throw new Error('Embeddings not supported by Groq in this provider');
}

export async function images(config, prompt) {
  throw new Error('Image generation not supported by Groq');
}

function parseChunk(data) {
  var result = {};
  var delta = data.choices?.[0]?.delta;
  if (!delta) return result;
  if (delta.content) result.content = delta.content;
  if (delta.thinking) result.thinking = delta.thinking;
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