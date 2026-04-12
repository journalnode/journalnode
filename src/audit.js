const fs = require('fs');
const path = require('path');
const { callModel } = require('./openrouter');
const { createPublicGist, getGitHubGistToken, slugify } = require('./githubGist');

const CANONICAL_AUDIT_CONTEXT_PATH = path.join(__dirname, '..', 'docs', 'post-fiat-validator-webpage-audit.txt');
const FETCH_TIMEOUT_MS = 15000;
const MAX_HTML_CHARS = 400000;
const MAX_PAGE_TEXT_CHARS = 30000;

const AUDIT_MODELS = [
  { id: 'openai/gpt-5.4', name: 'ChatGPT 5.4' },
  { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6' },
];

let canonicalAuditContextCache = null;

function getAuditModelById(modelId) {
  return AUDIT_MODELS.find(model => model.id === modelId) || null;
}

function getAuditGistToken() {
  return getGitHubGistToken();
}

function isPrivateIpv4(hostname) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some(part => Number.isNaN(part) || part < 0 || part > 255)) return false;

  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === '::1'
    || normalized.startsWith('fe80:')
    || normalized.startsWith('fc')
    || normalized.startsWith('fd');
}

function isNonPublicHostname(hostname) {
  const normalized = (hostname || '').toLowerCase();
  if (!normalized) return true;
  if (normalized === 'localhost') return true;
  if (normalized.endsWith('.local') || normalized.endsWith('.internal') || normalized.endsWith('.lan') || normalized.endsWith('.home')) return true;
  if (isPrivateIpv4(normalized) || isPrivateIpv6(normalized)) return true;
  if (!normalized.includes('.') && !normalized.includes(':')) return true;
  return false;
}

function validatePublicUrl(input) {
  let parsed;
  try {
    parsed = new URL((input || '').trim());
  } catch {
    return { ok: false, error: 'Provide a valid absolute URL starting with http:// or https://.' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'Only public http:// and https:// URLs are supported.' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Authenticated URLs are not allowed. Use a public page URL.' };
  }

  if (isNonPublicHostname(parsed.hostname)) {
    return { ok: false, error: 'That URL does not look public. Private, local, and internal hosts are blocked.' };
  }

  return { ok: true, normalizedUrl: parsed.toString() };
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&#x27;/gi, '\'');
}

function extractTagContent(html, tagName) {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? decodeHtmlEntities(match[1].replace(/\s+/g, ' ').trim()) : '';
}

function extractMetaDescription(html) {
  const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i)
    || html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i);
  return match ? decodeHtmlEntities(match[1].replace(/\s+/g, ' ').trim()) : '';
}

function htmlToPlainText(html) {
  const trimmed = String(html || '').slice(0, MAX_HTML_CHARS);
  const withoutHiddenBlocks = trimmed
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ');

  const structuralBreaks = withoutHiddenBlocks
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|aside|main|header|footer|nav|li|ul|ol|table|tr|td|th|h1|h2|h3|h4|h5|h6)>/gi, '\n');

  const withoutTags = structuralBreaks
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '');

  const decoded = decodeHtmlEntities(withoutTags);
  return decoded
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_PAGE_TEXT_CHARS);
}

function extractPageText(html) {
  const title = extractTagContent(html, 'title');
  const description = extractMetaDescription(html);
  const bodyText = htmlToPlainText(html);
  const parts = [];

  if (title) parts.push(`Title: ${title}`);
  if (description) parts.push(`Meta Description: ${description}`);
  if (bodyText) parts.push('Page Text:\n' + bodyText);

  return parts.join('\n\n').trim();
}

function loadCanonicalAuditContext() {
  if (!canonicalAuditContextCache) {
    canonicalAuditContextCache = fs.readFileSync(CANONICAL_AUDIT_CONTEXT_PATH, 'utf8').trim();
  }
  return canonicalAuditContextCache;
}

async function fetchPublicPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'JournalNodeAuditBot/0.1',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      },
    });

    if (!res.ok) {
      throw new Error(`The page could not be fetched. HTTP ${res.status} ${res.statusText}.`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
      throw new Error(`Unsupported content type: ${contentType || 'unknown'}. Submit a public webpage URL.`);
    }

    const raw = await res.text();
    const pageText = extractPageText(raw);
    if (!pageText) {
      throw new Error('The page was reachable but no readable text could be extracted.');
    }

    return {
      finalUrl: res.url || url,
      contentType,
      pageText,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('The page fetch timed out. Submit a faster public URL.');
    }
    if (err instanceof Error) throw err;
    throw new Error('Failed to fetch the submitted page.');
  } finally {
    clearTimeout(timeout);
  }
}

async function runValidatorAudit({ url, modelId }) {
  const model = getAuditModelById(modelId);
  if (!model) {
    throw new Error('Unsupported audit model selected.');
  }

  const page = await fetchPublicPage(url);
  const systemPrompt = [
    loadCanonicalAuditContext(),
    '',
    'Return only the completed audit report. Follow the exact template from the canonical context.',
  ].join('\n');

  const userPrompt = [
    'Run the canonical Post Fiat validator webpage audit on the following fetched page content.',
    `Audit Date: ${new Date().toISOString().slice(0, 10)}`,
    `Page URL: ${page.finalUrl}`,
    `Model: ${model.name} (${model.id})`,
    `Fetched Content-Type: ${page.contentType}`,
    '',
    'Fetched page text:',
    '============================================================',
    page.pageText,
    '============================================================',
  ].join('\n');

  const report = await callModel(model.id, systemPrompt, userPrompt, {
    maxTokens: 4500,
    temperature: 0.1,
  });

  return {
    model,
    page,
    report: String(report || '').trim(),
  };
}

async function createPublicAuditGist({ pageUrl, modelId, report }) {
  const parsedUrl = new URL(pageUrl);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const fileName = `audit-${slugify(parsedUrl.hostname, 'validator-page')}-${dateStamp}.md`;

  return createPublicGist({
    description: `Validator webpage audit for ${pageUrl} via ${modelId}`,
    fileName,
    content: report,
    userAgent: 'JournalNodeAuditBot/0.1',
  });
}

module.exports = {
  AUDIT_MODELS,
  createPublicAuditGist,
  extractPageText,
  fetchPublicPage,
  getAuditGistToken,
  getAuditModelById,
  loadCanonicalAuditContext,
  runValidatorAudit,
  validatePublicUrl,
};
