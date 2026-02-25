// All available LLM models for analysis modes
// Each model has a display name, OpenRouter model ID, and whether it supports vision (images)

const MODELS = [
  { id: 'openai/gpt-5.2-chat', name: 'ChatGPT 5.2', vision: true },
  { id: 'openai/gpt-5.2-pro', name: 'ChatGPT 5.2 Pro', vision: true },
  { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6', vision: true },
  { id: 'anthropic/claude-opus-4.5', name: 'Claude Opus 4.5', vision: true },
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', vision: true },
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', vision: true },
  { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', vision: true },
  { id: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro', vision: true },
  { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', vision: true },
  { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast', vision: true },
  { id: 'x-ai/grok-4', name: 'Grok 4', vision: true },
  { id: 'x-ai/grok-4-fast', name: 'Grok 4 Fast', vision: true },
  { id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5', vision: true },
  { id: 'z-ai/glm-5', name: 'GLM 5', vision: false },
  { id: 'deepseek/deepseek-v3.2', name: 'Deepseek v3.2', vision: false },
  { id: 'qwen/qwen3.5-397b-a17b', name: 'Qwen 3.5', vision: true },
  { id: 'qwen/qwen3.5-plus-02-15', name: 'Qwen 3.5 Plus', vision: true },
  { id: 'qwen/qwen3-max-thinking', name: 'Qwen 3 Max Thinking', vision: false },
];

function getModelById(id) {
  return MODELS.find(m => m.id === id) || null;
}

function getModelByName(name) {
  return MODELS.find(m => m.name === name) || null;
}

function getVisionModels() {
  return MODELS.filter(m => m.vision);
}

module.exports = { MODELS, getModelById, getModelByName, getVisionModels };
