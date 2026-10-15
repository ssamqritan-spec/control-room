For Render deployment, follow RENDER-SETUP.md. The original Vercel instructions below are retained for reference.

# Bursary Control Room  (Elimu Kenya + KMTC Bursary)

One control room, one database, two websites. Every record carries a `site` tag (`elimu` or `kmtc`), so the two
websites' users are **never mixed**: each has its own section, counts, money totals, lists, search and CSV export.
There is **no demo data** anywhere. A new database shows zeros and "No records yet".

```
Bursary-Control-Room/
├─ database/schema.sql      run ONCE in Supabase (shared by everything)
├─ admin/                   the control room  → its own Vercel project
├─ sites/elimu-kenya/       public website 1  → its own Vercel project
├─ sites/kmtc-bursary/      public website 2  → its own Vercel project
└─ tests/                   end-to-end test (not deployed)
```

## What the control room shows for every applicant
- **When they finished the application** (date, time, seconds; Nairobi time)
- **When they submitted payment**, the **M-Pesa code** and the phone it came from
- **How much they are to receive** (bursary amount) and **their band**
- **Fee due vs fee received** (received = what *you* verified)
- Every detail from the form: studies (HELB fields for Elimu; campus, level, admission no. and other support for KMTC), phone, email, guardian, county → sub-location, circumstances, their story
- A timeline: application completed → payment submitted → verified / rejected

## Setup (about 15 minutes)

### 1. Supabase (one project for both sites)
1. Create a **new** Supabase project. (Use a fresh one: it must not contain the old per-site `applications`/`payments` tables.)
2. SQL Editor → paste `database/schema.sql` → Run. Safe to run again later.
3. Project Settings → API: copy the **Project URL**, the **anon/publishable key**, and the **service_role key** (secret).

### 2. The two public websites
For each of `sites/elimu-kenya` and `sites/kmtc-bursary`: edit `config.js` →
`window.ELIMU = { url: 'PROJECT URL', key: 'ANON KEY' }`. **Never** put the service_role key here.
Leave `window.SITE` as it is. It is what files each user under the right website.
Deploy each folder as its own Vercel project (no build step). KMTC: also set `window.PAYBILL`.

### 3. The control room
Deploy the `admin/` folder as a third Vercel project (Node 22+). Environment variables:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (server only; never reaches the browser) |
| `PUBLIC_URL` | the control room's exact `https://…vercel.app` address |
| `ADMIN_PASSWORD` | a long passphrase. Required: the control room holds personal data and payment records |

Redeploy after setting them. Open the URL, enter the password, and you will see zeros until the first student applies.

## Day-to-day flow
1. A student completes the application on either site → appears under that site's **Applications** as *Awaiting payment*.
2. They pay by M-Pesa and enter the code → the item appears under **Payments** as *To verify* (orange badge in the sidebar).
3. Check the code against your M-Pesa statement, open the row, then **Verify payment** (confirm the amount received) or **Reject** (reason required).
   The student's pay page updates by itself: verified → success notice; rejected → asked to re-enter the code.
4. Use search (name, phone, email, reference or M-Pesa code), date and band filters, and **Export CSV** per site.

## Important honesty notes
- The M-Pesa code is typed by the student. The system records it as **unverified** until you verify it; only verified payments count as "Fees received".
- Bursary amounts and fees are calculated on the server from the band, so a browser cannot change them.
- The public sites use the anon key, which can only: submit an application, submit a payment, read one status. A test confirms they cannot read tables or call admin functions.
- Keep `ADMIN_PASSWORD` private. Repeated wrong passwords are throttled.

## Local test
`cd tests && npm install && npm test` starts a real PostgreSQL engine, loads `schema.sql`, runs the real control-room server against it and
drives both sites' flows (incl. partitioning, permissions, reject→resubmit→verify, CSV export). It never touches your live database.
