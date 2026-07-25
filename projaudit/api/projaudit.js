const { getIntegrationStatus } = require('../src/config');
const { sendJson } = require('../src/http');

async function handler(request, response) {
  if (request.method === 'GET') {
    return sendJson(response, 200, {
      service: 'journal-node-projaudit',
      status: 'scaffold-ready',
      auditLogic: 'not-implemented',
      integrations: getIntegrationStatus(),
      endpoints: {
        health: '/health',
        authenticatedHealth: '/health?verify=auth',
        scaffoldPing: 'POST /projaudit',
      },
    });
  }

  if (request.method === 'POST') {
    return sendJson(response, 200, {
      status: 'accepted',
      stage: 'scaffold-ping',
      auditExecuted: false,
      message: '/projaudit deployment pipeline is ready; audit logic is intentionally deferred.',
      integrations: getIntegrationStatus(),
    });
  }

  response.setHeader('Allow', 'GET, POST');
  return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
}

module.exports = handler;
