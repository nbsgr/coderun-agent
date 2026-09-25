import OpenAI from 'openai';
import { handleApiResponseError, safeReadJson, safeJsonParse } from '../agents/utils.js';

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

function sanitizeGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  if (Array.isArray(schema)) {
    var cleanArr = [];
    for (var ai = 0; ai < schema.length; ai++) {
      cleanArr.push(sanitizeGeminiSchema(schema[ai]));
    }
    return cleanArr;
  }

  var cleaned = {};
  for (var key in schema) {
    if (!schema.hasOwnProperty(key)) continue;

    // Discard fields known to cause Gemini Protobuf rejection
    if (key === 'additionalProperties' || key === '$schema' || key === 'title' || key === '$defs' || key === 'definitions') {
      continue;
    }

    if (key === 'properties' && schema.properties && typeof schema.properties === 'object') {
      var cleanProps = {};
      for (var propKey in schema.properties) {
        if (schema.properties.hasOwnProperty(propKey)) {
          cleanProps[propKey] = sanitizeGeminiSchema(schema.properties[propKey]);
        }
      }
      cleaned.properties = cleanProps;
    } else if (key === 'items') {
      cleaned.items = sanitizeGeminiSchema(schema.items);
    } else if (key === 'anyOf' || key === 'any_of') {
      cleaned[key] = sanitizeGeminiSchema(schema[key]);
    } else if (key === 'oneOf' || key === 'one_of') {
      cleaned[key] = sanitizeGeminiSchema(schema[key]);
    } else if (key === 'allOf' || key === 'all_of') {
      cleaned[key] = sanitizeGeminiSchema(schema[key]);
    } else {
      cleaned[key] = schema[key];
    }
  }

  return cleaned;
}

function sanitizeGeminiTools(tools) {
  if (!tools || !tools.length) return [];
  var cleaned = [];
  for (var i = 0; i < tools.length; i++) {
    var t = tools[i];
    if (t && t.function) {
      cleaned.push({
        type: t.type || 'function',
        function: {
          name: t.function.name,
          description: t.function.description || '',
          parameters: sanitizeGeminiSchema(t.function.parameters)
        }
      });
    } else {
      cleaned.push(t);
    }
  }
  return cleaned;
}

export async function* chat(config, messages, tools, reqOpts) {
  var baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : '';
  var requestOptions = (reqOpts && reqOpts.signal) ? { signal: reqOpts.signal } : undefined;
  var cleanModel = String(config.model || 'gemini-1.5-flash').trim().replace(/^models\//, '');
  var cleanTools = (tools && tools.length) ? sanitizeGeminiTools(tools) : [];
  
  if (baseUrl.includes('/openai') || !baseUrl.includes('streamGenerateContent')) {
    try {
      var client = createClient(config);
      var body = {
        model: cleanModel,
        messages: convertMessagesOpenAI(messages),
        stream: true,
        stream_options: { include_usage: true }
      };
      if (cleanTools.length) body.tools = cleanTools;

      var stream = await client.chat.completions.create(body, requestOptions);
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

  var cleanRestBaseUrl = baseUrl ? baseUrl.replace(/\/+$/, '') : 'https://generativelanguage.googleapis.com/v1beta';
  if (cleanRestBaseUrl.endsWith('/openai')) {
    cleanRestBaseUrl = cleanRestBaseUrl.substring(0, cleanRestBaseUrl.length - 7);
  }
  var url = cleanRestBaseUrl + '/models/' + cleanModel + ':streamGenerateContent?key=' + config.apiKey;

  var contents = convertMessagesNative(messages);
  var nativeBody = { contents: contents };
  if (cleanTools.length) {
    var functionDeclarations = [];
    for (var ti = 0; ti < cleanTools.length; ti++) {
      var t = cleanTools[ti];
      if (t && t.function) {
        functionDeclarations.push({
          name: t.function.name,
          description: t.function.description || '',
          parameters: t.function.parameters
        });
      }
    }
    nativeBody.tools = [{ function_declarations: functionDeclarations }];
  }

  var geminiHeaders = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    geminiHeaders['x-goog-api-key'] = config.apiKey;
    geminiHeaders['Authorization'] = 'Bearer ' + config.apiKey;
  }

  var response = await fetch(url, {
    method: 'POST',
    headers: geminiHeaders,
    body: JSON.stringify(nativeBody),
    signal: reqOpts && reqOpts.signal
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

  if (buffer && buffer.trim()) {
    var rawRemaining = buffer.trim();
    var remJson = rawRemaining;
    if (remJson.startsWith('data: ')) {
      remJson = remJson.substring(6).trim();
    }
    if (remJson && remJson !== '[DONE]') {
      try {
        var parsedRemainingData = JSON.parse(remJson);
        var remainingParsedChunk = parseChunkNative(parsedRemainingData);
        if (remainingParsedChunk.content || remainingParsedChunk.thinking || remainingParsedChunk.tool_calls || remainingParsedChunk.usage) {
          yield remainingParsedChunk;
        }
      } catch (remErr) {
        console.warn('[GEMINI] Final SSE JSON parse warning:', remErr.message);
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
        var rawId = response.data[i].id || response.data[i].name || '';
        var cleanId = rawId.replace(/^models\//, '');
        if (cleanId) models.push(cleanId);
      }
      if (models.length) return models;
    }
  } catch (_) {
    // Fallback to native REST API
  }

  var defaultGeminiModels = [
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b'
  ];

  try {
    var baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : 'https://generativelanguage.googleapis.com/v1beta';
    if (baseUrl.endsWith('/openai')) {
      baseUrl = baseUrl.substring(0, baseUrl.length - 7);
    }
    var url = baseUrl + '/models?key=' + (config.apiKey || '');
    var headers = {};
    if (config.apiKey) {
      headers['x-goog-api-key'] = config.apiKey;
      headers['Authorization'] = 'Bearer ' + config.apiKey;
    }
    var res = await fetch(url, { headers: headers });
    if (!res.ok) {
      console.warn('[CODERUN] Gemini REST /models returned ' + res.status + ', using standard model list');
      return defaultGeminiModels;
    }
    var data = await safeReadJson(res, 'Gemini');
    var nativeModels = [];
    if (data.models) {
      for (var j = 0; j < data.models.length; j++) {
        var name = data.models[j].name || '';
        var cleanName = name.replace(/^models\//, '');
        var ctx = data.models[j].inputTokenLimit || 0;
        if (ctx) {
          nativeModels.push({ id: cleanName, context_window: ctx });
        } else {
          nativeModels.push(cleanName);
        }
      }
    }
    return nativeModels.length ? nativeModels : defaultGeminiModels;
  } catch (err) {
    console.warn('[CODERUN] Failed to fetch models from Gemini endpoint, falling back to defaults:', err.message);
    return defaultGeminiModels;
  }
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
    var msg = { role: m.role, content: (m.content !== undefined && m.content !== null) ? m.content : '' };
    if (m.tool_calls && m.tool_calls.length) {
      if (!msg.content) {
        msg.content = null;
      }
      var safeToolCalls = [];
      for (var tcI = 0; tcI < m.tool_calls.length; tcI++) {
        var tcItem = m.tool_calls[tcI];
        var tcArgs = (tcItem.function && tcItem.function.arguments) || tcItem.arguments || '';
        if (typeof tcArgs !== 'string') {
          try { tcArgs = JSON.stringify(tcArgs); } catch (_) { tcArgs = '{}'; }
        }
        safeToolCalls.push({
          id: tcItem.id,
          type: tcItem.type || 'function',
          function: {
            name: (tcItem.function && tcItem.function.name) || tcItem.name || '',
            arguments: tcArgs
          }
        });
      }
      msg.tool_calls = safeToolCalls;
    }
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
      var toolResultText = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
      contents.push({ role: 'user', parts: [{ text: 'Tool result (' + (m.tool_name || m.tool_call_id || 'tool') + '): ' + toolResultText }] });
      continue;
    }

    var parts = [];
    if (m.content) parts.push({ text: m.content });

    if (m.tool_calls && m.tool_calls.length) {
      for (var tci = 0; tci < m.tool_calls.length; tci++) {
        var tCall = m.tool_calls[tci];
        var fnName = (tCall.function && tCall.function.name) || tCall.name || '';
        var rawArgs = (tCall.function && tCall.function.arguments) || tCall.arguments || {};
        var parsedArgs = typeof rawArgs === 'string' ? safeJsonParse(rawArgs, {}) : (rawArgs || {});
        parts.push({ functionCall: { name: fnName, args: parsedArgs } });
      }
    }

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
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts = contents[contents.length - 1].parts.concat(parts);
    } else {
      contents.push({ role: role, parts: parts });
    }
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