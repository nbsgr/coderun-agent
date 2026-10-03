// providerQwen.js — Qwen Browser Web API Provider Adapter
// Operates over reverse-engineered browser session API with dual-mode native/workspace execution.
// Strict traditional function declarations only. Zero modifications to agentLoop.js.

import { QWEN_SYSTEM_PROMPT } from '../agents/constants.js';
import { uploadFileToQwenOss } from './qwenOssManager.js';
import {
  generateUuid,
  createNewQwenChat,
  stopQwenChat,
  deleteQwenChat
} from './qwenSessionManager.js';

var activeQwenChatId = null;
var lastAssistantMsgId = null;
var sessionChatMap = {};
var lastSessionCookie = '';

export function setLastCookie(cookie) {
  if (cookie && typeof cookie === 'string') {
    lastSessionCookie = cookie.trim();
  }
}

export function getLastCookie() {
  return lastSessionCookie;
}

export function hasValidQwenToken(cookieStr) {
  if (!cookieStr || typeof cookieStr !== 'string') return false;
  var trimmed = cookieStr.trim();
  if (trimmed.startsWith('eyJ')) return true;
  return /(?:^|;\s*)(token|active_token)=ey[A-Za-z0-9_-]+/i.test(cookieStr) ||
         /(?:^|;\s*)(token|active_token)=[A-Za-z0-9_.-]{20,}/i.test(cookieStr);
}

export function parseTokenFromCookie(cookieStr) {
  if (!cookieStr) return '';
  var trimmed = cookieStr.trim();
  if (trimmed.startsWith('eyJ')) return trimmed;
  if (trimmed.startsWith('Bearer ')) return trimmed.substring(7).trim();
  var parts = cookieStr.split(';');
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (part.startsWith('token=')) return part.substring(6);
    if (part.startsWith('active_token=')) return part.substring(13);
  }
  for (var j = 0; j < parts.length; j++) {
    var p = parts[j].trim();
    var eqIdx = p.indexOf('=');
    if (eqIdx !== -1) {
      var kName = p.substring(0, eqIdx).toLowerCase();
      var kVal = p.substring(eqIdx + 1);
      if ((kName === 'token' || kName === 'active_token') && kVal.length > 20) {
        return kVal;
      }
    }
  }
  return '';
}

export function stripServerNoise(text) {
  if (!text || typeof text !== 'string') return '';
  var cleaned = text;
  cleaned = cleaned.replace(/Tool\s+[a-zA-Z0-9_.-]+\s+does\s+not\s+exists?\.?/gi, '');
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
  cleaned = cleaned.replace(/<tool_call>[\s\S]*/gi, '');
  return cleaned;
}

function parseSecurityTokens(cookieStr) {
  var bxUa = '234!t6OeKjrieePWr1PjjV4mwLmK48zJRd8FTTr55qiMD9dRMXOLA/2rqixq7SAwJ9Ie1K64UlwUoXPgZeWAEjvyoxLuZOvpd5Li3S7UmQHGnXrd8TjDjnf6DtXpsQFHAkJKSzIP7S9jnBDpHYqJUOPFBOCiGhtfHaCKmkPWTx0DNQmOJJ6J/DT9rLgFeZUrIbWX0La5AgVA/1IZn3UH9AJ7hwN+OUcOCd2gcP0aOQJNirLZZ3wH9idThpoZnkp/cAjenL5cQCyNescZn3UH9AVE6sZZ8ks/c24HeIoHOQYNhstZZ3wd9iJTCP2ZQkkwgsXH+lodOQ5NhsgiZ6Wd9iyoCvr+8Lkfcs4H+JWyQCyNhsfkZ3wd9ib2CvV+vkkhc2r7ZZodQCymhxuZVkUd9Ad7TZzZQkpvxOuyHVEHQQVmhxWZn3UJI4C8jRxZQ+kvc24TieCdQQymhskreLwH9idThnoZQpp/cs47ZJDxQC5Ovf1vSy+kKwbbBIoZQpsvc2PTYGwTQoVIhMaUekUM98edFVtZVY3QcM5Tn3ZEQCNmNkCZYLb39AdThrnZQLrOcMPTB/o9QCymhuxZekUH9AHb2c/NOARsoNvDAdHUePkbWoOvsUH2XTnfgIWAfVFu+7vqgyhrvdNaW1pb2jDq8ruAgAY5azNqoO5XcVVuBwmfEiIyAT+EVuc7En+OfbGuJRvv5eCurEmM6IkXp48DiBkI9qjmQe1Y+VHVhs/1mBaXBja/dqTPGVt4sr/ggEWFukX29KKoboI445AKjgR3DUpzecCEP/6DcMjKvzzzIm3CHOn7ZZwnAdIkdzKfclmLqfz3ALiWyQTQSxrRugB27Z3aVM6QX5+mlbtp3ZDoNas4u3vjUgueEk/E8xmyj0fEbnC/cKPbuxNTRgMZgHiCkXO4jEg7TtmXbdH4e1H6pqxqyj357FwExCtVNILqE7qcmw5OfLwSC1WHq1va5AlhdlcAZKAefbYnNbflnj+fVli6XfIl0KmzzzdsrLa3B8EESE1EkyPzTvfz0Bcn8RUYGKijqXyAdM7RAbAQhrNzGzRFBVVZoubREv1+sSc3zCsyXRPS8GIE5rqKO2PQZcoHZ5Xfw2VlBhiYGo3KhbTtZmZmOcixLj61U1wYqpFp7jspa+4SPJtl9gGKoHrQGja1hTIhiw/32YdoX2HKeemUWwSBo30Et+r4L+9usjb+NH4Oflq0UXtarsdCq1QElvpdA9BxqUXX+h/SzEqx4suD6IK8ORThuszcuzB9ukGKTX5jDE7+pQF8sEUdnQh1zXx/KN2PcYI0+Yw769RxwUb7zsWqo9z0ahlY52Cddr8j7fFkq9gVajuHmXuGRJUXDgJnHDqIpQs3sGYYTs0QJdNF5jq4xLNfcqugoNZMcDPu6V6Qeol1PagMdE+ssx4muDCuolycTXkqX7yAe+YwFjrMZWtb5Yyik/aKsqfD8ewvHpRwQGfP2oD4+J1VPG1BL6EgUJKqzf+M8xDgY0FmdYMJHrirYMf6gDdjlsmdio3LVCn28kaL/pn5HZSqzUIwvMjfw6olekKL5l0l6gOdSc/4c6xkXRjkkcK0vie+saJ2pavuiBKTxgyS/50k6QPKQnBWC19dG5R9GPZ1ZXEnnPVfGMWbBYgRXic6BjHjx7/jzSG57rtvtDMj4NhVsGVFYSAbMxWGFvn3THyqv37zsoYvmB5wrR9qWoDTV+p6pCtElyuS/oVYbLVIhrORf3hlsjrm+hvQk1XwIvKQIRqX2vy3ScanXL5QHDwiNc3kc8nTdSrczDzmCjp3GWbkkwqyMSIELCzI5NVPtMPl3fb5jNwgAhek';
  var bxUmidtoken = 'T2gAKSKQ-DRnLVZ5DYO63YR7SODE7IYEVg07M27F3ju0tJ5h6Z1NtMNDO8ocN4JoarA=';
  if (!cookieStr) return { bxUa: bxUa, bxUmidtoken: bxUmidtoken };

  var parts = cookieStr.split(';');
  for (var i = 0; i < parts.length; i++) {
    var item = parts[i].trim();
    if (item.startsWith('bx_ua=')) bxUa = item.substring(6);
    if (item.startsWith('bx_umidtoken=')) bxUmidtoken = item.substring(13);
  }
  return { bxUa: bxUa, bxUmidtoken: bxUmidtoken };
}

export function buildQwenHeaders(cookieStr, targetChatId) {
  var token = parseTokenFromCookie(cookieStr);
  var secTokens = parseSecurityTokens(cookieStr);

  var h = {
    'Accept': 'text/event-stream, application/json, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'bx-ua': secTokens.bxUa,
    'bx-umidtoken': secTokens.bxUmidtoken,
    'bx-v': '2.5.37',
    'Connection': 'keep-alive',
    'Content-Type': 'application/json',
    'dnt': '1',
    'Host': 'chat.qwen.ai',
    'Origin': 'https://chat.qwen.ai',
    'Sec-Ch-Ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
    'Sec-Ch-Ua-Mobile': '?1',
    'Sec-Ch-Ua-Platform': '"Android"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'source': 'h5',
    'timezone': 'Sat Sep 12 2026 18:31:07 GMT+0530',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
    'version': '0.2.91',
    'x-accel-buffering': 'no',
    'x-request-id': generateUuid(),
    'Cookie': cookieStr
  };
  if (token) h['Authorization'] = 'Bearer ' + token;
  if (targetChatId) {
    h['Referer'] = 'https://chat.qwen.ai/c/' + targetChatId;
  } else {
    h['Referer'] = 'https://chat.qwen.ai/';
  }
  return h;
}

export function formatToolsForPrompt(tools) {
  if (!tools || !tools.length) return 'No workspace tools available.';
  var s = '';
  for (var i = 0; i < tools.length; i++) {
    var t = tools[i];
    var fn = t.function || t;
    if (fn.name === 'image_edit' || fn.name === 'edit_image') {
      continue;
    }
    s += '\n### ' + fn.name + '\n';
    s += 'Description: ' + (fn.description || '') + '\n';
    if (fn.parameters && fn.parameters.properties) {
      s += 'Parameters (JSON schema properties):\n';
      var props = fn.parameters.properties;
      var required = fn.parameters.required || [];
      var propNames = Object.keys(props);
      for (var p = 0; p < propNames.length; p++) {
        var pName = propNames[p];
        var prop = props[pName];
        var req = required.includes(pName) ? ' (required)' : '';
        s += '- ' + pName + ' (' + prop.type + '): ' + (prop.description || '') + req + '\n';
      }
    }
  }
  return s;
}

export function serializeMessages(messages, systemContent, tools) {
  var parts = [];

  // Master Prompt: Dual native powers + workspace tools + strict JSON response contract
  // Always include QWEN_SYSTEM_PROMPT so Qwen knows it has MODE 1 (Native Web Browser Powers: Image Gen & Web Search)
  // and MODE 2 (Workspace Actions via tools)
  var baseSystem = QWEN_SYSTEM_PROMPT;
  if (systemContent && systemContent.trim() && systemContent !== QWEN_SYSTEM_PROMPT) {
    if (systemContent.indexOf('MODE 1: YOUR NATIVE WEB BROWSER POWERS') === -1) {
      baseSystem = QWEN_SYSTEM_PROMPT + '\n\n' + systemContent;
    } else {
      baseSystem = systemContent;
    }
  }
  if (baseSystem.indexOf('## AVAILABLE WORKSPACE TOOLS') === -1) {
    baseSystem += '\n\n## AVAILABLE WORKSPACE TOOLS\n' + formatToolsForPrompt(tools);
  }
  parts.push(baseSystem);

  // Conversation History
  function isNotSystem(m) {
    return m && m.role !== 'system';
  }
  var convMessages = messages.filter(isNotSystem);
  if (convMessages.length > 1) {
    parts.push('\n--- CONVERSATION HISTORY ---');
    for (var i = 0; i < convMessages.length - 1; i++) {
      var m = convMessages[i];
      if (m.role === 'user') {
        parts.push('\nUser:\n' + (m.content || ''));
      } else if (m.role === 'assistant') {
        var aText = '\nAssistant:';
        var r = m.reasoning || m.thinking;
        if (r) aText += '\nReasoning: ' + r;
        if (m.tool_calls && m.tool_calls.length) {
          aText += '\nTool Calls:\n' + JSON.stringify(m.tool_calls, null, 2);
        }
        if (m.content) aText += '\nContent:\n' + m.content;
        parts.push(aText);
      } else if (m.role === 'tool') {
        var toolId = m.tool_call_id || '';
        var toolName = m.tool_name || '';
        var tHeader = toolName ? (toolName + ' (ID: ' + toolId + ')') : ('ID: ' + toolId);
        parts.push('\n[Tool Result for ' + tHeader + ']:\n' + (m.content || ''));
      }
    }
  }

  // Current Step
  var lastMsg = convMessages.length > 0 ? convMessages[convMessages.length - 1] : null;
  if (lastMsg) {
    if (lastMsg.role === 'tool') {
      var lastToolId = lastMsg.tool_call_id || '';
      var lastToolName = lastMsg.tool_name || '';
      var lastHeader = lastToolName ? (lastToolName + ' (ID: ' + lastToolId + ')') : ('ID: ' + lastToolId);
      parts.push('\n--- CURRENT STEP ---\n[Latest Tool Execution Result for ' + lastHeader + ']:\n' + (lastMsg.content || '') + '\n\nAnalyze this result and decide the next step or final answer in strict OpenAI chat.completion format.');
    } else if (lastMsg.role === 'user') {
      parts.push('\n--- CURRENT REQUEST ---\nUser:\n' + (lastMsg.content || ''));
    } else if (lastMsg.role === 'assistant') {
      parts.push('\n--- CURRENT ASSISTANT REQUEST ---\n' + (lastMsg.content || ''));
    }
  }

  return parts.join('\n\n');
}

export function createJsonStreamExtractor() {
  var buffer = '';
  var streamedThinkingLength = 0;
  var streamedContentLength = 0;

  function decodeJsonStringChunk(raw) {
    try {
      return JSON.parse('"' + raw + '"');
    } catch (_) {
      return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }

  function extractStringField(key) {
    var searchKey = '"' + key + '"';
    var keyIdx = buffer.lastIndexOf(searchKey);
    if (keyIdx === -1) return null;
    var colonIdx = buffer.indexOf(':', keyIdx + searchKey.length);
    if (colonIdx === -1) return null;
    var quoteIdx = buffer.indexOf('"', colonIdx + 1);
    if (quoteIdx === -1) return null;

    var start = quoteIdx + 1;
    var end = -1;
    var i = start;
    while (i < buffer.length) {
      if (buffer[i] === '"' && buffer[i - 1] !== '\\') {
        var after = buffer.substring(i + 1).trim();
        if (after.startsWith(',') || after.startsWith('}') || after.startsWith('"') || after.length === 0) {
          end = i;
          break;
        }
      }
      i++;
    }

    if (end !== -1) {
      return { value: buffer.substring(start, end), isComplete: true };
    } else {
      var partial = buffer.substring(start);
      if (partial.endsWith('\\')) partial = partial.slice(0, -1);
      return { value: partial, isComplete: false };
    }
  }

  function push(chunk) {
    buffer += chunk;
    var result = {};

    var reasoningField = extractStringField('reasoning');
    if (reasoningField && reasoningField.value.length > streamedThinkingLength) {
      var newRaw = reasoningField.value.substring(streamedThinkingLength);
      streamedThinkingLength = reasoningField.value.length;
      result.thinking = decodeJsonStringChunk(newRaw);
    }

    var contentField = extractStringField('content');
    if (contentField && contentField.value.length > streamedContentLength) {
      var newRawContent = contentField.value.substring(streamedContentLength);
      streamedContentLength = contentField.value.length;
      result.content = decodeJsonStringChunk(newRawContent);
    }

    return result;
  }

  function getBuffer() {
    return buffer;
  }

  return {
    push: push,
    feed: push,
    getBuffer: getBuffer,
    getParsed: function getParsed() {
      return cleanAndParseOpenAiJson(buffer);
    }
  };
}

function extractReasoningField(text) {
  if (!text) return '';
  var target = '"reasoning":';
  var lastIdx = text.lastIndexOf(target);
  if (lastIdx === -1) return '';

  var quoteIdx = text.indexOf('"', lastIdx + target.length);
  if (quoteIdx === -1) return '';

  var start = quoteIdx + 1;
  var i = start;
  var end = -1;
  while (i < text.length) {
    if (text[i] === '"' && text[i - 1] !== '\\') {
      var after = text.substring(i + 1).trim();
      if (after.startsWith(',') || after.startsWith('}') || after.startsWith('"content"') || after.startsWith('"tool_calls"') || after.length === 0) {
        end = i;
        break;
      }
    }
    i++;
  }

  if (end !== -1) {
    var rawVal = text.substring(quoteIdx, end + 1);
    try {
      return JSON.parse(rawVal);
    } catch (_) {
      return text.substring(start, end)
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }

  return '';
}

function extractContentField(text) {
  if (!text) return '';
  var target = '"content":';
  var lastIdx = text.lastIndexOf(target);
  if (lastIdx === -1) return '';

  var quoteIdx = text.indexOf('"', lastIdx + target.length);
  if (quoteIdx === -1) return '';

  var start = quoteIdx + 1;
  var i = start;
  var end = -1;
  while (i < text.length) {
    if (text[i] === '"' && text[i - 1] !== '\\') {
      var after = text.substring(i + 1).trim();
      if (after.startsWith(',') || after.startsWith('}') || after.startsWith('"tool_calls"') || after.startsWith('"finish_reason"') || after.length === 0) {
        end = i;
        break;
      }
    }
    i++;
  }

  if (end !== -1) {
    var rawVal = text.substring(quoteIdx, end + 1);
    try {
      return JSON.parse(rawVal);
    } catch (_) {
      return text.substring(start, end)
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }

  return '';
}

function extractToolCallsField(text) {
  if (!text) return [];
  var target = '"tool_calls":';
  var lastIdx = text.lastIndexOf(target);
  if (lastIdx === -1) return [];

  var bracketIdx = text.indexOf('[', lastIdx + target.length);
  if (bracketIdx === -1) return [];

  var depth = 0;
  var end = -1;
  for (var i = bracketIdx; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end !== -1) {
    try {
      return JSON.parse(text.substring(bracketIdx, end + 1));
    } catch (_) { void 0; }
  }
  return [];
}

export function cleanAndParseOpenAiJson(raw) {
  var s = (raw || '').trim();
  s = stripServerNoise(s);
  if (s.startsWith('```json')) s = s.substring(7);
  else if (s.startsWith('```')) s = s.substring(3);
  if (s.endsWith('```')) s = s.substring(0, s.length - 3);
  s = stripServerNoise(s).trim();

  try {
    return JSON.parse(s);
  } catch (_) { void 0; }

  var start = s.indexOf('{');
  var end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(s.substring(start, end + 1));
    } catch (_) { void 0; }
  }

  if (s.includes('"chatcmpl') || s.includes('"choices"') || s.includes('"role": "assistant"') || s.includes('"tool_calls"')) {
    var extractedReasoning = extractReasoningField(s);
    var extractedContent = extractContentField(s);
    var extractedTools = extractToolCallsField(s);

    if (extractedContent || extractedTools.length > 0 || extractedReasoning) {
      return {
        id: 'chatcmpl-qwen',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              reasoning: extractedReasoning,
              content: extractedContent,
              tool_calls: extractedTools
            },
            finish_reason: extractedTools.length > 0 ? 'tool_calls' : 'stop'
          }
        ]
      };
    }
  }

  return null;
}

export function parseTextToolCalls(text) {
  var toolCalls = [];
  var idx = 0;

  var markdownRegex = /```json\s*(\{[\s\S]*?\})\s*(?:```|$)/g;
  var match;
  while ((match = markdownRegex.exec(text)) !== null) {
    try {
      var obj = JSON.parse(match[1].trim());
      if (obj && Array.isArray(obj.tool_calls)) {
        for (var i = 0; i < obj.tool_calls.length; i++) {
          var tc = obj.tool_calls[i];
          var tcName = (tc && tc.function && tc.function.name) || (tc && tc.name) || '';
          var tcArgsRaw = (tc && tc.function && tc.function.arguments !== undefined) ? tc.function.arguments : (tc && tc.arguments);
          var tcArgs = typeof tcArgsRaw === 'object' ? JSON.stringify(tcArgsRaw) : String(tcArgsRaw || '');
          toolCalls.push({
            id: 'text_call_' + idx++,
            type: 'function',
            function: {
              name: tcName,
              arguments: tcArgs
            }
          });
        }
      }
    } catch (_) { void 0; }
  }

  if (toolCalls.length === 0) {
    var firstBrace = text.indexOf('{');
    var lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      var potentialJson = text.substring(firstBrace, lastBrace + 1);
      if (potentialJson.includes('"tool_calls"')) {
        try {
          var obj2 = JSON.parse(potentialJson.trim());
          if (obj2 && Array.isArray(obj2.tool_calls)) {
            for (var j = 0; j < obj2.tool_calls.length; j++) {
              var tc2 = obj2.tool_calls[j];
              var tc2Name = (tc2 && tc2.function && tc2.function.name) || (tc2 && tc2.name) || '';
              var tc2ArgsRaw = (tc2 && tc2.function && tc2.function.arguments !== undefined) ? tc2.function.arguments : (tc2 && tc2.arguments);
              var tc2Args = typeof tc2ArgsRaw === 'object' ? JSON.stringify(tc2ArgsRaw) : String(tc2ArgsRaw || '');
              toolCalls.push({
                id: 'text_call_' + idx++,
                type: 'function',
                function: {
                  name: tc2Name,
                  arguments: tc2Args
                }
              });
            }
          }
        } catch (_) { void 0; }
      }
    }
  }
  return toolCalls;
}

export async function* chat(config, messages, tools, options) {
  var systemContent = '';
  for (var sIdx = 0; sIdx < messages.length; sIdx++) {
    if (messages[sIdx].role === 'system') {
      systemContent = messages[sIdx].content;
      break;
    }
  }

  var serialized = serializeMessages(messages, systemContent, tools);

  var validToolNames = new Set();
  if (tools && Array.isArray(tools)) {
    for (var ti = 0; ti < tools.length; ti++) {
      var tObj = tools[ti];
      var tName = (tObj.function && tObj.function.name) || tObj.name;
      if (tName) validToolNames.add(tName);
    }
  }

  var cookieStr = (config && config.apiKey) || lastSessionCookie || '';
  if (!cookieStr && typeof globalThis.qwenGetActiveCookie === 'function') {
    cookieStr = globalThis.qwenGetActiveCookie();
  }
  if (!cookieStr) {
    var missingAuthErr = new Error('Qwen session token expired or missing. Please sign in with Qwen to continue.');
    missingAuthErr.isAuthError = true;
    missingAuthErr.code = 'UNAUTHORIZED';
    throw missingAuthErr;
  }
  lastSessionCookie = cookieStr;

  cookieStr = cookieStr.trim();
  if (cookieStr.startsWith('eyJ')) {
    cookieStr = 'token=' + cookieStr;
  }

  var qwenModel = config.model || 'qwen3.7-plus';

  var sId = (config && (config.sessionId || config.conversationId || config.convId)) || '';
  if (!sId && Array.isArray(messages)) {
    for (var mi = 0; mi < messages.length; mi++) {
      var item = messages[mi];
      if (item && (item.sessionId || item.session_id || item.conversationId)) {
        sId = item.sessionId || item.session_id || item.conversationId;
        break;
      }
    }
    if (!sId) {
      for (var mj = 0; mj < messages.length; mj++) {
        if (messages[mj] && messages[mj].role === 'user' && messages[mj].content) {
          sId = 'chat_' + String(messages[mj].content).substring(0, 40).replace(/[^a-zA-Z0-9_]/g, '_');
          break;
        }
      }
    }
  }
  if (!sId) {
    sId = 'chat_' + Date.now();
  }

  var sessionEntry = sessionChatMap[sId];
  var qwenChatId = (config && config.chatId) || (sessionEntry && sessionEntry.chatId) || null;

  var initHeaders = buildQwenHeaders(cookieStr);
  if (!qwenChatId) {
    qwenChatId = await createNewQwenChat(qwenModel, initHeaders);
    sessionChatMap[sId] = { chatId: qwenChatId, model: qwenModel, lastAssistantMsgId: null };
  }
  activeQwenChatId = qwenChatId;
  if (config) config.chatId = qwenChatId;

  try {

  // Upload pending attachments / images to OSS
  var pendingUploads = [];
  var seenDataMap = new Set();

  function addPendingUpload(item, defaultName) {
    if (!item) return;
    var rawData = item.data || item;
    var dataSig = (typeof rawData === 'string') ? (rawData.substring(0, 100) + '_' + rawData.length) : String(rawData);
    if (seenDataMap.has(dataSig)) return;
    seenDataMap.add(dataSig);
    if (typeof item === 'object' && item.data) {
      pendingUploads.push(item);
    } else {
      pendingUploads.push({ data: item, name: defaultName });
    }
  }

  for (var mIdx = 0; mIdx < messages.length; mIdx++) {
    var msgItem = messages[mIdx];
    if (msgItem.role === 'user') {
      if (msgItem.attachments && Array.isArray(msgItem.attachments)) {
        for (var attIdx = 0; attIdx < msgItem.attachments.length; attIdx++) {
          addPendingUpload(msgItem.attachments[attIdx], 'attachment_' + (attIdx + 1));
        }
      } else if (msgItem.attachment) {
        addPendingUpload(msgItem.attachment, 'attachment');
      }
      if (msgItem.images && Array.isArray(msgItem.images)) {
        for (var imgIdx = 0; imgIdx < msgItem.images.length; imgIdx++) {
          addPendingUpload(msgItem.images[imgIdx], 'image_' + (imgIdx + 1) + '.png');
        }
      } else if (msgItem.image) {
        addPendingUpload(msgItem.image, 'image.png');
      }
      if (msgItem.files && Array.isArray(msgItem.files)) {
        for (var fIdx = 0; fIdx < msgItem.files.length; fIdx++) {
          addPendingUpload(msgItem.files[fIdx], 'file_' + (fIdx + 1));
        }
      }
    }
  }

  var qwenFiles = [];
  var seenFileIds = new Set();
  if (pendingUploads.length > 0) {
    var uploadHeaders = buildQwenHeaders(cookieStr, activeQwenChatId);
    for (var u = 0; u < pendingUploads.length; u++) {
      try {
        var uploadItem = pendingUploads[u];
        var uploadedFileObj = await uploadFileToQwenOss(uploadItem, uploadItem.name, uploadHeaders);
        if (uploadedFileObj && !seenFileIds.has(uploadedFileObj.id)) {
          seenFileIds.add(uploadedFileObj.id);
          qwenFiles.push(uploadedFileObj);
        }
      } catch (uploadErr) {
        console.error('[QWEN] Error uploading file to OSS:', uploadErr);
      }
    }
  }

  var url = 'https://chat.qwen.ai/api/v2/chat/completions?chat_id=' + activeQwenChatId;

  var prevMsgId = (sessionEntry && sessionEntry.lastAssistantMsgId) || lastAssistantMsgId || null;

  var payloadMsg = {
    fid: generateUuid(),
    parentId: prevMsgId,
    childrenIds: [generateUuid()],
    role: 'user',
    content: serialized,
    user_action: 'chat',
    files: qwenFiles,
    timestamp: Date.now(),
    models: [qwenModel],
    chat_type: 't2t',
    feature_config: {
      output_schema: 'phase',
      thinking_enabled: config.showThinking !== false,
      auto_thinking: true,
      thinking_mode: 'Auto',
      thinking_format: 'summary',
      auto_search: true
    },
    extra: { meta: { subChatType: 't2t' } },
    sub_chat_type: 't2t',
    parent_id: prevMsgId
  };

  var body = {
    chatId: activeQwenChatId,
    chat_id: activeQwenChatId,
    chat_mode: 'normal',
    incremental_output: true,
    model: qwenModel,
    stream: true,
    version: '2.1',
    parent_id: prevMsgId,
    messages: [payloadMsg],
    timestamp: Date.now()
  };

  var response = await fetch(url, {
    method: 'POST',
    headers: buildQwenHeaders(cookieStr, activeQwenChatId),
    body: JSON.stringify(body)
  });

  function updateSessionCookiesFromHeaders(resp) {
    if (!resp || !resp.headers) return;
    var setCookies = [];
    if (typeof resp.headers.getSetCookie === 'function') {
      setCookies = resp.headers.getSetCookie();
    } else if (resp.headers.get('set-cookie')) {
      setCookies = [resp.headers.get('set-cookie')];
    }
    if (setCookies.length > 0 && typeof globalThis.qwenOnCookieUpdate === 'function') {
      var merged = typeof globalThis.qwenMergeSetCookies === 'function' ? globalThis.qwenMergeSetCookies(cookieStr, setCookies) : cookieStr;
      if (merged && merged !== cookieStr) {
        lastSessionCookie = merged;
        globalThis.qwenOnCookieUpdate(merged);
      }
    }
  }

  updateSessionCookiesFromHeaders(response);

  var contentType = (response.headers.get('content-type') || '').toLowerCase();

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      var authErr3 = new Error('Qwen session token expired. Please log in again.');
      authErr3.isAuthError = true;
      authErr3.code = 'UNAUTHORIZED';
      throw authErr3;
    }
    if (response.status === 400 || response.status === 404) {
      console.log('[QWEN] Chat session returned HTTP ' + response.status + '. Creating fresh session...');
      qwenChatId = await createNewQwenChat(qwenModel, buildQwenHeaders(cookieStr));
      activeQwenChatId = qwenChatId;
      if (config) config.chatId = qwenChatId;
      if (sessionChatMap[sId]) {
        sessionChatMap[sId].chatId = qwenChatId;
        sessionChatMap[sId].lastAssistantMsgId = null;
      }
      url = 'https://chat.qwen.ai/api/v2/chat/completions?chat_id=' + qwenChatId;
      body.chatId = qwenChatId;
      body.chat_id = qwenChatId;
      body.parent_id = null;
      payloadMsg.parentId = null;
      payloadMsg.parent_id = null;
      response = await fetch(url, {
        method: 'POST',
        headers: buildQwenHeaders(cookieStr, qwenChatId),
        body: JSON.stringify(body)
      });
      contentType = (response.headers.get('content-type') || '').toLowerCase();
    }
    if (!response.ok) {
      throw new Error('Qwen API Error: HTTP ' + response.status + ' ' + response.statusText);
    }
  }

  // Handle non-SSE responses returned with HTTP 200 (Alibaba Captcha / WAF blocks)
  if (contentType.indexOf('application/json') !== -1) {
    var jsonErrData = {};
    try {
      jsonErrData = await response.json();
    } catch (_) { void 0; }

    var retStr = JSON.stringify(jsonErrData.ret || '');
    var dataUrl = (jsonErrData.data && jsonErrData.data.url) || '';
    if (retStr.indexOf('FAIL_SYS_USER_VALIDATE') !== -1 || dataUrl.indexOf('captcha') !== -1 || dataUrl.indexOf('punish') !== -1) {
      var compCaptchaErr = new Error('Alibaba Cloud security verification required (slider captcha).');
      compCaptchaErr.isCaptcha = true;
      compCaptchaErr.captchaUrl = dataUrl || 'https://chat.qwen.ai';
      compCaptchaErr.chatId = activeQwenChatId;
      throw compCaptchaErr;
    }

    var code = (jsonErrData.data && jsonErrData.data.code) || jsonErrData.code || '';
    var details = (jsonErrData.data && jsonErrData.data.details) || jsonErrData.message || jsonErrData.details || '';

    var isSessionStuck = details && (
      details.indexOf('deleted') !== -1 ||
      details.indexOf('not found') !== -1 ||
      details.indexOf('not exist') !== -1 ||
      details.indexOf('in progress') !== -1 ||
      details.indexOf('in_progress') !== -1
    );

    if (isSessionStuck) {
      console.log('[QWEN] Chat session stuck (' + details + '). Freeing session and creating fresh chat...');
      await stopQwenChat(qwenChatId, buildQwenHeaders(cookieStr, qwenChatId)).catch(function() {});
      qwenChatId = await createNewQwenChat(qwenModel, buildQwenHeaders(cookieStr));
      activeQwenChatId = qwenChatId;
      if (config) config.chatId = qwenChatId;
      if (sessionChatMap[sId]) {
        sessionChatMap[sId].chatId = qwenChatId;
        sessionChatMap[sId].lastAssistantMsgId = null;
      }
      url = 'https://chat.qwen.ai/api/v2/chat/completions?chat_id=' + qwenChatId;
      body.chatId = qwenChatId;
      body.chat_id = qwenChatId;
      body.parent_id = null;
      payloadMsg.parentId = null;
      payloadMsg.parent_id = null;
      response = await fetch(url, {
        method: 'POST',
        headers: buildQwenHeaders(cookieStr, qwenChatId),
        body: JSON.stringify(body)
      });
      contentType = (response.headers.get('content-type') || '').toLowerCase();
    }

    var isAuthFailure = code === 'unauthorized' || (typeof details === 'string' && (
      details.indexOf('guest chat limit') !== -1 ||
      details.indexOf('Log in to continue') !== -1 ||
      details.indexOf('expired') !== -1 ||
      details.indexOf('unauthorized') !== -1
    ));

    if (isAuthFailure) {
      var authErrJson = new Error(details || 'Qwen session token expired. Please log in again.');
      authErrJson.isAuthError = true;
      authErrJson.code = 'UNAUTHORIZED';
      throw authErrJson;
    }

    if (contentType.indexOf('application/json') !== -1) {
      throw new Error('Qwen API Error: ' + (details || JSON.stringify(jsonErrData)));
    }
  }

  if (contentType.indexOf('text/html') !== -1) {
    var compHtmlErr = new Error('Alibaba Cloud security challenge detected (WAF HTML). Please complete verification in browser.');
    compHtmlErr.isCaptcha = true;
    compHtmlErr.captchaUrl = 'https://chat.qwen.ai';
    throw compHtmlErr;
  }

  if (!response.body) {
    throw new Error('Qwen API Error: Response body is empty.');
  }

  var reader = response.body.getReader();
  var decoder = new TextDecoder('utf-8');
  var streamBuffer = '';
  var accumContent = '';
  var extractor = createJsonStreamExtractor();
  var streamedAnyThinking = false;
  var streamedAnyContent = false;
  var streamedImageUrls = new Set();
  var modeDecided = false;
  var isJsonMode = false;
  var initialBuffer = '';

  while (true) {
    var chunk = await reader.read();
    if (chunk.done) break;
    streamBuffer += decoder.decode(chunk.value, { stream: true });
    var lines = streamBuffer.split('\n');
    streamBuffer = lines.pop();
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith('data: ')) {
        var dataStr = line.substring(6);
        if (dataStr.trim() === '[DONE]') break;
        try {
          var data = JSON.parse(dataStr);
          if (data && data.success === false) {
            var sseErrMsg = (data.data && data.data.details) || data.message || data.details || JSON.stringify(data);
            var sseErr = new Error(sseErrMsg);
            var isSseAuth = data.code === 'unauthorized' ||
              (data.data && data.data.code === 'unauthorized') ||
              (typeof sseErrMsg === 'string' && (
                sseErrMsg.indexOf('guest chat limit') !== -1 ||
                sseErrMsg.indexOf('Log in to continue') !== -1 ||
                sseErrMsg.indexOf('expired') !== -1 ||
                sseErrMsg.indexOf('unauthorized') !== -1
              ));
            if (isSseAuth) {
              sseErr.isAuthError = true;
              sseErr.code = 'UNAUTHORIZED';
            }
            throw sseErr;
          }
          if (data && data.ret && JSON.stringify(data.ret).indexOf('FAIL_SYS_USER_VALIDATE') !== -1) {
            var sseCaptchaErr = new Error('Alibaba Cloud slider verification required.');
            sseCaptchaErr.isCaptcha = true;
            sseCaptchaErr.captchaUrl = (data.data && data.data.url) || 'https://chat.qwen.ai';
            throw sseCaptchaErr;
          }
          if (data && data.code === 'unauthorized') {
            var sseAuthErr = new Error('Qwen session token expired. Please log in again.');
            sseAuthErr.isAuthError = true;
            sseAuthErr.code = 'UNAUTHORIZED';
            throw sseAuthErr;
          }
          if (data && (data.id || data.msg_id || data.message_id)) {
            var mid = data.id || data.msg_id || data.message_id;
            lastAssistantMsgId = mid;
            if (sessionChatMap[sId]) {
              sessionChatMap[sId].lastAssistantMsgId = mid;
            }
          }

          var choice = data.choices && data.choices[0];
          if (choice) {
            var delta = choice.delta || {};
            var deltaContent = delta.content || '';
            var deltaExtra = delta.extra || {};

            // Intercept Qwen native image generation tool phase
            if (delta.phase === 'image_gen_tool' || deltaExtra.image_list || deltaExtra.tool_result) {
              var imgList = deltaExtra.image_list || deltaExtra.tool_result || [];
              for (var imgI = 0; imgI < imgList.length; imgI++) {
                var imgUrl = imgList[imgI] && (imgList[imgI].image || imgList[imgI].url);
                if (imgUrl && !streamedImageUrls.has(imgUrl)) {
                  streamedImageUrls.add(imgUrl);
                  streamedAnyContent = true;
                  var imgMd = '\n\n![Generated Image](' + imgUrl + ')\n\n';
                  accumContent += imgMd;
                  yield { content: imgMd };
                }
              }
            }

            // Native Qwen Thinking Phase
            if (delta.phase === 'think') {
              if (deltaContent) {
                streamedAnyThinking = true;
                yield { thinking: deltaContent };
              }
              continue;
            }

            // Answer / Tool execution phase
            if (deltaContent) {
              // Deduplicate any markdown image containing an image URL already streamed
              if (streamedImageUrls.size > 0) {
                var streamedUrlsArr = Array.from(streamedImageUrls);
                for (var uIdx = 0; uIdx < streamedUrlsArr.length; uIdx++) {
                  var sUrl = streamedUrlsArr[uIdx];
                  if (deltaContent.indexOf(sUrl) !== -1) {
                    var escapedUrl = sUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    var mdImgPattern = new RegExp('!\\[[^\\]]*\\]\\(' + escapedUrl + '\\)', 'g');
                    deltaContent = deltaContent.replace(mdImgPattern, '');
                  }
                }
              }

              var cleanedChunk = stripServerNoise(deltaContent);
              if (!cleanedChunk && deltaContent) {
                continue;
              }

              accumContent += cleanedChunk;

              if (!modeDecided) {
                initialBuffer += cleanedChunk;
                var trimmedInit = stripServerNoise(initialBuffer).trim();
                if (!trimmedInit) {
                  continue;
                }

                var looksLikeJson = trimmedInit.startsWith('{') ||
                                    trimmedInit.startsWith('```json') ||
                                    trimmedInit.startsWith('```\n{') ||
                                    trimmedInit.includes('"choices"') ||
                                    trimmedInit.includes('"message"') ||
                                    trimmedInit.includes('"tool_calls"');

                if (looksLikeJson) {
                  modeDecided = true;
                  isJsonMode = true;
                  var initStreamed = extractor.push(trimmedInit);
                  var initChunk = {};
                  if (initStreamed.thinking) {
                    initChunk.thinking = initStreamed.thinking;
                    streamedAnyThinking = true;
                  }
                  if (initStreamed.content) {
                    initChunk.content = initStreamed.content;
                    streamedAnyContent = true;
                  }
                  if (initChunk.thinking || initChunk.content) {
                    yield initChunk;
                  }
                } else if (trimmedInit.length >= 80) {
                  modeDecided = true;
                  isJsonMode = false;
                  streamedAnyContent = true;
                  yield { content: trimmedInit };
                }
              } else if (isJsonMode) {
                var streamed = extractor.push(cleanedChunk);
                var resultChunk = {};
                if (streamed.thinking) {
                  resultChunk.thinking = streamed.thinking;
                  streamedAnyThinking = true;
                }
                if (streamed.content) {
                  resultChunk.content = streamed.content;
                  streamedAnyContent = true;
                }
                if (resultChunk.thinking || resultChunk.content) {
                  yield resultChunk;
                }
              } else {
                // Conversational plain text / markdown streaming
                streamedAnyContent = true;
                yield { content: cleanedChunk };
              }
            }
          }
        } catch (e) {
          if (e.isAuthError || e.isCaptcha) throw e;
        }
      }
    }
  }

  // Handle case where total content was shorter than 80 chars and mode was not decided yet
  if (!modeDecided && initialBuffer) {
    var finalInit = stripServerNoise(initialBuffer).trim();
    if (finalInit.startsWith('{') || finalInit.startsWith('```json') || finalInit.includes('"choices"') || finalInit.includes('"message"') || finalInit.includes('"tool_calls"')) {
      modeDecided = true;
      isJsonMode = true;
    } else if (finalInit && !streamedAnyContent) {
      modeDecided = true;
      isJsonMode = false;
      streamedAnyContent = true;
      yield { content: finalInit };
    }
  }

  // Post-stream parse: Process accumulated response as OpenAI chat.completion JSON
  var cleanedTotal = stripServerNoise(accumContent);
  var parsed = cleanAndParseOpenAiJson(cleanedTotal);
  if (parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
    var msg = parsed.choices[0].message;
    var postResult = {};

    if (msg.reasoning && !streamedAnyThinking) {
      postResult.thinking = msg.reasoning;
      streamedAnyThinking = true;
    }
    if (msg.content && !streamedAnyContent) {
      postResult.content = msg.content;
      streamedAnyContent = true;
    }
    if (postResult.thinking || postResult.content) {
      yield postResult;
    }

    if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      var formattedCalls = [];
      for (var tcIdx = 0; tcIdx < msg.tool_calls.length; tcIdx++) {
        var rawTc = msg.tool_calls[tcIdx];
        var fn = rawTc.function || rawTc;
        var fnName = fn.name;
        if (fnName === 'image_edit' || fnName === 'edit_image') {
          fnName = 'generate_image';
        }
        if (fnName === 'generate_image' && streamedImageUrls.size > 0) {
          continue;
        }
        if (validToolNames && validToolNames.size > 0 && !validToolNames.has(fnName)) {
          continue;
        }
        var args = fn.arguments;
        if (typeof args === 'object' && args !== null) {
          args = JSON.stringify(args);
        }
        var callId = rawTc.id || ('call_' + tcIdx);
        formattedCalls.push({
          id: callId,
          type: 'function',
          index: tcIdx,
          function: {
            name: fnName,
            arguments: String(args || '')
          }
        });
      }
      if (formattedCalls.length > 0) {
        yield { tool_calls: formattedCalls };
      }
    }
  } else {
    var fallbackCalls = parseTextToolCalls(cleanedTotal);
    if (fallbackCalls && fallbackCalls.length) {
      var filteredFallback = [];
      for (var fbi = 0; fbi < fallbackCalls.length; fbi++) {
        var fbItem = fallbackCalls[fbi];
        var fbName = (fbItem.function && fbItem.function.name) || fbItem.name;
        if (fbName === 'image_edit' || fbName === 'edit_image') {
          fbName = 'generate_image';
          if (fbItem.function) fbItem.function.name = 'generate_image';
        }
        if (fbName === 'generate_image' && streamedImageUrls.size > 0) {
          continue;
        }
        if (validToolNames && validToolNames.size > 0 && !validToolNames.has(fbName)) {
          continue;
        }
        filteredFallback.push(fbItem);
      }
      if (filteredFallback.length > 0) {
        yield { tool_calls: filteredFallback };
      }
    } else if (!streamedAnyContent && cleanedTotal) {
      var trimmed = cleanedTotal.trim();
      if (trimmed.startsWith('{') && (trimmed.includes('"chatcmpl') || trimmed.includes('"choices"') || trimmed.includes('"message"'))) {
        var rescuedTools = extractToolCallsField(trimmed);
        if (rescuedTools && rescuedTools.length > 0) {
          var formattedRescued = [];
          for (var rIdx = 0; rIdx < rescuedTools.length; rIdx++) {
            var rTc = rescuedTools[rIdx];
            var rFn = rTc.function || rTc;
            var rName = rFn.name;
            if (rName === 'image_edit' || rName === 'edit_image') {
              rName = 'generate_image';
            }
            if (rName === 'generate_image' && streamedImageUrls.size > 0) {
              continue;
            }
            if (validToolNames && validToolNames.size > 0 && !validToolNames.has(rName)) {
              continue;
            }
            var rArgs = rFn.arguments;
            if (typeof rArgs === 'object' && rArgs !== null) {
              rArgs = JSON.stringify(rArgs);
            }
            formattedRescued.push({
              id: rTc.id || ('call_' + rIdx),
              type: 'function',
              index: rIdx,
              function: {
                name: rName,
                arguments: String(rArgs || '')
              }
            });
          }
          if (formattedRescued.length > 0) {
            yield { tool_calls: formattedRescued };
          }
        } else {
          var rescuedContent = extractContentField(trimmed);
          if (rescuedContent) {
            yield { content: rescuedContent };
          }
        }
      } else if (!trimmed.startsWith('{') && !trimmed.includes('"choices"')) {
        yield { content: trimmed };
      }
    }
  }

  if (!accumContent) {
    var emptyStreamErr = new Error('Qwen returned an empty response. The connection may have timed out.');
    emptyStreamErr.isAuthError = false;
    throw emptyStreamErr;
  }
} finally {
  // Chat session is kept alive across turns so user's conversation on Qwen is preserved,
  // while context is fully maintained via serialized messages on every turn just like standard APIs.
}
}

export async function listModels(config) {
  var defaultModels = [
    'qwen3.7-plus',
    'qwen3.8-max',
    'qwen3.8-omni-flash',
    'qwen3.7-max',
    'qwen3.6-plus',
    'qwen3.5-plus',
    'qwen3.5-omni-plus'
  ];
  try {
    var cookieStr = (config && config.apiKey) || lastSessionCookie || '';
    if (!cookieStr && typeof globalThis.qwenGetActiveCookie === 'function') {
      cookieStr = globalThis.qwenGetActiveCookie();
    }
    if (!cookieStr) return defaultModels;
    lastSessionCookie = cookieStr;
    var headers = buildQwenHeaders(cookieStr);
    var res = await fetch('https://chat.qwen.ai/api/v2/models', { headers: headers });
    if (!res.ok) return defaultModels;
    var json = await res.json();
    var list = (json && json.data && Array.isArray(json.data.data)) ? json.data.data : ((json && Array.isArray(json.data)) ? json.data : []);
    if (list && list.length > 0) {
      var models = [];
      for (var j = 0; j < list.length; j++) {
        var item = list[j];
        if (item && item.id) models.push(item.id);
      }
      if (models.length < 5) {
        for (var mi = 0; mi < defaultModels.length; mi++) {
          if (!models.includes(defaultModels[mi])) {
            models.push(defaultModels[mi]);
          }
        }
      }
      return models.length > 0 ? models : defaultModels;
    }
  } catch (_) { void 0; }
  return defaultModels;
}

export async function embeddings(config, texts) {
  throw new Error('Embeddings not supported by Qwen Browser API');
}

export async function images(config, prompt) {
  config = config || {};
  var cookieStr = (config && config.apiKey) || lastSessionCookie || '';
  if (!cookieStr) {
    throw new Error('Qwen session token or cookie required for image generation.');
  }
  lastSessionCookie = cookieStr;

  cookieStr = cookieStr.trim();
  if (cookieStr.startsWith('eyJ')) {
    cookieStr = 'token=' + cookieStr;
  }

  var createRes = await fetch('https://chat.qwen.ai/api/v2/chats/new', {
    method: 'POST',
    headers: buildQwenHeaders(cookieStr),
    body: JSON.stringify({
      title: 'Image: ' + (prompt ? prompt.slice(0, 30) : 'Generation'),
      models: [config.model || 'qwen3.8-max'],
      chat_mode: 'normal',
      chat_type: 't2t',
      timestamp: Date.now()
    })
  });
  var createData = await createRes.json();
  if (!createData || !createData.success || !createData.data || !createData.data.id) {
    var errMsg = (createData && createData.data && createData.data.details) || JSON.stringify(createData);
    throw new Error('Failed to create Qwen chat session for image generation: ' + errMsg);
  }
  var chatId = createData.data.id;

  var payloadMsg = {
    fid: generateUuid(),
    parentId: null,
    childrenIds: [generateUuid()],
    role: 'user',
    content: 'generate an image of ' + prompt,
    user_action: 'chat',
    files: [],
    timestamp: Date.now(),
    models: [config.model || 'qwen3.8-max'],
    chat_type: 't2t',
    feature_config: {
      output_schema: 'phase',
      thinking_enabled: false
    },
    extra: { meta: { subChatType: 't2t' } },
    sub_chat_type: 't2t',
    parent_id: null
  };

  var body = {
    chatId: chatId,
    chat_id: chatId,
    chat_mode: 'normal',
    incremental_output: true,
    model: config.model || 'qwen3.8-max',
    stream: true,
    version: '2.1',
    parent_id: null,
    messages: [payloadMsg],
    timestamp: Date.now()
  };

  var response = await fetch('https://chat.qwen.ai/api/v2/chat/completions?chat_id=' + chatId, {
    method: 'POST',
    headers: buildQwenHeaders(cookieStr, chatId),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error('Qwen Image Gen Error: HTTP ' + response.status);
  }

  var reader = response.body.getReader();
  var decoder = new TextDecoder('utf-8');
  var buffer = '';
  var foundImageUrl = null;

  while (true) {
    var chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    var lines = buffer.split('\n');
    buffer = lines.pop();
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || !line.startsWith('data:')) continue;
      var dataStr = line.substring(5).trim();
      if (dataStr === '[DONE]') break;
      try {
        var parsed = JSON.parse(dataStr);
        var delta = (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) || {};
        var deltaExtra = delta.extra || {};
        if (delta.phase === 'image_gen_tool' || deltaExtra.image_list || deltaExtra.tool_result) {
          var imgList = deltaExtra.image_list || deltaExtra.tool_result || [];
          for (var imgIdx = 0; imgIdx < imgList.length; imgIdx++) {
            var candidateUrl = imgList[imgIdx] && (imgList[imgIdx].image || imgList[imgIdx].url);
            if (candidateUrl) {
              foundImageUrl = candidateUrl;
              break;
            }
          }
        }
        if (!foundImageUrl && delta.content) {
          var directMatch = delta.content.match(/(https:\/\/cdn\.qwenlm\.ai\/output\/[^\s"')]+)/) ||
                            delta.content.match(/!\[.*?\]\((https?:\/\/[^\s"')]+)\)/);
          if (directMatch) {
            foundImageUrl = directMatch[1];
          }
        }
      } catch (_) { void 0; }
    }
    if (foundImageUrl) break;
  }

  if (!foundImageUrl) {
    try {
      var dRes = await fetch('https://chat.qwen.ai/api/v2/chats/' + chatId, {
        headers: buildQwenHeaders(cookieStr, chatId)
      });
      if (dRes.ok) {
        var dData = await dRes.json();
        var chatMsgs = (dData && dData.data && dData.data.chat && dData.data.chat.messages) || [];
        for (var mi = 0; mi < chatMsgs.length; mi++) {
          var clList = chatMsgs[mi].content_list || [];
          for (var cli = 0; cli < clList.length; cli++) {
            var clItem = clList[cli];
            var imgArr = (clItem.extra && (clItem.extra.image_list || clItem.extra.tool_result)) || [];
            for (var ii = 0; ii < imgArr.length; ii++) {
              var u = imgArr[ii] && (imgArr[ii].image || imgArr[ii].url);
              if (u) {
                foundImageUrl = u;
                break;
              }
            }
            if (!foundImageUrl && clItem.content) {
              var histMatch = clItem.content.match(/(https:\/\/cdn\.qwenlm\.ai\/output\/[^\s"')]+)/) ||
                              clItem.content.match(/!\[.*?\]\((https?:\/\/[^\s"')]+)\)/);
              if (histMatch) foundImageUrl = histMatch[1];
            }
            if (foundImageUrl) break;
          }
          if (foundImageUrl) break;
        }
      }
    } catch (_) { void 0; }
  }

  // Cleanup temporary image chat session in background
  try {
    fetch('https://chat.qwen.ai/api/v2/chats/' + chatId, {
      method: 'DELETE',
      headers: buildQwenHeaders(cookieStr, chatId)
    }).catch(function() { void 0; });
  } catch (_) { void 0; }

  if (foundImageUrl) {
    return { data: [{ url: foundImageUrl }] };
  }
  throw new Error('Qwen did not return an image URL for the requested prompt.');
}

export async function stopChat(config) {
  if (!activeQwenChatId) return;
  var cookieStr = (config && config.apiKey) || lastSessionCookie || '';
  if (!cookieStr) return;
  lastSessionCookie = cookieStr;
  await stopQwenChat(activeQwenChatId, buildQwenHeaders(cookieStr, activeQwenChatId));
}

export async function deleteChat(config, chatIdOrSessionId) {
  var targetChatId = null;
  if (chatIdOrSessionId) {
    if (sessionChatMap[chatIdOrSessionId]) {
      targetChatId = sessionChatMap[chatIdOrSessionId].chatId;
      delete sessionChatMap[chatIdOrSessionId];
    } else {
      for (var sKey in sessionChatMap) {
        if (sessionChatMap[sKey] && sessionChatMap[sKey].chatId === chatIdOrSessionId) {
          targetChatId = chatIdOrSessionId;
          delete sessionChatMap[sKey];
          break;
        }
      }
      if (!targetChatId) targetChatId = chatIdOrSessionId;
    }
  } else {
    targetChatId = activeQwenChatId;
  }
  if (!targetChatId) return;
  var cookieStr = (config && config.apiKey) || lastSessionCookie || '';
  if (!cookieStr) return;
  lastSessionCookie = cookieStr;
  await deleteQwenChat(targetChatId, buildQwenHeaders(cookieStr, targetChatId)).catch(function() {});
  if (activeQwenChatId === targetChatId) {
    activeQwenChatId = null;
  }
}

export async function clearAllSessions(config) {
  var cookieStr = (config && config.apiKey) || lastSessionCookie || '';
  var headers = cookieStr ? buildQwenHeaders(cookieStr) : null;
  for (var sKey in sessionChatMap) {
    var entry = sessionChatMap[sKey];
    if (entry && entry.chatId && headers) {
      deleteQwenChat(entry.chatId, headers).catch(function() {});
    }
  }
  sessionChatMap = {};
  activeQwenChatId = null;
  lastAssistantMsgId = null;
}
