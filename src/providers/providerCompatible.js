import OpenAI from 'openai';
import { handleApiResponseError, safeReadJson } from '../agents/utils.js';

function createClient(config) {
  return new OpenAI({
    baseURL: config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : '',
    apiKey: config.apiKey || 'dummy',
    dangerouslyAllowBrowser: true
  });
}

export async function* chat(config, messages, tools) {
  var client = createClient(config);
  var body = {
    model: config.model,
    messages: convertMessages(messages),
    stream: true,
    stream_options: { include_usage: true }
  };
  if (tools && tools.length) body.tools = tools;

  var stream = await client.chat.completions.create(body);

  for await (var chunk of stream) {
    var parsed = parseChunk(chunk);
    if (parsed.content || parsed.thinking || parsed.tool_calls || parsed.usage) {
      yield parsed;
    }
  }
}

export async function listModels(config) {
  var baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : '';
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

  try {
    var client = createClient(config);
    var response = await client.models.list();
    var modelList = [];
    if (response && response.data) {
      for (var j = 0; j < response.data.length; j++) {
        modelList.push(response.data[j].id || response.data[j].name);
      }
    }
    return modelList;
  } catch (e) {
    console.warn('[CODERUN] Failed to reach compatible endpoint via SDK:', e.message);
    return config.model ? [config.model] : [];
  }
}

export async function embeddings(config, texts) {
  var client = createClient(config);
  var response = await client.embeddings.create({
    model: config.model,
    input: texts
  });
  var embeddingList = [];
  if (response && response.data) {
    for (var i = 0; i < response.data.length; i++) {
      embeddingList.push(response.data[i].embedding);
    }
  }
  return embeddingList;
}

export async function images(config, prompt) {
  throw new Error('Image generation not supported by this provider');
}

function parseChunk(data) {
  var result = {};
  if (data && data.usage) {
    result.usage = {
      prompt_tokens: data.usage.prompt_tokens || 0,
      completion_tokens: data.usage.completion_tokens || 0,
      total_tokens: data.usage.total_tokens || 0
    };
  }
  var delta = data.choices && data.choices[0] ? data.choices[0].delta : null;
  if (!delta) return result;

  if (delta.content) result.content = delta.content;

  if (delta.reasoning) {
    result.thinking = delta.reasoning;
    result.thinkingKey = 'reasoning';
  } else if (delta.reasoning_content) {
    result.thinking = delta.reasoning_content;
    result.thinkingKey = 'reasoning_content';
  } else if (delta.thinking) {
    result.thinking = delta.thinking;
    result.thinkingKey = 'thinking';
  } else if (delta.thought) {
    result.thinking = delta.thought;
    result.thinkingKey = 'thought';
  }

  if (delta.tool_calls) result.tool_calls = delta.tool_calls;
  return result;
}

function convertMessages(messages) {
  var converted = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var msg = { role: m.role, content: m.content || '' };

    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;

    if (m.thinking) {
      var tKey = m.thinkingKey || 'reasoning_content';
      msg[tKey] = m.thinking;
    }
    if (m.reasoning) msg.reasoning = m.reasoning;
    if (m.reasoning_content) msg.reasoning_content = m.reasoning_content;
    if (m.thought) msg.thought = m.thought;

    if (m.tool_calls) {
      var convertedToolCalls = [];
      for (var tcIndex = 0; tcIndex < m.tool_calls.length; tcIndex++) {
        var tc = m.tool_calls[tcIndex];
        var args = tc.function?.arguments || tc.arguments || {};
        if (typeof args !== 'string') {
          try {
            args = JSON.stringify(args);
          } catch (_) {
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