// toolDefinitions.js — Tool schemas for LLM function calling
// Re-exports from the unified toolRegistry.
// Kept for backward compatibility — agentLoop.js imports from here.

export { getDefinitions, getDefinition, clearDefinitions } from './toolRegistry.js';
