import fs from 'fs';
import path from 'path';

async function main() {
  const cookiePath = path.join(process.env.APPDATA, 'Code/User/globalStorage/qwen_extracted_cookie.txt');
  const cookie = fs.readFileSync(cookiePath, 'utf8').trim();
  let token = '';
  const parts = cookie.split(';');
  for (const p of parts) {
    if (p.trim().startsWith('token=')) token = p.trim().substring(6);
  }

  const headers = {
    'Accept': 'application/json',
    'Cookie': cookie,
    'Origin': 'https://chat.qwen.ai',
    'Referer': 'https://chat.qwen.ai/'
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch('https://chat.qwen.ai/api/v2/models', { headers });
  console.log('HTTP status:', res.status);
  const data = await res.json();
  console.log('API Response data:', JSON.stringify(data, null, 2));
}

main();
