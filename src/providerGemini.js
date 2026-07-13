// providerGemini.js — Google Gemini API provider

export async function* chat(config, messages, tools) {
  var model = config.model || 'gemini-1.5-pro';
  var url = config.baseUrl.replace(/\/+$/, '') + '/models/' + model + ':streamGenerateContent?key=' + config.apiKey;

  var contents = convertMessages(messages);
  var body = { contents: contents };
  if (tools && tools.length) {
    body.tools = [{ function_declarations: tools.map(function(t) {
      return {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters
      };
    })}];
  }

  var response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    var err = await response.json().catch(function() { return {}; });
    throw new Error(err.error?.message || 'Gemini Error: HTTP ' + response.status);
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
      } catch (e) {}
    }
  }
}

export async function listModels(config) {
  var url = config.baseUrl.replace(/\/+$/, '') + '/models?key=' + config.apiKey;
  try {
    var res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    return data.models ? data.models.map(function(m) { return m.name.split('/').pop(); }) : [];
  } catch (e) {
    console.warn('[CODERUN] Failed to fetch models from Gemini-Compatible endpoint:', e.message);
    return config.model ? [config.model] : ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash-exp'];
  }
}

export async function embeddings(config, texts) {
  var model = config.model || 'text-embedding-004';
  var url = config.baseUrl.replace(/\/+$/, '') + '/models/' + model + ':batchEmbedContents?key=' + config.apiKey;
  var res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: texts.map(function(t) { return { content: { parts: [{ text: t }] } }; })
    })
  });
  var data = await res.json();
  return data.embeddings ? data.embeddings.map(function(e) { return e.values; }) : [];
}

export async function images(config, prompt) {
  throw new Error('Image generation not supported by Gemini in this provider');
}

function convertMessages(messages) {
  var contents = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (m.role === 'system') {
      contents.push({ role: 'user', parts: [{ text: 'System: ' + m.content }] });
      continue;
    }
    var role = m.role === 'assistant' ? 'model' : 'user';
    if (m.role === 'tool') {
      role = 'user';
      contents.push({ role: role, parts: [{ text: 'Tool result (' + m.tool_call_id + '): ' + m.content }] });
    } else {
      contents.push({ role: role, parts: [{ text: m.content }] });
    }
  }
  return contents;
}

function parseChunk(data) {
  var result = {};
  if (data.candidates && data.candidates[0]) {
    var candidate = data.candidates[0];
    if (candidate.content && candidate.content.parts) {
      var contentParts = [];
      var thinkingParts = [];
      for (var i = 0; i < candidate.content.parts.length; i++) {
        var part = candidate.content.parts[i];
        
        var textVal = part.text || '';
        var thoughtVal = typeof part.thought === 'string' ? part.thought : '';
        
        if (part.thought === true || thoughtVal) {
          thinkingParts.push(textVal || thoughtVal);
        } else {
          contentParts.push(textVal);
        }
        
        if (part.functionCall) {
          result.tool_calls = result.tool_calls || [];
          result.tool_calls.push({
            id: part.functionCall.name + '_' + Date.now(),
            function: {
              name: part.functionCall.name,
              arguments: part.functionCall.args || {}
            }
          });
        }
      }
      var contentText = contentParts.join('');
      var thinkingText = thinkingParts.join('');
      if (contentText) result.content = contentText;
      if (thinkingText) result.thinking = thinkingText;
    }
  }
  return result;
}