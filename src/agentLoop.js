// agentLoop.js — Core agent loop: Think → Plan → Act → Verify
// User Request → Prompt Builder → Provider → Model → Tool Calls? → Execute → Loop

import { MAX_ITERATIONS, EVENT_TYPES } from './constants.js';
import { buildMessages } from './promptBuilder.js';
import { createProvider } from './providerManager.js';
import { getDefinitions } from './toolDefinitions.js';
import * as toolRegistry from './toolRegistry.js';
import { formatToolResult } from './toolExecutor.js';
import { requestPermission } from './permissions.js';

export async function runAgentLoop(userPrompt, config, options) {
  options = options || {};
  var workspace = options.workspace || '';
  var history = options.history || [];
  var sendEvent = options.sendEvent || function() {};
  var askPermission = options.askPermission || requestPermission;
  var signal = options.signal || null;
  var maxIterations = config.maxIterations || MAX_ITERATIONS;

  var provider = createProvider(config);
  var messages = buildMessages(userPrompt, {
    workspace: workspace,
    history: history
  });

  var iteration = 0;
  var fullThinking = '';
  var fullContent = '';

  while (iteration < maxIterations) {
    // Cooperative stop: the webview sets signal.stopped = true to halt the
    // agent between iterations. The current LLM stream / tool call is
    // allowed to finish naturally so we don't leave the workspace in a
    // half-modified state.
    if (signal && signal.stopped) {
      console.log('[AGENT LOOP] Stop requested at iteration ' + iteration);
      sendEvent({
        type: EVENT_TYPES.AGENT_DONE,
        reason: 'stopped',
        content: fullContent,
        thinking: fullThinking
      });
      return { content: fullContent, thinking: fullThinking, done: false, stopped: true };
    }

    iteration++;
    console.log('[AGENT LOOP] Iteration ' + iteration + '/' + maxIterations);
    sendEvent({ type: EVENT_TYPES.AGENT_STATUS, status: 'thinking', iteration: iteration });

    var streamBuffer = '';
    var inThinkTag = false;
    var iterationThinking = '';
    var iterationContent = '';
    var toolCalls = [];

    // Stream from provider
    try {
      var stream = provider.chat(config, messages, getDefinitions());
      for await (var chunk of stream) {
        // Handle thinking tokens
        if (chunk.thinking) {
          iterationThinking += chunk.thinking;
          fullThinking += chunk.thinking;
          sendEvent({ message: { role: 'assistant', thinking: chunk.thinking } });
        }
        // Handle content with inline think tags (DeepSeek style)
        if (chunk.content) {
          var parsed = processThinkTags(chunk.content, inThinkTag, streamBuffer);
          inThinkTag = parsed.inThinkTag;
          streamBuffer = parsed.buffer;
          if (parsed.thinking) {
            iterationThinking += parsed.thinking;
            fullThinking += parsed.thinking;
            sendEvent({ message: { role: 'assistant', thinking: parsed.thinking } });
          }
          if (parsed.content) {
            iterationContent += parsed.content;
            fullContent += parsed.content;
            sendEvent({ message: { role: 'assistant', content: parsed.content } });
          }
        }
        // Handle tool calls
        // ──────────────────────────────────────────────────────────────
        // OpenAI-style streaming tool calls come as DELTAS, not complete
        // objects. Each chunk has `tool_calls: [{ index: 0, id?: "fc_xx",
        // function: { name?: "...", arguments: "<partial json>" } }, ...]`
        // The `arguments` field is a STRING that arrives in pieces and
        // must be accumulated + JSON.parsed at the end.
        //
        // Previous code pushed raw chunks into `toolCalls` and used the
        // FIRST chunk's `arguments` directly, which is always a partial
        // JSON like "{" — causing all tools to receive empty/wrong args.
        if (chunk.tool_calls && chunk.tool_calls.length) {
          for (var tc of chunk.tool_calls) {
            var tcIndex = (typeof tc.index === 'number') ? tc.index : toolCalls.length;
            if (!toolCalls[tcIndex]) {
              // First chunk for this tool call index — bootstrap the slot.
              toolCalls[tcIndex] = {
                index: tcIndex,
                id: tc.id,
                type: tc.type || 'function',
                function: {
                  name: (tc.function && tc.function.name) || tc.name || '',
                  arguments: ''
                }
              };
            }
            var slot = toolCalls[tcIndex];
            if (tc.id) slot.id = tc.id;
            if (tc.type) slot.type = tc.type;
            if (tc.function) {
              if (tc.function.name) slot.function.name = tc.function.name;
              if (typeof tc.function.arguments === 'string') {
                slot.function.arguments += tc.function.arguments;
              } else if (tc.function.arguments != null) {
                // Already parsed (some providers) — re-serialize for the
                // final JSON.parse round-trip below.
                try {
                  slot.function.arguments += JSON.stringify(tc.function.arguments);
                } catch (_) {
                  slot.function.arguments += String(tc.function.arguments);
                }
              }
            } else if (tc.name) {
              // Non-OpenAI shape: { name, arguments }
              slot.function.name = slot.function.name || tc.name;
              if (typeof tc.arguments === 'string') {
                slot.function.arguments += tc.arguments;
              } else if (tc.arguments != null) {
                try { slot.function.arguments += JSON.stringify(tc.arguments); }
                catch (_) { slot.function.arguments += String(tc.arguments); }
              }
            }
          }
          // Forward a synthesized view of tool_calls so the UI still sees
          // them as they stream. We emit a copy with the *current* partial
          // arguments so the chat can show the tool name + args as they
          // arrive.
          var streamingView = toolCalls.map(function(t) {
            return {
              index: t.index,
              id: t.id,
              type: t.type,
              function: { name: t.function.name, arguments: t.function.arguments }
            };
          });
          sendEvent({ message: { role: 'assistant', tool_calls: streamingView } });
        }
      }
    } catch (err) {
      sendEvent({ type: EVENT_TYPES.AGENT_ERROR, message: err.message });
      throw err;
    }

    // Flush remaining buffer
    if (streamBuffer.length > 0) {
      if (inThinkTag) {
        fullThinking += streamBuffer;
        sendEvent({ message: { role: 'assistant', thinking: streamBuffer } });
      } else {
        fullContent += streamBuffer;
        sendEvent({ message: { role: 'assistant', content: streamBuffer } });
      }
    }

    // Compact the sparse `toolCalls` array (we may have indexed slots that
    // are not contiguous if the model did not emit `index: 0` first).
    // We also JSON.parse the accumulated `arguments` string here.
    var completedToolCalls = toolCalls
      .filter(function(t) { return !!t; })
      .map(function(t) {
        var rawArgs = t.function && t.function.arguments;
        var parsedArgs = {};
        if (typeof rawArgs === 'string') {
          var trimmed = rawArgs.trim();
          if (trimmed.length > 0) {
            try {
              parsedArgs = JSON.parse(trimmed);
              if (parsedArgs == null || typeof parsedArgs !== 'object') {
                parsedArgs = {};
              }
            } catch (e) {
              console.error('[AGENT LOOP] Failed to parse tool args for', t.function && t.function.name, ':', e.message, 'raw:', trimmed);
              parsedArgs = {};
            }
          }
        } else if (rawArgs && typeof rawArgs === 'object') {
          parsedArgs = rawArgs;
        }
        return {
          id: t.id,
          type: t.type,
          function: {
            name: t.function && t.function.name,
            arguments: parsedArgs
          }
        };
      });

    // No tool calls = we're done
    if (completedToolCalls.length === 0) {
      sendEvent({ type: EVENT_TYPES.AGENT_DONE, reason: 'direct_answer', content: fullContent, thinking: fullThinking });
      return { content: fullContent, thinking: fullThinking, done: true };
    }

    // Execute tools
    sendEvent({ type: EVENT_TYPES.AGENT_STATUS, status: 'executing_tools', count: completedToolCalls.length });
    var toolResults = [];

    for (var i = 0; i < completedToolCalls.length; i++) {
      var tc = completedToolCalls[i];
      var toolName = tc.function?.name;
      var args = tc.function?.arguments || {};
      var tcId = tc.id || 'call_' + iteration + '_' + i;

      // Permission check
      var approved = await askPermission(toolName, args, tcId, sendEvent);
      if (!approved) {
        sendEvent({ type: EVENT_TYPES.TOOL_RESULT, tool: toolName, success: false, message: 'Permission denied by user.' });
        toolResults.push({ tool_name: toolName, tool_call_id: tcId, formattedResult: 'Permission denied.' });
        continue;
      }

      // Execute tool
      console.log('[AGENT LOOP] Running tool: ' + toolName);
      var lastResult = null;
      try {
        var generator = toolRegistry.execute(toolName, args, workspace);
        for await (var event of generator) {
          sendEvent(event);
          if (event.type === 'tool_result') {
            lastResult = event;
          }
        }
      } catch (err) {
        sendEvent({ type: EVENT_TYPES.TOOL_RESULT, tool: toolName, success: false, message: err.message });
        lastResult = { success: false, message: err.message };
      }

      toolResults.push({
        tool_name: toolName,
        tool_call_id: tcId,
        formattedResult: formatToolResult(toolName, lastResult)
      });
    }

    sendEvent({ type: EVENT_TYPES.AGENT_ITERATION, iteration: iteration, phase: 'tools_executed' });

    // Build assistant message with tool calls.
    // ──────────────────────────────────────────────────────────────
    // Different providers expect `arguments` in different formats when we
    // echo an assistant message back into the history:
    //
    //   • Ollama:   arguments must be a JSON OBJECT (not a string)
    //   • OpenAI / Anthropic / Gemini / OpenRouter / Groq / xAI:
    //               arguments must be a JSON STRING
    //
    // Sending the wrong format makes Ollama throw HTTP 400 with
    // "Value looks like object, but can't find closing '}' symbol"
    // because it tries to parse a stringified object as JSON.
    var isOllama = (config.provider === 'ollama');
    var assistantToolCalls = completedToolCalls.map(function(t) {
      var args = (t.function && t.function.arguments) || {};
      return {
        id: t.id,
        type: t.type || 'function',
        function: {
          name: t.function && t.function.name,
          arguments: isOllama ? args : JSON.stringify(args)
        }
      };
    });
    var assistantMsg = { role: 'assistant', content: iterationContent || '' };
    if (iterationThinking) {
      assistantMsg.content = '\uE000' + iterationThinking + '\uE001\n' + (assistantMsg.content || '');
    }
    if (assistantToolCalls.length) assistantMsg.tool_calls = assistantToolCalls;
    messages.push(assistantMsg);

    // Add tool results to messages for next iteration.
    // Ollama expects `tool_name` in addition to `tool_call_id` on the
    // tool result message; OpenAI-style providers only need tool_call_id.
    // We include both so it works for every provider.
    var isOllama2 = (config.provider === 'ollama');
    for (var j = 0; j < toolResults.length; j++) {
      var toolMsg = {
        role: 'tool',
        tool_call_id: toolResults[j].tool_call_id,
        content: toolResults[j].formattedResult
      };
      if (isOllama2 && toolResults[j].tool_name) {
        toolMsg.tool_name = toolResults[j].tool_name;
      }
      messages.push(toolMsg);
    }
  }

  // Max iterations reached
  sendEvent({
    type: EVENT_TYPES.AGENT_DONE,
    reason: 'max_iterations',
    content: fullContent + '\n\nMaximum agent iterations reached (' + maxIterations + '). The task may not be complete. Do you want me to continue?',
    thinking: fullThinking
  });
  return { content: fullContent, thinking: fullThinking, done: false, maxReached: true };
}

// Parse DeepSeek-style \uE000...\uE001 think tags from streaming content
function processThinkTags(text, inThinkTag, buffer) {
  var contentPart = '';
  var thinkingPart = '';
  buffer += text;

  while (true) {
    if (!inThinkTag) {
      var startIdx = buffer.indexOf('\uE000');
      if (startIdx !== -1) {
        contentPart += buffer.substring(0, startIdx);
        inThinkTag = true;
        buffer = buffer.substring(startIdx + 1);
      } else {
        // Check for partial tag at end
        var partialLen = 0;
        for (var i = 1; i <= buffer.length; i++) {
          if ('\uE000'.startsWith(buffer.slice(-i))) {
            partialLen = i;
            break;
          }
        }
        contentPart += buffer.substring(0, buffer.length - partialLen);
        buffer = buffer.substring(buffer.length - partialLen);
        break;
      }
    } else {
      var endIdx = buffer.indexOf('\uE001');
      if (endIdx !== -1) {
        thinkingPart += buffer.substring(0, endIdx);
        inThinkTag = false;
        buffer = buffer.substring(endIdx + 1);
      } else {
        var partialLen = 0;
        for (var i = 1; i <= buffer.length; i++) {
          if ('\uE001'.startsWith(buffer.slice(-i))) {
            partialLen = i;
            break;
          }
        }
        thinkingPart += buffer.substring(0, buffer.length - partialLen);
        buffer = buffer.substring(buffer.length - partialLen);
        break;
      }
    }
  }

  return { content: contentPart, thinking: thinkingPart, inThinkTag: inThinkTag, buffer: buffer };
}