// fetchServer.cjs — Built-in zero-dependency MCP Web Fetcher server
// Communicates via JSON-RPC 2.0 over process.stdin / process.stdout

var readline = require('readline');

function htmlToMarkdown(html) {
  if (!html || typeof html !== 'string') return '';
  var text = html;

  // Remove scripts and styles
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Convert headings
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');

  // Convert links
  text = text.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Convert list items
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n* $1');

  // Convert paragraphs and linebreaks
  text = text.replace(/<p[^>]*>/gi, '\n\n');
  text = text.replace(/<\/p>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<div[^>]*>/gi, '\n');
  text = text.replace(/<\/div>/gi, '');

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

async function handleFetchWebContent(args) {
  var url = args && args.url;
  if (!url) {
    return { isError: true, content: [{ type: 'text', text: 'Error: url parameter is required' }] };
  }

  try {
    var resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 CodeRun/1.5.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!resp.ok) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'HTTP Error ' + resp.status + ' (' + resp.statusText + ') fetching ' + url }]
      };
    }

    var contentType = resp.headers.get('content-type') || '';
    var rawText = await resp.text();

    var output;
    if (args.raw) {
      output = rawText;
    } else if (contentType.includes('json')) {
      try {
        output = JSON.stringify(JSON.parse(rawText), null, 2);
      } catch (_) {
        output = rawText;
      }
    } else if (contentType.includes('html')) {
      output = htmlToMarkdown(rawText);
    } else {
      output = rawText;
    }

    if (output.length > 30000) {
      output = output.substring(0, 30000) + '\n\n... [Content truncated, ' + output.length + ' bytes total]';
    }

    return {
      content: [{ type: 'text', text: output }]
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'Failed to fetch ' + url + ': ' + (err.message || String(err)) }]
    };
  }
}

async function handleHttpGet(args) {
  var url = args && args.url;
  if (!url) {
    return { isError: true, content: [{ type: 'text', text: 'Error: url parameter is required' }] };
  }

  var headers = (args && args.headers) || {};
  try {
    var resp = await fetch(url, {
      headers: headers,
      signal: AbortSignal.timeout(15000)
    });

    var body = await resp.text();
    return {
      content: [{ type: 'text', text: 'Status: ' + resp.status + '\n\n' + body }]
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'HTTP GET error: ' + (err.message || String(err)) }]
    };
  }
}

function sendResponse(id, result, error) {
  var msg = {
    jsonrpc: '2.0',
    id: id
  };
  if (error) {
    msg.error = error;
  } else {
    msg.result = result;
  }
  process.stdout.write(JSON.stringify(msg) + '\n');
}

var TOOLS = [
  {
    name: 'fetch_web_content',
    description: 'Fetch a web page or URL, strip HTML tags, and convert contents to clean markdown text.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The HTTP or HTTPS URL of the web page to fetch.' },
        raw: { type: 'boolean', description: 'If true, returns raw unconverted HTML/text instead of clean markdown.' }
      },
      required: ['url']
    }
  },
  {
    name: 'http_get',
    description: 'Make an HTTP GET request to an API endpoint or web address and return the response.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The target API endpoint or URL.' },
        headers: { type: 'object', description: 'Optional request headers dictionary.' }
      },
      required: ['url']
    }
  }
];

var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', function onLine(line) {
  var str = line.trim();
  if (!str) return;

  var msg;
  try {
    msg = JSON.parse(str);
  } catch (err) {
    return;
  }

  var method = msg.method;
  var id = msg.id;

  if (method === 'initialize') {
    sendResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'web-fetcher',
        version: '1.0.0'
      }
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    sendResponse(id, { tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    var params = msg.params || {};
    var toolName = params.name;
    var toolArgs = params.arguments || {};

    if (toolName === 'fetch_web_content') {
      handleFetchWebContent(toolArgs).then(function onFetchResult(res) {
        sendResponse(id, res);
      });
      return;
    }

    if (toolName === 'http_get') {
      handleHttpGet(toolArgs).then(function onHttpResult(res) {
        sendResponse(id, res);
      });
      return;
    }

    sendResponse(id, null, {
      code: -32601,
      message: 'Unknown tool: ' + toolName
    });
    return;
  }

  if (id !== undefined && id !== null) {
    sendResponse(id, null, {
      code: -32601,
      message: 'Method not found: ' + method
    });
  }
});
