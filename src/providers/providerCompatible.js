import OpenAI from 'openai';
import { handleApiResponseError, safeReadJson } from '../agents/utils.js';
import { extractModelModality, getProviderTimeout } from './modelClassifier.js';

function createClient(config) {
  var baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : '';
  if (baseUrl && !baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = 'https://' + baseUrl;
  }
  return new OpenAI({
    baseURL: baseUrl,
    apiKey: config.apiKey || 'dummy',
    dangerouslyAllowBrowser: true,
    timeout: getProviderTimeout(config),
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
  var stream = await client.chat.completions.create(body, requestOptions);

  for await (var chunk of stream) {
    var parsed = parseChunk(chunk);
    if (parsed.error) {
      throw new Error(parsed.error);
    }
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
        var rawM = response.data[j];
        var mId = rawM.id || rawM.name;
        if (!mId) continue;
        modelList.push({
          id: mId,
          modality: extractModelModality(rawM),
          context_window: rawM.context_window || rawM.context_length || rawM.max_tokens || 0,
          raw: rawM
        });
      }
    }
    return modelList;
  } catch (e) {
    console.warn('[CODERUN] Failed to reach compatible endpoint via SDK:', e.message);
    throw e;
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

function extractMediaUrl(data) {
  if (!data) return null;
  if (typeof data === 'string' && (data.startsWith('http://') || data.startsWith('https://') || data.startsWith('data:'))) {
    return data;
  }
  if (Array.isArray(data)) {
    for (var i = 0; i < data.length; i++) {
      var itemUrl = extractMediaUrl(data[i]);
      if (itemUrl) return itemUrl;
    }
  }
  if (data.data && Array.isArray(data.data) && data.data[0]) {
    var item = data.data[0];
    if (item.url) return item.url;
    if (item.b64_json) {
      return item.b64_json.startsWith('data:') ? item.b64_json : ('data:image/png;base64,' + item.b64_json);
    }
    if (item.image) return item.image;
    if (item.video) return item.video;
  }
  if (data.url) return data.url;
  if (data.video_url) return data.video_url;
  if (data.output) {
    if (typeof data.output === 'string') return data.output;
    if (Array.isArray(data.output) && data.output[0]) return extractMediaUrl(data.output[0]);
  }
  if (data.result) {
    if (typeof data.result === 'string') return data.result;
    if (data.result.url) return data.result.url;
  }
  return null;
}

function extractTaskId(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.task_id) return data.task_id;
  if (data.video_id) return data.video_id;
  if (data.job_id) return data.job_id;
  if (data.id && (data.status === 'processing' || data.status === 'pending' || data.status === 'queued' || data.status === 'starting' || data.status === 'created' || data.status === 'in-progress')) {
    return data.id;
  }
  if (data.data && typeof data.data === 'object') {
    return extractTaskId(data.data);
  }
  return null;
}

function sleep(ms) {
  function timerExecutor(resolve) {
    setTimeout(resolve, ms);
  }
  return new Promise(timerExecutor);
}

async function pollVideoTask(baseUrl, taskId, modelName, headers, explicitPollUrl) {
  var maxAttempts = 60;
  var isAgnes = baseUrl.indexOf('agnes-ai') !== -1;

  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(3000);
    var pollUrl = explicitPollUrl;
    if (!pollUrl) {
      if (isAgnes) {
        pollUrl = baseUrl.replace(/\/v1$/, '') + '/agnesapi?video_id=' + encodeURIComponent(taskId) + (modelName ? '&model_name=' + encodeURIComponent(modelName) : '');
      } else {
        pollUrl = baseUrl + '/videos/' + encodeURIComponent(taskId);
      }
    }

    try {
      var pollRes = await fetch(pollUrl, {
        method: 'GET',
        headers: headers
      });

      if (!pollRes.ok && pollRes.status === 404 && !isAgnes && !explicitPollUrl) {
        var taskFallbackUrl = baseUrl + '/tasks/' + encodeURIComponent(taskId);
        var taskRes = await fetch(taskFallbackUrl, { method: 'GET', headers: headers });
        if (taskRes.ok) {
          pollRes = taskRes;
        }
      }

      if (pollRes.ok) {
        var pollData = await pollRes.json();
        var mediaUrl = extractMediaUrl(pollData);
        if (mediaUrl) return mediaUrl;

        var status = pollData.status || (pollData.data && pollData.data.status);
        if (status === 'failed' || status === 'error' || status === 'rejected') {
          var failMsg = pollData.error || pollData.message || (pollData.data && pollData.data.error) || 'Video generation task failed';
          throw new Error(typeof failMsg === 'string' ? failMsg : JSON.stringify(failMsg));
        }
      }
    } catch (pollErr) {
      if (pollErr.message && pollErr.message.indexOf('Video generation task failed') !== -1) {
        throw pollErr;
      }
      console.warn('[PROVIDER] Video poll attempt ' + (attempt + 1) + ' error:', pollErr.message);
    }
  }

  throw new Error('Video generation timed out after 180 seconds. Task ID: ' + taskId);
}

export async function images(config, prompt) {
  try {
    var client = createClient(config);
    var response = await client.images.generate({
      model: config.model || 'dall-e-3',
      prompt: prompt,
      n: 1
    });
    var clientUrl = extractMediaUrl(response);
    if (clientUrl) return clientUrl;
  } catch (_) {
    // Fallback to direct HTTP fetch
  }

  var baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : 'https://api.openai.com/v1';
  var url = baseUrl + '/images/generations';
  var headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;
  var res = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ model: config.model || 'dall-e-3', prompt: prompt, n: 1 })
  });
  if (!res.ok) {
    var errText = await res.text();
    throw new Error('Image generation failed (' + res.status + '): ' + errText);
  }
  var data = await res.json();
  var extracted = extractMediaUrl(data);
  if (extracted) return extracted;
  return null;
}

function formatVideoErrorMessage(status, rawText) {
  try {
    var parsed = JSON.parse(rawText);
    var msg = (parsed.error && parsed.error.message) || parsed.message || (parsed.data && parsed.data.message);
    if (parsed.code === 'video_queue_full' || (msg && msg.indexOf('video queue is full') !== -1)) {
      return 'Video generation server queue is currently full (remote GPU cluster at capacity). Please wait 1-2 minutes and try again.';
    }
    if (status === 429 || (msg && msg.indexOf('rate limit') !== -1)) {
      return 'API rate limit reached for this video provider. ' + (msg || 'Please wait a moment before trying again.');
    }
    if (msg) {
      return msg;
    }
  } catch (_) {}
  return rawText;
}

export async function videos(config, prompt) {
  var baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : 'https://api.openai.com/v1';
  var primaryUrl = baseUrl + '/videos';
  var headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;

  var standardPayload = {
    model: config.model || 'sora',
    prompt: prompt
  };

  var maxQueueRetries = 3;
  var res = null;
  var lastErrText = '';

  for (var queueAttempt = 0; queueAttempt < maxQueueRetries; queueAttempt++) {
    res = await fetch(primaryUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(standardPayload)
    });

    if (!res.ok && res.status === 400) {
      var errCheckText = await res.text();
      if (errCheckText.indexOf('mode') !== -1) {
        var adaptivePayload = {
          model: config.model || 'sora',
          prompt: prompt,
          mode: 'text'
        };
        res = await fetch(primaryUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(adaptivePayload)
        });
      } else {
        var formatted400 = formatVideoErrorMessage(400, errCheckText);
        throw new Error('Video generation failed: ' + formatted400);
      }
    }

    if (!res.ok && res.status === 404) {
      var fallbackUrl = baseUrl + '/video/generations';
      res = await fetch(fallbackUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(standardPayload)
      });
    }

    if (!res.ok && res.status === 503) {
      var errCheck503 = await res.text();
      lastErrText = errCheck503;
      if (errCheck503.indexOf('video_queue_full') !== -1 || errCheck503.indexOf('queue is full') !== -1) {
        if (queueAttempt < maxQueueRetries - 1) {
          console.log('[PROVIDER] Video queue is full (503). Retrying in 6 seconds (attempt ' + (queueAttempt + 1) + '/' + maxQueueRetries + ')...');
          await sleep(6000);
          continue;
        }
      }
      var formatted503 = formatVideoErrorMessage(503, errCheck503);
      throw new Error('Video generation failed: ' + formatted503);
    }

    if (res.ok) {
      break;
    } else {
      lastErrText = await res.text();
      break;
    }
  }

  if (!res || !res.ok) {
    var formattedErr = formatVideoErrorMessage(res ? res.status : 500, lastErrText);
    throw new Error('Video generation failed: ' + formattedErr);
  }

  var data = await res.json();

  var directUrl = extractMediaUrl(data);
  if (directUrl) return directUrl;

  var taskId = extractTaskId(data);
  if (taskId) {
    var explicitPollUrl = data.status_url || data.poll_url || (data.urls && data.urls.get);
    return await pollVideoTask(baseUrl, taskId, config.model, headers, explicitPollUrl);
  }

  return data;
}

function parseChunk(data) {
  var result = {};
  if (data && data.error) {
    result.error = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error));
    return result;
  }
  if (data && data.usage) {
    result.usage = {
      prompt_tokens: data.usage.prompt_tokens || 0,
      completion_tokens: data.usage.completion_tokens || 0,
      total_tokens: data.usage.total_tokens || 0
    };
  }
  var choice = data && data.choices && data.choices[0];
  if (choice && choice.finish_reason === 'network_error') {
    result.error = 'API response finished with reason: network_error';
    return result;
  }
  var delta = choice ? choice.delta : null;
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