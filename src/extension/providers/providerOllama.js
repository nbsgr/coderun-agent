import OpenAI from 'openai';
import { handleApiResponseError, safeReadJson } from '../agents/utils.js';

function getCleanOllamaBaseUrl(baseUrl) {
  var clean = String(baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  if (clean.endsWith('/v1')) {
    clean = clean.substring(0, clean.length - 3);
  }
  return clean;
}

function getV1OllamaBaseUrl(baseUrl) {
  var clean = getCleanOllamaBaseUrl(baseUrl);
  return clean + '/v1';
}

function createClient(config) {
  return new OpenAI({
    baseURL: getV1OllamaBaseUrl(config.baseUrl),
    apiKey: config.apiKey || 'ollama',
    timeout: 600000,
    maxRetries: 0,
    dangerouslyAllowBrowser: true
  });
}

export async function* chat(config, messages, tools, reqOpts) {
  var client = createClient(config);
  var body = {
    model: config.model,
    messages: convertMessages(messages),
    stream: true,
    stream_options: { include_usage: true }
  };
  if (tools && tools.length) body.tools = tools;

  var requestOptions = (reqOpts && reqOpts.signal) ? { signal: reqOpts.signal } : undefined;
  var hasStreamedThinking = false;
  var stream = await client.chat.completions.create(body, requestOptions);

  for await (var chunk of stream) {
    var parsed = parseChunk(chunk);
    if (parsed.thinking) {
      if (parsed._isSummary && hasStreamedThinking) {
        delete parsed.thinking;
        delete parsed.thinkingKey;
      } else {
        hasStreamedThinking = true;
      }
    }
    if (parsed.content || parsed.thinking || parsed.tool_calls || parsed.usage) {
      yield parsed;
    }
  }
}

export async function listModels(config) {
  // Try native /api/tags first — raw fetch preserves context_length in details
  try {
    var baseUrl = getCleanOllamaBaseUrl(config.baseUrl);
    var url = baseUrl + '/api/tags';
    var res = await fetch(url);
    if (res.ok) {
      var data = await safeReadJson(res, 'Ollama');
      var tagModels = [];
      if (data.models) {
        for (var j = 0; j < data.models.length; j++) {
          var item = data.models[j];
          var name = item.name;
          var ctx2 = (item.details && item.details.context_length) || item.context_length || 0;
          if (ctx2) {
            tagModels.push({ id: name, context_window: ctx2 });
          } else {
            tagModels.push(name);
          }
        }
      }
      if (tagModels.length) return tagModels;
    }
  } catch (_) {
    // Fall through to OpenAI SDK path
  }

  try {
    var client = createClient(config);
    var response = await client.models.list();
    var models = [];
    if (response && response.data) {
      for (var i = 0; i < response.data.length; i++) {
        var mItem = response.data[i];
        var mId = mItem.id || mItem.name;
        models.push(mId);
      }
      if (models.length) return models;
    }
  } catch (_2) {
    // Both paths failed
  }

  throw new Error('Could not list Ollama models. Check that Ollama is running.');
}

export async function embeddings(config, texts) {
  try {
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
      return embeddingList;
    }
  } catch (_) {
    // Fallback to native /api/embeddings
  }

  var baseUrl = getCleanOllamaBaseUrl(config.baseUrl);
  var url = baseUrl + '/api/embeddings';
  var results = [];
  for (var k = 0; k < texts.length; k++) {
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, prompt: texts[k] })
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

function extractThinkingValue(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    if (typeof val.content === 'string') return val.content;
    if (typeof val.text === 'string') return val.text;
    if (Array.isArray(val)) {
      var parts = [];
      for (var i = 0; i < val.length; i++) {
        var part = val[i];
        if (typeof part === 'string') parts.push(part);
        else if (part && typeof part.text === 'string') parts.push(part.text);
      }
      return parts.join('');
    }
  }
  return '';
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
  var choice = data && data.choices && data.choices[0];
  var delta = choice ? (choice.delta || choice.message) : null;
  if (!delta) return result;

  if (delta.content) result.content = delta.content;

  if (delta.reasoning) {
    result.thinking = extractThinkingValue(delta.reasoning);
    result.thinkingKey = 'reasoning';
  } else if (delta.reasoning_content) {
    result.thinking = extractThinkingValue(delta.reasoning_content);
    result.thinkingKey = 'reasoning_content';
  } else if (delta.thinking) {
    result.thinking = extractThinkingValue(delta.thinking);
    result.thinkingKey = 'thinking';
  } else if (delta.thought) {
    result.thinking = extractThinkingValue(delta.thought);
    result.thinkingKey = 'thought';
  }

  if (delta.tool_calls) result.tool_calls = delta.tool_calls;

  if (!result.thinking) {
    var topVal = (data && (data.reasoning_content || data.reasoning || data.thinking || data.thought)) ||
                 (choice && (choice.reasoning_content || choice.reasoning || choice.thinking || choice.thought));
    if (topVal) {
      var topText = extractThinkingValue(topVal);
      if (topText) {
        result.thinking = topText;
        result.thinkingKey = (data && data.reasoning_content) ? 'reasoning_content' :
                             ((data && data.reasoning) ? 'reasoning' :
                             ((data && data.thinking) ? 'thinking' : 'thought'));
      }
    } else {
      var topSummary = (data && data.reasoning_summary) || (choice && choice.reasoning_summary) || (delta && delta.reasoning_summary);
      if (topSummary) {
        var summaryText = extractThinkingValue(topSummary);
        if (summaryText) {
          result.thinking = summaryText;
          result.thinkingKey = 'reasoning_content';
          result._isSummary = true;
        }
      }
    }
  }

  return result;
}

function convertMessages(messages) {
  var converted = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var msg = { role: m.role, content: m.content || '' };

    if (m.role === 'tool') {
      msg.name = m.tool_name || m.name || '';
    }

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