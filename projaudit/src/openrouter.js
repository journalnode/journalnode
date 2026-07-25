const { getConfig } = require('./config');

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_AUTH_URL = 'https://openrouter.ai/api/v1/auth/key';

function buildMessageContent(userMessage, options = {}) {
  if (options.imageBase64) {
    return [
      { type: 'text', text: userMessage },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${options.imageBase64}` } },
    ];
  }

  if (options.imageUrl) {
    return [
      { type: 'text', text: userMessage },
      { type: 'image_url', image_url: { url: options.imageUrl } },
    ];
  }

  return userMessage;
}

function extractTextFromContentPart(part) {
  if (!part) return '';
  if (typeof part === 'string') return part;
  if (typeof part.type === 'string' && /reasoning/i.test(part.type)) return '';
  if (typeof part.text === 'string') return part.text;
  if (typeof part.content === 'string') return part.content;

  if (Array.isArray(part.text)) {
    return part.text.map(extractTextFromContentPart).filter(Boolean).join('\n');
  }

  if (Array.isArray(part.content)) {
    return part.content.map(extractTextFromContentPart).filter(Boolean).join('\n');
  }

  return '';
}

function extractContent(data) {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;

  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const text = extractTextFromContentPart(content).trim();
    if (text) return text;
  }

  if (Array.isArray(content)) {
    const text = content.map(extractTextFromContentPart).filter(Boolean).join('\n').trim();
    if (text) return text;
  }

  const fallbackText = data.choices?.[0]?.text;
  if (typeof fallbackText === 'string' && fallbackText.trim()) return fallbackText.trim();

  throw new Error('OpenRouter returned an unexpected response shape.');
}

async function createChatCompletion({
  model,
  messages,
  maxTokens = 1500,
  temperature,
  apiKey,
  fetchImpl = globalThis.fetch,
}) {
  const config = getConfig();
  const resolvedApiKey = apiKey || config.openRouterApiKey;
  const resolvedModel = model || config.openRouterModel;

  if (!resolvedApiKey) {
    throw new Error('OPENROUTER_API_KEY is not set.');
  }

  const response = await fetchImpl(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resolvedApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: resolvedModel,
      messages,
      max_tokens: maxTokens,
      ...(typeof temperature === 'number' ? { temperature } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${body}`);
  }

  return extractContent(await response.json());
}

async function callModel(modelId, systemPrompt, userMessage, options = {}) {
  return createChatCompletion({
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildMessageContent(userMessage, options) },
    ],
    maxTokens: options.maxTokens || 500,
    temperature: options.temperature,
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
  });
}

async function verifyOpenRouterAuthentication(options = {}) {
  const config = getConfig();
  const apiKey = options.apiKey || config.openRouterApiKey;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (!apiKey) {
    return { configured: false, authenticated: false, status: 'missing' };
  }

  const response = await fetchImpl(OPENROUTER_AUTH_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  return {
    configured: true,
    authenticated: response.ok,
    status: response.ok ? 'ready' : `http-${response.status}`,
  };
}

module.exports = {
  OPENROUTER_AUTH_URL,
  OPENROUTER_CHAT_URL,
  buildMessageContent,
  callModel,
  createChatCompletion,
  extractContent,
  verifyOpenRouterAuthentication,
};
