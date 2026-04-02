const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-opus-4.6';

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

function extractContent(data) {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('\n')
      .trim();
  }

  throw new Error('OpenRouter returned an unexpected response shape.');
}

async function createChatCompletion({ model = OPENROUTER_MODEL, messages, maxTokens = 1500, temperature }) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set.');
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      ...(typeof temperature === 'number' ? { temperature } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${body}`);
  }

  const data = await res.json();
  return extractContent(data);
}

async function chat(systemPrompt, userMessage, options = {}) {
  return createChatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildMessageContent(userMessage, options) },
    ],
    maxTokens: options.maxTokens || 1500,
    temperature: options.temperature,
  });
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
  });
}

async function chatWithMessages(messages, options = {}) {
  return createChatCompletion({
    messages,
    maxTokens: options.maxTokens || 1500,
    temperature: options.temperature,
  });
}

module.exports = { chat, callModel, chatWithMessages };
