const {
  AUDIT_MODELS,
  extractPageText,
  getAuditModelById,
  validatePublicUrl,
} = require('./audit');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

async function runAll() {
  console.log('\n=== Audit Tests ===\n');

  await test('accepts standard public https URLs', async () => {
    const result = validatePublicUrl('https://validator.example.com/path?q=1');
    assert(result.ok === true, 'expected URL to be accepted');
    assert(result.normalizedUrl === 'https://validator.example.com/path?q=1', `unexpected normalized URL: ${result.normalizedUrl}`);
  });

  await test('rejects localhost and private network URLs', async () => {
    const localhost = validatePublicUrl('http://localhost:3000');
    const privateIp = validatePublicUrl('http://192.168.1.12/page');
    assert(localhost.ok === false, 'localhost should be rejected');
    assert(privateIp.ok === false, 'private IP should be rejected');
  });

  await test('rejects non-http protocols', async () => {
    const result = validatePublicUrl('ftp://example.com/file');
    assert(result.ok === false, 'ftp should be rejected');
  });

  await test('extractPageText pulls title, meta description, and visible text', async () => {
    const html = `
      <html>
        <head>
          <title>Validator Alpha</title>
          <meta name="description" content="High-signal validator page">
          <style>.hidden { display:none; }</style>
        </head>
        <body>
          <h1>Validator Alpha</h1>
          <p>Uptime: 99.98%</p>
          <script>console.log('ignore me')</script>
        </body>
      </html>
    `;
    const extracted = extractPageText(html);
    assert(extracted.includes('Title: Validator Alpha'), 'title should be present');
    assert(extracted.includes('Meta Description: High-signal validator page'), 'meta description should be present');
    assert(extracted.includes('Uptime: 99.98%'), 'visible text should be present');
    assert(!extracted.includes('ignore me'), 'script text should be removed');
  });

  await test('audit models are restricted to the two supported choices', async () => {
    assert(AUDIT_MODELS.length === 2, `expected 2 audit models, got ${AUDIT_MODELS.length}`);
    assert(getAuditModelById('openai/gpt-5.4')?.name === 'ChatGPT 5.4', 'missing ChatGPT 5.4');
    assert(getAuditModelById('anthropic/claude-opus-4.6')?.name === 'Claude Opus 4.6', 'missing Claude Opus 4.6');
    assert(getAuditModelById('openai/gpt-5.2-chat') === null, 'unexpected extra model support');
  });
}

runAll().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
