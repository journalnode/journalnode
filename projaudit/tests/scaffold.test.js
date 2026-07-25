const assert = require('node:assert/strict');
const test = require('node:test');

const healthHandler = require('../api/health');
const projauditHandler = require('../api/projaudit');
const { getIntegrationStatus } = require('../src/config');
const { createPublicGist, verifyGitHubAuthentication } = require('../src/github');
const { callModel, verifyOpenRouterAuthentication } = require('../src/openrouter');

function createResponse() {
  return {
    headers: {},
    statusCode: null,
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

test('integration status reports configured environment variables without exposing secrets', () => {
  const status = getIntegrationStatus({
    OPENROUTER_API_KEY: 'openrouter-secret',
    GITHUB_GIST_TOKEN: 'github-secret',
    OPENROUTER_MODEL: 'test/model',
  });

  assert.deepEqual(status, {
    openrouter: { configured: true, model: 'test/model' },
    github: { configured: true, capability: 'public-gist-creation' },
  });
  assert.equal(JSON.stringify(status).includes('secret'), false);
});

test('ported OpenRouter wrapper sends the existing audit call shape', async () => {
  let request;
  const result = await callModel('test/model', 'system prompt', 'user prompt', {
    apiKey: 'openrouter-secret',
    maxTokens: 4500,
    temperature: 0.1,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'placeholder report' } }] }),
      };
    },
  });

  assert.equal(result, 'placeholder report');
  assert.equal(request.options.headers.Authorization, 'Bearer openrouter-secret');
  assert.deepEqual(JSON.parse(request.options.body), {
    model: 'test/model',
    messages: [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt' },
    ],
    max_tokens: 4500,
    temperature: 0.1,
  });
});

test('GitHub client preserves public gist creation behavior', async () => {
  let request;
  const result = await createPublicGist({
    description: 'Scaffold smoke test',
    fileName: 'projaudit-smoke-test.md',
    content: 'ok',
    token: 'github-secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ id: 'gist-id', html_url: 'https://gist.github.com/example/gist-id' }),
      };
    },
  });

  assert.equal(result.id, 'gist-id');
  assert.equal(request.options.headers.Authorization, 'Bearer github-secret');
  assert.equal(JSON.parse(request.options.body).public, true);
});

test('authentication probes report successful provider responses', async () => {
  const successfulFetch = async () => ({ ok: true, status: 200 });
  const openrouter = await verifyOpenRouterAuthentication({
    apiKey: 'openrouter-secret',
    fetchImpl: successfulFetch,
  });
  const github = await verifyGitHubAuthentication({
    token: 'github-secret',
    fetchImpl: successfulFetch,
  });

  assert.deepEqual(openrouter, { configured: true, authenticated: true, status: 'ready' });
  assert.deepEqual(github, { configured: true, authenticated: true, status: 'ready' });
});

test('health endpoint exposes scaffold state', async () => {
  const response = createResponse();
  await healthHandler({ method: 'GET', url: '/health' }, response);
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.runtime, 'vercel-functions-node');
  assert.equal(body.auditLogic, 'not-implemented');
});

test('projaudit endpoint accepts a scaffold ping without running audit logic', async () => {
  const response = createResponse();
  await projauditHandler({ method: 'POST', url: '/projaudit' }, response);
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.status, 'accepted');
  assert.equal(body.auditExecuted, false);
});
