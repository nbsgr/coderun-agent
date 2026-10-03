// testQwenStreamingAndImageGen.js
// Verifies real-time streaming of thinking tokens, content streaming, and image generation in providerQwen

import assert from 'assert';
import * as providerQwen from '../src/extension/browser/providerQwen.js';
import { SYSTEM_PROMPT } from '../src/extension/agents/constants.js';

console.log('================================================================');
console.log('=== TEST: QWEN STREAMING, THINKING & NATIVE IMAGE GEN DUAL MODE ===');
console.log('================================================================');

// 1. Verify serializeMessages always includes QWEN_SYSTEM_PROMPT
console.log('\n--- 1. Testing System Prompt Injection in serializeMessages ---');
var dummyMessages = [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: 'generate an image of a cybernetic dragon' }
];

var serialized = providerQwen.serializeMessages(dummyMessages, SYSTEM_PROMPT, []);
assert(serialized.indexOf('MODE 1: YOUR NATIVE WEB BROWSER POWERS') !== -1, 'Must include MODE 1 native browser powers');
assert(serialized.indexOf('Image Generation') !== -1, 'Must include Image Generation instructions');
assert(serialized.indexOf('MODE 2: WORKSPACE ACTIONS') !== -1, 'Must include MODE 2 workspace actions');
assert(serialized.indexOf('SYSTEM_PROMPT') === -1, 'Should include actual content');
console.log('✓ System Prompt correctly includes dual-mode native powers alongside agent rules.');

// 2. Verify cleanAndParseOpenAiJson
console.log('\n--- 2. Testing cleanAndParseOpenAiJson with various outputs ---');
var rawText = 'I am generating an image for you now!';
var parsedText = providerQwen.cleanAndParseOpenAiJson(rawText);
assert.strictEqual(parsedText, null, 'Plain text should return null so it is not mistaken for JSON');

var jsonEnvelope = JSON.stringify({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  choices: [{
    index: 0,
    message: {
      role: 'assistant',
      reasoning: 'Need to inspect package.json',
      content: '',
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: { name: 'read_file', arguments: JSON.stringify({ path: 'package.json' }) }
      }]
    },
    finish_reason: 'tool_calls'
  }]
});

var parsedJson = providerQwen.cleanAndParseOpenAiJson(jsonEnvelope);
assert(parsedJson && parsedJson.choices && parsedJson.choices[0].message.tool_calls.length === 1, 'Should parse JSON tool call');
console.log('✓ cleanAndParseOpenAiJson properly differentiates JSON tool calls and plain text.');

// 3. Verify stripServerNoise and server noise prefixed JSON rescue
console.log('\n--- 3. Testing Server Noise Stripping & Prefixed JSON Recovery ---');
var noisyText = 'Tool ask_question does not exists.Tool ask_question does not exists.{\n  "choices": [{"message": {"role": "assistant", "reasoning": "Inspecting image", "content": "How would you like to edit this?", "tool_calls": []}}]}';
var strippedOnly = providerQwen.stripServerNoise(noisyText);
assert.strictEqual(strippedOnly.indexOf('Tool ask_question does not exists.'), -1, 'Must strip all server error notices');
assert(strippedOnly.startsWith('{\n  "choices":'), 'Must leave valid JSON envelope');

var parsedNoisy = providerQwen.cleanAndParseOpenAiJson(noisyText);
assert(parsedNoisy && parsedNoisy.choices && parsedNoisy.choices[0].message, 'Must rescue JSON despite server noise prefix');
assert.strictEqual(parsedNoisy.choices[0].message.reasoning, 'Inspecting image', 'Must extract reasoning');
assert.strictEqual(parsedNoisy.choices[0].message.content, 'How would you like to edit this?', 'Must extract content');
console.log('✓ stripServerNoise and cleanAndParseOpenAiJson successfully rescue corrupted Qwen responses.');

// 4. Verify continuous real-time streaming of thinking tokens and content tokens
console.log('\n--- 4. Testing Multi-Chunk Stream Extractor for Thinking & Content ---');
var extractor = providerQwen.createJsonStreamExtractor();
var chunk1 = '{"choices": [{"message": {"role": "assistant", "reasoning": "Thinking step 1... ';
var res1 = extractor.push(chunk1);
assert.strictEqual(res1.thinking, 'Thinking step 1... ', 'First thinking chunk must stream');

var chunk2 = 'and thinking step 2...", "content": "Hello ';
var res2 = extractor.push(chunk2);
assert.strictEqual(res2.thinking, 'and thinking step 2...', 'Subsequent thinking chunk must stream without choking');
assert.strictEqual(res2.content, 'Hello ', 'First content chunk must stream');

var chunk3 = 'user! How can I help you?", "tool_calls": []}}]}';
var res3 = extractor.push(chunk3);
assert.strictEqual(res3.content, 'user! How can I help you?', 'Subsequent content chunk must stream without choking');
console.log('✓ createJsonStreamExtractor streams both thinking and content continuously across all chunks.');

console.log('\n================================================================');
console.log('=== ALL STREAMING & IMAGE GEN CONTRACT VERIFICATIONS PASSED ===');
console.log('================================================================');

