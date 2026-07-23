import { handleApiResponseError, safeReadJson } from './utils.js';

export async function* chat(config, messages, tools) {
  var url = config.baseUrl.replace(/\/+$/, '') + '/api/chat';
  var body = {
    model: config.model,
    messages: convertMessages(messages),
    stream: true
  };
  if (tools && tools.length) body.tools = tools;

  var response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw await handleApiResponseError(response, 'Ollama');
  }

  if (!response.body) {
    throw new Error('Ollama API Error: Response body is empty. The server may have returned an incomplete response.');
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
      if (!line) continue;
      try {
        var data = JSON.parse(line);
        yield parseChunk(data);
      } catch (e) {
        // skip malformed lines
      }
    }
  }
}

export async function listModels(config) {
  var url = config.baseUrl.replace(/\/+$/, '') + '/api/tags';
  var res = await fetch(url);
  if (!res.ok) throw await handleApiResponseError(res, 'Ollama');
  var data = await safeReadJson(res, 'Ollama');
  return data.models ? data.models.map(function(m) { return m.name; }) : [];
}

export async function embeddings(config, texts) {
  var url = config.baseUrl.replace(/\/+$/, '') + '/api/embeddings';
  var results = [];
  for (var i = 0; i < texts.length; i++) {
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, prompt: texts[i] })
    });
    if (!res.ok) throw await handleApiResponseError(res, 'Ollama');
    var data = await safeReadJson(res, 'Ollama');
    results.push(data.embedding || []);
  }
  return results;
}

export async function images(config, prompt) {
  throw new Error('Image generation not supported by Ollama in this provider');
}

function parseChunk(data) {
  var result = {};
  if (data.message) {
    var msg = data.message;
    if (msg.thinking) result.thinking = msg.thinking;
    if (msg.content) result.content = msg.content;
    if (msg.tool_calls && msg.tool_calls.length) result.tool_calls = msg.tool_calls;
  }
  if (data.done) result.done = true;
  return result;
}

function convertMessages(messages) {
  return messages.map(function(m) {
    var msg = { role: m.role, content: m.content || '' };
    if (m.thinking) msg.thinking = m.thinking;
    
    // For Ollama tool role, name is required
    if (m.role === 'tool') {
      msg.name = m.tool_name || m.name || '';
    }
    
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    
    if (m.tool_calls) {
      msg.tool_calls = m.tool_calls.map(function(tc) {
        var args = tc.function?.arguments || tc.arguments || {};
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch (_) {
            console.error('[OLLAMA] Failed to parse tool call arguments:', args);
            args = {};
          }
        }
        return {
          id: tc.id,
          type: tc.type || 'function',
          function: {
            name: tc.function?.name || tc.name,
            arguments: args
          }
        };
      });
    }
    
    var rawImages = m.images || (m.image ? [m.image] : null);
    if (rawImages && !Array.isArray(rawImages)) rawImages = [rawImages];
    if (rawImages && rawImages.length) {
      msg.images = rawImages.map(function(img) {
        return String(img).replace(/^data:[^;]+;base64,/, '');
      });
    }
    return msg;
  });
}