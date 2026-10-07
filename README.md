# Longhorn Ledger

A payment voucher system for the Longhorn group: Longhorn Associates, Longhorn Financial
Services and Longhorn Insurance Broking all keep their books in one ledger, and no
company can see another company's vouchers.

## What each role can do

| Role | Create vouchers | See vouchers | Approve | Admin panel |
| --- | --- | --- | --- | --- |
| **Preparer** | Yes, always stamped with their own branch | Only their own branch | No | No |
| **Approver** | No | Every branch, with a branch filter | Yes, one at a time or a whole month | No |
| **Admin** | Yes | Every branch, with a branch filter | Yes, one at a time or a whole month | Yes |

Those rules are enforced in Postgres by Row Level Security, so they hold even if
someone edits the browser's JavaScript. The UI filters on top of that are a
convenience, not the guard.

## Setup

### 1. Install and run

```bash
npm install
npm run dev
```

### 2. Add the server keys

Supabase is the database and the sign-in provider. Copy `.env.example` to `.env` and fill
in three variables:

| Variable | Where to find it | Needed for |
| --- | --- | --- |
| `NITRO_SUPABASE_URL` | Supabase → Project Settings → API | resolving your role and branch |
| `NITRO_SUPABASE_ANON_KEY` | same page, Publishable key | verifying who is signed in |
| `NITRO_SUPABASE_SERVICE_KEY` | same page, Secret key | admin panel only |

The publishable key is also hardcoded in `src/integrations/supabase/client.ts` for the
browser, so it is safe to expose. The **secret** key is not: nothing under `src/` reads it,
and it must never be committed or shared.

### 2a. On Vercel

Environment variables are read at build time, so set them under
**Settings → Environment Variables** with **Production** scope, then redeploy:

```
NITRO_SUPABASE_URL             production
NITRO_SUPABASE_ANON_KEY        production
NITRO_SUPABASE_SERVICE_KEY     production   (sb_secret_...)
```

Setting them in `.env` alone does nothing for the deployed site. If the admin panel reports
a missing credential, it means the current deployment predates the variable.

Without the secret key everything still works — sign-in, vouchers, branch visibility and
monthly approval. Only "Add person", access toggles and password resets are blocked.

### 3. Run the database migration

Open `database/multi_company_setup.sql` in the Supabase SQL Editor and run it. It is
idempotent, so it is safe to run again. It:

- creates the `companies` table and seeds the three branches
- adds `profiles.company_id`, `vouchers.company_id` and
  `vouchers.assigned_approver_id`
- backfills existing users and vouchers, so nothing is left unassigned
- installs the RLS policies that keep each branch's vouchers private

Existing users are matched to a branch by email domain. If your staff use different
domains, edit the `CASE` in section 4 of that file before running it, or set each
person's branch afterwards from the admin panel.

### 4. Sign in and open the admin panel

Go to `/admin` as an admin. From there you can add people, set roles, assign branches,
add or stand down branches, and reset passwords.

## Approving a month at a time

Approvers get an **Approve a month** view in the sidebar. It opens on the newest month
with anything waiting, and offers:

- a month stepper plus quick chips for recent months
- a branch filter, since approvers see all three companies
- a list of everything still `Pending approval` in that month, grouped by preparer
- **Select all in [month]** and **Approve N at once**, behind a confirmation dialog
- a single **Approve** button per row for the odd one out

Bulk approval is deliberately restricted to **closed months**. The current month is still
collecting vouchers, so approving it wholesale would sign off payments that have not
arrived yet; the UI says so and leaves single approval available instead.

The month is sent to the server with the request, and the server refuses anything that
has moved out of it. That means a stale browser tab cannot approve a voucher the approver
had not actually looked at. Anything skipped is reported back by name rather than
silently dropped.

## Changing a sign-in email

Both in **Settings** and from the admin panel, an email change applies immediately.

This needs explaining, because the obvious approach does not work. Supabase's own email
change is designed to send a confirmation link and leave the stored address untouched
until somebody clicks it. This project sits on Supabase's built-in mail service, which
only delivers to project team members, so that link never arrives and the address
silently never changes. Passwords have no such step, which is why changing a password
appeared to work while changing an email did not.

So the change is applied server-side instead, with `email_confirm: true`:

- `PATCH /api/account/email` — the signed-in person changing their own address
- `PATCH /api/admin/users/:id` — an admin changing anyone's address

Self-service asks for the current password first. A session alone is not enough: a
hijacked session could otherwise redirect an account and take it over permanently.

Note that changing someone's address does **not** move them to a different branch. Branch
assignment lives on their profile and is only ever changed from the admin panel.

### 5. If role edits in the Table Editor keep reverting

There was a bug where promoting someone in the Supabase Table Editor appeared to save and
then sprang back. Run this once in the SQL Editor:

```
database/fix_role_edits.sql
```

It repairs the trigger and also promotes `kuunda@longhorn-associates.com` to admin.

The cause was a trigger that stopped non-admins from editing roles. It judged the caller
by `auth.uid()`, but the Table Editor, the SQL editor and the app's own service-role
backend all run with no signed-in user, so they were mistaken for an attack and their
edits were silently reverted. A write with no signed-in user is now treated as trusted,
and a *signed-in* non-admin is still protected, which is the case that matters.

### 6. If an approver's name is wrong on existing vouchers

Run `database/fix_approver_attribution.sql` in the SQL Editor. Section 1 is read-only and
prints the current attribution per branch, so you can check before changing anything.

It repoints Longhorn Associates vouchers whose approver is not someone with the approver
role, and leaves rows already attributed to a genuine approver alone. Voucher dates,
amounts and the original `approved_at` are never touched. Idempotent.

### 7. Stop the same payment being entered twice

Run `database/find_duplicate_vouchers.sql` first — it is read-only and reports where the same
invoice reference, or the same payee for the same amount on the same day, already repeats.

Then run `database/prevent_duplicate_vouchers.sql`. It installs the guard only once the
ledger is clean, and refuses with a count if it is not.

What it blocks:

- the same invoice reference twice in one branch
- the same payee for the same amount on the same day, in one branch

What it deliberately does **not** block: several payments on the same date. Paying fuel, a
courier and airtime on one morning is normal, and enforcing one voucher per date would stop
real payments. A duplicate is the same invoice paid twice, not two payments on one day.

### 8. Make the approval date match the date on the voucher

Run `database/align_approval_dates.sql` in the SQL Editor. Paste the whole file and click Run.
Its opening sections are read-only and show the gap, plus how far `created_at` and the
voucher's own date diverge.

If you see `syntax error at or near "\"`, you are running an older copy that still contains
psql client commands such as `\echo`. Those are not SQL. Pull the latest and paste again.

`approved_at` becomes `voucher_date`, the date printed on the voucher. A voucher dated 30
September shows **Date: 30 Sep 2026** beside the approver's signature, matching the date at
the top of the same sheet, and its month grouping follows the month it is dated.

`voucher_date` itself is never touched, so nothing moves between months. The original
timestamp moves to `approved_recorded_at`, so you can still audit exactly when each approval
happened:

```sql
select voucher_no, voucher_date, approved_at, approved_recorded_at
  from public.vouchers
 where approved_recorded_at is not null
 order by approved_recorded_at desc;
```

A trigger keeps this true for future approvals, so it holds for single approval, monthly bulk
approval and the bulk importer alike.

**Run that one file and nothing else.** It supersedes
`database/set_approval_date_from_created.sql`, which used `created_at` instead. That one is
wrong for this ledger: every voucher was loaded in a single batch, so `created_at` reads the
batch date and September vouchers kept showing an October approval date. It is marked
SUPERSEDED. If you already ran it, just run `align_approval_dates.sql` afterwards — it
switches you over and is idempotent.

> **Why running it twice earlier did nothing.** That script also left a trigger behind which
> forced `approved_at` back to `created_at` on every update. The fix has to drop that trigger
> *before* it writes any rows, or the trigger overwrites each one as it lands. The current
> script does that, and `npm run db:verify` includes a check that installs the old trigger
> first, so this cannot regress silently.

### 9. Print vouchers in bulk, and choose how many rows a page shows

No setup. This is all in the app.

**Bulk printing.** Both **Pending vouchers** and **Approved vouchers** have a tick box per row
and a **Print selected (n)** button. Each voucher prints as its own A4 sheet, one per page,
with the approver's name and the voucher's own date on it.

To print a whole month without ticking 780 boxes, use **Select all n vouchers**. It is always
visible once the list is longer than one page, so you do not have to tick the page checkbox
first. Narrow the list with the search box, the branch filter or the date range, then print.

**There is a limit of 100 vouchers per print job.** Each one is a full sheet of paper, and
asking the browser to render several hundred at once stalls the print dialog badly enough to
look like a crash. Above the limit the app says so and tells you to narrow the date range,
rather than freezing the tab.

> **If printing comes out blank, check the rule in `@media print`.** The sheets are portalled
> to `<body>` on purpose. The stylesheet hides `body > *:not(.print-only)`, which only works
> while the sheets really are a direct child of `<body>`. An earlier version reached in from
> `.app-shell` instead, which hid `.main-content` — and every sheet inside it came out at zero
> height, so every page printed blank. If the `.print-only` markup is ever moved back inside
> the app shell, printing breaks again.

**Rows per page.** The pager under each table has a **Rows** picker: 10, 25, 50, 100, 150 or
200. It appears as soon as there is anything in the list, so you can find it before you need
it, and the choice is remembered on that browser for next time. One setting covers both
tables.

Changing the size returns you to the first page, so you never land on a page that no longer
exists.

## Verifying the rules locally

The migration can be tested without touching Supabase. This builds a throwaway database,
runs the migration three times to prove it is idempotent, then impersonates a real user
for each rule:

```bash
npm run db:verify
```

It needs `psql` and a superuser connection. Defaults to
`postgresql://postgres:postgres@localhost:5432/postgres`; override with
`ADMIN_DATABASE_URL`. Expected result:

```
  run 1: ok
  run 2: ok
  run 3: ok
  PASS: LFS preparer sees only LFS vouchers (expected 1, got 1)
  PASS: LFS approver sees every branch (expected 3, got 3)
  PASS: LAssociates voucher hidden from LFS preparer
  PASS: Insurance Broking voucher hidden from LFS preparer
  8 further rule checks reported PASS
All multi-company rules verified.
```

Bulk approval has its own checks:

```bash
npm run test:approvals
npm run test:email
```

These prove the month scoping, that drafts and already-approved rows are never stamped,
that the approval stamp comes from the caller's profile rather than the request body, and
that the approver role is re-checked server-side.

The page size and bulk printing have theirs:

```bash
npm run test:pagination
```

That one executes `src/lib/pagination.ts` rather than pattern-matching it, so the paging
arithmetic is really run: an out-of-range page, a page that vanishes when the size changes,
a stored value edited to something unoffered, and the print limit are all exercised. It also
asserts the wiring, including that no print path bypasses the limit.

## Layout

```
database/
  multi_company_setup.sql       the migration to run in Supabase
  fix_role_edits.sql            one-off fix if Table Editor role changes revert
  verify-migration.mjs          local proof the rules hold  (npm run db:verify)
  _migration_test_setup.sql     stand-in schema for the test
  _migration_verify.sql         the branch-scoping checks
  _role_edit_verify.sql         dashboard-edit checks
  _revert_role_trigger.sql      fixture: the old buggy trigger, for regression testing
  longhorn_ledger_seed.sql      original local Postgres seed

server/
  utils/supabase.ts             verifies the caller, resolves role and branch
  routes/api/me.get.ts          who am I, and what may I do
  routes/api/directory.get.ts   branches plus the approver dropdown list
  routes/api/vouchers/bulk-approve.post.ts
                                approve a whole month in one request
  routes/api/account/email.patch.ts  change your own sign-in email
  routes/api/admin/*            branch and user management, admin only

src/
  pages/Index.tsx               overview, pending, approved, settings
  pages/ApprovalsPanel.tsx      monthly sign-off for approvers
  pages/Admin.tsx               the admin panel
  components/AppShell.tsx       sidebar and top bar shared by both pages
  components/PaginationBar.tsx  rows-per-page picker and page buttons
  lib/pagination.ts             paging and bulk-print rules
  lib/api.ts                    client for the server layer
```

## How access is decided

Supabase Auth owns sign-in, so the browser already holds an access token. It is attached
to every `/api/*` call as a bearer token, and the server verifies it against Supabase Auth
rather than trusting it. Role and branch come from the `profiles` row, read on the server.

Voucher rows are read straight from Supabase with that same session token, where the RLS
policies apply. The admin routes additionally re-check that the caller is an admin before
touching anything, using a service-role client.

Hiding a link in the UI is therefore only ever a convenience. Every rule is enforced again
on the server.

## Notes

- **Migrating users.** The service key is server-only and never committed, so the admin
  panel reports a clear configuration error until it is set rather than failing silently.
  Viewing everything else works without it.
- **Bulk import** assigns every row in a file to one nominated approver, since a
  spreadsheet has no per-row approver.
- **The approver dropdown** lists every approver and admin across all three branches,
  with the preparer's own branch first, so a payment can be routed to whichever signatory
  actually approves it.