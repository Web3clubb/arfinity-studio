# ARFINITY Studio: deployment and lead setup

The site is static HTML at the repo root. Netlify publishes it with no build step. Lead capture runs in a Netlify Function and stores leads in Supabase. Each new lead also emails the team through Resend.

Nothing in this repo contains real credentials. Keys live only in Netlify environment variables and in your local `.env`, which is git-ignored.

## 1. Create the Supabase project (Free tier)

1. supabase.com → **New project**. Pick a region close to your team and set a strong database password.
2. Wait for provisioning, then open **Project Settings → API**. You need three values:
   - Project URL → `SUPABASE_URL`
   - `anon` public key → `SUPABASE_ANON_KEY` (not used by the current code, but part of the agreed list)
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` (**server-side only**)

## 2. Run the schema

1. **SQL Editor → New query**.
2. Paste the contents of `supabase/migrations/20261120000000_brand_leads.sql` and click **Run**.
3. Check **Table Editor → brand_leads**. RLS should show as enabled, and anonymous access should be blocked.

Reviewing leads: open **Table Editor → brand_leads** and change `status` to one of `new`, `contacted`, `concepts_in_progress`, `delivered`, `converted`, `not_qualified`. Only project members can see this table.

## 3. Configure Resend (Free tier)

1. resend.com → create an API key with **Sending access** → `RESEND_API_KEY`.
2. For production, verify your sending domain (**Domains → Add domain**, then add the DNS records Resend shows you). Use an address on that domain for `RESEND_FROM_EMAIL`, for example `ARFINITY Leads <leads@arfinity.studio>`.
3. Until the domain is verified, you can test with the default sender, which only delivers to the email on your Resend account.
4. Set `ADMIN_NOTIFICATION_EMAIL` to the team inbox that should receive new leads.

## 4. Add environment variables in Netlify

Netlify → your site → **Site configuration → Environment variables**. Add each of these:

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Secret. Do not mark it as exposed to the front end. |
| `RESEND_API_KEY` | yes | Without it, leads are saved but the email is queued for resend. |
| `ADMIN_NOTIFICATION_EMAIL` | yes | Where lead alerts go. |
| `RESEND_FROM_EMAIL` | recommended | Verified sender address. |
| `SUPABASE_ANON_KEY` | optional | Not used by the current code. |
| `ADMIN_TOKEN` | for resend tool | At least 24 random characters. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. |

Redeploy after changing variables (**Deploys → Trigger deploy**). Functions read variables at deploy time.

## 5. Deploy through GitHub

The site is connected to GitHub, so nothing changes in your workflow. Open a pull request from a branch, review the Netlify deploy preview, and merge into `main` when it looks right.

The Netlify config is in `netlify.toml`. It sets `publish = "."` and `functions = "netlify/functions"`. If the Netlify UI has a build command set, clear it. The site does not need one.

## 6. Test a real lead

1. Open the deploy preview or the live site. Fill in the form with a test brand, your own email, and a real WhatsApp number.
2. Expect the confirmation panel. A "Received" state only appears after the lead is saved, so a success state means the row exists.
3. Check **Table Editor → brand_leads**. You should see the row with `status = new` and `notified_at` filled in.
4. Check your admin inbox for the email. If `notified_at` is empty and `notification_error` says something like `resend_http_403`, fix the Resend setup and go to step 7.

## 7. Re-send notifications that failed

Any lead with `notified_at` empty is a pending notification. Re-send them with:

```bash
curl -X POST https://www.arfinity.studio/.netlify/functions/notify-pending \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Replace `$ADMIN_TOKEN` with the value from Netlify. Use your shell variable, not a literal token. The response reports how many were checked and sent.

## Local development

```bash
cp .env.example .env     # then fill in real values locally, never commit .env
npm install -g netlify-cli
netlify dev              # serves the site and functions on http://localhost:8888
npm test                 # backend tests (no network calls, mocked fetch)
```

Without Supabase variables, the form shows a clear "not configured" message on localhost and never claims a lead was saved.

## Known limits (first version)

- Rate limiting is best effort. Serverless instances do not share memory, so the main protections are the hidden honeypot field, the minimum fill time, and a 10-minute duplicate check against the database.
- Duplicate protection: the same email and brand within 10 minutes returns success without a second insert.
- The browser never talks to Supabase directly. The public site cannot read leads.
