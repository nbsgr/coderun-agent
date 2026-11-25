// On-device streaming ASR manager using Foundry Local and native audio capture.
// Strict traditional function declarations only. Zero classes or arrow functions.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import * as vscode from 'vscode';

var require = createRequire(import.meta.url);

var MODEL_ALIAS = 'nemotron-3.5-asr-streaming-0.6b';
var MODEL_VARIANT = MODEL_ALIAS + '-generic-cpu';
var MODEL_TASK = 'automatic-speech-recognition';
var DEFAULT_SAMPLE_RATE = 16000;
var MAX_PENDING_AUDIO_BYTES = 64 * 1024 * 1024;
var MODEL_APP_NAME = 'CodeRunAgent';

var foundryManager = null;
var foundryModel = null;
var foundryModelPath = '';
var foundryCacheDir = '';
var foundryModelPromise = null;
var activeSession = null;
var startingSession = null;

export function createTranscriptState() {
  return {
    finalizedText: '',
    partialText: ''
  };
}

function joinTranscriptParts(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (/\s$/.test(left) || /^\s/.test(right)) return left + right;
  return left + ' ' + right;
}

function getCumulativeTranscript(state) {
  return joinTranscriptParts(state.finalizedText, state.partialText);
}

export function applyTranscriptionResult(state, result) {
  var content = result && Array.isArray(result.content) ? result.content[0] : null;
  var text = content ? String(content.text || content.transcript || '') : '';

  if (result && result.is_final) {
    var finalText = text.trim();
    if (finalText) {
      state.finalizedText = joinTranscriptParts(state.finalizedText, finalText);
    }
    state.partialText = '';
    return {
      text: getCumulativeTranscript(state),
      delta: finalText,
      isFinal: true
    };
  }

  state.partialText += text;
  return {
    text: getCumulativeTranscript(state),
    delta: text,
    isFinal: false
  };
}

function getConfiguredModelPath() {
  var configuration = vscode.workspace.getConfiguration('coderun');
  var configuredPath = configuration && typeof configuration.get === 'function'
    ? String(configuration.get('dictationModelPath', '') || '').trim()
    : '';

  if (configuredPath) {
    var resolvedPath = path.resolve(configuredPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('Configured Nemotron model directory does not exist: ' + resolvedPath);
    }
    return resolvedPath;
  }

  var appData = process.env.APPDATA || '';
  if (!appData) return '';

  var defaultPath = path.join(
    appData,
    'Code',
    'chatDictationModels',
    'Microsoft',
    MODEL_VARIANT + '-3',
    'v3'
  );
  return fs.existsSync(defaultPath) ? defaultPath : '';
}

function readLocalModelId(modelPath) {
  var metadataPath = path.join(modelPath, 'inference_model.json');
  if (!fs.existsSync(metadataPath)) {
    throw new Error('Nemotron model metadata is missing: ' + metadataPath);
  }

  var metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  var modelId = metadata && typeof metadata.Name === 'string' ? metadata.Name : '';
  var expectedPrefix = MODEL_VARIANT + ':';
  var version = modelId.indexOf(expectedPrefix) === 0 ? modelId.slice(expectedPrefix.length) : '';

  if (!/^[1-9]\d*$/.test(version)) {
    throw new Error('The configured model is not a supported Nemotron 3.5 ASR CPU model.');
  }
  return modelId;
}

async function registerLocalModel(sdk, manager, modelPath) {
  var modelId = readLocalModelId(modelPath);
  var catalog = manager.getCatalog(sdk.CatalogType.Local);
  var models = await catalog.getModels();
  var i;

  for (i = 0; i < models.length; i++) {
    if (models[i].id !== modelId) continue;
    if (path.resolve(models[i].path) === path.resolve(modelPath)) {
      return models[i];
    }
    await catalog.unregisterModel(models[i].id);
    break;
  }

  var metadata = new sdk.MutableModelInfo();
  metadata.setStringProperty(sdk.ModelInfoStringProperty.Task, MODEL_TASK);
  metadata.setStringProperty(sdk.ModelInfoStringProperty.ModelType, 'onnxmodel');
  try {
    return await catalog.registerModel(modelPath, modelId, metadata);
  } finally {
    metadata.dispose();
  }
}

function selectCachedModelVariant(model) {
  var variants = Array.isArray(model.variants) ? model.variants : [];
  var i;

  for (i = 0; i < variants.length; i++) {
    if (variants[i].isCached && variants[i].id.indexOf('-generic-cpu:') >= 0) {
      model.selectVariant(variants[i]);
      return;
    }
  }
  for (i = 0; i < variants.length; i++) {
    if (variants[i].isCached) {
      model.selectVariant(variants[i]);
      return;
    }
  }
}

async function loadFoundryModel(cacheDir, modelPath, onStatus) {
  var sdk = await import('foundry-local-sdk');
  if (foundryManager && foundryCacheDir !== cacheDir) {
    throw new Error('Foundry Local is already initialized with a different model cache directory.');
  }

  if (!foundryManager) {
    foundryManager = await sdk.FoundryLocalManager.createAsync({
      appName: MODEL_APP_NAME,
      appDataDir: path.join(cacheDir, 'app-data'),
      modelCacheDir: cacheDir,
      logLevel: 'warn',
      disableNonessentialTelemetry: true
    });
    foundryCacheDir = cacheDir;
  }

  var model;
  if (modelPath) {
    model = await registerLocalModel(sdk, foundryManager, modelPath);
  } else {
    model = await foundryManager.catalog.getModel(MODEL_ALIAS);
    selectCachedModelVariant(model);
    if (!model.isCached) {
      onStatus('loading');
      await model.download();
    }
  }

  onStatus('loading');
  await model.load();
  foundryModel = model;
  foundryModelPath = modelPath;
  return model;
}

async function ensureFoundryModel(cacheDir, modelPath, onStatus) {
  if (foundryModel && foundryCacheDir === cacheDir && foundryModelPath === modelPath) {
    return foundryModel;
  }
  if (foundryModelPromise) {
    return foundryModelPromise;
  }

  if (foundryModel) {
    var wasLoaded = await foundryModel.isLoaded();
    if (wasLoaded) {
      await foundryModel.unload();
    }
    foundryModel = null;
    foundryModelPath = '';
  }

  foundryModelPromise = loadFoundryModel(cacheDir, modelPath, onStatus);
  var modelPromise = foundryModelPromise;
  try {
    return await modelPromise;
  } finally {
    if (foundryModelPromise === modelPromise) {
      foundryModelPromise = null;
    }
  }
}

function normalizeError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function reportSessionError(state, error) {
  if (!state.failure) {
    state.failure = normalizeError(error);
  }
  state.captureStopped = true;
  if (!state.errorReported) {
    state.errorReported = true;
    state.onError(state.failure.message);
    state.onStatus('error');
  }
}

function stopRecorder(state) {
  if (state.recorderStopped) return;
  state.recorderStopped = true;
  state.recorder.stop();
}

async function releaseSessionResources(state) {
  var session = state.session;
  var audioClient = state.audioClient;
  state.session = null;
  state.audioClient = null;

  try {
    if (session) {
      await session.dispose();
    }
  } finally {
    if (audioClient) {
      audioClient.dispose();
    }
  }
}

async function failSession(state, error) {
  reportSessionError(state, error);
  if (state.stopPromise) return;
  if (state.cleanupPromise) return state.cleanupPromise;
  try {
    stopRecorder(state);
  } catch (stopError) {
    console.warn('[CODERUN ASR] Failed to stop microphone after dictation error:', stopError.message);
  }
  state.cleanupPromise = cleanupFailedSession(state);
  try {
    await state.cleanupPromise;
  } finally {
    if (activeSession === state) {
      activeSession = null;
    }
  }
}

async function cleanupFailedSession(state) {
  if (state.openPromise) {
    try {
      await state.openPromise;
    } catch (openError) {
      // The initiating failure is already reported; continue releasing resources.
    }
  }
  await releaseSessionResources(state);
}

function handleSessionFailure(state, error) {
  failSession(state, error).catch(function onDictationCleanupError(cleanupError) {
    console.error('[CODERUN ASR] Failed to release dictation session:', cleanupError.message);
  });
}

function enqueueAudioChunk(state, session, chunk) {
  var appendPromise = state.appendChain.then(function appendAudioChunk() {
    if (state.failure || state.session !== session) return;
    return session.append(chunk);
  });
  state.appendChain = appendPromise.catch(function onAudioAppendError(error) {
    handleSessionFailure(state, error);
  });
}

function copyPcmChunk(samples) {
  if (!(samples instanceof Int16Array)) {
    throw new Error('Microphone capture returned audio in an unsupported sample format.');
  }
  var source = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  var copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

function handleAudioSamples(state, error, samples) {
  if (state.captureStopped || state.failure) return;
  if (error) {
    handleSessionFailure(state, error);
    return;
  }
  if (!samples || samples.length === 0) return;

  try {
    var chunk = copyPcmChunk(samples);
    if (state.session) {
      enqueueAudioChunk(state, state.session, chunk);
      return;
    }

    state.pendingAudioBytes += chunk.byteLength;
    if (state.pendingAudioBytes > MAX_PENDING_AUDIO_BYTES) {
      throw new Error('Dictation model is still loading; buffered microphone audio limit was reached.');
    }
    state.pendingChunks.push(chunk);
  } catch (captureError) {
    handleSessionFailure(state, captureError);
  }
}

function cumulativeTextFromResult(state, result) {
  var update = applyTranscriptionResult(state.transcript, result);
  if (update.text) {
    state.onPartial(update.text, update.delta);
    state.onStatus(update.isFinal ? 'listening' : 'recognizing');
  }
}

async function consumeSession(state, session) {
  try {
    for await (var result of session.getStream()) {
      if (state.failure) break;
      cumulativeTextFromResult(state, result);
    }
  } catch (streamError) {
    await failSession(state, streamError);
  }
}

function appendPendingAudio(state, session) {
  var pendingChunks = state.pendingChunks;
  state.pendingChunks = [];
  state.pendingAudioBytes = 0;
  var i;

  for (i = 0; i < pendingChunks.length; i++) {
    enqueueAudioChunk(state, session, pendingChunks[i]);
  }
}

async function openTranscriptionSession(state) {
  var model = await ensureFoundryModel(state.cacheDir, state.modelPath, state.onStatus);
  if (state.failure || (state.captureStopped && state.pendingChunks.length === 0)) {
    return;
  }

  var audioClient = model.createAudioClient();
  state.audioClient = audioClient;
  audioClient.settings.language = state.language;
  var session = audioClient.createLiveTranscriptionSession();
  state.session = session;
  session.settings.sampleRate = DEFAULT_SAMPLE_RATE;
  session.settings.channels = 1;
  session.settings.bitsPerSample = 16;
  session.settings.language = state.language;
  await session.start();

  if (state.failure) {
    await releaseSessionResources(state);
    return;
  }

  state.consumePromise = consumeSession(state, session);
  appendPendingAudio(state, session);
  if (!state.captureStopped) {
    state.onStatus('listening');
  }
}

async function finishSession(state) {
  try {
    if (state.openPromise) {
      await state.openPromise;
    }
    if (state.failure) {
      throw state.failure;
    }

    if (state.session) {
      await state.appendChain;
      if (state.failure) {
        throw state.failure;
      }
      await state.session.stop();
      if (state.consumePromise) {
        await state.consumePromise;
      }
      if (state.failure) {
        throw state.failure;
      }
    }

    await releaseSessionResources(state);
    state.onFinal(getCumulativeTranscript(state.transcript).trim());
    state.onStatus('stopped');
  } catch (finishError) {
    reportSessionError(state, finishError);
    try {
      await releaseSessionResources(state);
    } catch (cleanupError) {
      console.error('[CODERUN ASR] Failed to release dictation session:', cleanupError.message);
    }
  } finally {
    if (activeSession === state) {
      activeSession = null;
    }
  }
}

async function beginDictationSession(options) {
  var audioCapture = require('@kstonekuan/audio-capture');
  var recorder = new audioCapture.Recorder();
  var state = {
    recorder: recorder,
    cacheDir: options.cacheDir,
    modelPath: getConfiguredModelPath(),
    language: String(options.langTag || 'en-US').replace(/^</, '').replace(/>$/, ''),
    onStatus: options.onStatus,
    onPartial: options.onPartial,
    onFinal: options.onFinal,
    onError: options.onError,
    transcript: createTranscriptState(),
    pendingChunks: [],
    pendingAudioBytes: 0,
    appendChain: Promise.resolve(),
    openPromise: null,
    consumePromise: null,
    stopPromise: null,
    cleanupPromise: null,
    session: null,
    audioClient: null,
    captureStopped: false,
    recorderStopped: false,
    errorReported: false,
    failure: null
  };

  activeSession = state;
  state.onStatus('loading');
  try {
    recorder.start(function onCapturedAudio(error, samples) {
      handleAudioSamples(state, error, samples);
    });
  } catch (startError) {
    activeSession = null;
    throw startError;
  }

  if (state.failure) {
    state.openPromise = Promise.resolve();
  } else {
    state.openPromise = openTranscriptionSession(state);
    state.openPromise.catch(function onSessionOpenError(openError) {
      handleSessionFailure(state, openError);
    });
  }
  return state;
}

export async function startDictationSession(options) {
  options = options || {};
  function noopStatus() {}
  function noopPartial() {}
  function noopFinal() {}
  function noopError() {}

  var onStatus = typeof options.onStatus === 'function' ? options.onStatus : noopStatus;
  var onPartial = typeof options.onPartial === 'function' ? options.onPartial : noopPartial;
  var onFinal = typeof options.onFinal === 'function' ? options.onFinal : noopFinal;
  var onError = typeof options.onError === 'function' ? options.onError : noopError;
  var cacheDir = String(options.cacheDir || '').trim();

  if (!cacheDir) {
    throw new Error('Dictation requires the extension global storage directory.');
  }
  cacheDir = path.resolve(cacheDir);

  if (startingSession) {
    return startingSession;
  }
  if (activeSession) {
    await stopDictationSession();
  }

  var startPromise = beginDictationSession({
    cacheDir: cacheDir,
    langTag: options.langTag,
    onStatus: onStatus,
    onPartial: onPartial,
    onFinal: onFinal,
    onError: onError
  });
  startingSession = startPromise;
  try {
    return await startPromise;
  } finally {
    if (startingSession === startPromise) {
      startingSession = null;
    }
  }
}

export async function stopDictationSession() {
  var state = activeSession;
  if (!state) return;

  state.captureStopped = true;
  if (state.cleanupPromise) {
    await state.cleanupPromise;
    return;
  }
  try {
    stopRecorder(state);
  } catch (stopError) {
    reportSessionError(state, stopError);
  }

  if (!state.stopPromise) {
    state.stopPromise = finishSession(state);
  }
  await state.stopPromise;
}

export function isDictationActive() {
  return Boolean(activeSession || startingSession);
}

export async function disposeDictationRuntime() {
  await stopDictationSession();

  var model = foundryModel;
  var manager = foundryManager;
  foundryModel = null;
  foundryModelPath = '';
  foundryManager = null;
  foundryCacheDir = '';

  var disposeError = null;
  if (model) {
    try {
      if (await model.isLoaded()) {
        await model.unload();
      }
    } catch (modelError) {
      disposeError = modelError;
    }
  }
  if (manager) {
    try {
      manager.dispose();
    } catch (managerError) {
      if (!disposeError) {
        disposeError = managerError;
      }
    }
  }
  if (disposeError) {
    throw disposeError;
  }
}
