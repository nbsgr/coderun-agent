import fs from 'fs';
import path from 'path';
import * as providerQwen from '../src/extension/browser/providerQwen.js';
import * as mediaManager from '../src/extension/media/mediaManager.js';

async function run() {
  const cookiePath = path.join(process.env.APPDATA, 'Code/User/globalStorage/qwen_extracted_cookie.txt');
  if (!fs.existsSync(cookiePath)) {
    console.error('Cookie file does not exist at:', cookiePath);
    process.exit(1);
  }

  const cookie = fs.readFileSync(cookiePath, 'utf8').trim();
  console.log('Testing Qwen images() with real extracted cookie...');

  try {
    const config = {
      apiKey: cookie,
      model: 'qwen3.7-max'
    };
    console.log('Requesting image generation: "a glowing neon cybernetic cat"');
    const result = await providerQwen.images(config, 'a glowing neon cybernetic cat');
    console.log('Image generation result:', JSON.stringify(result));
    
    if (result && result.data && result.data[0] && result.data[0].url) {
      const imgUrl = result.data[0].url;
      console.log('Generated Image URL:', imgUrl);
      
      // Test downloading and saving the media using mediaManager
      const testDir = path.join(process.cwd(), 'scratch/test_media_download');
      if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
      
      console.log('Testing mediaManager.saveMediaFromDataOrUrl...');
      const saved = await mediaManager.saveMediaFromDataOrUrl(testDir, 'qwen_img_test', imgUrl, 'png');
      console.log('Saved media locally:', saved);
      if (saved && fs.existsSync(saved.filePath)) {
        console.log('✓ SUCCESS: File exists on disk, size:', fs.statSync(saved.filePath).size, 'bytes');
      }
    }
  } catch (err) {
    console.error('Image test failed (or Qwen image generation timed out):', err.message);
  }
}

run();
