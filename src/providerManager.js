// providerManager.js — Creates the right provider based on config
// The rest of the agent never knows which provider is being used.

import { PROVIDERS } from './constants.js';
import * as providerOllama from './providerOllama.js';
import * as providerOpenAI from './providerOpenAI.js';
import * as providerAnthropic from './providerAnthropic.js';
import * as providerGemini from './providerGemini.js';
import * as providerOpenRouter from './providerOpenRouter.js';
import * as providerCompatible from './providerCompatible.js';
import * as providerGroq from './providerGroq.js';

export function createProvider(config) {
  var provider = config.provider || PROVIDERS.OLLAMA;

  if (provider.startsWith('compatible')) {
    var apiType = config.apiType || 'openai';
    if (apiType === 'anthropic') {
      return providerAnthropic;
    } else if (apiType === 'gemini') {
      return providerGemini;
    } else {
      return providerCompatible;
    }
  }

  switch (provider) {
    case PROVIDERS.OLLAMA:
      return providerOllama;
    case PROVIDERS.OPENAI:
      return providerOpenAI;
    case PROVIDERS.ANTHROPIC:
      return providerAnthropic;
    case PROVIDERS.GEMINI:
      return providerGemini;
    case PROVIDERS.OPENROUTER:
      return providerOpenRouter;
    case PROVIDERS.XAI:
      return providerCompatible;
    case PROVIDERS.GROQ:
      return providerGroq;
    case PROVIDERS.COMPATIBLE:
      return providerCompatible;
    default:
      return providerOllama;
  }
}

export function getProviderName(config) {
  return config.provider || PROVIDERS.OLLAMA;
}

export function needsApiKey(provider) {
  if (provider && provider.startsWith('compatible')) {
    return true;
  }
  var needs = {
    ollama: false,
    openai: true,
    anthropic: true,
    gemini: true,
    openrouter: true,
    xai: true,
    groq: true,
    compatible: true
  };
  return needs[provider] || false;
}