const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', function handleLine(line) {
  const str = line.trim();
  if (!str) return;
  try {
    const msg = JSON.parse(str);
    if (msg.method === 'initialize') {
      const resp = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-mcp-server', version: '1.0.0' }
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\n');
    } else if (msg.method === 'notifications/initialized') {
      // Handshake confirmed
    } else if (msg.method === 'tools/list') {
      const resp = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'calculate_sum',
              description: 'Calculate sum of two numbers',
              inputSchema: {
                type: 'object',
                properties: {
                  a: { type: 'number', description: 'First number' },
                  b: { type: 'number', description: 'Second number' }
                },
                required: ['a', 'b']
              }
            }
          ]
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\n');
    } else if (msg.method === 'tools/call') {
      const args = msg.params.arguments || {};
      const sum = (Number(args.a) || 0) + (Number(args.b) || 0);
      const resp = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [
            { type: 'text', text: 'Result: ' + sum }
          ]
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\n');
    }
  } catch (err) {
    process.stderr.write('Server parse error: ' + err.message + '\n');
  }
});