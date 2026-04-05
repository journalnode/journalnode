const assert = require('assert');
const {
  applyTaskNodeEnvOverrides,
  buildAuditFailureReply,
  buildAuditStartedReply,
  buildAuditSuccessReply,
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
  });

  await test('parseAuditRequest returns usage error when slash command omits url', async () => {
    const result = parseAuditRequest('/audit');
    assert.strictEqual(result.shouldRespond, true);
    assert.strictEqual(result.kind, 'usage-error');
    assert.match(result.error, /Usage:/);
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
    assert.strictEqual(settings.auditModel, 'openai/gpt-5.4');
    assert.strictEqual(settings.pollIntervalMs, 15000);
  });

  await test('reply builders format expected output', async () => {
    assert.match(buildAuditStartedReply('https://validator.example.com'), /Running the validator-page audit/);
    assert.strictEqual(buildAuditFailureReply(' bad   input '), 'Audit failed: bad input');
    assert.match(
      buildAuditSuccessReply({
        requestedUrl: 'https://validator.example.com',
        finalUrl: 'https://validator.example.com/final',
        modelName: 'ChatGPT 5.4',
        modelId: 'openai/gpt-5.4',
        gistUrl: 'https://gist.github.com/example',
      }),
      /Public gist: https:\/\/gist.github.com\/example/
    );
  });
})();
