import OpenAI from 'openai';

async function testOllamaUsage() {
  console.log('=== Testing Ollama Usage ===');
  try {
    var client = new OpenAI({
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'ollama'
    });
    var stream = await client.chat.completions.create({
      model: 'minimax-m3:cloud',
      messages: [{ role: 'user', content: 'Say hello in 3 words' }],
      stream: true,
      stream_options: { include_usage: true }
    });
    for await (var chunk of stream) {
      if (chunk.usage) {
        console.log('[Ollama USAGE DETECTED]:', JSON.stringify(chunk.usage));
      }
    }
  } catch (err) {
    console.log('[Ollama ERROR]:', err.message);
  }
}

async function testOpenCodeUsage() {
  console.log('=== Testing OpenCode Usage ===');
  try {
    var client = new OpenAI({
      baseURL: 'https://opencode.ai/zen/v1',
      apiKey: 'sk-2GS9T54rzLK0s77eoaRwRf3cMOKBuY66XdHXaNfjSFW6icvxaasXF302j8Mdn3Gn'
    });
    var stream = await client.chat.completions.create({
      model: 'deepseek-v4-flash-free',
      messages: [{ role: 'user', content: 'Say hello in 3 words' }],
      stream: true,
      stream_options: { include_usage: true }
    });
    for await (var chunk of stream) {
      if (chunk.usage) {
        console.log('[OpenCode USAGE DETECTED]:', JSON.stringify(chunk.usage));
      }
    }
  } catch (err) {
    console.log('[OpenCode ERROR]:', err.message);
  }
}

async function testGeminiUsage() {
  console.log('=== Testing Gemini OpenAI SDK Usage ===');
  try {
    var client = new OpenAI({
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      apiKey: 'AIzaSyBA6FmLn7abwZXXVXKlaM_6amDJdYVWqj8'
    });

    var modelList = await client.models.list();
    var names = [];
    for (var m of modelList.data) names.push(m.id);
    console.log('[Gemini OPENAI SDK AVAILABLE MODELS]:', names.slice(0, 10).join(', '));

    for (var i = 0; i < names.length; i++) {
      var mName = names[i];
      try {
        console.log('Trying model:', mName);
        var stream = await client.chat.completions.create({
          model: mName,
          messages: [{ role: 'user', content: 'Hi' }],
          stream: true,
          stream_options: { include_usage: true }
        });
        for await (var chunk of stream) {
          if (chunk.usage) {
            console.log('[Gemini USAGE DETECTED VIA OPENAI SDK!]:', JSON.stringify(chunk.usage));
          }
          if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) {
            process.stdout.write(chunk.choices[0].delta.content);
          }
        }
        console.log('\nSUCCESS WITH MODEL:', mName);
        break;
      } catch (err) {
        console.log('Model', mName, 'failed:', err.message);
      }
    }
  } catch (err) {
    console.log('[Gemini ERROR VIA OPENAI SDK]:', err.message);
  }
}

async function main() {
  await testOllamaUsage();
  await testGeminiUsage();
}

main();
