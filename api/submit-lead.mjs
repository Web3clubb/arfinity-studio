// Vercel Serverless Function: POST /api/submit-lead
// Same logic as netlify/functions/submit-lead.mjs. Shared code lives in netlify/lib/leads.mjs.
import {
  clientKey,
  findRecentDuplicate,
  insertLead,
  markNotification,
  rateLimited,
  sendLeadNotification,
  supabaseConfig,
  validateLead,
} from '../netlify/lib/leads.mjs';

const MAX_BODY_BYTES = 12_000;

function send(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(status).send(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return send(res, 413, { ok: false, message: 'Request is too large.' });
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return send(res, 400, { ok: false, message: 'Invalid request.' });
    }
  }
  if (Buffer.byteLength(JSON.stringify(body || {}), 'utf8') > MAX_BODY_BYTES) {
    return send(res, 413, { ok: false, message: 'Request is too large.' });
  }

  if (rateLimited(clientKey(req.headers), { limit: 5, windowMs: 10 * 60 * 1000 })) {
    return send(res, 429, { ok: false, message: 'Too many requests. Please wait a few minutes and try again.' });
  }

  const result = validateLead(body);
  if (result.spam) {
    console.info('[submit-lead] filtered submission (honeypot or too fast)');
    return send(res, 200, { ok: true });
  }
  if (!result.ok) return send(res, 400, { ok: false, errors: result.errors });

  const config = supabaseConfig();
  if (!config) {
    console.error('[submit-lead] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing');
    return send(res, 503, {
      ok: false,
      code: 'not_configured',
      message: 'Lead storage is not configured yet. Please email support@arfinity.studio instead.',
    });
  }

  let lead;
  try {
    if (await findRecentDuplicate(config, result.data)) return send(res, 200, { ok: true, duplicate: true });
    const inserted = await insertLead(config, result.data);
    lead = { ...result.data, id: inserted.id, created_at: inserted.created_at };
  } catch (err) {
    console.error('[submit-lead] could not save lead', { status: err?.status });
    return send(res, 502, {
      ok: false,
      message: 'We could not save your request just now. Please try again, or email support@arfinity.studio.',
    });
  }

  try {
    const notice = await sendLeadNotification(lead);
    await markNotification(config, lead.id, { sent: notice.sent, error: notice.error, attempts: 1 });
    if (!notice.sent) console.warn('[submit-lead] notification pending', { id: lead.id, reason: notice.error });
  } catch (err) {
    console.error('[submit-lead] notification bookkeeping failed', { id: lead.id, status: err?.status });
  }

  return send(res, 200, { ok: true });
}
