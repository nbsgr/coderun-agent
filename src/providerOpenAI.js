// providerOpenAI.js — OpenAI API provider

export async function* chat(config, messages, tools) {
  var url = config.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  var headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + config.apiKey
  };
  if (config.organization) headers['OpenAI-Organization'] = config.organization;
  if (config.project) headers['OpenAI-Project'] = config.project;

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
    throw new Error(err.error?.message || 'OpenAI Error: HTTP ' + response.status);
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
  var url = config.baseUrl.replace(/\/+$/, '') + '/embeddings';
  var res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + config.apiKey
    },
    body: JSON.stringify({ model: config.model || 'text-embedding-3-small', input: texts })
  });
  var data = await res.json();
  return data.data ? data.data.map(function(d) { return d.embedding; }) : [];
}

export async function images(config, prompt) {
  var url = config.baseUrl.replace(/\/+$/, '') + '/images/generations';
  var res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + config.apiKey
    },
    body: JSON.stringify({ model: config.model || 'dall-e-3', prompt: prompt, n: 1 })
  });
  var data = await res.json();
  return data.data ? data.data[0].url : null;
}

function convertMessages(messages) {
  return messages.map(function(m) {
    var msg = { role: m.role, content: m.content };
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    return msg;
  });
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