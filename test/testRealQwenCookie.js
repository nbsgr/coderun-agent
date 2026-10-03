import fs from 'fs';
import path from 'path';
import * as providerQwen from '../src/extension/browser/providerQwen.js';

async function run() {
  const cookiePath = path.join(process.env.APPDATA, 'Code/User/globalStorage/qwen_extracted_cookie.txt');
  if (!fs.existsSync(cookiePath)) {
    console.error('Cookie file does not exist at:', cookiePath);
    process.exit(1);
  }

  const cookie = fs.readFileSync(cookiePath, 'utf8').trim();
  console.log('Successfully loaded cookie from global storage. Length:', cookie.length);

  // Test 1: listModels
  console.log('\n--- 1. Testing listModels ---');
  try {
    const models = await providerQwen.listModels({ apiKey: cookie });
    console.log('Models returned:', models.length, 'models:');
    function printModel(m) {
      console.log(' - ' + m);
    }
    models.forEach(printModel);
  } catch (err) {
    console.error('listModels failed:', err.message);
  }

  // Test 2: Chat call
  console.log('\n--- 2. Testing Chat with "hi" ---');
  try {
    const config = {
      apiKey: cookie,
      model: 'qwen3.8-max'
    };
    const messages = [
      { role: 'user', content: 'hi, reply with exactly "Hello from Qwen!"' }
    ];
    let fullResponse = '';
    for await (const chunk of providerQwen.chat(config, messages, [])) {
      if (chunk.content) {
        process.stdout.write(chunk.content);
        fullResponse += chunk.content;
      }
      if (chunk.thinking) {
        process.stdout.write('[thinking: ' + chunk.thinking + ']');
      }
    }
    console.log('\nChat test finished! Total response length:', fullResponse.length);
  } catch (err) {
    console.error('\nChat test failed:', err);
  }
}

run();
