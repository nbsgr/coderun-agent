// qwenOssManager.js — Multimodal Image & Document Upload via Alibaba Cloud OSS STS Tokens
// Strict traditional function declarations only.

import OSS from 'ali-oss';
import fs from 'fs';

var ossFileCache = new Map();

export function clearOssFileCache() {
  ossFileCache.clear();
}

export function getFileBuffer(fileInput) {
  if (!fileInput) return null;
  if (Buffer.isBuffer(fileInput)) return fileInput;
  if (typeof fileInput === 'string') {
    if (fileInput.startsWith('data:')) {
      var commaIdx = fileInput.indexOf(',');
      if (commaIdx !== -1) {
        return Buffer.from(fileInput.substring(commaIdx + 1), 'base64');
      }
    }
    if (/^[A-Za-z0-9+/=]+$/.test(fileInput.trim()) && fileInput.length > 50) {
      try {
        return Buffer.from(fileInput.trim(), 'base64');
      } catch (_) { void 0; }
    }
    try {
      if (fs.existsSync(fileInput)) {
        return fs.readFileSync(fileInput);
      }
    } catch (_) { void 0; }
  }
  if (fileInput && fileInput.data) {
    return getFileBuffer(fileInput.data);
  }
  return null;
}

export function inferMimeType(filename, fileInput) {
  if (typeof fileInput === 'string' && fileInput.startsWith('data:')) {
    var match = fileInput.match(/^data:([^;]+);/);
    if (match) return match[1];
  }
  if (fileInput && fileInput.type) return fileInput.type;
  var ext = (filename || '').split('.').pop().toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'txt') return 'text/plain';
  if (ext === 'md') return 'text/markdown';
  if (ext === 'json') return 'application/json';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'js') return 'text/javascript';
  if (ext === 'ts') return 'text/typescript';
  if (ext === 'py') return 'text/x-python';
  if (ext === 'html') return 'text/html';
  if (ext === 'css') return 'text/css';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

export async function uploadFileToQwenOss(fileInput, customName, headers) {
  var buffer = getFileBuffer(fileInput);
  if (!buffer || buffer.length === 0) return null;

  var filename = customName || (fileInput && fileInput.name) || ('attachment_' + Date.now());
  var mimeType = inferMimeType(filename, fileInput);
  if (mimeType.startsWith('image/') && filename.indexOf('.') === -1) {
    var ext = mimeType.split('/')[1] || 'png';
    filename += '.' + ext;
  } else if (mimeType === 'application/pdf' && !filename.toLowerCase().endsWith('.pdf')) {
    filename += '.pdf';
  }

  var cacheKey = filename + '_' + buffer.length + '_' + buffer.subarray(0, 32).toString('hex');
  if (ossFileCache.has(cacheKey)) {
    console.log('[QWEN OSS] Using cached uploaded file:', filename);
    return ossFileCache.get(cacheKey);
  }

  console.log('[QWEN OSS] Requesting STS token for', filename, 'size:', buffer.length, 'type:', mimeType);
  var stsRes = await fetch('https://chat.qwen.ai/api/v2/files/getstsToken', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      filename: filename,
      filesize: String(buffer.length),
      filetype: mimeType
    })
  });

  if (!stsRes.ok) {
    console.error('[QWEN OSS] Failed to get STS token. HTTP', stsRes.status);
    return null;
  }

  var stsData = await stsRes.json();
  if (!stsData || !stsData.success || !stsData.data) {
    console.error('[QWEN OSS] getstsToken error:', stsData);
    return null;
  }

  var d = stsData.data;
  var client = new OSS({
    authorizationV4: true,
    region: d.region,
    endpoint: d.endpoint,
    accessKeyId: d.access_key_id,
    accessKeySecret: d.access_key_secret,
    stsToken: d.security_token,
    bucket: d.bucketname
  });

  var putRes = await client.put(d.file_path, buffer);
  if (!putRes || !putRes.res || putRes.res.status !== 200) {
    console.error('[QWEN OSS] OSS client.put failed:', putRes);
    return null;
  }

  var isVision = mimeType.startsWith('image/');
  var fileObj = {
    id: d.file_id,
    name: filename,
    file_type: mimeType,
    type: isVision ? 'image' : 'file',
    file_class: isVision ? 'vision' : 'document',
    size: buffer.length,
    url: d.file_url,
    status: 'uploaded',
    showType: isVision ? 'image' : 'file'
  };

  ossFileCache.set(cacheKey, fileObj);
  console.log('[QWEN OSS] Uploaded successfully! File ID:', d.file_id);
  return fileObj;
}
