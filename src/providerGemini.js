// providerGemini.js — Google Gemini API provider

export async function* chat(config, messages, tools) {
  var model = config.model || 'gemini-1.5-pro';
  var url = config.baseUrl.replace(/\/+$/, '') + '/models/' + model + ':streamGenerateContent?key=' + config.apiKey;

  var contents = convertMessages(messages);
  var body = { contents: contents };
  if (tools && tools.length) {
    body.tools = [{ function_declarations: tools.map(function(t) {
      return {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters
      };
    })}];
  }

  console.log('[GEMINI] Provider Selected: gemini');
  console.log('[GEMINI] Request URL:', url);
  console.log('[GEMINI] Request Body:', JSON.stringify(body).substring(0, 500));

  var response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  console.log('[GEMINI] HTTP Status:', response.status, response.statusText);

  if (!response.ok) {
    var err = await response.json().catch(function() { return {}; });
    throw new Error(err.error?.message || 'Gemini Error: HTTP ' + response.status);
  }

  var reader = response.body.getReader();
  var decoder = new TextDecoder('utf-8');
  var buffer = '';
  var chunkCount = 0;

  while (true) {
    var raw = await reader.read();
    if (raw.done) break;
    buffer += decoder.decode(raw.value, { stream: true });

    // Gemini SSE may emit pretty-printed (multi-line) JSON per event.
    // Events are delimited by \n\n or \r\n\r\n. Each event can contain
    // JSON body text with internal newlines. We extract ONE complete
    // event at a time, reassemble its data lines into a single JSON
    // string, then parse.
    while (true) {
      // Find the next event delimiter: \n\n or \r\n\r\n
      var nlPos = buffer.indexOf('\n\n');
      var crlfPos = buffer.indexOf('\r\n\r\n');
      var delimStart;
      var delimLen;
      if (crlfPos !== -1 && (nlPos === -1 || crlfPos < nlPos)) {
        delimStart = crlfPos; delimLen = 4;
      } else if (nlPos !== -1) {
        delimStart = nlPos; delimLen = 2;
      } else {
        break; // No complete event in buffer yet
      }

      var eventText = buffer.substring(0, delimStart);
      buffer = buffer.substring(delimStart + delimLen);

      var trimmed = (eventText || '').trim();
      if (!trimmed) continue;

      // Normalize to \n-only
      var normalized = trimmed.replace(/\r\n/g, '\n');
      // Reconstruct JSON from potentially multi-line SSE event body
      var eventLines = normalized.split('\n');
      var jsonParts = [];
      for (var ei = 0; ei < eventLines.length; ei++) {
        var l = eventLines[ei].trim();
        if (l.startsWith('data: ')) {
          jsonParts.push(l.slice(6));
        } else if (l.length > 0) {
          jsonParts.push(l);
        }
      }
      var jsonStr = jsonParts.join('');

      if (!jsonStr || jsonStr === '[DONE]') continue;

      try {
        var data = JSON.parse(jsonStr);
        chunkCount++;
        console.log('[GEMINI] Event #' + chunkCount + ':', jsonStr.substring(0, 300));
        var parsed = parseChunk(data);
        console.log('[GEMINI] YIELD =', JSON.stringify(parsed).substring(0, 500));
        if (parsed.content) console.log('[GEMINI] Yielded content:', parsed.content.substring(0, 100));
        if (parsed.thinking) console.log('[GEMINI] Yielded thinking:', parsed.thinking.substring(0, 100));
        if (parsed.tool_calls) console.log('[GEMINI] Yielded tool_calls:', parsed.tool_calls.length);
        yield parsed;
      } catch (e) {
        console.error('[GEMINI] Parse error:', jsonStr.substring(0, 200), e);
      }
    }
  }

  // Flush remaining buffer (last event may not be terminated with \n\n)
  var remaining = buffer.trim();
  if (remaining) {
    var jsonStr = remaining;
    if (jsonStr.startsWith('data: ')) jsonStr = jsonStr.slice(6);
    if (jsonStr && jsonStr !== '[DONE]') {
      try {
        var data = JSON.parse(jsonStr);
        chunkCount++;
        console.log('[GEMINI] Final event:', jsonStr.substring(0, 300));
        var parsed = parseChunk(data);
        console.log('[GEMINI] YIELD =', JSON.stringify(parsed).substring(0, 500));
        yield parsed;
      } catch (e) {
        console.error('[GEMINI] Parse error for final buffer:', jsonStr.substring(0, 200), e);
      }
    }
  }

  console.log('[GEMINI] Stream complete, total chunks:', chunkCount);
}

export async function listModels(config) {
  var url = config.baseUrl.replace(/\/+$/, '') + '/models?key=' + config.apiKey;
  try {
    var res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    return data.models ? data.models.map(function(m) { return m.name.split('/').pop(); }) : [];
  } catch (e) {
    console.warn('[CODERUN] Failed to fetch models from Gemini-Compatible endpoint:', e.message);
    return config.model ? [config.model] : ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash-exp'];
  }
}

export async function embeddings(config, texts) {
  var model = config.model || 'text-embedding-004';
  var url = config.baseUrl.replace(/\/+$/, '') + '/models/' + model + ':batchEmbedContents?key=' + config.apiKey;
  var res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: texts.map(function(t) { return { content: { parts: [{ text: t }] } }; })
    })
  });
  var data = await res.json();
  return data.embeddings ? data.embeddings.map(function(e) { return e.values; }) : [];
}

export async function images(config, prompt) {
  throw new Error('Image generation not supported by Gemini in this provider');
}

function convertMessages(messages) {
  var contents = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (m.role === 'system') {
      contents.push({ role: 'user', parts: [{ text: 'System: ' + m.content }] });
      continue;
    }
    var role = m.role === 'assistant' ? 'model' : 'user';
    if (m.role === 'tool') {
      role = 'user';
      contents.push({ role: role, parts: [{ text: 'Tool result (' + m.tool_call_id + '): ' + m.content }] });
    } else {
      contents.push({ role: role, parts: [{ text: m.content }] });
    }
  }
  return contents;
}

function parseChunk(data) {
  var result = {};
  console.log('[GEMINI PARSER] typeof data:', typeof data);
  console.log('[GEMINI PARSER] Array.isArray(data):', Array.isArray(data));
  if (Array.isArray(data)) {
    console.log('[GEMINI PARSER] data.length:', data.length);
    for (var di = 0; di < data.length; di++) {
      console.log('[GEMINI PARSER] data[' + di + '] type:', typeof data[di], 'has candidates:', !!data[di].candidates, 'has content:', !!(data[di].candidates && data[di].candidates[0] && data[di].candidates[0].content));
      if (data[di].candidates && data[di].candidates[0] && data[di].candidates[0].content && data[di].candidates[0].content.parts) {
        for (var pi = 0; pi < data[di].candidates[0].content.parts.length; pi++) {
          var p = data[di].candidates[0].content.parts[pi];
          console.log('[GEMINI PARSER] data[' + di + '].candidates[0].content.parts[' + pi + ']: text="' + (p.text || '').substring(0, 100) + '", thought:', p.thought, 'functionCall:', !!p.functionCall);
        }
      }
    }
    // Process every element in the array, not just the first
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
  } else {
    // Single object (non-array)
    console.log('[GEMINI PARSER] Single object, has candidates:', !!data.candidates);
    if (data.candidates && data.candidates[0]) {
      console.log('[GEMINI PARSER] candidate[0] has content:', !!data.candidates[0].content);
      if (data.candidates[0].content && data.candidates[0].content.parts) {
        for (var pi3 = 0; pi3 < data.candidates[0].content.parts.length; pi3++) {
          var p3 = data.candidates[0].content.parts[pi3];
          console.log('[GEMINI PARSER] part[' + pi3 + ']: text="' + (p3.text || '').substring(0, 100) + '", thought:', p3.thought);
        }
      }
    }
    if (data.candidates && data.candidates[0]) {
      var candidate = data.candidates[0];
      if (candidate.content && candidate.content.parts) {
        for (var pi4 = 0; pi4 < candidate.content.parts.length; pi4++) {
          var part = candidate.content.parts[pi4];
          var textVal = part.text || '';
          var thoughtVal = typeof part.thought === 'string' ? part.thought : '';
          if (part.thought === true || thoughtVal) {
            result.thinking = (result.thinking || '') + (textVal || thoughtVal);
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
    }
  }
  console.log('[GEMINI PARSER] Final result:', JSON.stringify(result).substring(0, 300));
  return result;
}