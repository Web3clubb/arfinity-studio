-- ARFINITY Studio: brand_leads
-- Run once in Supabase → SQL Editor (or `supabase db push` if you use the CLI).
--
-- Security model:
--   * RLS is enabled and NO policies are created, so anon and authenticated users can neither
--     read nor write this table directly.
--   * The website never talks to this table from the browser. Only the Netlify Function
--     (which holds SUPABASE_SERVICE_ROLE_KEY server-side) inserts rows, and service_role bypasses RLS.
--   * Team members review leads in the Supabase dashboard (Table Editor), which is project-owner access.

create table if not exists public.brand_leads (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),

  brand_name             text not null check (char_length(brand_name) between 2 and 120),
  website_url            text not null check (char_length(website_url) between 4 and 200),
  category               text not null check (category in (
                           'fashion_beauty','jewelry_luxury','food_beverage','hospitality',
                           'music_artists','tech_startup','consumer_products','other')),
  contact_name           text not null check (char_length(contact_name) between 2 and 100),
  email                  text not null check (char_length(email) between 5 and 254),
  whatsapp               text not null check (whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
  selected_world         text not null check (selected_world in ('surreal','dream','future','surprise')),
  campaign_description   text check (campaign_description is null or char_length(campaign_description) <= 1000),

  request_consent        boolean not null check (request_consent = true),
  marketing_consent      boolean not null default false,

  status                 text not null default 'new' check (status in (
                           'new','contacted','concepts_in_progress','delivered','converted','not_qualified')),
  source                 text not null default 'website',

  -- Email notification bookkeeping. A row with notified_at IS NULL is re-sent by notify-pending.
  notified_at            timestamptz,
  notification_attempts  integer not null default 0,
  notification_error     text
);

create index if not exists brand_leads_created_at_idx on public.brand_leads (created_at desc);
create index if not exists brand_leads_pending_idx on public.brand_leads (created_at) where notified_at is null;
create index if not exists brand_leads_dedupe_idx on public.brand_leads (email, brand_name, created_at desc);

alter table public.brand_leads enable row level security;

-- Belt and braces: remove any default grants that could expose the table through the Data API.
revoke all on public.brand_leads from anon, authenticated;

comment on table public.brand_leads is 'Lead requests from the ARFINITY "3 creative worlds" form. Contains personal data: no public access.';
