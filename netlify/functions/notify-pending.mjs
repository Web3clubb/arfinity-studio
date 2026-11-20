// POST /.netlify/functions/notify-pending
// Re-sends admin notifications for leads that were saved but whose email never went out.
// Protected by ADMIN_TOKEN (set in Netlify env vars). Never expose this token in front-end code.
import { timingSafeEqual } from 'node:crypto';
import {
  listPendingNotifications,
  markNotification,
  sendLeadNotification,
  supabaseConfig,
} from '../lib/leads.mjs';

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload),
});

function tokenMatches(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, message: 'Method not allowed.' });

  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.length < 24) {
    return json(503, { ok: false, code: 'not_configured', message: 'ADMIN_TOKEN is not set (min 24 characters).' });
  }
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!tokenMatches(provided, expected)) return json(401, { ok: false, message: 'Unauthorized.' });

  const config = supabaseConfig();
  if (!config) return json(503, { ok: false, code: 'not_configured', message: 'Supabase is not configured.' });

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

  return json(200, { ok: true, checked: pending.length, sent, failed });
};
