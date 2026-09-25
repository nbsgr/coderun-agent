// chats-stream-parser.js (UI side)
// Parses live streaming LLM chunks, extracts thinking tokens, and formats content
// Strict traditional function declarations only

export function extractThinkingFromStream(rawText) {
  if (!rawText || typeof rawText !== 'string') return { content: '', thinking: '' };
  var thinkMatch = rawText.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
  var thinking = thinkMatch ? thinkMatch[1].trim() : '';
  var content = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return {
    content: content,
    thinking: thinking
  };
}

export function parseStreamLine(line) {
  if (!line || typeof line !== 'string') return null;
  try {
    return JSON.parse(line);
  } catch (err) {
    return null;
  }
}
