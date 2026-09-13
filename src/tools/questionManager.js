// questionManager.js — Session-scoped Interactive Question Lifecycle Manager
// Manages pending questions from ask_question tool calls.
// Allows webview UI to resolve questions with user-selected answers.

var pendingQuestions = {};
var QUESTION_TIMEOUT_MS = 300000; // 5 minutes bounded lifetime

function createDeferredPromise() {
  var deferred = {};
  function deferredExecutor(resolve, reject) {
    deferred.resolve = resolve;
    deferred.reject = reject;
  }
  deferred.promise = new Promise(deferredExecutor);
  return deferred;
}

export function createQuestion(question, options, sessionId, timeoutMs) {
  var sid = sessionId || 'default';
  var questionId = 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  var deferred = createDeferredPromise();
  var limit = timeoutMs || QUESTION_TIMEOUT_MS;

  function onQuestionTimeout() {
    if (pendingQuestions[questionId]) {
      console.warn('[QUESTION MANAGER] Question timed out:', questionId);
      delete pendingQuestions[questionId];
      deferred.resolve({
        answered: false,
        answer: '',
        timedOut: true,
        message: 'Question timed out waiting for user answer.'
      });
    }
  }

  var timer = setTimeout(onQuestionTimeout, limit);

  pendingQuestions[questionId] = {
    id: questionId,
    question: question || '',
    options: Array.isArray(options) ? options : [],
    sessionId: sid,
    deferred: deferred,
    timer: timer,
    createdAt: Date.now()
  };

  return {
    id: questionId,
    question: question,
    options: options,
    sessionId: sid,
    promise: deferred.promise
  };
}

export function resolveQuestion(questionId, answer, sessionId) {
  if (!questionId) return { success: false, message: 'Missing questionId' };
  var item = pendingQuestions[questionId];
  if (!item) {
    return { success: false, message: 'Question not found or already answered: ' + questionId };
  }

  if (sessionId && item.sessionId && item.sessionId !== sessionId) {
    console.warn('[QUESTION MANAGER] Cross-session resolve rejected. Request session:', item.sessionId, 'Caller session:', sessionId);
    return { success: false, message: 'Cross-session authorization denied.' };
  }

  if (item.timer) {
    clearTimeout(item.timer);
  }

  delete pendingQuestions[questionId];

  item.deferred.resolve({
    answered: true,
    answer: String(answer != null ? answer : '').trim(),
    timedOut: false
  });

  return { success: true, questionId: questionId };
}

export function getPendingQuestion(questionId) {
  return pendingQuestions[questionId] || null;
}

export function listPendingQuestions(sessionId) {
  var list = [];
  for (var id in pendingQuestions) {
    var item = pendingQuestions[id];
    if (!sessionId || item.sessionId === sessionId) {
      list.push({
        id: item.id,
        question: item.question,
        options: item.options,
        sessionId: item.sessionId,
        createdAt: item.createdAt
      });
    }
  }
  return list;
}

export function cancelSessionQuestions(sessionId) {
  if (!sessionId) return;
  for (var id in pendingQuestions) {
    var item = pendingQuestions[id];
    if (item.sessionId === sessionId) {
      if (item.timer) clearTimeout(item.timer);
      item.deferred.resolve({
        answered: false,
        answer: '',
        cancelled: true,
        message: 'Question cancelled.'
      });
      delete pendingQuestions[id];
    }
  }
}

export function cancelAllQuestions() {
  for (var id in pendingQuestions) {
    var item = pendingQuestions[id];
    if (item.timer) clearTimeout(item.timer);
    item.deferred.resolve({
      answered: false,
      answer: '',
      cancelled: true,
      message: 'All questions cancelled.'
    });
    delete pendingQuestions[id];
  }
}
