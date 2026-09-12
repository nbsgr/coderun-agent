const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', function handleLine(line) {
  const str = line.trim();
  if (!str) return;
  try {
    const msg = JSON.parse(str);
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'adv-mcp', version: '1.0' } } }) + '\n');
    } else if (msg.method === 'tools/list') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'adv_echo', description: 'Echo tool', inputSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] } }] } }) + '\n');
    } else if (msg.method === 'tools/call') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'Echo: ' + (msg.params.arguments.msg || '') }] } }) + '\n');
    }
  } catch (_) {}
});