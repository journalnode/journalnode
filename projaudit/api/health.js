const { getIntegrationStatus } = require('../src/config');
const { verifyGitHubAuthentication } = require('../src/github');
const { parseRequestUrl, sendJson } = require('../src/http');
const { verifyOpenRouterAuthentication } = require('../src/openrouter');

async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
  }

  const requestUrl = parseRequestUrl(request);
  const integrations = getIntegrationStatus();
  let authentication = null;

  if (requestUrl.searchParams.get('verify') === 'auth') {
    const [openrouter, github] = await Promise.all([
      verifyOpenRouterAuthentication(),
      verifyGitHubAuthentication(),
    ]);
    authentication = { openrouter, github };
  }

  const authenticationReady = !authentication
    || (authentication.openrouter.authenticated && authentication.github.authenticated);

  return sendJson(response, authenticationReady ? 200 : 503, {
    status: authenticationReady ? 'ok' : 'degraded',
    service: 'journal-node-projaudit',
    version: '0.1.0-scaffold',
    runtime: 'vercel-functions-node',
    auditLogic: 'not-implemented',
    integrations,
    ...(authentication ? { authentication } : {}),
  });
}

module.exports = handler;
