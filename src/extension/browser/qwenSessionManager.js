// qwenSessionManager.js — Qwen Chat Session Lifecycle Management
// Lazy session creation, stopping, and server-side chat deletion.
// Strict traditional function declarations only.

export function isValidQwenChatId(id) {
  if (!id || typeof id !== 'string') {
    return false;
  }
  if (id.startsWith('new-') || id.startsWith('conv_') || id.startsWith('session_')) {
    return false;
  }
  var uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var hex32Regex = /^[0-9a-f]{32}$/i;
  return uuidRegex.test(id) || hex32Regex.test(id);
}

export function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export async function createNewQwenChat(qwenModel, headers) {
  var newChatUrl = 'https://chat.qwen.ai/api/v2/chats/new';
  var newChatPayload = {
    title: 'CodeRun Chat',
    models: [qwenModel || 'qwen3.7-plus'],
    chat_mode: 'normal',
    chat_type: 't2t',
    timestamp: Date.now()
  };

  var newChatRes = await fetch(newChatUrl, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(newChatPayload)
  });

  var newChatContentType = (newChatRes.headers.get('content-type') || '').toLowerCase();
  if (!newChatRes.ok) {
    if (newChatRes.status === 401 || newChatRes.status === 403) {
      var authErr1 = new Error('Qwen session token expired. Please log in again.');
      authErr1.isAuthError = true;
      authErr1.code = 'UNAUTHORIZED';
      throw authErr1;
    }
    throw new Error('HTTP error creating chat: ' + newChatRes.status);
  }

  if (newChatContentType.indexOf('text/html') !== -1) {
    var wafErr = new Error('Alibaba Cloud security verification required. Please complete verification in browser.');
    wafErr.isCaptcha = true;
    wafErr.captchaUrl = 'https://chat.qwen.ai';
    throw wafErr;
  }

  var newChatData = await newChatRes.json();
  if (newChatData && newChatData.success && newChatData.data && newChatData.data.id) {
    return newChatData.data.id;
  }

  var errRet = JSON.stringify((newChatData && newChatData.ret) || '');
  var errUrl = (newChatData && newChatData.data && newChatData.data.url) || '';
  if (errRet.indexOf('FAIL_SYS_USER_VALIDATE') !== -1 || errUrl.indexOf('captcha') !== -1 || errUrl.indexOf('punish') !== -1) {
    var captchaErr = new Error('Alibaba Cloud security verification required (slider captcha).');
    captchaErr.isCaptcha = true;
    captchaErr.captchaUrl = errUrl || 'https://chat.qwen.ai';
    throw captchaErr;
  }

  var errCode = newChatData && newChatData.data && newChatData.data.code;
  var errDetails = newChatData && newChatData.data && newChatData.data.details;
  if (errCode === 'unauthorized') {
    var authErr2 = new Error('Qwen session token expired. Please log in again.');
    authErr2.isAuthError = true;
    authErr2.code = 'UNAUTHORIZED';
    throw authErr2;
  }

  throw new Error('Qwen failed to return a new Chat ID: ' + (errDetails || JSON.stringify(newChatData)));
}

export async function stopQwenChat(chatId, headers) {
  if (!chatId || !isValidQwenChatId(chatId)) return;
  try {
    await fetch('https://chat.qwen.ai/api/v2/chat/completions/stop', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ chat_id: chatId })
    });
    console.log('[QWEN] Sent stop signal for chat ' + chatId);
  } catch (e) {
    console.warn('[QWEN] Could not send stop signal:', e.message);
  }
}

export async function deleteQwenChat(chatId, headers) {
  if (!chatId || !isValidQwenChatId(chatId)) return;
  try {
    var deleteUrl = 'https://chat.qwen.ai/api/v2/chats/delete';
    await fetch(deleteUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ chat_ids: [chatId] })
    });
    console.log('[QWEN] Successfully deleted remote chat on server: ' + chatId);
  } catch (e) {
    console.warn('[QWEN] Could not delete remote chat:', e.message);
  }
}
