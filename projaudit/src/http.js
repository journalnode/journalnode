function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body, null, 2));
}

function parseRequestUrl(request) {
  return new URL(request.url || '/', 'https://projaudit.invalid');
}

module.exports = { parseRequestUrl, sendJson };
