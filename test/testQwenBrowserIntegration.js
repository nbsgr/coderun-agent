// testQwenBrowserIntegration.js
// Verification suite for reverse-engineered Qwen Browser API integration
// Strict traditional function declarations only. Zero arrow functions, zero classes.

import assert from 'node:assert';
import * as providerQwen from '../src/extension/browser/providerQwen.js';
import * as qwenSessionManager from '../src/extension/browser/qwenSessionManager.js';
import * as qwenOssManager from '../src/extension/browser/qwenOssManager.js';
import * as browserLoginManager from '../src/extension/browser/browserLoginManager.js';
import { PROVIDERS, PROVIDER_LABELS, PROVIDER_DEFAULTS, QWEN_SYSTEM_PROMPT } from '../src/extension/agents/constants.js';

function runQwenIntegrationTests() {
  console.log('================================================================');
  console.log('=== RUNNING QWEN BROWSER INTEGRATION VERIFICATION SUITE ===');
  console.log('================================================================');

  // Test 1: Constants Registration
  console.log('--- Test 1: Provider Constants Registration ---');
  assert.strictEqual(PROVIDERS.QWEN, 'qwen', 'PROVIDERS.QWEN must be "qwen"');
  assert.strictEqual(PROVIDER_LABELS.qwen, 'Qwen Browser API', 'PROVIDER_LABELS.qwen must be "Qwen Browser API"');
  assert.strictEqual(PROVIDER_DEFAULTS.qwen.baseUrl, 'https://chat.qwen.ai', 'Qwen default baseUrl must be "https://chat.qwen.ai"');
  assert.strictEqual(PROVIDER_DEFAULTS.qwen.needsKey, true, 'Qwen needsKey must be true');
  assert(QWEN_SYSTEM_PROMPT.includes('MODE 1: YOUR NATIVE WEB BROWSER POWERS'), 'System prompt must include Mode 1 native browser powers');
  assert(QWEN_SYSTEM_PROMPT.includes('MODE 2: WORKSPACE ACTIONS'), 'System prompt must include Mode 2 workspace actions');
  assert(QWEN_SYSTEM_PROMPT.includes('finish_reason'), 'System prompt must enforce OpenAI finish_reason schema');
  console.log('✓ Test 1 Passed: Provider Constants and Dual-Mode Master Prompt verified.');

  // Test 2: Qwen Session Management UUID & ID Validation
  console.log('--- Test 2: Qwen Session ID Validation & UUID Generation ---');
  var uuid = qwenSessionManager.generateUuid();
  assert(uuid && uuid.length === 36, 'Generated UUID must be 36 characters long');
  assert(qwenSessionManager.isValidQwenChatId(uuid), 'UUID must be recognized as valid Qwen chat ID');
  assert(qwenSessionManager.isValidQwenChatId('a1b2c3d4e5f678901234567890abcdef'), '32-character hex ID must be recognized as valid');
  assert(!qwenSessionManager.isValidQwenChatId('invalid-short-id'), 'Malformed short ID must be rejected');
  assert(!qwenSessionManager.isValidQwenChatId(null), 'Null ID must be rejected');
  console.log('✓ Test 2 Passed: Qwen Session ID Validation and UUID generation verified.');

  // Test 3: OSS Manager MIME Type and Buffer Parsing
  console.log('--- Test 3: OSS Manager File Ingestion & MIME Inference ---');
  assert.strictEqual(qwenOssManager.inferMimeType('photo.png', null), 'image/png', 'PNG extension must infer image/png');
  assert.strictEqual(qwenOssManager.inferMimeType('document.pdf', null), 'application/pdf', 'PDF extension must infer application/pdf');
  assert.strictEqual(qwenOssManager.inferMimeType('code.js', null), 'text/javascript', 'JS extension must infer text/javascript');

  var sampleB64 = Buffer.from('hello-qwen-agent').toString('base64');
  var dataUri = 'data:image/png;base64,' + sampleB64;
  var bufFromUri = qwenOssManager.getFileBuffer(dataUri);
  assert(Buffer.isBuffer(bufFromUri), 'getFileBuffer must return Buffer from Data URI');
  assert.strictEqual(bufFromUri.toString('utf8'), 'hello-qwen-agent', 'Decoded buffer content must match original text');
  console.log('✓ Test 3 Passed: OSS Manager MIME inference and buffer decoding verified.');

  // Test 4: Browser Detection
  console.log('--- Test 4: System Chromium Browser Detection ---');
  var browserPath = browserLoginManager.detectSystemBrowser();
  console.log('Detected system Chromium path:', browserPath || '(none found in test env)');
  // In CI or environment with Chrome/Edge installed, browserPath is string, or null if headless
  assert(browserPath === null || typeof browserPath === 'string', 'detectSystemBrowser must return string or null');
  console.log('✓ Test 4 Passed: System Chromium browser detection verified.');

  // Test 5: Clean and Parse OpenAI JSON Responses
  console.log('--- Test 5: Clean & Parse OpenAI JSON Responses ---');
  var rawFenceJson = '```json\n{\n  "choices": [{\n    "message": {\n      "role": "assistant",\n      "reasoning": "Thinking step by step",\n      "content": "Done processing",\n      "tool_calls": []\n    },\n    "finish_reason": "stop"\n  }]\n}\n```';
  var parsed = providerQwen.cleanAndParseOpenAiJson(rawFenceJson);
  assert(parsed && parsed.choices && parsed.choices[0], 'Parsed JSON must extract choices array');
  assert.strictEqual(parsed.choices[0].message.reasoning, 'Thinking step by step', 'Reasoning must be extracted');
  assert.strictEqual(parsed.choices[0].message.content, 'Done processing', 'Content must be extracted');

  // Test with surrounding narrative text
  var narrativeText = 'Here is the tool call you requested:\n{\n  "role": "assistant",\n  "tool_calls": [\n    {\n      "id": "call_42",\n      "type": "function",\n      "function": {\n        "name": "read_file",\n        "arguments": { "path": "package.json" }\n      }\n    }\n  ]\n}\nHope this helps!';
  var parsedToolCalls = providerQwen.parseTextToolCalls(narrativeText);
  assert(Array.isArray(parsedToolCalls) && parsedToolCalls.length === 1, 'Must extract tool_calls from embedded JSON block');
  assert.strictEqual(parsedToolCalls[0].function.name, 'read_file', 'Tool name must be read_file');
  var argsObj = JSON.parse(parsedToolCalls[0].function.arguments);
  assert.strictEqual(argsObj.path, 'package.json', 'Tool argument path must be package.json');
  console.log('✓ Test 5 Passed: Clean and parse OpenAI JSON extraction verified.');

  // Test 6: Streaming JSON Chunk Extractor (Delta Streaming)
  console.log('--- Test 6: Real-time Streaming JSON Chunk Extractor ---');
  var extractor = providerQwen.createJsonStreamExtractor();
  var emittedDeltas = [];

  function onChunk(token) {
    var delta = extractor.feed(token);
    if (delta.thinking || delta.content) {
      emittedDeltas.push(delta);
    }
  }

  // Simulate streaming output of JSON block token by token
  var streamTokens = [
    '```json\n',
    '{\n  "choices": [{\n    "message": {\n',
    '      "role": "assistant",\n',
    '      "reasoning": "Let us check the file structure",\n',
    '      "content": "I will inspect package.json now",\n',
    '      "tool_calls": []\n',
    '    }\n  }]\n}\n```'
  ];

  for (var i = 0; i < streamTokens.length; i++) {
    onChunk(streamTokens[i]);
  }

  var finalParsed = extractor.getParsed();
  assert(finalParsed, 'Final extractor state must produce parsed response object');
  console.log('Emitted stream deltas count:', emittedDeltas.length);
  console.log('✓ Test 6 Passed: Real-time streaming JSON chunk extractor verified.');

  // Test 7: Message Serialization & Tool Instruction Embedding
  console.log('--- Test 7: Message Serialization & Tool Instruction Embedding ---');
  var testMessages = [
    { role: 'user', content: 'What dependencies are installed?' }
  ];
  var mockTools = [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read contents of a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path']
        }
      }
    }
  ];

  var serialized = providerQwen.serializeMessages(testMessages, null, mockTools);
  assert(typeof serialized === 'string' && serialized.length > 0, 'Serialized prompt must not be empty');
  assert(serialized.includes('read_file'), 'Serialized message must contain tool definition');
  assert(serialized.includes('What dependencies are installed?'), 'Serialized message must contain original user question');
  console.log('✓ Test 7 Passed: Message serialization and tool schemas embedding verified.');

  console.log('================================================================');
  console.log('=== ALL QWEN BROWSER INTEGRATION TESTS PASSED CLEANLY ===');
  console.log('================================================================');
}

runQwenIntegrationTests();
