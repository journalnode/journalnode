const { calculateSCS } = require('./scs');

/**
 * Model handler registry. Each handler takes { prompt, temperature, signal }
 * and returns a numeric output. Real handlers for OpenAI and Anthropic use
 * their official SDKs; all others return deterministic mock outputs.
 */
const modelHandlers = {
  // ── Real API Handlers ──────────────────────────────────────────────

  'openai': async ({ modelId, prompt, temperature, signal }) => {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      temperature: temperature ?? 0.7,
    }, { signal });
    const text = response.choices[0].message.content.trim();
    const num = parseFloat(text);
    if (Number.isNaN(num)) throw new Error(`Non-numeric response from ${modelId}: "${text}"`);
    return num;
  },

  'anthropic': async ({ modelId, prompt, temperature, signal }) => {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: modelId,
      max_tokens: 64,
      temperature: temperature ?? 0.7,
      messages: [{ role: 'user', content: prompt }],
    }, { signal });
    const text = response.content[0].text.trim();
    const num = parseFloat(text);
    if (Number.isNaN(num)) throw new Error(`Non-numeric response from ${modelId}: "${text}"`);
    return num;
  },

  // ── Stub / Mock Handlers ───────────────────────────────────────────
  // These return deterministic mock outputs so the engine is testable
  // without every API key. Replace with real SDK calls when ready.

  'google': async ({ modelId }) => {
    // STUB: Google Gemini handler — returns mock output
    return 55 + (modelId.length % 10);
  },

  'x-ai': async ({ modelId }) => {
    // STUB: xAI Grok handler — returns mock output
    return 48 + (modelId.length % 15);
  },

  'moonshotai': async () => {
    // STUB: Moonshot Kimi handler — returns mock output
    return 52;
  },

  'z-ai': async () => {
    // STUB: Z-AI GLM handler — returns mock output
    return 60;
  },

  'deepseek': async () => {
    // STUB: Deepseek handler — returns mock output
    return 58;
  },

  'qwen': async ({ modelId }) => {
    // STUB: Qwen handler — returns mock output
    return 50 + (modelId.length % 12);
  },

  '__default': async ({ modelId }) => {
    // STUB: Unknown provider — returns mock output
    return 50 + (modelId.length % 20);
  },
};

/**
 * Resolve the handler for a given model identifier string.
 * Model IDs use "provider/model-name" format (e.g. "openai/gpt-5.2-chat").
 */
function getHandler(modelName) {
  const provider = modelName.includes('/') ? modelName.split('/')[0] : null;
  return modelHandlers[provider] || modelHandlers['__default'];
}

/**
 * Query multiple models in parallel with per-model timeout.
 *
 * @param {object} params
 * @param {string[]} params.models - model identifier strings
 * @param {string} params.prompt - the prompt to send to each model
 * @param {string} [params.assetClass] - asset class context
 * @param {string} [params.timeframe] - timeframe context
 * @param {number} [params.temperature=0.7] - sampling temperature
 * @param {number} [params.timeout=30000] - per-model timeout in ms
 * @param {Function} [params._handlerOverride] - test hook to override handler
 * @returns {Promise<{ results: Array, excluded: Array, meta: object }>}
 */
async function queryModels({
  models,
  prompt,
  assetClass,
  timeframe,
  temperature = 0.7,
  timeout = 30000,
  _handlerOverride,
}) {
  if (!models || models.length === 0) {
    throw new Error('models must be a non-empty array');
  }

  const startTime = Date.now();

  const promises = models.map(modelName => {
    const controller = new AbortController();
    const handler = _handlerOverride || getHandler(modelName);

    const callPromise = handler({
      modelId: modelName,
      prompt,
      temperature,
      signal: controller.signal,
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        controller.abort();
        reject(new Error(`exceeded ${timeout}ms`));
      }, timeout);
    });

    return Promise.race([callPromise, timeoutPromise])
      .then(output => ({ modelName, output, status: 'success' }))
      .catch(err => ({ modelName, status: err.message.includes('exceeded') ? 'timeout' : 'error', reason: err.message }));
  });

  const settled = await Promise.allSettled(promises);

  const results = [];
  const excluded = [];

  for (const entry of settled) {
    // Promise.race always resolves (we catch inside), so status is 'fulfilled'
    const val = entry.value;
    if (val.status === 'success') {
      results.push({ modelName: val.modelName, output: val.output, status: 'success' });
    } else {
      excluded.push({ modelName: val.modelName, status: val.status, reason: val.reason });
    }
  }

  const executionMs = Date.now() - startTime;

  return {
    results,
    excluded,
    meta: {
      totalRequested: models.length,
      totalSucceeded: results.length,
      totalExcluded: excluded.length,
      executionMs,
    },
  };
}

/**
 * Query models in parallel, then pipe successful results into calculateSCS.
 *
 * @param {object} params
 * @param {string[]} params.models
 * @param {string} params.prompt
 * @param {string} params.assetClass
 * @param {string} [params.timeframe]
 * @param {string} [params.mode='sentiment'] - 'sentiment' or 'confidence'
 * @param {number} [params.temperature=0.7]
 * @param {number} [params.timeout=30000]
 * @param {Function} [params._handlerOverride] - test hook
 * @returns {Promise<{ scs: { score, label, variance }, queryMeta: object }>}
 */
async function queryModelsWithSCS({
  models,
  prompt,
  assetClass,
  timeframe,
  mode = 'sentiment',
  temperature = 0.7,
  timeout = 30000,
  _handlerOverride,
}) {
  const queryResult = await queryModels({
    models,
    prompt,
    assetClass,
    timeframe,
    temperature,
    timeout,
    _handlerOverride,
  });

  if (queryResult.results.length === 0) {
    throw new Error('All models failed or timed out; cannot compute SCS');
  }

  const successModels = queryResult.results.map(r => r.modelName);
  const successOutputs = queryResult.results.map(r => r.output);

  const scs = calculateSCS({
    models: successModels,
    outputs: successOutputs,
    assetClass,
    mode,
  });

  return {
    scs,
    queryMeta: queryResult.meta,
  };
}

module.exports = { queryModels, queryModelsWithSCS };
