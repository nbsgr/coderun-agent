import OpenAI from 'openai';
import { handleApiResponseError, safeReadJson } from '../agents/utils.js';

function getGeminiOpenAiBaseUrl(baseUrl) {
  var url = String(baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai/').replace(/\/+$/, '');
  if (!url.endsWith('/openai')) {
    if (url.endsWith('/v1beta')) {
      url += '/openai';
    } else if (url.includes('/v1beta/')) {
      url = url.split('/v1beta')[0] + '/v1beta/openai';
    }
  }
  return url;
}

function createClient(config) {
  return new OpenAI({
    baseURL: getGeminiOpenAiBaseUrl(config.baseUrl),
    apiKey: config.apiKey || '',
    dangerouslyAllowBrowser: true
  });
}

export async function* chat(config, messages, tools) {
  var baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : '';
  
  if (baseUrl.includes('/openai') || !baseUrl.includes('streamGenerateContent')) {
    try {
      var client = createClient(config);
      var body = {
        model: config.model || 'gemini-1.5-flash',
        messages: convertMessagesOpenAI(messages),
        stream: true,
        stream_options: { include_usage: true }
      };
      if (tools && tools.length) body.tools = tools;

      var stream = await client.chat.completions.create(body);
      for await (var chunk of stream) {
        var parsedOpenAI = parseChunkOpenAI(chunk);
        if (parsedOpenAI.content || parsedOpenAI.thinking || parsedOpenAI.tool_calls || parsedOpenAI.usage) {
          yield parsedOpenAI;
        }
      }
      return;
    } catch (e) {
      console.warn('[GEMINI] OpenAI endpoint failed, trying native REST endpoint fallback:', e.message);
    }
  }

  var model = config.model || 'gemini-1.5-pro';
  var url = baseUrl + '/models/' + model + ':streamGenerateContent?key=' + config.apiKey;

  var contents = convertMessagesNative(messages);
  var nativeBody = { contents: contents };
  if (tools && tools.length) {
    var functionDeclarations = [];
    for (var ti = 0; ti < tools.length; ti++) {
      var t = tools[ti];
      functionDeclarations.push({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters
      });
    }
    nativeBody.tools = [{ function_declarations: functionDeclarations }];
  }

  var response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(nativeBody)
  });

  if (!response.ok) {
    throw await handleApiResponseError(response, 'Gemini');
  }

  if (!response.body) {
    throw new Error('Gemini API Error: Response body is empty. The server may have returned an incomplete response.');
  }

  var reader = response.body.getReader();
  var decoder = new TextDecoder('utf-8');
  var buffer = '';

  while (true) {
    var raw = await reader.read();
    if (raw.done) break;
    buffer += decoder.decode(raw.value, { stream: true });

    while (true) {
      var nlPos = buffer.indexOf('\n\n');
      var crlfPos = buffer.indexOf('\r\n\r\n');
      var delimStart;
      var delimLen;
      if (crlfPos !== -1 && (nlPos === -1 || crlfPos < nlPos)) {
        delimStart = crlfPos; delimLen = 4;
      } else if (nlPos !== -1) {
        delimStart = nlPos; delimLen = 2;
      } else {
        break;
      }

      var rawChunk = buffer.substring(0, delimStart).trim();
      buffer = buffer.substring(delimStart + delimLen);

      if (!rawChunk) continue;

      var jsonStr = rawChunk;
      if (jsonStr.startsWith('data: ')) {
        jsonStr = jsonStr.substring(6).trim();
      }
      if (jsonStr === '[DONE]') continue;

      try {
        var parsedNativeData = JSON.parse(jsonStr);
        var parsedChunk = parseChunkNative(parsedNativeData);
        if (parsedChunk.content || parsedChunk.thinking || parsedChunk.tool_calls || parsedChunk.usage) {
          yield parsedChunk;
        }
      } catch (err) {
        console.warn('[GEMINI] SSE JSON parse warning:', err.message);
      }
    }
  }
}

export async function listModels(config) {
  try {
    var client = createClient(config);
    var response = await client.models.list();
    var models = [];
    if (response && response.data) {
      for (var i = 0; i < response.data.length; i++) {
        models.push(response.data[i].id || response.data[i].name);
      }
      if (models.length) return models;
    }
  } catch (_) {
    // Fallback to native REST API
  }

  var baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : 'https://generativelanguage.googleapis.com/v1beta/openai/';
  var url = baseUrl + '/models?key=' + config.apiKey;
  var res = await fetch(url);
  if (!res.ok) throw await handleApiResponseError(res, 'Gemini');
  var data = await safeReadJson(res, 'Gemini');
  var nativeModels = [];
  if (data.models) {
    for (var j = 0; j < data.models.length; j++) {
      var name = data.models[j].name || '';
      nativeModels.push(name.replace(/^models\//, ''));
    }
  }
  return nativeModels;
}

export async function embeddings(config, texts) {
  try {
    var client = createClient(config);
    var response = await client.embeddings.create({
      model: config.model || 'text-embedding-004',
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
    // Fallback to native REST API
  }

  var model = config.model || 'embedding-001';
  var baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : 'https://generativelanguage.googleapis.com/v1beta/openai/';
  var url = baseUrl + '/models/' + model + ':batchEmbedContents?key=' + config.apiKey;

  var requests = [];
  for (var k = 0; k < texts.length; k++) {
    requests.push({ content: { parts: [{ text: texts[k] }] } });
  }

  var resNative = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: requests })
  });
  if (!resNative.ok) throw await handleApiResponseError(resNative, 'Gemini');
  var dataNative = await safeReadJson(resNative, 'Gemini');
  var embeddingsList = [];
  if (dataNative.embeddings) {
    for (var m = 0; m < dataNative.embeddings.length; m++) {
      embeddingsList.push(dataNative.embeddings[m].values);
    }
  }
  return embeddingsList;
}

export async function images(config, prompt) {
  throw new Error('Image generation not supported by Gemini in this provider');
}

function parseChunkOpenAI(data) {
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

function convertMessagesOpenAI(messages) {
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

function convertMessagesNative(messages) {
  var contents = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (m.role === 'system') {
      contents.push({ role: 'user', parts: [{ text: 'System: ' + (m.content || '') }] });
      continue;
    }
    var role = m.role === 'assistant' ? 'model' : 'user';
    if (m.role === 'tool') {
      contents.push({ role: 'user', parts: [{ text: 'Tool result (' + m.tool_call_id + '): ' + (m.content || '') }] });
      continue;
    }

    var parts = [];
    if (m.content) parts.push({ text: m.content });

    var rawImages = m.images || (m.image ? [m.image] : null);
    if (rawImages && !Array.isArray(rawImages)) rawImages = [rawImages];
    if (rawImages && rawImages.length) {
      for (var imgIdx = 0; imgIdx < rawImages.length; imgIdx++) {
        var img = rawImages[imgIdx];
        var cleanB64 = String(img).replace(/^data:[^;]+;base64,/, '');
        var mimeType = 'image/png';
        var match = String(img).match(/^data:([^;]+);base64,/);
        if (match && match[1]) mimeType = match[1];
        parts.push({
          inline_data: {
            mime_type: mimeType,
            data: cleanB64
          }
        });
      }
    }

    if (!parts.length) parts.push({ text: '' });
    contents.push({ role: role, parts: parts });
  }
  return contents;
}

function parseChunkNative(data) {
  var result = {};
  if (data && data.usageMetadata) {
    result.usage = {
      prompt_tokens: data.usageMetadata.promptTokenCount || 0,
      completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
      total_tokens: data.usageMetadata.totalTokenCount || 0
    };
  }
  if (Array.isArray(data)) {
    for (var di2 = 0; di2 < data.length; di2++) {
      var item = data[di2];
      if (!item.candidates || !item.candidates[0]) continue;
      var candidate = item.candidates[0];
      if (!candidate.content || !candidate.content.parts) continue;
      for (var pi2 = 0; pi2 < candidate.content.parts.length; pi2++) {
        var part = candidate.content.parts[pi2];
        var textVal = part.text || '';
        var thoughtVal = typeof part.thought === 'string' ? part.thought : '';
        if (part.thought === true || thoughtVal) {
          result.thinking = (result.thinking || '') + (textVal || thoughtVal);
          result.thinkingKey = 'thought';
        } else {
          result.content = (result.content || '') + textVal;
        }
        if (part.functionCall) {
          result.tool_calls = result.tool_calls || [];
          result.tool_calls.push({
            id: part.functionCall.name + '_' + Date.now(),
            function: { name: part.functionCall.name, arguments: part.functionCall.args || {} }
          });
        }
      }
    }
  } else if (data && data.candidates && data.candidates[0]) {
    var candidate2 = data.candidates[0];
    if (candidate2.content && candidate2.content.parts) {
      for (var pi4 = 0; pi4 < candidate2.content.parts.length; pi4++) {
        var part2 = candidate2.content.parts[pi4];
        var textVal2 = part2.text || '';
        var thoughtVal2 = typeof part2.thought === 'string' ? part2.thought : '';
        if (part2.thought === true || thoughtVal2) {
          result.thinking = (result.thinking || '') + (textVal2 || thoughtVal2);
          result.thinkingKey = 'thought';
        } else {
          result.content = (result.content || '') + textVal2;
        }
        if (part2.functionCall) {
          result.tool_calls = result.tool_calls || [];
          result.tool_calls.push({
            id: part2.functionCall.name + '_' + Date.now(),
            function: { name: part2.functionCall.name, arguments: part2.functionCall.args || {} }
          });
        }
      }
    }
  }
  return result;
}