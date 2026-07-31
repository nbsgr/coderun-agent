import { handleApiResponseError, safeReadJson } from '../agents/utils.js';

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
    throw await handleApiResponseError(response, 'OpenAI');
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
        } catch (e) {
          // Intentionally ignored to allow safe execution fallback
        }
      }
    }
  }
}

export async function listModels(config) {
  var url = config.baseUrl.replace(/\/+$/, '') + '/models';
  var res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + config.apiKey }
  });
  if (!res.ok) throw await handleApiResponseError(res, 'OpenAI');
  var data = await safeReadJson(res, 'OpenAI');
  var models = [];
  if (data.data) {
    for (var i = 0; i < data.data.length; i++) {
      models.push(data.data[i].id);
    }
  }
  return models;
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
  var data = await safeReadJson(res, 'OpenAI');
  var embeddingList = [];
  if (data.data) {
    for (var i = 0; i < data.data.length; i++) {
      embeddingList.push(data.data[i].embedding);
    }
  }
  return embeddingList;
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
  var data = await safeReadJson(res, 'OpenAI');
  return data.data ? data.data[0].url : null;
}

function convertMessages(messages) {
  var converted = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var msg = { role: m.role, content: m.content || '' };
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
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