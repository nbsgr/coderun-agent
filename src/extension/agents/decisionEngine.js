// decisionEngine.js — Decision engine for LLM conclusions and final outcomes
// Extracted from agentLoop.js. Handles concluding stream requests when tool execution completes.

/**
 * When the last conversation message was a tool result and the model did not output text,
 * forces a concluding response from the LLM confirming task completion.
 *
 * Returns { content, thinking } — empty strings on failure or if aborted.
 */
export async function forceConclusion(provider, config, messages, activeToolDefinitions, signal, sendEvent) {
  if (!messages || messages.length === 0) {
    return { content: '', thinking: '' };
  }
  var lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== 'tool') {
    return { content: '', thinking: '' };
  }

  console.log('[DECISION ENGINE] Forcing a concluding response from LLM...');
  var concludingThinking = '';
  var concludingContent = '';

  try {
    var concludingMessages = messages.slice();
    concludingMessages.push({
      role: 'user',
      content: 'The verification tool execution is completed. Please write a brief concluding response to the user confirming the final outcome of the task.'
    });

    var concludingChatSignal = (signal && signal.signal) ? signal.signal : signal;
    var stream = provider.chat(config, concludingMessages, activeToolDefinitions, { signal: concludingChatSignal });

    for await (var chunk of stream) {
      if (signal && (signal.stopped || signal.aborted)) {
        break;
      }
      if (chunk.content) {
        concludingContent += chunk.content;
        if (typeof sendEvent === 'function') {
          sendEvent({ message: { role: 'assistant', content: chunk.content } });
        }
      }
      if (chunk.thinking) {
        concludingThinking += chunk.thinking;
      }
    }
  } catch (e) {
    console.error('[DECISION ENGINE] Failed to generate concluding response:', e);
  }

  return { content: concludingContent, thinking: concludingThinking };
}
