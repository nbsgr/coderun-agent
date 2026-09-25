// mediaRuntime.js — Direct generation shortcircuit for image and video models
// Extracted from agentLoop.js. Called at startup when the active model is not a chat model.
// Returns a completed result object so agentLoop can return immediately without entering the loop.

import * as mediaManager from '../media/mediaManager.js';
import * as executionTrace from '../execution/executionTrace.js';
import * as agentState from './agentState.js';
import * as events from './events.js';
import { EVENT_TYPES } from './constants.js';

/**
 * Handles direct image or video generation when the selected model modality
 * is 'image' or 'video' — bypasses the chat/tool loop entirely.
 *
 * Returns { content, thinking, done, stopped } on success, or throws on failure.
 * Returns null when modality is 'chat' (no direct generation needed).
 */
export async function handleDirectGeneration(
  modality, provider, config, effectivePrompt,
  sessionId, agentIdentity, sendEvent, messages, sendHistoryUpdate
) {
  if (modality !== 'image' && modality !== 'video') {
    return null;
  }

  if (modality === 'image') {
    return handleImageGeneration(
      provider, config, effectivePrompt,
      sessionId, agentIdentity, sendEvent, messages, sendHistoryUpdate
    );
  }

  return handleVideoGeneration(
    provider, config, effectivePrompt,
    sessionId, agentIdentity, sendEvent, messages, sendHistoryUpdate
  );
}

function buildAgentId(agentIdentity) {
  return agentIdentity ? agentIdentity.agentId : 'root';
}

async function handleImageGeneration(
  provider, config, effectivePrompt,
  sessionId, agentIdentity, sendEvent, messages, sendHistoryUpdate
) {
  console.log('[MEDIA RUNTIME] Direct Image Generation triggered for model: ' + config.model);
  sendEvent({
    type: EVENT_TYPES.AGENT_STATUS,
    status: 'generating_image',
    iteration: 0,
    content: '🎨 Synthesizing image with ' + config.model + '...'
  });

  try {
    var imgResult = await provider.images(config, effectivePrompt);
    if (!imgResult) {
      throw new Error('No image returned from image generation endpoint');
    }

    var savedMedia = await mediaManager.saveMediaFromDataOrUrl(null, sessionId, imgResult, 'png');
    var localImgPath = savedMedia
      ? savedMedia.filePath
      : (typeof imgResult === 'string' ? imgResult : 'generated_image.png');
    var mdContent = '![Generated Image](' + localImgPath + ')\n\n*Generated with ' + config.model + '*';

    agentState.transition('completed', sessionId);
    executionTrace.finishRun(sessionId, 'completed');

    var assistantMediaMsg = {
      role: 'assistant',
      content: mdContent,
      media: {
        type: 'image',
        filePath: localImgPath,
        filename: savedMedia ? savedMedia.filename : 'image.png',
        model: config.model
      }
    };
    messages.push(assistantMediaMsg);
    sendHistoryUpdate();

    try {
      executionTrace.recordFinalResponse(sessionId, {
        text: mdContent,
        thinking: '',
        durationMs: 0
      });
      executionTrace.saveTraceToDisk(null, sessionId);
    } catch (catchErr) { console.debug('[CODERUN] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }

    sendEvent({
      type: 'media_generated',
      mediaType: 'image',
      prompt: effectivePrompt,
      filePath: localImgPath,
      filename: savedMedia ? savedMedia.filename : 'image.png',
      model: config.model,
      sessionId: sessionId
    });
    sendEvent({ message: assistantMediaMsg });
    sendEvent({
      type: EVENT_TYPES.AGENT_DONE,
      reason: 'completed',
      content: mdContent,
      thinking: ''
    });

    return { content: mdContent, thinking: '', done: true, stopped: false };

  } catch (imgErr) {
    console.error('[MEDIA RUNTIME] Image generation error:', imgErr);
    agentState.transition('failed', sessionId);
    executionTrace.finishRun(sessionId, 'failed', { error: imgErr.message });
    sendEvent({
      type: EVENT_TYPES.AGENT_ERROR,
      message: 'Image generation failed: ' + imgErr.message,
      sessionId: sessionId
    });
    throw imgErr;
  }
}

async function handleVideoGeneration(
  provider, config, effectivePrompt,
  sessionId, agentIdentity, sendEvent, messages, sendHistoryUpdate
) {
  console.log('[MEDIA RUNTIME] Direct Video Generation triggered for model: ' + config.model);
  sendEvent({
    type: EVENT_TYPES.AGENT_STATUS,
    status: 'generating_video',
    iteration: 0,
    content: '🎬 Generating video with ' + config.model + '...'
  });

  try {
    var vidResult = await provider.videos(config, effectivePrompt);
    if (!vidResult) {
      throw new Error('No video returned from video generation endpoint');
    }

    var savedVid = await mediaManager.saveMediaFromDataOrUrl(null, sessionId, vidResult, 'mp4');
    var localVidPath = savedVid
      ? savedVid.filePath
      : (typeof vidResult === 'string' ? vidResult : 'generated_video.mp4');
    var vidMdContent = '![Generated Video](' + localVidPath + ')\n\n*Generated with ' + config.model + '*';

    agentState.transition('completed', sessionId);
    executionTrace.finishRun(sessionId, 'completed');

    var assistantVidMsg = {
      role: 'assistant',
      content: vidMdContent,
      media: {
        type: 'video',
        filePath: localVidPath,
        filename: savedVid ? savedVid.filename : 'video.mp4',
        model: config.model
      }
    };
    messages.push(assistantVidMsg);
    sendHistoryUpdate();

    try {
      executionTrace.recordFinalResponse(sessionId, {
        text: vidMdContent,
        thinking: '',
        durationMs: 0
      });
      executionTrace.saveTraceToDisk(null, sessionId);
    } catch (catchErr) { console.debug('[CODERUN] Non-fatal fallback:', catchErr ? catchErr.message : catchErr); }

    sendEvent({
      type: 'media_generated',
      mediaType: 'video',
      prompt: effectivePrompt,
      filePath: localVidPath,
      filename: savedVid ? savedVid.filename : 'video.mp4',
      model: config.model,
      sessionId: sessionId
    });
    sendEvent({ message: assistantVidMsg });
    sendEvent({
      type: EVENT_TYPES.AGENT_DONE,
      reason: 'completed',
      content: vidMdContent,
      thinking: ''
    });

    return { content: vidMdContent, thinking: '', done: true, stopped: false };

  } catch (vidErr) {
    console.error('[MEDIA RUNTIME] Video generation error:', vidErr);
    agentState.transition('failed', sessionId);
    executionTrace.finishRun(sessionId, 'failed', { error: vidErr.message });
    sendEvent({
      type: EVENT_TYPES.AGENT_ERROR,
      message: 'Video generation failed: ' + vidErr.message,
      sessionId: sessionId
    });
    throw vidErr;
  }
}
