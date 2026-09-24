import OpenAI from 'openai';
import { extractModelModality } from './modelClassifier.js';

function createClient(config) {
  var baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : 'https://openrouter.ai/api/v1';
  if (baseUrl && !baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = 'https://' + baseUrl;
  }
  return new OpenAI({
    baseURL: baseUrl,
    apiKey: config.apiKey || '',
    timeout: 30000,
    maxRetries: 2,
    defaultHeaders: {
      'HTTP-Referer': 'https://coderun-agent.dev',
      'X-Title': 'CodeRun Agent',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
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

  var hasStreamedThinking = false;
  try {
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
  } catch (err) {
    var msg = err.message || String(err);
    if (msg.indexOf('No endpoints found') !== -1 || msg.indexOf('tool use') !== -1 || msg.indexOf('tool') !== -1) {
      msg += '\n\nThis model does not support tool/function calling on OpenRouter.' +
             '\nPlease use a model that supports tools, such as:' +
             '\n  - anthropic/claude-3.5-sonnet' +
             '\n  - openai/gpt-4o' +
             '\n  - openai/gpt-4o-mini' +
             '\n  - google/gemini-1.5-pro' +
             '\n\nOr switch to a different provider (OpenAI, Anthropic, Ollama).';
    }
    throw new Error(msg);
  }
}

export async function listModels(config) {
  var baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : 'https://openrouter.ai/api/v1';
  if (baseUrl && !baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = 'https://' + baseUrl;
  }
  var modelsUrl = baseUrl + '/models';
  var headers = {
    'HTTP-Referer': 'https://coderun-agent.dev',
    'X-Title': 'CodeRun Agent'
  };
  if (config.apiKey) {
    headers['Authorization'] = 'Bearer ' + config.apiKey;
  }
  var res = await fetch(modelsUrl, { headers: headers });
  if (!res.ok) {
    throw new Error('OpenRouter /models request failed: ' + res.status + ' ' + res.statusText);
  }
  var data = await res.json();
  var models = [];
  var list = data.data || data.models || [];
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    var mId = m.id || m.name || '';
    if (!mId) continue;
    var ctx = m.context_length || m.context_window || 0;
    models.push({
      id: mId,
      modality: extractModelModality(m),
      context_window: ctx,
      raw: m
    });
  }
  return models;
}

export async function embeddings(config, texts) {
  throw new Error('Embeddings not supported by OpenRouter in this provider');
}

export async function images(config, prompt) {
  throw new Error('Image generation not supported by OpenRouter in this provider');
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
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;

    if (m.thinking) {
      var tKey = m.thinkingKey || 'reasoning_content';
      msg[tKey] = m.thinking;
    }
    if (m.reasoning) msg.reasoning = m.reasoning;
    if (m.reasoning_content) msg.reasoning_content = m.reasoning_content;
    if (m.thought) msg.thought = m.thought;

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