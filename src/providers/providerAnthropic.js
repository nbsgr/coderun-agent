import { handleApiResponseError, safeReadJson } from '../agents/utils.js';

export async function* chat(config, messages, tools, reqOpts) {
  var baseUrl = (config.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
  var url = baseUrl + '/messages';
  var headers = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01'
  };

  var systemMsg = null;
  var chatMessages = [];
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].role === 'system') {
      systemMsg = messages[i];
    } else {
      chatMessages.push(messages[i]);
    }
  }

  var body = {
    model: config.model,
    max_tokens: 4096,
    messages: convertMessages(chatMessages),
    stream: true
  };
  if (systemMsg) body.system = systemMsg.content;
  if (tools && tools.length) {
    var anthropicTools = [];
    for (var ti = 0; ti < tools.length; ti++) {
      var t = tools[ti];
      anthropicTools.push({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
      });
    }
    body.tools = anthropicTools;
  }

  var response = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
    signal: reqOpts && reqOpts.signal
  });

  if (!response.ok) {
    throw await handleApiResponseError(response, 'Anthropic');
  }

  if (!response.body) {
    throw new Error('Anthropic API Error: Response body is empty. The server may have returned an incomplete response.');
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
        var parsed = parseChunk(data);
        if (parsed.content || parsed.thinking || parsed.tool_calls || parsed.usage) {
          yield parsed;
        }
      } catch (e) { console.warn('[Anthropic] Failed to parse SSE chunk:', e.message); }
    }
  }
}

export async function listModels(config) {
  if (config.provider && config.provider.startsWith('compatible')) {
    var baseUrl = (config.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    var url = baseUrl + '/models';
    var headers = {};
    if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;
    try {
      var res = await fetch(url, { headers: headers });
      if (!res.ok) {
        throw await handleApiResponseError(res, 'Anthropic');
      }
      var data = await safeReadJson(res, 'Anthropic');
      var models = [];
      if (data.data) {
        for (var i = 0; i < data.data.length; i++) {
          models.push(data.data[i].id || data.data[i].name);
        }
      }
      return models;
    } catch (e) {
      console.warn('[CODERUN] Failed to fetch models from Anthropic-Compatible endpoint:', e.message);
    }
    return config.model ? [config.model] : [];
  }
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
  var converted = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var role = m.role === 'tool' ? 'user' : m.role;
    var rawImages = m.images || (m.image ? [m.image] : null);
    if (rawImages && !Array.isArray(rawImages)) rawImages = [rawImages];

    if (m.role === 'tool') {
      converted.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }]
      });
      continue;
    }

    if (rawImages && rawImages.length) {
      var contentBlocks = [];
      if (m.content) {
        contentBlocks.push({ type: 'text', text: m.content });
      }
      for (var imgIdx = 0; imgIdx < rawImages.length; imgIdx++) {
        var img = rawImages[imgIdx];
        var cleanB64 = String(img).replace(/^data:[^;]+;base64,/, '');
        var mediaType = 'image/png';
        var match = String(img).match(/^data:([^;]+);base64,/);
        if (match && match[1]) mediaType = match[1];
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: cleanB64
          }
        });
      }
      converted.push({ role: role, content: contentBlocks });
      continue;
    }

    converted.push({ role: role, content: m.content || '' });
  }
  return converted;
}

function parseChunk(data) {
  var result = {};
  if (data.type === 'message_start' && data.message && data.message.usage) {
    result.usage = {
      prompt_tokens: data.message.usage.input_tokens || 0,
      completion_tokens: data.message.usage.output_tokens || 0,
      total_tokens: (data.message.usage.input_tokens || 0) + (data.message.usage.output_tokens || 0)
    };
  } else if (data.type === 'message_delta' && data.usage) {
    result.usage = {
      prompt_tokens: 0,
      completion_tokens: data.usage.output_tokens || 0,
      total_tokens: data.usage.output_tokens || 0
    };
  }
  if (data.type === 'content_block_delta') {
    if (data.delta.thinking) {
      result.thinking = data.delta.thinking;
      result.thinkingKey = 'thinking';
    }
    if (data.delta.text) result.content = data.delta.text;
    if (data.delta.type === 'input_json_delta' && data.delta.partial_json) {
      result.tool_calls = [{
        index: data.index,
        function: {
          arguments: data.delta.partial_json
        }
      }];
    }
  }
  if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
    result.tool_calls = [{
      id: data.content_block.id,
      function: {
        name: data.content_block.name,
        arguments: ''
      }
    }];
  }
  return result;
}