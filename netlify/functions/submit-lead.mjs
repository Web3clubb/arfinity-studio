// POST /.netlify/functions/submit-lead
// Public endpoint for the "Get 3 creative worlds" form. Saves a lead to Supabase, then notifies the team.
import {
  clientKey,
  findRecentDuplicate,
  insertLead,
  markNotification,
  rateLimited,
  sendLeadNotification,
  supabaseConfig,
  validateLead,
} from '../lib/leads.mjs';

const MAX_BODY_BYTES = 12_000;

const json = (statusCode, payload) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
  body: JSON.stringify(payload),
});

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { ...json(405, { ok: false, message: 'Method not allowed.' }), headers: { Allow: 'POST' } };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return json(413, { ok: false, message: 'Request is too large.' });
  }

  let body;
  try {
    body = JSON.parse(rawBody || '{}');
  } catch {
    return json(400, { ok: false, message: 'Invalid request.' });
  }

  if (rateLimited(clientKey(event.headers), { limit: 5, windowMs: 10 * 60 * 1000 })) {
    return json(429, { ok: false, message: 'Too many requests. Please wait a few minutes and try again.' });
  }

  const result = validateLead(body);

  // Bots: pretend success, store nothing.
  if (result.spam) {
    console.info('[submit-lead] filtered submission (honeypot or too fast)');
    return json(200, { ok: true });
  }
  if (!result.ok) {
    return json(400, { ok: false, errors: result.errors });
  }

  const config = supabaseConfig();
  if (!config) {
    // Never pretend a lead was saved when storage is not configured.
    console.error('[submit-lead] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing');
    return json(503, {
      ok: false,
      code: 'not_configured',
      message: 'Lead storage is not configured yet. Please email support@arfinity.studio instead.',
    });
  }

  let lead;
  try {
    if (await findRecentDuplicate(config, result.data)) {
      // Same brand + email inside 10 minutes: the first copy already counts. Don't store twice.
      return json(200, { ok: true, duplicate: true });
    }
    const inserted = await insertLead(config, result.data);
    lead = { ...result.data, id: inserted.id, created_at: inserted.created_at };
  } catch (err) {
    console.error('[submit-lead] could not save lead', { status: err?.status });
    return json(502, {
      ok: false,
      message: 'We could not save your request just now. Please try again, or email support@arfinity.studio.',
    });
  }

  // The lead is saved at this point. Email problems must not lose it or show an error to the visitor.
  try {
    const notice = await sendLeadNotification(lead);
    await markNotification(config, lead.id, {
      sent: notice.sent,
      error: notice.error,
      attempts: 1,
    });
    if (!notice.sent) console.warn('[submit-lead] notification pending', { id: lead.id, reason: notice.error });
  } catch (err) {
    console.error('[submit-lead] notification bookkeeping failed', { id: lead.id, status: err?.status });
  }

  return json(200, { ok: true });
};
