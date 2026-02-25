const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-opus-4.6';

async function chat(systemPrompt, userMessage) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set.');
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 1500,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

/**
 * Call a specific model via OpenRouter. Supports text and image inputs.
 * @param {string} modelId - OpenRouter model ID (e.g. 'anthropic/claude-opus-4.6')
 * @param {string} systemPrompt - System prompt
 * @param {string} userMessage - Text message
 * @param {object} [options] - Optional: { imageUrl, imageBase64, maxTokens }
 * @returns {string} Model response text
 */
async function callModel(modelId, systemPrompt, userMessage, options = {}) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set.');
  }

  // Build user content — text only or multimodal (text + image)
  let userContent;
  if (options.imageUrl || options.imageBase64) {
    userContent = [
      { type: 'text', text: userMessage },
    ];
    if (options.imageUrl) {
      userContent.push({
        type: 'image_url',
        image_url: { url: options.imageUrl },
      });
    } else if (options.imageBase64) {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${options.imageBase64}` },
      });
    }
  } else {
    userContent = userMessage;
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      max_tokens: options.maxTokens || 500,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

module.exports = { chat, callModel };
