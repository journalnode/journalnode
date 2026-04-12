const GITHUB_GIST_API_URL = 'https://api.github.com/gists';

function getGitHubGistToken() {
  return process.env.GITHUB_GIST_TOKEN || process.env.GITHUB_TOKEN || '';
}

function slugify(value, fallback = 'report') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || fallback;
}

async function createPublicGist({
  description,
  fileName,
  content,
  userAgent = 'JournalNodeBot/0.1',
}) {
  const token = getGitHubGistToken();
  if (!token) {
    throw new Error('GitHub gist publishing is not configured. Set GITHUB_GIST_TOKEN or GITHUB_TOKEN.');
  }

  const res = await fetch(GITHUB_GIST_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      description,
      public: true,
      files: {
        [fileName]: {
          content,
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub gist creation failed (${res.status}). ${body}`);
  }

  const data = await res.json();
  return {
    htmlUrl: data.html_url,
    id: data.id,
  };
}

module.exports = {
  createPublicGist,
  getGitHubGistToken,
  slugify,
};
