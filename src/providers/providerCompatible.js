import { handleApiResponseError, safeReadJson } from '../agents/utils.js';

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
    throw await handleApiResponseError(response, 'Compatible');
  }

  if (!response.body) {
    throw new Error('Compatible API Error: Response body is empty. The server may have returned an incomplete response.');
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
        } catch (e) { console.warn('[Compatible] Failed to parse SSE chunk:', e.message); }
      }
    }
  }
}

export async function listModels(config) {
  var baseUrl = config.baseUrl.replace(/\/+$/, '');
  var headers = {};
  if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;

  if (baseUrl.includes('cloudflare.com')) {
    try {
      var match = baseUrl.match(/\/accounts\/([^\/]+)/);
      if (match && match[1]) {
        var accountId = match[1];
        var cfUrl = 'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/ai/models/search?per_page=300';
        var res = await fetch(cfUrl, { headers: headers });
        if (res.ok) {
          var data = await safeReadJson(res, 'Compatible');
          if (data.result && Array.isArray(data.result)) {
            var models = [];
            for (var i = 0; i < data.result.length; i++) {
              models.push(data.result[i].name);
            }
            return models;
          }
        }
      }
    } catch (e) {
      console.warn('[CODERUN] Failed to fetch models from Cloudflare Search API:', e.message);
    }
  }

  var url = baseUrl + '/models';
  var res;
  try {
    res = await fetch(url, { headers: headers });
  } catch (e) {
    console.warn('[CODERUN] Failed to reach compatible endpoint:', e.message);
    return config.model ? [config.model] : [];
  }

  if (!res.ok) {
    throw await handleApiResponseError(res, 'Compatible');
  }

  var data = await safeReadJson(res, 'Compatible');
  var models = [];
  if (data.data) {
    for (var i = 0; i < data.data.length; i++) {
      models.push(data.data[i].id || data.data[i].name);
    }
  }
  return models;
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
  if (!res.ok) throw await handleApiResponseError(res, 'Compatible');
  var data = await safeReadJson(res, 'Compatible');
  var embeddingList = [];
  if (data.data) {
    for (var i = 0; i < data.data.length; i++) {
      embeddingList.push(data.data[i].embedding);
    }
  }
  return embeddingList;
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
  if (delta.thought) result.thinking = delta.thought;
  if (delta.tool_calls) result.tool_calls = delta.tool_calls;
  return result;
}

function convertMessages(messages) {
  var converted = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var msg = { role: m.role, content: m.content || '' };
    
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    
    if (m.tool_calls) {
      var convertedToolCalls = [];
      for (var tcIndex = 0; tcIndex < m.tool_calls.length; tcIndex++) {
        var tc = m.tool_calls[tcIndex];
        var args = tc.function?.arguments || tc.arguments || {};
        if (typeof args !== 'string') {
          try {
            args = JSON.stringify(args);
          } catch (_) {
            // Intentionally fall back to empty object JSON if serialization fails
            args = '{}';
          }
        }
        convertedToolCalls.push({
          id: tc.id,
          type: tc.type || 'function',
          function: {
            name: tc.function?.name || tc.name,
            arguments: args
          }
        });
      }
      msg.tool_calls = convertedToolCalls;
    }
    
    var rawImages = m.images || (m.image ? [m.image] : null);
    if (rawImages && !Array.isArray(rawImages)) rawImages = [rawImages];
    if (rawImages && rawImages.length) {
      var parts = [];
      if (m.content) parts.push({ type: 'text', text: m.content });
      for (var imgIdx = 0; imgIdx < rawImages.length; imgIdx++) {
        var img = rawImages[imgIdx];
        var dataUri = String(img).startsWith('data:') ? img : 'data:image/png;base64,' + img;
        parts.push({ type: 'image_url', image_url: { url: dataUri } });
      }
      msg.content = parts;
    }
    converted.push(msg);
  }
  return converted;
}