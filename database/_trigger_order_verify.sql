-- Proves the fix works even when the superseded trigger is already installed.
--
-- That ordering was the bug: align_approval_dates.sql fixed the rows and only
-- then dropped trg_vouchers_approval_date, so the old trigger rewrote every row
-- as it was written. 780 vouchers read as approved on 05 Oct no matter how many
-- times the script was run. This check installs the bad trigger first, so a
-- regression cannot pass.
\set ON_ERROR_STOP on
\pset pager off

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;
grant usage on schema public, auth to authenticated;

alter table public.vouchers add column if not exists paid_to text;
alter table public.vouchers add column if not exists being_payment text;
alter table public.vouchers add column if not exists reference text;

-- A batch import: many vouchers created on one day, spread across months. This
-- is the shape of the real ledger and the reason created_at was the wrong source.
insert into auth.users (id, email) values ('aaaa1111-1111-1111-1111-111111111111', 'a@x.com') on conflict (id) do nothing;
insert into public.profiles (id, full_name, role) values ('aaaa1111-1111-1111-1111-111111111111', 'Tezza', 'admin') on conflict (id) do nothing;

insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, company_id, prepared_by, prepared_by_name, status, approved_by, approved_by_name, approved_at, created_at)
select
  'IMP-' || lpad(g::text, 4, '0'),
  date '2026-01-05' + ((g - 1) * 3),
  100 * g,
  'Payee ' || g,
  'Imported payment',
  (select id from public.companies where code = 'LA'),
  'aaaa1111-1111-1111-1111-111111111111',
  'Tezza Mutepeka',
  'Approved',
  '22222222-2222-2222-2222-222222222222',
  'Izukanji Mwanza',
  timestamptz '2026-10-05 10:00:00+00',
  timestamptz '2026-10-05 09:00:00+00'
from generate_series(1, 30) g
on conflict (voucher_no) do nothing;

\echo ''
\echo '=== 1. Before: every approval date is the batch date ==='
select
  count(*)                                                  as approved_vouchers,
  count(*) filter (where approved_at::date = voucher_date)  as date_matches,
  count(*) filter (where approved_at::date <> voucher_date) as date_differs
  from public.vouchers where status = 'Approved';

\echo ''
\echo '=== 2. Install the superseded trigger, as an earlier run would have ==='
\o trigger_output.txt
\i set_approval_date_from_created.sql
\o
do $$
declare n int;
begin
  select count(*) into n from pg_trigger
   where tgrelid = 'public.vouchers'::regclass
     and tgname = 'trg_vouchers_approval_date';
  if n <> 1 then raise exception 'FAIL: could not install the old trigger'; end if;
  raise notice 'old trigger installed, which is the state that broke it';
end $$;

-- Prove the old trigger really does rewrite rows, so the test is not hollow.
-- Write a date that is neither the voucher date nor the creation date. If the
-- trigger is live, the row comes back holding the creation date instead.
do $$
declare wanted date := '2026-01-05';
        stored  date;
        created date;
begin
  select created_at::date into created
    from public.vouchers where voucher_no = 'IMP-0001';

  update public.vouchers set approved_at = wanted::timestamptz where voucher_no = 'IMP-0001';
  select approved_at::date into stored
    from public.vouchers where voucher_no = 'IMP-0001';

  if stored <> created or stored = wanted then
    raise exception 'FAIL: expected the trigger to force %, but the row holds %', created, stored;
  end if;
  raise notice 'confirmed: wrote %, the old trigger forced it back to %', wanted, stored;
end $$;

\echo ''
\echo '=== 3. Run the fix on top of the installed trigger ==='
\o trigger_output.txt
\i align_approval_dates.sql
\o

\echo ''
\echo '=== 4. After: every approval matches the voucher date ==='
select
  count(*)                                                  as approved_vouchers,
  count(*) filter (where approved_at::date = voucher_date)  as date_matches,
  count(*) filter (where approved_at::date <> voucher_date) as date_differs
  from public.vouchers where status = 'Approved';
do $$
declare n int;
begin
  select count(*) into n from public.vouchers
   where status = 'Approved' and approved_at::date <> voucher_date;
  if n > 0 then
    raise exception 'FAIL: % voucher(s) still show the wrong approval date', n;
  end if;
  raise notice 'PASS: all 30 imported vouchers now show their own date';
end $$;

\echo ''
\echo '=== 5. The old trigger is gone, so it cannot fight the new one ==='
do $$
declare n int;
begin
  select count(*) into n from pg_trigger
   where tgrelid = 'public.vouchers'::regclass
     and tgname = 'trg_vouchers_approval_date';
  if n <> 0 then raise exception 'FAIL: the superseded trigger is still installed'; end if;
  raise notice 'PASS: superseded trigger removed';
end $$;

\echo ''
\echo '=== 6. A new approval is aligned too ==='
do $$
begin
  insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, company_id, prepared_by, status)
  values ('NEW-0001','2026-07-04',500,'X','Y',(select id from public.companies where code='LA'),'aaaa1111-1111-1111-1111-111111111111','Pending approval');

  update public.vouchers set status='Approved', approved_by='22222222-2222-2222-2222-222222222222', approved_at=now()
   where voucher_no = 'NEW-0001';

  if (select approved_at::date from public.vouchers where voucher_no='NEW-0001')
     <> (select voucher_date from public.vouchers where voucher_no='NEW-0001') then
    raise exception 'FAIL: a new approval is not aligned to the voucher date';
  end if;
  raise notice 'PASS: new approvals are aligned on the way in';
end $$;

\echo ''
\echo '=== 7. Re-running changes nothing ==='
\o trigger_output.txt
\i align_approval_dates.sql
\o
do $$
declare n int;
begin
  select count(*) into n from public.vouchers
   where status = 'Approved' and approved_at::date <> voucher_date;
  if n > 0 then raise exception 'FAIL: second run disturbed % row(s)', n; end if;
  raise notice 'PASS: idempotent';
end $$;

\echo ''
\echo '=== 8. The batch date was kept for audit, not lost ==='
select
  count(*) filter (where approved_recorded_at is not null)                     as original_kept,
  count(*) filter (where to_char(approved_recorded_at,'YYYY-MM-DD') = '2026-10-05') as still_showing_batch_date
  from public.vouchers;

delete from public.vouchers where voucher_no like 'IMP-%' or voucher_no like 'NEW-%';

\echo ''
\echo 'TRIGGER-ORDERING CHECKS COMPLETE'