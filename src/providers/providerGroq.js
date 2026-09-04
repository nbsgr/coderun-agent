import OpenAI from 'openai';

function createClient(config) {
  var baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : 'https://api.groq.com/openai/v1';
  if (baseUrl && !baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = 'https://' + baseUrl;
  }
  return new OpenAI({
    baseURL: baseUrl,
    apiKey: config.apiKey || '',
    dangerouslyAllowBrowser: true,
    timeout: 30000,
    maxRetries: 2,
    defaultHeaders: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
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
  try {
    var stream = await client.chat.completions.create(body, requestOptions);
    for await (var chunk of stream) {
      var parsed = parseChunk(chunk);
      if (parsed.content || parsed.thinking || parsed.tool_calls || parsed.usage) {
        yield parsed;
      }
    }
  } catch (err) {
    var msg = err.message || String(err);
    if (msg.includes('tool') || msg.includes('function')) {
      msg += '\n\nNote: Not all Groq models support tool use.\nTry: llama3-groq-70b-8192-tool-use-preview or llama3-groq-8b-8192-tool-use-preview';
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
  throw new Error('Embeddings not supported by Groq in this provider');
}

export async function images(config, prompt) {
  throw new Error('Image generation not supported by Groq');
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