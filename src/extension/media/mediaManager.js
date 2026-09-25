// mediaManager.js — Manages persistent storage of generated images and videos
// Stores all generated media in VS Code globalStorage/media/ to prevent URL expiration,
// avoid localStorage quota limits, and maintain consistency across sessions and restarts.

import fs from 'fs';
import path from 'path';

var _defaultMediaStoragePath = null;

export function setDefaultMediaStoragePath(dirPath) {
  if (dirPath && typeof dirPath === 'string') {
    _defaultMediaStoragePath = dirPath;
  }
}

export function getDefaultMediaStoragePath() {
  return _defaultMediaStoragePath;
}

export async function ensureMediaDir(baseStoragePath) {
  var targetBase = baseStoragePath || _defaultMediaStoragePath;
  if (!targetBase) return null;
  var mediaDir = path.join(targetBase, 'media');
  try {
    await fs.promises.mkdir(mediaDir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  return mediaDir;
}

export async function saveMediaFromDataOrUrl(baseStoragePath, sessionId, dataOrUrl, defaultExt) {
  if (!dataOrUrl) return null;
  var mediaDir = await ensureMediaDir(baseStoragePath);
  if (!mediaDir) return null;

  var safeSession = String(sessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  var timestamp = Date.now();
  var ext = defaultExt || 'png';

  // Case 1: Data URL (e.g. data:image/png;base64,...)
  if (typeof dataOrUrl === 'string' && dataOrUrl.startsWith('data:')) {
    var match = dataOrUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      var mime = match[1];
      var base64Data = match[2];
      if (mime.indexOf('video') !== -1) {
        ext = 'mp4';
      } else if (mime.indexOf('jpeg') !== -1 || mime.indexOf('jpg') !== -1) {
        ext = 'jpg';
      } else if (mime.indexOf('webp') !== -1) {
        ext = 'webp';
      } else if (mime.indexOf('gif') !== -1) {
        ext = 'gif';
      } else {
        ext = 'png';
      }
      var buf = Buffer.from(base64Data, 'base64');
      var filename = 'media_' + safeSession + '_' + timestamp + '.' + ext;
      var outPath = path.join(mediaDir, filename);
      await fs.promises.writeFile(outPath, buf);
      return {
        filePath: outPath,
        filename: filename,
        ext: ext,
        size: buf.length
      };
    }
  }

  // Case 2: Raw base64 string without data prefix
  if (typeof dataOrUrl === 'string' && !dataOrUrl.startsWith('http://') && !dataOrUrl.startsWith('https://') && dataOrUrl.length > 200) {
    try {
      var rawBuf = Buffer.from(dataOrUrl, 'base64');
      var rawFilename = 'media_' + safeSession + '_' + timestamp + '.' + ext;
      var rawOutPath = path.join(mediaDir, rawFilename);
      await fs.promises.writeFile(rawOutPath, rawBuf);
      return {
        filePath: rawOutPath,
        filename: rawFilename,
        ext: ext,
        size: rawBuf.length
      };
    } catch (_) {
      // Fall through to remote URL handling
    }
  }

  // Case 3: Remote URL (e.g. https://... from DALL-E or custom provider)
  if (typeof dataOrUrl === 'string' && (dataOrUrl.startsWith('http://') || dataOrUrl.startsWith('https://'))) {
    var resp = await fetch(dataOrUrl);
    if (!resp.ok) {
      throw new Error('Failed to download generated media from ' + dataOrUrl + ' (status ' + resp.status + ')');
    }
    var contentType = resp.headers.get('content-type') || '';
    if (contentType.indexOf('video') !== -1) {
      ext = 'mp4';
    } else if (contentType.indexOf('jpeg') !== -1 || contentType.indexOf('jpg') !== -1) {
      ext = 'jpg';
    } else if (contentType.indexOf('webp') !== -1) {
      ext = 'webp';
    } else if (contentType.indexOf('gif') !== -1) {
      ext = 'gif';
    } else {
      ext = 'png';
    }
    var arrayBuf = await resp.arrayBuffer();
    var downloadBuf = Buffer.from(arrayBuf);
    var downloadFilename = 'media_' + safeSession + '_' + timestamp + '.' + ext;
    var downloadPath = path.join(mediaDir, downloadFilename);
    await fs.promises.writeFile(downloadPath, downloadBuf);
    return {
      filePath: downloadPath,
      filename: downloadFilename,
      ext: ext,
      size: downloadBuf.length
    };
  }

  // Case 4: Already a local file path
  if (typeof dataOrUrl === 'string' && fs.existsSync(dataOrUrl)) {
    return {
      filePath: dataOrUrl,
      filename: path.basename(dataOrUrl),
      ext: path.extname(dataOrUrl).replace(/^\./, '') || ext,
      size: fs.statSync(dataOrUrl).size
    };
  }

  return null;
}

export async function copyMediaToWorkspace(sourceFilePath, targetRelPath, workspaceFolder) {
  if (!sourceFilePath || !workspaceFolder) {
    throw new Error('Source file and workspace folder are required');
  }
  if (!fs.existsSync(sourceFilePath)) {
    throw new Error('Source media file does not exist: ' + sourceFilePath);
  }
  var destPath = path.join(workspaceFolder, targetRelPath);
  var destDir = path.dirname(destPath);
  await fs.promises.mkdir(destDir, { recursive: true });
  await fs.promises.copyFile(sourceFilePath, destPath);
  return destPath;
}
