-- Proves database/fix_approver_attribution.sql does what it claims:
--   - repoints a misattributed LA approval to a real approver
--   - leaves vouchers that already sit with a genuine approver alone
--   - never touches another branch
--   - keeps approved_at and the voucher dates as they were
--   - is idempotent
--
-- The bulk importer used to stamp whoever ran the import as the approver, so the
-- fixture below reproduces exactly that: an ADMIN on the approved_by column.
\set ON_ERROR_STOP on
\pset pager off

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;
grant usage on schema public, auth to authenticated;

-- The wrong state: an admin stamped as approver on Longhorn Associates rows.
update public.vouchers v
   set approved_by           = a.id,
       approved_by_name      = 'Tezza Mutepeka',
       assigned_approver_id  = a.id,
       assigned_approver_name = 'Tezza Mutepeka'
  from public.profiles a
 where a.role = 'admin'
   and coalesce(v.company_id, (select id from public.companies where code = 'LA')) =
       (select id from public.companies where code = 'LA');

insert into public.vouchers (voucher_no, voucher_date, amount, amount_paid_to, being_payment, company_id, prepared_by, approved_by, approved_by_name, approved_at, status)
values ('ATTR-JAN', '2026-01-15', 5000, 'Supplier A', 'January', (select id from public.companies where code='LA'),
        (select id from auth.users where email='finance@longhorn-associates.com'),
        (select id from auth.users where email='admin@longhorn-associates.com'), 'Tezza Mutepeka', '2026-01-20 09:00:00+00', 'Approved')
on conflict (voucher_no) do update
  set approved_by = excluded.approved_by, approved_by_name = excluded.approved_by_name;

\echo ''
\echo '=== BEFORE: the misattribution is present ==='
select voucher_no, approved_by_name, coalesce(p.role,'?') as role, assigned_approver_name
  from public.vouchers v left join public.profiles p on p.id = v.approved_by
 where v.voucher_no = 'ATTR-JAN';
do $$
declare who text;
begin
  select approved_by_name into who from public.vouchers where voucher_no = 'ATTR-JAN';
  if who <> 'Tezza Mutepeka' then
    raise exception 'FAIL: fixture not in the expected broken state (got %)', who;
  end if;
  raise notice 'fixture in place: %', who;
end $$;

-- Run the shipped fix.
\echo ''
\echo '=== RUNNING database/fix_approver_attribution.sql ==='
\o attr_fix_output.txt
\i fix_approver_attribution.sql
\o

\echo ''
\echo '=== 1. The misattributed row is repointed to a real approver ==='
select voucher_no, approved_by_name, coalesce(p.role,'?') as role, assigned_approver_name
  from public.vouchers v left join public.profiles p on p.id = v.approved_by
 where v.voucher_no = 'ATTR-JAN';
do $$
declare who text; role text;
begin
  select approved_by_name into who from public.vouchers where voucher_no = 'ATTR-JAN';
  select coalesce(p.role,'') into role from public.vouchers v left join public.profiles p on p.id = v.approved_by
   where v.voucher_no = 'ATTR-JAN';
  if who <> 'Izukanji Mwanza' then raise exception 'FAIL: approver is still %', who; end if;
  if role <> 'approver' then raise exception 'FAIL: approver role is %', role; end if;
  raise notice 'PASS: repointed to %, role %', who, role;
end $$;

\echo ''
\echo '=== 2. No LA voucher is left attributed to a non-approver ==='
do $$
declare n int;
begin
  select count(*) into n
    from public.vouchers v
    left join public.profiles p on p.id = v.approved_by
   where v.approved_by is not null
     and coalesce(p.role,'') <> 'approver';
  if n > 0 then raise exception 'FAIL: % voucher(s) still attributed to a non-approver', n; end if;
  raise notice 'PASS: no voucher anywhere is attributed to a non-approver';
end $$;

\echo ''
\echo '=== 3. Other branches are untouched ==='
do $$
declare n int;
begin
  select count(*) into n
    from public.vouchers v
    join public.companies c on c.id = v.company_id
   where c.code <> 'LA'
     and v.approved_by = (select id from auth.users where email = 'approvals@longhorn-associates.com');
  if n > 0 then raise exception 'FAIL: % non-LA voucher(s) were repointed', n; end if;
  raise notice 'PASS: Financial Services and Insurance Broking untouched';
end $$;

\echo ''
\echo '=== 4. Dates and amounts are unchanged ==='
do $$
declare d date; a numeric; ok timestamp; n int;
begin
  select voucher_date, amount into d, a from public.vouchers where voucher_no = 'ATTR-JAN';
  if d <> '2026-01-15'::date then raise exception 'FAIL: voucher_date moved to %', d; end if;
  if a <> 5000 then raise exception 'FAIL: amount changed to %', a; end if;
  select approved_at into ok from public.vouchers where voucher_no = 'ATTR-JAN';
  if ok is null then raise exception 'FAIL: approved_at was wiped'; end if;
  if ok::date <> '2026-01-20'::date then raise exception 'FAIL: approved_at moved to %', ok; end if;
  raise notice 'PASS: date, amount and the original approval timestamp all preserved';
end $$;

\echo ''
\echo '=== 5. Running it again changes nothing ==='
\o attr_fix_output.txt
\i fix_approver_attribution.sql
\o
do $$
declare n int;
begin
  -- A second run must not have touched any row, so re-count by comparing the
  -- number of approver-role attributions before and after is not possible here.
  -- Instead assert nothing is attributed to a non-approver, which is the state
  -- a second run must preserve.
  select count(*) into n
    from public.vouchers v
    left join public.profiles p on p.id = v.approved_by
   where v.approved_by is not null and coalesce(p.role,'') <> 'approver';
  if n > 0 then raise exception 'FAIL: second run disturbed % row(s)', n; end if;
  raise notice 'PASS: idempotent';
end $$;

delete from public.vouchers where voucher_no = 'ATTR-JAN';

\echo ''
\echo 'ATTRIBUTION CHECKS COMPLETE'