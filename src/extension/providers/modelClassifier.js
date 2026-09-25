// modelClassifier.js — Classifies model modalities (chat, image, video, embedding, audio)
// Implements Strategy 1 (Provider metadata inspection) with deterministic token fallbacks.

export function extractModelModality(rawModelOrId) {
  if (!rawModelOrId) return 'chat';
  var m = typeof rawModelOrId === 'object' ? rawModelOrId : { id: String(rawModelOrId) };
  var id = String(m.id || m.name || '').toLowerCase();

  // 1. Direct type field from provider (Strategy 1)
  if (m.type) {
    var t = String(m.type).toLowerCase();
    if (t === 'video' || t === 'image' || t === 'embedding' || t === 'audio' || t === 'chat') {
      return t;
    }
  }

  // 2. Modalities array (e.g. ["image"] or ["video"] or ["text"])
  if (Array.isArray(m.modalities) && m.modalities.length > 0) {
    var mods = [];
    for (var i = 0; i < m.modalities.length; i++) {
      mods.push(String(m.modalities[i]).toLowerCase());
    }
    if (mods.indexOf('video') !== -1) return 'video';
    if (mods.indexOf('image') !== -1 && mods.indexOf('text') === -1) return 'image';
    if (mods.indexOf('embedding') !== -1) return 'embedding';
  }

  // 3. Architecture / Task / Capabilities metadata
  if (m.architecture && m.architecture.modality) {
    var archMod = String(m.architecture.modality).toLowerCase();
    if (archMod === 'video' || archMod === 'image' || archMod === 'embedding') {
      return archMod;
    }
  }
  if (m.task) {
    var task = String(m.task).toLowerCase();
    if (task.indexOf('text-to-video') !== -1 || task.indexOf('video') !== -1) return 'video';
    if (task.indexOf('text-to-image') !== -1 || task.indexOf('image') !== -1) return 'image';
    if (task.indexOf('embedding') !== -1) return 'embedding';
  }

  // 4. Token heuristics on model ID (Strategy 2 fallback safety)
  if (/(?:^|[-_])video(?:[-_]|$)|sora|kling|runway|cogvideo|luma|pika/i.test(id)) {
    return 'video';
  }
  if (/(?:^|[-_])image(?:[-_]|$)|dall-?e|imagen|flux|stable-diffusion|sdxl/i.test(id)) {
    return 'image';
  }
  if (/(?:^|[-_])embed(?:ding)?(?:[-_]|$)|text-similarity|bge-/i.test(id)) {
    return 'embedding';
  }
  if (/(?:^|[-_])whisper(?:[-_]|$)|tts|audio|speech/i.test(id)) {
    return 'audio';
  }

  return 'chat';
}

export function isLocalEndpoint(config) {
  if (!config) return true;
  var provider = String(config.provider || '').toLowerCase();
  if (provider === 'ollama') return true;

  var baseUrl = String(config.baseUrl || '').toLowerCase();
  if (!baseUrl) {
    if (provider === '' || provider === 'ollama') return true;
    return false;
  }

  if (baseUrl.indexOf('localhost') !== -1 ||
      baseUrl.indexOf('127.0.0.1') !== -1 ||
      baseUrl.indexOf('0.0.0.0') !== -1 ||
      baseUrl.indexOf('::1') !== -1 ||
      baseUrl.indexOf('.local') !== -1 ||
      baseUrl.indexOf(':11434') !== -1) {
    return true;
  }

  return false;
}

export function getProviderTimeout(config) {
  if (isLocalEndpoint(config)) {
    return 600000;
  }
  return 30000;
}
