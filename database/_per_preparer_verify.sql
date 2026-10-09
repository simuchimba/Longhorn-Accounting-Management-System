-- ============================================================================
--  Verification harness for database/per_preparer_workspace.sql
-- ============================================================================
--
--  Prints one `metric=value` line per observation, as the `authenticated`
--  role, impersonating a real person. The runner in verify-per-preparer.mjs
--  asserts on those values.
--
--  Everything runs as `authenticated`, the unprivileged role PostgREST uses in
--  Supabase. Row level security is BYPASSED for the table owner, so measuring
--  from `postgres` would report the right numbers for a reason that proves
--  nothing.
--
--  Written without plpgsql on purpose: a machine whose Application Control
--  policy blocks plpgsql.dll cannot run a do-block at all, and the rules under
--  test are plain SQL, so the harness should not depend on that library either.
--
--  Expected-to-fail statements are NOT here. They are run one at a time by the
--  runner, which checks the exit code, because a rejected statement cannot be
--  caught inside a script without plpgsql.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
\t on
\a

set role authenticated;

-- -------------------------------------------------------------- 1. visibility
-- What preparer A, at Longhorn Associates, can see of the whole ledger.
select public.as_preparer_a();
select 'preparer_a_own='        || count(*) filter (where prepared_by = '33333333-3333-3333-3333-333333333333')::text from public.vouchers;
select 'preparer_a_colleague='   || count(*) filter (where prepared_by = '77777777-7777-7777-7777-777777777777')::text from public.vouchers;
select 'preparer_a_other_branch='|| count(*) filter (where prepared_by = '55555555-5555-5555-5555-555555555555')::text from public.vouchers;
select 'preparer_a_total='       || count(*)::text from public.vouchers;

-- --------------------------------------------------------------- 2. by name
-- The colleague's voucher, addressed directly rather than counted.
select public.as_preparer_a();
select 'preparer_a_reads_b_voucher=' || count(*)::text from public.vouchers where voucher_no = '05/09/0002';

-- --------------------------------------------------------------- 3. editing
-- A data-modifying CTE reports how many rows RLS let through, which is the only
-- honest measure: an UPDATE matching no visible rows raises no error, it just
-- affects nothing.
select public.as_preparer_a();
with changed as (
  update public.vouchers set being_payment = 'rewritten by A' where voucher_no = '05/09/0002' returning 1
) select 'preparer_a_updated_b_rows=' || count(*)::text from changed;

-- -------------------------------------------------------------- 4. deleting
select public.as_preparer_a();
with removed as (
  delete from public.vouchers where voucher_no = '05/09/0002' returning 1
) select 'preparer_a_deleted_b_rows=' || count(*)::text from removed;

-- Put it back, because every later count depends on it being there.
select 'preparer_a_can_restore_b=' || case when public.as_preparer_b() is not null then 'yes' else 'no' end;
insert into public.vouchers (voucher_no, voucher_date, amount, amount_paid_to, being_payment, prepared_by, prepared_by_name, status, company_id)
values ('05/09/0002', '2026-09-05', 1750.00, 'Ndola Hardware', 'Tools for B',
        '77777777-7777-7777-7777-777777777777', 'Kabaso Chanda', 'Pending approval',
        (select id from public.companies where code = 'LA'))
on conflict (voucher_no) do nothing;

-- -------------------------------------------------------- 5. own voucher
-- Isolation is worthless if it also locks the owner out.
select public.as_preparer_a();
select 'preparer_a_reads_own='    || count(*)::text from public.vouchers where voucher_no = '05/09/0001';
with changed as (
  update public.vouchers set being_payment = 'revised by A' where voucher_no = '05/09/0001' returning 1
) select 'preparer_a_updated_own_rows=' || count(*)::text from changed;
with removed as (
  delete from public.vouchers where voucher_no = '05/09/0001' returning 1
) select 'preparer_a_deleted_own_rows=' || count(*)::text from removed;

-- Re-insert, filed under A, so the counts in the checks above stay stable.
insert into public.vouchers (voucher_no, voucher_date, amount, amount_paid_to, being_payment, prepared_by, prepared_by_name, status, company_id)
values ('05/09/0001', '2026-09-05', 2500.00, 'Lusaka Supplies', 'Stationery for A',
        '33333333-3333-3333-3333-333333333333', 'Chanda Mulenga', 'Pending approval',
        (select id from public.companies where code = 'LA'))
on conflict (voucher_no) do nothing;

-- ------------------------------------------------- 6. approvers keep sight
-- Month-end approval is why this matters: if an approver only saw one
-- preparer's vouchers, clearing a month would silently skip the rest.
select public.as_approver();
select 'approver_total=' || count(*)::text from public.vouchers;
with changed as (
  update public.vouchers set status = 'Approved', approved_by = auth.uid(), approved_by_name = 'Izukanji Mwanza'
   where voucher_no = '05/09/0002' returning 1
) select 'approver_updated_b_rows=' || count(*)::text from changed;

-- ----------------------------------------------------- 7. admins oversight
select public.as_admin();
select 'admin_total=' || count(*)::text from public.vouchers;
with removed as (
  delete from public.vouchers where voucher_no = '05/09/0002' returning 1
) select 'admin_deleted_b_rows=' || count(*)::text from removed;
insert into public.vouchers (voucher_no, voucher_date, amount, amount_paid_to, being_payment, prepared_by, prepared_by_name, status, company_id)
values ('05/09/0002', '2026-09-05', 1750.00, 'Ndola Hardware', 'Tools for B',
        '77777777-7777-7777-7777-777777777777', 'Kabaso Chanda', 'Approved',
        (select id from public.companies where code = 'LA'))
on conflict (voucher_no) do nothing;

reset role;

\echo 'ALL CHECKS COMPLETE'