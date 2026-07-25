const { getConfig } = require('./config');

const GITHUB_API_URL = 'https://api.github.com';

function getGitHubHeaders(token, userAgent = 'JournalNodeProjaudit/0.1') {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': userAgent,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function createPublicGist({
  description,
  fileName,
  content,
  token,
  fetchImpl = globalThis.fetch,
}) {
  const config = getConfig();
  const resolvedToken = token || config.githubToken;

  if (!resolvedToken) {
    throw new Error('GitHub gist publishing is not configured. Set GITHUB_GIST_TOKEN or GITHUB_TOKEN.');
  }

  const response = await fetchImpl(`${GITHUB_API_URL}/gists`, {
    method: 'POST',
    headers: getGitHubHeaders(resolvedToken),
    body: JSON.stringify({
      description,
      public: true,
      files: {
        [fileName]: { content },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub gist creation failed (${response.status}). ${body}`);
  }

  const data = await response.json();
  return { htmlUrl: data.html_url, id: data.id };
}

async function verifyGitHubAuthentication(options = {}) {
  const config = getConfig();
  const token = options.token || config.githubToken;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (!token) {
    return { configured: false, authenticated: false, status: 'missing' };
  }

  const response = await fetchImpl(`${GITHUB_API_URL}/user`, {
    headers: getGitHubHeaders(token),
  });

  return {
    configured: true,
    authenticated: response.ok,
    status: response.ok ? 'ready' : `http-${response.status}`,
  };
}

module.exports = {
  GITHUB_API_URL,
  createPublicGist,
  getGitHubHeaders,
  verifyGitHubAuthentication,
};
