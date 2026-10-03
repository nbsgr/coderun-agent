import fs from 'fs';
import path from 'path';
import { buildQwenHeaders } from '../src/extension/browser/providerQwen.js';
import { createNewQwenChat } from '../src/extension/browser/qwenSessionManager.js';

var cookiePath = path.join(process.env.APPDATA, 'Code', 'User', 'globalStorage', 'qwen_extracted_cookie.txt');
var cookie = fs.readFileSync(cookiePath, 'utf8').trim();

async function test() {
  var headers = buildQwenHeaders(cookie);
  try {
    var chatId = await createNewQwenChat('qwen3.7-max', headers);
    console.log('Chat created successfully with ID:', chatId);

    var compRes = await fetch('https://chat.qwen.ai/api/v2/chat/completions?chat_id=' + chatId, {
      method: 'POST',
      headers: buildQwenHeaders(cookie, chatId),
      body: JSON.stringify({
        chatId: chatId,
        chat_id: chatId,
        chat_mode: 'normal',
        model: 'qwen3.7-max',
        messages: [{
          role: 'user',
          content: 'hello'
        }]
      })
    });
    console.log('completions HTTP status:', compRes.status);
    var text = await compRes.text();
    console.log('completions response preview:', text.substring(0, 400));
  } catch (err) {
    console.error('Error during test:', err.message);
  }
}

test();
