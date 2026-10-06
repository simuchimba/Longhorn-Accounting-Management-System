-- Proves database/align_approval_dates.sql aligns the approval date to the
-- voucher's date, keeps the real timestamp, and leaves months untouched.
\set ON_ERROR_STOP on
\pset pager off

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;
grant usage on schema public, auth to authenticated;

-- Columns the real ledger has that the harness omits.
alter table public.vouchers add column if not exists paid_to text;
alter table public.vouchers add column if not exists being_payment text;
alter table public.vouchers add column if not exists reference text;

-- Fixture: a payment dated in January but approved in September, which is the
-- exact case the user reported.
insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, company_id, prepared_by, prepared_by_name, status, approved_by, approved_by_name, approved_at)
values
 ('DATE-0001','2026-01-15',5000,'Supplier A','January payment',(select id from public.companies where code='LA'),
  '33333333-3333-3333-3333-333333333333','Chanda Mulenga','Approved',
  '22222222-2222-2222-2222-222222222222','Izukanji Mwanza','2026-09-20 14:30:00+00'),
 ('DATE-0002','2026-03-22',2300,'Courier','March payment',(select id from public.companies where code='LA'),
  '33333333-3333-3333-3333-333333333333','Chanda Mulenga','Approved',
  '22222222-2222-2222-2222-222222222222','Izukanji Mwanza','2026-10-02 09:15:00+00'),
 ('DATE-0003','2026-05-09',890,'Airtime','May payment',(select id from public.companies where code='LA'),
  '33333333-3333-3333-3333-333333333333','Chanda Mulenga','Pending approval',null,null,null)
on conflict (voucher_no) do nothing;

\echo ''
\echo '=== BEFORE: approval dates disagree with the voucher dates ==='
select voucher_no, voucher_date, status, approved_at
  from public.vouchers
 where voucher_no like 'DATE-%'
 order by voucher_no;

do $$
declare n int;
begin
  select count(*) into n from public.vouchers
   where voucher_no like 'DATE-%'
     and approved_at::date <> voucher_date;
  if n = 0 then raise exception 'FAIL: fixture is not in the expected broken state'; end if;
  raise notice 'fixture in place: % row(s) with a mismatched approval date', n;
end $$;

\echo ''
\echo '=== RUNNING database/align_approval_dates.sql ==='
\o align_dates_output.txt
\i align_approval_dates.sql
\o

\echo ''
\echo '=== 1. Approval dates now equal the voucher dates ==='
select voucher_no, voucher_date, status, approved_at
  from public.vouchers
 where voucher_no like 'DATE-%'
 order by voucher_no;
do $$
declare n int;
begin
  select count(*) into n from public.vouchers
   where voucher_no like 'DATE-%' and status = 'Approved'
     and approved_at::date <> voucher_date;
  if n > 0 then raise exception 'FAIL: % row(s) still differ', n; end if;
  raise notice 'PASS: every approved voucher matches its own date';
end $$;

\echo ''
\echo '=== 2. The real approval timestamp is preserved, not lost ==='
select voucher_no, approved_at as shown_date, approved_recorded_at as actual_moment
  from public.vouchers
 where voucher_no like 'DATE-%' and status = 'Approved'
 order by voucher_no;
do $$
declare n int;
begin
  -- Only approved rows. A pending voucher correctly has no approval history yet.
  select count(*) into n from public.vouchers
   where voucher_no like 'DATE-%' and status = 'Approved'
     and approved_recorded_at is null;
  if n > 0 then raise exception 'FAIL: % original timestamp(s) were lost', n; end if;
  raise notice 'PASS: the true approval moments were kept';
end $$;

\echo ''
\echo '=== 3. Pending vouchers are not given a false approval date ==='
do $$
declare d timestamptz;
begin
  select approved_at into d from public.vouchers where voucher_no = 'DATE-0003';
  if d is not null then raise exception 'FAIL: a pending voucher carries an approval date (%', d; end if;
  raise notice 'PASS: pending voucher has no approval date';
end $$;

\echo ''
\echo '=== 4. Nothing moved between months ==='
select voucher_no, to_char(voucher_date, 'YYYY-MM') as voucher_month,
       to_char(approved_at, 'YYYY-MM') as approval_month
  from public.vouchers
 where voucher_no like 'DATE-%' and status = 'Approved'
 order by voucher_no;
do $$
declare n int;
begin
  select count(*) into n from public.vouchers
   where voucher_no like 'DATE-%' and status = 'Approved'
     and to_char(voucher_date, 'YYYY-MM') <> to_char(approved_at, 'YYYY-MM');
  if n > 0 then raise exception 'FAIL: % voucher(s) changed month', n; end if;
  raise notice 'PASS: every voucher is still filed under the month it is dated';
end $$;

\echo ''
\echo '=== 5. A newly approved voucher is aligned automatically ==='
do $$
begin
  update public.vouchers
     set status = 'Approved',
         approved_by = '22222222-2222-2222-2222-222222222222',
         approved_by_name = 'Izukanji Mwanza',
         approved_at = now()
   where voucher_no = 'DATE-0003';

  if (select approved_at::date from public.vouchers where voucher_no = 'DATE-0003')
       <> (select voucher_date from public.vouchers where voucher_no = 'DATE-0003') then
    raise exception 'FAIL: a fresh approval was not aligned to the voucher date';
  end if;
  if (select approved_recorded_at from public.vouchers where voucher_no = 'DATE-0003') is null then
    raise exception 'FAIL: the real approval moment was not stamped';
  end if;
  raise notice 'PASS: a new approval is aligned on the way in';
end $$;

\echo ''
\echo '=== 6. Sending a voucher back clears the approval date ==='
do $$
begin
  update public.vouchers set status = 'Draft', approved_by = null where voucher_no = 'DATE-0001';
  if (select approved_at from public.vouchers where voucher_no = 'DATE-0001') is not null then
    raise exception 'FAIL: a draft voucher still carries an approval date';
  end if;
  raise notice 'PASS: unapproving clears the date';
end $$;

\echo ''
\echo '=== 7. Re-running is safe ==='
\o align_dates_output.txt
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

delete from public.vouchers where voucher_no like 'DATE-%';

\echo ''
\echo 'DATE-ALIGNMENT CHECKS COMPLETE'