// providerAnthropic.js — Anthropic Claude API provider

export async function* chat(config, messages, tools) {
  var url = config.baseUrl.replace(/\/+$/, '') + '/messages';
  var headers = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01'
  };

  var systemMsg = messages.find(function(m) { return m.role === 'system'; });
  var chatMessages = messages.filter(function(m) { return m.role !== 'system'; });

  var body = {
    model: config.model,
    max_tokens: 4096,
    messages: convertMessages(chatMessages),
    stream: true
  };
  if (systemMsg) body.system = systemMsg.content;
  if (tools && tools.length) {
    body.tools = tools.map(function(t) {
      return {
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
      };
    });
  }

  var response = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    var err = await response.json().catch(function() { return {}; });
    throw new Error(err.error?.message || 'Anthropic Error: HTTP ' + response.status);
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
      if (!line || !line.startsWith('data: ')) continue;
      try {
        var data = JSON.parse(line.slice(6));
        yield parseChunk(data);
      } catch (e) {}
    }
  }
}

export async function listModels(config) {
  // Anthropic does not have a public models endpoint; return known models
  return [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307'
  ];
}

export async function embeddings(config, texts) {
  throw new Error('Embeddings not supported by Anthropic in this provider');
}

export async function images(config, prompt) {
  throw new Error('Image generation not supported by Anthropic');
}

function convertMessages(messages) {
  return messages.map(function(m) {
    var msg = { role: m.role === 'tool' ? 'user' : m.role, content: m.content };
    if (m.role === 'tool') {
      msg.content = [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }];
    }
    return msg;
  });
}

function parseChunk(data) {
  var result = {};
  if (data.type === 'content_block_delta') {
    if (data.delta.thinking) result.thinking = data.delta.thinking;
    if (data.delta.text) result.content = data.delta.text;
  }
  if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
    result.tool_calls = [{
      id: data.content_block.id,
      function: {
        name: data.content_block.name,
        arguments: data.content_block.input || {}
      }
    }];
  }
  return result;
}