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
        if (chunk.tool_calls && chunk.tool_calls.length) {
          for (var tc of chunk.tool_calls) {
            toolCalls.push(tc);
          }
          sendEvent({ message: { role: 'assistant', tool_calls: chunk.tool_calls } });
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

    // No tool calls = we're done
    if (toolCalls.length === 0) {
      sendEvent({ type: EVENT_TYPES.AGENT_DONE, reason: 'direct_answer', content: fullContent, thinking: fullThinking });
      return { content: fullContent, thinking: fullThinking, done: true };
    }

    // Execute tools
    sendEvent({ type: EVENT_TYPES.AGENT_STATUS, status: 'executing_tools', count: toolCalls.length });
    var toolResults = [];

    for (var i = 0; i < toolCalls.length; i++) {
      var tc = toolCalls[i];
      var toolName = tc.function?.name || tc.name;
      var args = tc.function?.arguments || tc.arguments || {};
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

    // Build assistant message with tool calls
    var assistantMsg = { role: 'assistant', content: iterationContent };
    if (iterationThinking) {
      assistantMsg.content = '\uE000' + iterationThinking + '\uE001\n' + assistantMsg.content;
    }
    if (toolCalls.length) assistantMsg.tool_calls = toolCalls;
    messages.push(assistantMsg);

    // Add tool results to messages for next iteration
    for (var j = 0; j < toolResults.length; j++) {
      messages.push({
        role: 'tool',
        tool_call_id: toolResults[j].tool_call_id,
        content: toolResults[j].formattedResult
      });
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