// Vercel Serverless Function: POST /api/notify-pending (token-protected resend of failed notifications)
import { timingSafeEqual } from 'node:crypto';
import { listPendingNotifications, markNotification, sendLeadNotification, supabaseConfig } from '../netlify/lib/leads.mjs';

function send(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(payload));
}

function tokenMatches(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, message: 'Method not allowed.' });

  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.length < 24) {
    return send(res, 503, { ok: false, code: 'not_configured', message: 'ADMIN_TOKEN is not set (min 24 characters).' });
  }
  const header = req.headers.authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!tokenMatches(provided, expected)) return send(res, 401, { ok: false, message: 'Unauthorized.' });

  const config = supabaseConfig();
  if (!config) return send(res, 503, { ok: false, code: 'not_configured', message: 'Supabase is not configured.' });

  const pending = await listPendingNotifications(config, 20);
  let sent = 0;
  let failed = 0;
  for (const lead of pending) {
    const notice = await sendLeadNotification(lead);
    await markNotification(config, lead.id, {
      sent: notice.sent,
      error: notice.error,
      attempts: (lead.notification_attempts || 0) + 1,
    });
    if (notice.sent) sent += 1;
    else failed += 1;
  }
  return send(res, 200, { ok: true, checked: pending.length, sent, failed });
}
