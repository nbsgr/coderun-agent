// permission-store.js (extension side)
// Central store for pending tool permission requests, interactive questions,
// and session decision routing.
// Strict traditional function declarations only

import * as permissions from '../tools/permissions.js';
import * as questionManager from '../tools/questionManager.js';
import * as subagentManager from '../agents/subagentManager.js';

export function handleAskPermission(webview, toolName, args, id, sessionId, parentSessionId) {
  var sid = sessionId || 'default';
  var parentSid = parentSessionId || null;
  var subagentRec = null;
  try {
    subagentRec = subagentManager.getSubagent(sid);
    if (subagentRec && subagentRec.parentSessionId) {
      parentSid = subagentRec.parentSessionId;
    }
  } catch (subErr) {
    console.debug('[PERMISSION] Could not query subagent record for ' + sid + ':', subErr ? subErr.message : subErr);
  }

  var chatDecision = permissions.getAlwaysDecision(toolName, sid);
  if (!chatDecision && parentSid) {
    chatDecision = permissions.getAlwaysDecision(toolName, parentSid);
  }

  if (chatDecision) {
    webview.postMessage({
      type: 'agentEvent',
      event: {
        type: 'requestPermission',
        tool: toolName,
        arguments: args,
        id: id,
        sessionId: sid,
        parentSessionId: parentSid,
        autoResolved: true,
        decision: chatDecision,
        subagentName: subagentRec && subagentRec.identity ? subagentRec.identity.name : null,
        subagentRole: subagentRec && subagentRec.identity ? subagentRec.identity.role : null,
        agentType: subagentRec ? 'subagent' : 'main'
      }
    });
    return Promise.resolve(chatDecision === 'allow');
  }

  webview.postMessage({
    type: 'agentEvent',
    event: {
      type: 'requestPermission',
      tool: toolName,
      arguments: args,
      id: id,
      sessionId: sid,
      parentSessionId: parentSid,
      subagentName: subagentRec && subagentRec.identity ? subagentRec.identity.name : null,
      subagentRole: subagentRec && subagentRec.identity ? subagentRec.identity.role : null,
      agentType: subagentRec ? 'subagent' : 'main'
    }
  });
  return permissions.requestPermission(toolName, args, id, null, sid, parentSid);
}

export function handlePermissionResponse(message) {
  var respSessionId = message.sessionId || message.conversationId || 'default';
  var parentSid = null;
  try {
    var subagentRec = subagentManager.getSubagent(respSessionId);
    if (subagentRec && subagentRec.parentSessionId) {
      parentSid = subagentRec.parentSessionId;
    }
  } catch (subErr) {
    console.debug('[PERMISSION] Subagent lookup error on permission response:', subErr ? subErr.message : subErr);
  }

  permissions.resolvePermission(
    message.toolCallId,
    Boolean(message.approved),
    {
      always: Boolean(message.always),
      tool: message.tool,
      toolName: message.tool,
      sessionId: respSessionId,
      parentSessionId: parentSid
    },
    respSessionId
  );
}

export function handleClearPermissionDecision(message, webview) {
  var clearSessionId = message.sessionId || message.conversationId;
  if (message.tool) {
    permissions.clearAlwaysDecision(message.tool, clearSessionId);
  } else {
    permissions.clearAlwaysDecision(null, clearSessionId);
  }
  if (webview && typeof webview.postMessage === 'function') {
    webview.postMessage({
      type: 'permissionState',
      decisions: permissions.listAlwaysDecisions(clearSessionId)
    });
  }
}

export function handleQuestionResponse(message) {
  var qRespSessionId = message.sessionId || message.conversationId || 'default';
  questionManager.resolveQuestion(message.questionId, message.answer, qRespSessionId);
}
