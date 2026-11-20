import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import submit from '../api/submit-lead.mjs';
import notify from '../api/notify-pending.mjs';

const OLD_ENV = { ...process.env };
const OLD_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.RESEND_API_KEY = 're_test';
  process.env.ADMIN_NOTIFICATION_EMAIL = 'team@example.com';
  process.env.ADMIN_TOKEN = 'x'.repeat(32);
});
afterEach(() => {
  process.env = { ...OLD_ENV };
  globalThis.fetch = OLD_FETCH;
});

function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: '' };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
}
const validBody = () => ({
  brand_name: 'Maison Noor', website_url: 'maisonnoor.com', category: 'other',
  contact_name: 'Asli Demir', email: 'asli@maisonnoor.com', whatsapp: '+905551234567',
  selected_world: 'future', request_consent: true, started_at: Date.now() - 60000,
});

test('vercel submit: GET returns 405', async () => {
  const res = fakeRes();
  await submit({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('vercel submit: validation error returns 400 with field errors', async () => {
  const res = fakeRes();
  await submit({ method: 'POST', headers: {}, body: { ...validBody(), email: 'bad' } }, res);
  assert.equal(res.statusCode, 400);
  assert.ok(JSON.parse(res.body).errors.email);
});

test('vercel submit: missing credentials return 503 not_configured', async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = fakeRes();
  await submit({ method: 'POST', headers: {}, body: validBody() }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).code, 'not_configured');
});

test('vercel submit: accepts a JSON string body and saves once', async () => {
  let inserts = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('api.resend.com')) return new Response('{"id":"e"}', { status: 200 });
    if (opts.method === 'POST' && u.includes('brand_leads')) { inserts++; return new Response('[{"id":"v1","created_at":"2026-11-20T10:00:00Z"}]', { status: 201 }); }
    if (opts.method === 'PATCH') return new Response(null, { status: 204 });
    return new Response('[]', { status: 200 });
  };
  const res = fakeRes();
  await submit({ method: 'POST', headers: { 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify(validBody()) }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(inserts, 1);
});

test('vercel notify-pending: rejects a wrong token', async () => {
  const res = fakeRes();
  await notify({ method: 'POST', headers: { authorization: 'Bearer nope' } }, res);
  assert.equal(res.statusCode, 401);
});
