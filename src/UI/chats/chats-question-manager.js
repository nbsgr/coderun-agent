// chats-question-manager.js (UI side)
// Renders and handles interactive user question prompts (ask_question tool lifecycle)
// Strict traditional function declarations only

import { vscode } from '../controller/vscode-api.js';

export function submitQuestionAnswer(questionId, answer, sessionId) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'questionResponse',
      questionId: questionId,
      answer: answer,
      sessionId: sessionId
    });
  }
}

export function buildQuestionCardHtml(questionData) {
  var qId = questionData.id || '';
  var prompt = questionData.question || questionData.prompt || '';
  var options = questionData.options || [];
  var isMulti = Boolean(questionData.is_multi_select || questionData.multiple);

  var html = '<div class="cr-question-card" id="question_' + qId + '">';
  html += '<div class="cr-question-title">' + escapeHtml(prompt) + '</div>';
  html += '<div class="cr-question-options">';

  for (var i = 0; i < options.length; i++) {
    var opt = options[i];
    var optText = typeof opt === 'object' ? (opt.label || opt.text || '') : String(opt);
    var inputType = isMulti ? 'checkbox' : 'radio';
    html += '<label class="cr-question-option">';
    html += '<input type="' + inputType + '" name="q_opt_' + qId + '" value="' + escapeHtml(optText) + '"> ';
    html += '<span>' + escapeHtml(optText) + '</span>';
    html += '</label>';
  }

  html += '</div>';
  html += '<div class="cr-question-actions">';
  html += '<button class="cr-btn cr-btn-primary" onclick="window.handleQuestionSubmit(\'' + qId + '\')">Submit Answer</button>';
  html += '</div></div>';

  return html;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
