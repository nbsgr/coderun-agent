// providerOllama.js — Ollama API provider

export async function* chat(config, messages, tools) {
  var url = config.baseUrl.replace(/\/+$/, '') + '/api/chat';
  var body = {
    model: config.model,
    messages: messages,
    stream: true
  };
  if (tools && tools.length) body.tools = tools;

  var response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    var errText = await response.text();
    throw new Error('Ollama API Error: HTTP ' + response.status + ' - ' + errText);
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
  if (!res.ok) throw new Error('HTTP ' + res.status);
  var data = await res.json();
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
    var data = await res.json();
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