// Shared server-side logic for ARFINITY lead capture.
// Runs only inside Netlify Functions. Secrets are read from process.env and never shipped to the browser.
import { createHash } from 'node:crypto';

export const WORLDS = {
  surreal: 'The Surreal',
  dream: 'The Dream',
  future: 'The Future',
  surprise: 'Surprise me',
};

export const CATEGORIES = {
  fashion_beauty: 'Fashion & beauty',
  jewelry_luxury: 'Jewelry & luxury',
  food_beverage: 'Food & beverage',
  hospitality: 'Hospitality & travel',
  music_artists: 'Music & artists',
  tech_startup: 'Tech & startups',
  consumer_products: 'Consumer products',
  other: 'Other',
};

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+[1-9]\d{6,14}$/;
const MIN_FILL_MS = 3000; // a human needs longer than this to fill the form

/** Single-line text: strips control characters, collapses whitespace, caps length. */
export function cleanLine(value, max) {
  return String(value ?? '').replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Multi-line text: keeps line breaks, strips control characters, caps length. */
export function cleanText(value, max) {
  return String(value ?? '').replace(CONTROL_CHARS, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

/** Accepts a domain, a full URL, or an @instagram handle. Returns a normalized https URL or null. */
export function normalizeWebsite(raw) {
  let s = cleanLine(raw, 200);
  if (!s) return null;
  if (s.startsWith('@')) {
    const handle = s.slice(1).replace(/[^A-Za-z0-9._]/g, '');
    if (!handle) return null;
    s = `https://www.instagram.com/${handle}`;
  } else if (!/^https?:\/\//i.test(s)) {
    s = `https://${s}`;
  }
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (!url.hostname.includes('.')) return null;
  return url.toString();
}

/** Normalizes an international phone number to E.164-like form (+ and digits only). */
export function normalizePhone(raw) {
  let s = String(raw ?? '').replace(/[\s\-().]/g, '').slice(0, 25);
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  return PHONE_RE.test(s) ? s : null;
}

/**
 * Validates and sanitizes a submission. Returns one of:
 *  - { spam: true }                 honeypot filled or form completed implausibly fast
 *  - { ok: false, errors }          field-level validation errors (safe to show the visitor)
 *  - { ok: true, data }             cleaned record ready for storage
 */
export function validateLead(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, errors: { form: 'Please fill in the form and try again.' } };
  }

  if (cleanLine(body.hp_company_fax, 200)) return { spam: true };
  if (body.started_at !== undefined) {
    const started = Number(body.started_at);
    if (Number.isFinite(started) && Date.now() - started < MIN_FILL_MS) return { spam: true };
  }

  const errors = {};
  const brandName = cleanLine(body.brand_name, 120);
  const contactName = cleanLine(body.contact_name, 100);
  const email = cleanLine(body.email, 254).toLowerCase();
  const websiteUrl = normalizeWebsite(body.website_url);
  const whatsapp = normalizePhone(body.whatsapp);
  const category = cleanLine(body.category, 40);
  const selectedWorld = cleanLine(body.selected_world, 20);
  const campaign = cleanText(body.campaign_description, 1000);

  if (brandName.length < 2) errors.brand_name = 'Please enter your brand or business name.';
  if (!websiteUrl) errors.website_url = 'Enter a website (yourbrand.com) or Instagram handle (@yourbrand).';
  if (!Object.prototype.hasOwnProperty.call(CATEGORIES, category)) errors.category = 'Please choose a business category.';
  if (contactName.length < 2) errors.contact_name = 'Please enter your name.';
  if (!EMAIL_RE.test(email) || email.length > 254) errors.email = 'Please enter a valid business email.';
  if (!whatsapp) errors.whatsapp = 'Include your country code, e.g. +44 7700 900123.';
  if (!Object.prototype.hasOwnProperty.call(WORLDS, selectedWorld)) errors.selected_world = 'Choose the world that interests you most.';
  if (body.request_consent !== true) errors.request_consent = 'Please agree so we can respond to your request.';

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    data: {
      brand_name: brandName,
      website_url: websiteUrl,
      category,
      contact_name: contactName,
      email,
      whatsapp,
      selected_world: selectedWorld,
      campaign_description: campaign || null,
      request_consent: true,
      marketing_consent: body.marketing_consent === true,
      status: 'new',
      source: 'website',
    },
  };
}

// ---- Best-effort rate limiting -------------------------------------------------------------
// Netlify Functions run in many short-lived instances, so this only slows down bursts that hit
// the same warm instance. The real protections are the honeypot, the timing check and the DB dedupe.
const hits = new Map();
export function rateLimited(key, { limit = 5, windowMs = 10 * 60 * 1000 } = {}) {
  const now = Date.now();
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }
  const entry = hits.get(key);
  if (!entry || now - entry.start > windowMs) {
    hits.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

/** Hashes a client IP so it can be rate-limited without being stored or logged in plain text. */
export function clientKey(headers = {}) {
  const ip =
    headers['x-nf-client-connection-ip'] ||
    String(headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown';
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

// ---- Supabase (server-side only, service role) ---------------------------------------------
export function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // Accept "https://x.supabase.co", "https://x.supabase.co/" and "https://x.supabase.co/rest/v1".
  // Pasting the REST path into the env var used to produce /rest/v1/rest/v1 and a 404.
  const clean = url.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  return { url: clean, key };
}

async function sbRequest(config, path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${config.url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const err = new Error(`Supabase ${method} ${path.split('?')[0]} failed with ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function insertLead(config, row) {
  const rows = await sbRequest(config, 'brand_leads?select=id,created_at', {
    method: 'POST',
    body: row,
    prefer: 'return=representation',
  });
  return rows[0];
}

export async function findRecentDuplicate(config, { email, brand_name }, windowMs = 10 * 60 * 1000) {
  const since = new Date(Date.now() - windowMs).toISOString();
  const q = new URLSearchParams({
    select: 'id',
    email: `eq.${email}`,
    brand_name: `eq.${brand_name}`,
    created_at: `gte.${since}`,
    limit: '1',
  });
  const rows = await sbRequest(config, `brand_leads?${q.toString()}`);
  return Array.isArray(rows) && rows.length > 0;
}

export async function markNotification(config, id, { sent, error, attempts }) {
  await sbRequest(config, `brand_leads?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: {
      notified_at: sent ? new Date().toISOString() : null,
      notification_error: sent ? null : String(error || 'unknown').slice(0, 300),
      notification_attempts: attempts,
    },
    prefer: 'return=minimal',
  });
}

export async function listPendingNotifications(config, limit = 20) {
  const q = new URLSearchParams({
    select: '*',
    notified_at: 'is.null',
    order: 'created_at.asc',
    limit: String(limit),
  });
  return sbRequest(config, `brand_leads?${q.toString()}`);
}

// ---- Resend (email notification) ------------------------------------------------------------
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function resendConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!apiKey || !to) return null;
  return {
    apiKey,
    to,
    from: process.env.RESEND_FROM_EMAIL || 'ARFINITY Leads <onboarding@resend.dev>',
  };
}

export function renderLeadEmail(lead) {
  const world = WORLDS[lead.selected_world] || lead.selected_world;
  const category = CATEGORIES[lead.category] || lead.category;
  const waDigits = String(lead.whatsapp || '').replace(/\D/g, '');
  const submitted = new Date(lead.created_at || Date.now());
  const when = `${submitted.toISOString().replace('T', ' ').slice(0, 16)} UTC`;

  const rows = [
    ['Brand', lead.brand_name],
    ['Website / Instagram', lead.website_url],
    ['Category', category],
    ['Contact name', lead.contact_name],
    ['Business email', lead.email],
    ['WhatsApp', lead.whatsapp],
    ['Selected world', world],
    ['Campaign / product', lead.campaign_description || '—'],
    ['Marketing consent', lead.marketing_consent ? 'Yes' : 'No'],
    ['Submitted', when],
  ];

  const html = `<!doctype html><html><body style="margin:0;padding:16px;background:#f6f1e7;font-family:Arial,Helvetica,sans-serif;color:#1a1410">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:6px;padding:24px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8a5e18">New brand lead</p>
<h1 style="margin:0 0 20px;font-size:22px;line-height:1.25">${esc(lead.brand_name)}</h1>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:15px">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:10px 0;border-top:1px solid #eee;color:#6b5f4f;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:10px 0;border-top:1px solid #eee;vertical-align:top;word-break:break-word">${esc(v)}</td></tr>`,
  )
  .join('')}
</table>
<p style="margin:24px 0 0;font-size:14px">
<a href="https://wa.me/${esc(waDigits)}" style="display:inline-block;background:#1a1410;color:#f0d080;padding:12px 18px;text-decoration:none;margin-right:8px">Open WhatsApp</a>
<a href="mailto:${esc(lead.email)}" style="display:inline-block;background:#C8A45A;color:#080504;padding:12px 18px;text-decoration:none">Reply by email</a>
</p>
<p style="margin:24px 0 0;font-size:12px;color:#8a7f70">Lead ID ${esc(lead.id)}. Update its status in Supabase → brand_leads.</p>
</div></body></html>`;

  const text = [
    `New brand lead: ${lead.brand_name}`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Lead ID: ${lead.id}`,
  ].join('\n');

  return { html, text, subject: `New brand lead: ${lead.brand_name} (${world})` };
}

/** Sends the admin notification. Never throws: returns { sent, error } so the lead is never lost. */
export async function sendLeadNotification(lead) {
  const config = resendConfig();
  if (!config) return { sent: false, error: 'resend_not_configured' };
  try {
    const { html, text, subject } = renderLeadEmail(lead);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `brand-lead-${lead.id}`,
      },
      body: JSON.stringify({
        from: config.from,
        to: [config.to],
        reply_to: lead.email,
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { sent: false, error: `resend_http_${res.status}` };
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err?.name === 'TimeoutError' ? 'resend_timeout' : 'resend_network_error' };
  }
}
