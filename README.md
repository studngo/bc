# Students NGO-Help — Backend

Express + Supabase API for the Students NGO-Help platform. This repo is deployed independently from the
frontend — see [students-ngo-help-frontend](../students-ngo-help-frontend) (or your frontend repo) for the UI.

Data access uses `@supabase/supabase-js` with the **service role key**, talking to Supabase over HTTPS
(PostgREST) rather than a direct Postgres connection — this avoids Render's lack of outbound IPv6 support
entirely, since there's no raw database connection to worry about.

## Structure

```
config/       supabaseClient.js (service-role client), grades.js (single source of truth for grades/pricing)
routes/       auth, grades, registrations, students, payments, paystackWebhook, dashboard
middleware/   auth.js (JWT), errorHandler.js
services/     paystackService.js, registrationService.js (calls Postgres RPC functions for atomic operations)
utils/        supabaseErrors.js (converts PostgREST errors into throwable JS errors), phone.js, reference.js
scripts/      createAdmin.js
db/schema.sql PostgreSQL schema — tables, RLS, and RPC functions (run this in the Supabase SQL Editor)
server.js     Express entrypoint
```

### Why some logic lives in SQL functions (RPCs)

`supabase-js` talks to Postgres over HTTP (PostgREST), which can't run a multi-statement transaction from the
client the way a direct `pg` connection could. Anything that has to happen atomically — recalculating a
registration's payable amount, or finalizing payment across the `registrations` and `students` tables at once
— is implemented as a Postgres function in `db/schema.sql` and called via `supabase.rpc(...)`. Each function
runs as one atomic transaction on the database side, so this preserves the same correctness guarantees a raw
SQL transaction would have (including the idempotent, race-safe payment finalization).

## 1. Install

```bash
npm install
```

## 2. Create the Supabase project and database schema

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** in the Supabase dashboard, paste the entire contents of `db/schema.sql`, and run it.
   This creates the `registrations`, `students`, `admins`, and `webhook_events` tables (with the unique index
   that prevents duplicate Birth Certificate/Assessment numbers), enables Row Level Security, and creates the
   RPC functions the backend calls for atomic operations.
3. Get your project URL and service role key from **Project Settings → API**.

There's no separate migration script to run — the SQL Editor is the source of truth for schema changes with
this setup. If you change `db/schema.sql` later, re-run the changed statements in the SQL Editor.

## 3. Configure environment variables

Copy `.env.example` to `.env`:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your project URL, e.g. `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | The **service role** (secret) key — bypasses Row Level Security. Backend only, never sent to the frontend. |
| `PAYSTACK_SECRET_KEY` | Paystack **secret** key — never exposed to the frontend |
| `JWT_SECRET` | Long random string. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `FRONTEND_URL` | The deployed frontend's exact URL — used for CORS |
| `PORT` | Port Express listens on (Render sets this automatically) |

Never commit `.env` — it's already in `.gitignore`.

## 4. Create your first admin account

```bash
npm run create-admin -- "admin@yourorg.org" "A-Strong-Password-1" "Admin Full Name"
```

## 5. Configure Paystack

1. Sign up at [paystack.com](https://paystack.com) and enable Kenyan M-Pesa mobile money.
2. Copy your **Test Secret Key** from Settings → API Keys & Webhooks into `PAYSTACK_SECRET_KEY`.

## 6. Configure the Paystack webhook

- Webhook URL: `https://<your-backend-domain>/api/paystack/webhook`
- Every webhook is signature-verified (`x-paystack-signature`) and idempotent — duplicate deliveries are
  recorded in `webhook_events` and ignored on replay.
- For local development, tunnel with `ngrok http 10000` or use the Paystack CLI.

## 7. Run locally

```bash
npm run dev
```
Runs at `http://localhost:10000`. Set your frontend's `VITE_API_URL` to `http://localhost:10000/api`.

## 8. Deploy to Render

This repo includes a `render.yaml` Blueprint:

1. Push this repo to GitHub.
2. In Render: **New → Blueprint** → connect this repo. Render reads `render.yaml` and creates a Web Service
   with the build/start commands and health check already set.
3. During setup, fill in the variables marked `sync: false`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `PAYSTACK_SECRET_KEY`, `JWT_SECRET`, `FRONTEND_URL`. `NODE_ENV` and `PORT` are already set.
4. Alternatively, skip the Blueprint: **New → Web Service** → connect this repo → Build Command `npm install`
   → Start Command `npm start` → add the same environment variables by hand.
5. Create your first production admin (from your machine, with the production `SUPABASE_URL` /
   `SUPABASE_SERVICE_ROLE_KEY` in your local `.env`):
   ```bash
   npm run create-admin -- "admin@yourorg.org" "StrongPassword" "Admin Name"
   ```

## 9. CORS

`FRONTEND_URL` must exactly match your deployed frontend's origin (including `https://`, no trailing slash) —
the backend only accepts requests from that one origin.

## 10. Testing payments

1. Use Paystack's test M-Pesa numbers to simulate successful and failed charges.
2. Confirm `students × KSh. 100` matches what Paystack charges, regardless of what a browser might try to send.
3. Re-send the same webhook event from the Paystack dashboard and confirm no duplicate students are created.

## 11. Switching to live mode

1. Complete Paystack business verification.
2. Replace `PAYSTACK_SECRET_KEY` with your **Live Secret Key** in Render.
3. Set the webhook URL again under the **Live** keys tab in Paystack (test/live webhooks are separate).
4. Run one small real transaction end-to-end before launch.

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security entirely — it exists only in this backend's
  environment variables, never in frontend code or Git history.
- Row Level Security is enabled on every table with no policies defined, so only the service role (this
  backend) can read or write — a defense-in-depth measure in case the anon/public key is ever used against
  this project by mistake.
- The backend independently recalculates `students × KSh. 100` (via the `recalculate_registration_amount` RPC)
  before every payment initialization; the amount sent by the browser is never trusted.
- Admin routes require a valid JWT (`middleware/auth.js`); passwords are hashed with bcrypt.
