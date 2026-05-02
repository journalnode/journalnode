const assert = require('assert');
const {
  AUDIT_COMMAND_MIN_COST_DROPS,
  applyTaskNodeEnvOverrides,
  buildAuditFailureReply,
  buildAuditModelSelectionErrorReply,
  buildAuditModelSelectionReply,
  buildAuditStartedReply,
  buildAuditSuccessReply,
  findAuditModelFromText,
  getTaskNodeAgentSettings,
  parseAuditRequest,
} = require('./tasknodeAuditAgentShared');

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

(async () => {
  await test('parseAuditRequest accepts slash command with url', async () => {
    const result = parseAuditRequest('/audit https://validator.example.com');
    assert.strictEqual(result.shouldRespond, true);
    assert.strictEqual(result.kind, 'audit');
    assert.strictEqual(result.url, 'https://validator.example.com');
    assert.strictEqual(result.modelId, null);
  });

  await test('parseAuditRequest accepts slash command with ChatGPT 5.5 model selection', async () => {
    const result = parseAuditRequest('/audit https://validator.example.com --model "ChatGPT 5.5"');
    assert.strictEqual(result.shouldRespond, true);
    assert.strictEqual(result.kind, 'audit');
    assert.strictEqual(result.url, 'https://validator.example.com');
    assert.strictEqual(result.modelId, 'openai/gpt-5.5');
  });

  await test('parseAuditRequest accepts slash command with Claude Opus 4.6 model selection', async () => {
    const result = parseAuditRequest('/audit https://validator.example.com --model "Claude Opus 4.6"');
    assert.strictEqual(result.shouldRespond, true);
    assert.strictEqual(result.kind, 'audit');
    assert.strictEqual(result.url, 'https://validator.example.com');
    assert.strictEqual(result.modelId, 'anthropic/claude-opus-4.6');
  });

  await test('parseAuditRequest returns usage error when slash command omits url', async () => {
    const result = parseAuditRequest('/audit');
    assert.strictEqual(result.shouldRespond, true);
    assert.strictEqual(result.kind, 'usage-error');
    assert.match(result.error, /Usage:/);
  });

  await test('parseAuditRequest rejects unsupported explicit model values', async () => {
    const result = parseAuditRequest('/audit https://validator.example.com --model "gpt-4"');
    assert.strictEqual(result.shouldRespond, true);
    assert.strictEqual(result.kind, 'usage-error');
    assert.match(result.error, /Unsupported model/);
  });

  await test('parseAuditRequest accepts bare url messages', async () => {
    const result = parseAuditRequest('https://validator.example.com/page');
    assert.strictEqual(result.shouldRespond, true);
    assert.strictEqual(result.kind, 'audit');
    assert.strictEqual(result.url, 'https://validator.example.com/page');
  });

  await test('parseAuditRequest ignores unsupported messages', async () => {
    const result = parseAuditRequest('hello there');
    assert.strictEqual(result.shouldRespond, false);
  });

  await test('findAuditModelFromText accepts the exact supported model names', async () => {
    assert.strictEqual(findAuditModelFromText('ChatGPT 5.5')?.id, 'openai/gpt-5.5');
    assert.strictEqual(findAuditModelFromText('Claude Opus 4.6')?.id, 'anthropic/claude-opus-4.6');
    assert.strictEqual(findAuditModelFromText('gpt-4'), null);
  });

  await test('applyTaskNodeEnvOverrides maps prefixed seed settings', async () => {
    const env = {
      TASKNODE_AGENT_SEED_FILE: 'data/tasknode-agent/seed.txt',
      TASKNODE_AGENT_PING_INTERVAL_MS: '30000',
    };

    applyTaskNodeEnvOverrides(env);
    assert.strictEqual(env.BOT_SEED_FILE, 'data/tasknode-agent/seed.txt');
    assert.strictEqual(env.PING_INTERVAL_MS, '30000');
  });

  await test('getTaskNodeAgentSettings applies defaults', async () => {
    const settings = getTaskNodeAgentSettings({});
    assert.strictEqual(settings.agentName, 'Journal Node');
    assert.strictEqual(settings.auditModel, 'openai/gpt-5.5');
    assert.strictEqual(settings.pollIntervalMs, 15000);
    assert.strictEqual(
      settings.agentDescription,
    'LLM-optimization suite by Wizbubba. Investment Thesis and Post Fiat Validator Webpage scoring tools.'
    );
    assert.strictEqual(settings.commands[0].min_cost_drops, AUDIT_COMMAND_MIN_COST_DROPS);
    assert.strictEqual(
      settings.commands[0].description,
      'Find out how LLM-optimized your Post Fiat validator webpage is with a comprehensive audit report. After you submit the URL, reply in-thread with ChatGPT 5.5 or Claude Opus 4.6 to choose the audit model.'
    );
    assert.strictEqual(
      settings.commands[0].example,
      '/audit https://validator.example.com'
    );
  });

  await test('reply builders format expected output', async () => {
    assert.match(
      buildAuditModelSelectionReply('https://validator.example.com'),
      /Reply in this thread with exactly one of these model names/
    );
    assert.match(buildAuditModelSelectionErrorReply(), /ChatGPT 5\.5/);
    assert.match(
      buildAuditStartedReply('https://validator.example.com', 'ChatGPT 5.5'),
      /Running the validator-page audit for https:\/\/validator\.example\.com\./
    );
    assert.strictEqual(buildAuditFailureReply(' bad   input '), 'Audit failed: bad input');
    assert.match(
      buildAuditSuccessReply({
        requestedUrl: 'https://validator.example.com',
        finalUrl: 'https://validator.example.com/final',
        modelName: 'ChatGPT 5.5',
        modelId: 'openai/gpt-5.5',
        gistUrl: 'https://gist.github.com/example',
      }),
      /Public gist: https:\/\/gist.github.com\/example/
    );
  });
})();
