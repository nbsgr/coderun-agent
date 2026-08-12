import OpenAI from 'openai';

function createClient(config) {
  return new OpenAI({
    baseURL: config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : 'https://openrouter.ai/api/v1',
    apiKey: config.apiKey || '',
    defaultHeaders: {
      'HTTP-Referer': 'https://coderun-agent.dev',
      'X-Title': 'CodeRun Agent'
    },
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

  try {
    var stream = await client.chat.completions.create(body);
    for await (var chunk of stream) {
      var parsed = parseChunk(chunk);
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
  var client = createClient(config);
  var response = await client.models.list();
  var models = [];
  if (response && response.data) {
    for (var i = 0; i < response.data.length; i++) {
      models.push(response.data[i].id);
    }
  }
  return models;
}

export async function embeddings(config, texts) {
  throw new Error('Embeddings not supported by OpenRouter in this provider');
}

export async function images(config, prompt) {
  throw new Error('Image generation not supported by OpenRouter in this provider');
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