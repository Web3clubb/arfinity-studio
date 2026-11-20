import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWebsite,
  normalizePhone,
  validateLead,
  rateLimited,
  renderLeadEmail,
} from '../netlify/lib/leads.mjs';
import { handler } from '../netlify/functions/submit-lead.mjs';
import { handler as notifyHandler } from '../netlify/functions/notify-pending.mjs';

const OLD_ENV = { ...process.env };
const OLD_FETCH = globalThis.fetch;
const longAgo = Date.now() - 60_000; // well past the anti-bot minimum fill time

const validBody = (overrides = {}) => ({
  brand_name: 'Maison Noor',
  website_url: 'maisonnoor.com',
  category: 'jewelry_luxury',
  contact_name: 'Asli Demir',
  email: 'Asli@MaisonNoor.com',
  whatsapp: '+90 555 123 45 67',
  selected_world: 'dream',
  campaign_description: 'Spring diamond capsule',
  request_consent: true,
  marketing_consent: false,
  hp_company_fax: '',
  started_at: longAgo,
  ...overrides,
});

const post = (body) => ({
  httpMethod: 'POST',
  headers: { 'x-nf-client-connection-ip': `10.0.0.${Math.floor(Math.random() * 250)}` },
  body: JSON.stringify(body),
  isBase64Encoded: false,
});

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.ADMIN_NOTIFICATION_EMAIL = 'team@example.com';
  process.env.ADMIN_TOKEN = 'x'.repeat(32);
  delete process.env.RESEND_FROM_EMAIL;
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  globalThis.fetch = OLD_FETCH;
});

/** Installs a fake fetch that routes by URL and records every call. */
function fakeFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
    for (const [matcher, responder] of routes) {
      if (matcher(String(url), opts)) return responder(String(url), opts);
    }
    throw new Error(`Unexpected fetch to ${url}`);
  };
  return calls;
}

const jsonRes = (status, data) =>
  new Response(data === undefined ? '' : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// ── Field normalization ──────────────────────────────────────────────────────────────────────

test('website: accepts domains, URLs and @handles, rejects junk', () => {
  assert.equal(normalizeWebsite('maisonnoor.com'), 'https://maisonnoor.com/');
  assert.equal(normalizeWebsite('https://www.maisonnoor.com/shop'), 'https://www.maisonnoor.com/shop');
  assert.equal(normalizeWebsite('@maison.noor'), 'https://www.instagram.com/maison.noor');
  assert.equal(normalizeWebsite('javascript:alert(1)'), null);
  assert.equal(normalizeWebsite('localhost'), null);
  assert.equal(normalizeWebsite('@'), null);
  assert.equal(normalizeWebsite(''), null);
});

test('phone: requires country code, normalizes spacing and 00 prefix', () => {
  assert.equal(normalizePhone('+90 555 123 45 67'), '+905551234567');
  assert.equal(normalizePhone('0044 7700 900123'), '+447700900123');
  assert.equal(normalizePhone('5551234567'), null);
  assert.equal(normalizePhone('+0123'), null);
  assert.equal(normalizePhone('abc'), null);
});

test('validateLead: a complete submission is cleaned and normalized', () => {
  const r = validateLead(validBody({ brand_name: '  Maison   Noor\u0007 ' }));
  assert.equal(r.ok, true);
  assert.equal(r.data.brand_name, 'Maison Noor');
  assert.equal(r.data.email, 'asli@maisonnoor.com');
  assert.equal(r.data.status, 'new');
  assert.equal(r.data.source, 'website');
  assert.equal(r.data.marketing_consent, false);
});

test('validateLead: missing required fields return field-level errors', () => {
  const r = validateLead(validBody({ brand_name: '', email: 'nope', request_consent: false, selected_world: 'moon' }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.brand_name);
  assert.ok(r.errors.email);
  assert.ok(r.errors.request_consent);
  assert.ok(r.errors.selected_world);
  assert.equal(r.errors.contact_name, undefined);
});

test('validateLead: marketing consent is never implied by request consent', () => {
  const r = validateLead(validBody({ marketing_consent: 'yes' }));
  assert.equal(r.ok, true);
  assert.equal(r.data.marketing_consent, false);
});

test('validateLead: honeypot and implausibly fast submissions are flagged as spam', () => {
  assert.deepEqual(validateLead(validBody({ hp_company_fax: 'http://spam' })), { spam: true });
  assert.deepEqual(validateLead(validBody({ started_at: Date.now() })), { spam: true });
});

test('rateLimited: blocks after the limit within the window', () => {
  const key = `test-${Math.random()}`;
  for (let i = 0; i < 3; i++) assert.equal(rateLimited(key, { limit: 3 }), false);
  assert.equal(rateLimited(key, { limit: 3 }), true);
});

test('renderLeadEmail: escapes HTML from visitor input', () => {
  const { html, subject } = renderLeadEmail({
    id: 'abc',
    created_at: '2026-11-20T10:00:00Z',
    brand_name: '<img src=x onerror=alert(1)>',
    website_url: 'https://example.com/',
    category: 'other',
    contact_name: 'Test',
    email: 'a@b.co',
    whatsapp: '+905551234567',
    selected_world: 'future',
    campaign_description: null,
    marketing_consent: false,
  });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
  assert.ok(subject.includes('The Future'));
});

// ── Endpoint behavior ────────────────────────────────────────────────────────────────────────

test('submit: GET is rejected with 405', async () => {
  const res = await handler({ httpMethod: 'GET', headers: {}, body: '' });
  assert.equal(res.statusCode, 405);
});

test('submit: invalid JSON is rejected', async () => {
  const res = await handler({ httpMethod: 'POST', headers: {}, body: '{nope' });
  assert.equal(res.statusCode, 400);
});

test('submit: oversized bodies are rejected before parsing', async () => {
  const res = await handler({ httpMethod: 'POST', headers: {}, body: 'x'.repeat(20_000) });
  assert.equal(res.statusCode, 413);
});

test('submit: validation errors return 400 without touching storage', async () => {
  const calls = fakeFetch([]);
  const res = await handler(post(validBody({ email: 'bad' })));
  assert.equal(res.statusCode, 400);
  assert.ok(JSON.parse(res.body).errors.email);
  assert.equal(calls.length, 0);
});

test('submit: honeypot returns a silent success and stores nothing', async () => {
  const calls = fakeFetch([]);
  const res = await handler(post(validBody({ hp_company_fax: 'bot' })));
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 0);
});

test('supabaseConfig: strips a pasted /rest/v1 suffix', async () => {
  const { supabaseConfig } = await import('../netlify/lib/leads.mjs');
  for (const raw of ['https://p.supabase.co', 'https://p.supabase.co/', 'https://p.supabase.co/rest/v1', 'https://p.supabase.co/rest/v1/']) {
    process.env.SUPABASE_URL = raw;
    assert.equal(supabaseConfig().url, 'https://p.supabase.co', raw);
  }
});

test('submit: missing Supabase credentials return 503, never a success', async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls = fakeFetch([]);
  const res = await handler(post(validBody()));
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 503);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'not_configured');
  assert.equal(calls.length, 0);
});

test('submit: happy path saves the lead, sends the email and records notification', async () => {
  const calls = fakeFetch([
    [(u, o) => u.includes('/rest/v1/brand_leads?') && o.method === 'GET', () => jsonRes(200, [])],
    [(u, o) => u.includes('/rest/v1/brand_leads?select=id,created_at') && o.method === 'POST',
      () => jsonRes(201, [{ id: 'lead-1', created_at: '2026-11-20T10:00:00Z' }])],
    [(u) => u === 'https://api.resend.com/emails', () => jsonRes(200, { id: 'email-1' })],
    [(u, o) => u.includes('/rest/v1/brand_leads?id=eq.lead-1') && o.method === 'PATCH', () => new Response(null, { status: 204 })],
  ]);

  const res = await handler(post(validBody()));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });

  const insert = JSON.parse(calls.find((c) => c.method === 'POST' && c.url.includes('brand_leads')).body);
  assert.equal(insert.email, 'asli@maisonnoor.com');
  assert.equal(insert.request_consent, true);

  const email = calls.find((c) => c.url === 'https://api.resend.com/emails');
  assert.equal(email.headers['Idempotency-Key'], 'brand-lead-lead-1');
  assert.equal(JSON.parse(email.body).reply_to, 'asli@maisonnoor.com');

  const patch = JSON.parse(calls.find((c) => c.method === 'PATCH').body);
  assert.ok(patch.notified_at);
  assert.equal(patch.notification_error, null);
});

test('submit: email failure keeps the lead, returns success and records the error', async () => {
  const calls = fakeFetch([
    [(u, o) => u.includes('/rest/v1/brand_leads?') && o.method === 'GET', () => jsonRes(200, [])],
    [(u, o) => u.includes('/rest/v1/brand_leads?select=id,created_at') && o.method === 'POST',
      () => jsonRes(201, [{ id: 'lead-2', created_at: '2026-11-20T10:00:00Z' }])],
    [(u) => u === 'https://api.resend.com/emails', () => jsonRes(500, { message: 'boom' })],
    [(u, o) => u.includes('/rest/v1/brand_leads?id=eq.lead-2') && o.method === 'PATCH', () => new Response(null, { status: 204 })],
  ]);

  const res = await handler(post(validBody()));
  assert.equal(res.statusCode, 200);
  const patch = JSON.parse(calls.find((c) => c.method === 'PATCH').body);
  assert.equal(patch.notified_at, null);
  assert.equal(patch.notification_error, 'resend_http_500');
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url.includes('brand_leads')).length, 1);
});

test('submit: duplicate within 10 minutes returns success without a second insert', async () => {
  const calls = fakeFetch([
    [(u, o) => u.includes('/rest/v1/brand_leads?') && o.method === 'GET', () => jsonRes(200, [{ id: 'old' }])],
  ]);
  const res = await handler(post(validBody()));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).duplicate, true);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});

test('submit: storage failure returns 502 with a safe message', async () => {
  fakeFetch([
    [(u, o) => u.includes('/rest/v1/brand_leads?') && o.method === 'GET', () => jsonRes(200, [])],
    [(u, o) => o.method === 'POST', () => jsonRes(500, { message: 'db down' })],
  ]);
  const res = await handler(post(validBody()));
  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(res.body).ok, false);
});

test('notify-pending: rejects requests without the admin token', async () => {
  const res = await notifyHandler({ httpMethod: 'POST', headers: { authorization: 'Bearer wrong' } });
  assert.equal(res.statusCode, 401);
});

test('notify-pending: re-sends pending notifications when authorized', async () => {
  const pending = [{ id: 'p1', created_at: '2026-11-20T09:00:00Z', notification_attempts: 1, brand_name: 'A', website_url: 'https://a.com', category: 'other', contact_name: 'Bo', email: 'bo@a.com', whatsapp: '+447700900123', selected_world: 'surreal', campaign_description: null, marketing_consent: false }];
  const calls = fakeFetch([
    [(u, o) => u.includes('/rest/v1/brand_leads?') && o.method === 'GET', () => jsonRes(200, pending)],
    [(u) => u === 'https://api.resend.com/emails', () => jsonRes(200, { id: 'e' })],
    [(u, o) => u.includes('id=eq.p1') && o.method === 'PATCH', () => new Response(null, { status: 204 })],
  ]);
  const res = await notifyHandler({ httpMethod: 'POST', headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, checked: 1, sent: 1, failed: 0 });
  const patch = JSON.parse(calls.find((c) => c.method === 'PATCH').body);
  assert.equal(patch.notification_attempts, 2);
});
