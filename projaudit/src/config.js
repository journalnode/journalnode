const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-opus-4.6';

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getConfig(env = process.env) {
  return {
    openRouterApiKey: env.OPENROUTER_API_KEY || '',
    openRouterModel: env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
    githubToken: env.GITHUB_GIST_TOKEN || env.GITHUB_TOKEN || '',
  };
}

function getIntegrationStatus(env = process.env) {
  const config = getConfig(env);
  return {
    openrouter: {
      configured: hasValue(config.openRouterApiKey),
      model: config.openRouterModel,
    },
    github: {
      configured: hasValue(config.githubToken),
      capability: 'public-gist-creation',
    },
  };
}

module.exports = {
  DEFAULT_OPENROUTER_MODEL,
  getConfig,
  getIntegrationStatus,
  hasValue,
};
