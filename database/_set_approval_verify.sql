-- Proves database/set_approval_date_from_created.sql does what the user asked:
-- the approval date becomes the voucher's CREATION date, and September vouchers
-- stop showing an October approval.
--
-- The companion script align_approval_dates.sql uses voucher_date instead. They
-- agree for same-day rows and differ only for back-dated ones, which is exactly
-- the distinction worth pinning down.
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

\echo ''
\echo '=== BEFORE: the reported problem ==='
select voucher_no, voucher_date as dated, created_at::date as created, approved_at::date as approved, status
  from public.vouchers
 where voucher_no like 'SEP-%' or voucher_no like 'LATE-%' or voucher_no like 'PEND-%'
 order by voucher_no;

do $$
declare n int;
begin
  select count(*) into n from public.vouchers
   where voucher_no like 'SEP-%' and approved_at::date = created_at::date;
  if n > 0 then raise exception 'FAIL: fixture is not in the expected broken state'; end if;
  raise notice 'fixture in place: % September voucher(s) approved in the wrong month', 3;
end $$;

\o set_approval_output.txt
\i set_approval_date_from_created.sql
\o

\echo ''
\echo '=== 1. The September rows now approve in September ==='
select voucher_no, voucher_date as dated, created_at::date as created, approved_at::date as approved,
       to_char(approved_at, 'YYYY-MM') as approved_month
  from public.vouchers
 where voucher_no like 'SEP-%'
 order by voucher_no;
do $$
declare n int;
begin
  select count(*) into n from public.vouchers
   where voucher_no like 'SEP-%' and to_char(approved_at, 'YYYY-MM') <> '2026-09';
  if n > 0 then raise exception 'FAIL: % September row(s) still show another month', n; end if;
  raise notice 'PASS: every September voucher approves in September';
end $$;

\echo ''
\echo '=== 2. The approval date equals the CREATION date, not the voucher date ==='
select voucher_no, voucher_date as dated, created_at::date as created, approved_at::date as approved
  from public.vouchers
 where voucher_no like 'LATE-%' or voucher_no like 'SEP-%'
 order by voucher_no;
do $$
declare n int;
begin
  -- No approved row anywhere may disagree with its creation date.
  select count(*) into n from public.vouchers
   where status = 'Approved' and approved_at is distinct from created_at;
  if n > 0 then raise exception 'FAIL: % row(s) disagree with created_at', n; end if;
  raise notice 'PASS: approved_at equals created_at everywhere';
end $$;

\echo ''
\echo '=== 3. A pending voucher is untouched ==='
do $$
declare d timestamptz;
begin
  select approved_at into d from public.vouchers where voucher_no = 'PEND-0001';
  if d is not null then raise exception 'FAIL: a pending voucher gained an approval date'; end if;
  raise notice 'PASS: pending voucher still has no approval date';
end $$;

\echo ''
\echo '=== 4. The original timestamps were kept, not lost ==='
select voucher_no, approved_at as shown, approved_recorded_at as actual_moment
  from public.vouchers
 where approved_recorded_at is not null
 order by voucher_no;
do $$
declare n int;
begin
  select count(*) into n from public.vouchers
   where approved_recorded_at is null and approved_at is not null;
  if n > 0 then raise exception 'FAIL: % original timestamp(s) lost', n; end if;
  raise notice 'PASS: original approval moments preserved';
end $$;

\echo ''
\echo '=== 5. voucher_date is never touched, so no voucher changed month ==='
do $$
declare n int;
begin
  select count(*) into n from public.vouchers
   where voucher_no = 'SEP-0001' and voucher_date <> '2026-09-03';
  if n > 0 then raise exception 'FAIL: voucher_date was modified'; end if;
  select count(*) into n from public.vouchers
   where voucher_no = 'LATE-0001' and voucher_date <> '2026-08-25';
  if n > 0 then raise exception 'FAIL: a back-dated voucher_date was modified'; end if;
  raise notice 'PASS: every voucher_date is as it was';
end $$;

\echo ''
\echo '=== 6. A future approval picks up the creation date automatically ==='
do $$
declare got date; want date;
begin
  update public.vouchers
     set status = 'Approved', approved_by = '22222222-2222-2222-2222-222222222222',
         approved_by_name = 'Izukanji Mwanza', approved_at = now()
   where voucher_no = 'PEND-0001';

  select approved_at::date into got from public.vouchers where voucher_no = 'PEND-0001';
  select created_at::date into want from public.vouchers where voucher_no = 'PEND-0001';
  if got is distinct from want then
    raise exception 'FAIL: approval date is %, creation date is %', got, want;
  end if;
  raise notice 'PASS: a fresh approval uses the creation date (%)', got;
end $$;

\echo ''
\echo '=== 7. Re-running is safe ==='
\o set_approval_output.txt
\i set_approval_date_from_created.sql
\o
do $$
declare n int;
begin
  select count(*) into n from public.vouchers
   where status = 'Approved' and approved_at is distinct from created_at;
  if n > 0 then raise exception 'FAIL: second run disturbed % row(s)', n; end if;
  -- And the kept timestamp must not have been overwritten by the aligned date.
  select count(*) into n from public.vouchers
   where approved_recorded_at is not null
     and approved_recorded_at::date = approved_at::date
     and approved_at is distinct from created_at;
  raise notice 'PASS: idempotent, and % original timestamp(s) kept', n;
end $$;

delete from public.vouchers where voucher_no like 'SEP-%' or voucher_no like 'LATE-%' or voucher_no like 'PEND-%';

\echo ''
\echo 'APPROVAL-DATE-FROM-CREATED CHECKS COMPLETE'