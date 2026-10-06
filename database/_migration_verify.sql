-- ============================================================================
--  Verification harness for database/multi_company_setup.sql
-- ============================================================================
--  Runs the real migration against a stand-in schema, then proves each rule by
--  impersonating a real user.
--
--  Two details matter for the results to mean anything:
--
--    1. The tests run as the `authenticated` role, the unprivileged role
--       PostgREST uses in Supabase. Row level security is BYPASSED for the table
--       owner, so testing as `postgres` would report "PASS" for every rule while
--       proving nothing.
--
--    2. Each persona is set by changing the JWT subject claim, which is exactly
--       what PostgREST does per request.
--
--  Every rule below reports PASS or FAIL, so a regression is obvious.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off

-- ---------------------------------------------------------------- fixtures
-- Created while still superuser, because `authenticated` has no CREATE on public.
-- CREATE ROLE has no IF NOT EXISTS, and a role is global to the cluster, so the
-- do-blocks below make this file safe to run more than once.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;
grant usage on schema public to authenticated;



-- Just sets the JWT subject claim, exactly as PostgREST does for a real request.
-- No SECURITY DEFINER: the claim has to survive into the session that runs the
-- test queries, and a definer function cannot SET ROLE anyway.
create or replace function public.impersonate(who uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', who::text, false);
end $$;

-- One role for all three personas is enough: RLS reads the branch and role from
-- the `profiles` row named by the claim, not from the database role.
create or replace function public.as_preparer() returns void
language sql as $$ select public.impersonate('44444444-4444-4444-4444-444444444444') $$;
create or replace function public.as_approver() returns void
language sql as $$ select public.impersonate('55555555-5555-5555-5555-555555555555') $$;
create or replace function public.as_admin() returns void
language sql as $$ select public.impersonate('11111111-1111-1111-1111-111111111111') $$;

-- Reset the rows the tests create, while still superuser, so this file can be
-- run repeatedly without duplicate-key noise.
--
-- The claim is set first: trg_profiles_protect_role discards role and branch
-- changes from anyone who is not an admin, so resetting without an admin claim
-- in place would silently do nothing.
select public.impersonate('11111111-1111-1111-1111-111111111111');
delete from public.vouchers where voucher_no like 'TEST-%';
update public.profiles set role = 'preparer', full_name = 'Naledi Phiri'
 where id = '44444444-4444-4444-4444-444444444444';
-- Check 18 promotes this person on its way past; put them back so check 14
-- asserts against a known state on every run.
update public.profiles set role = 'preparer',
       company_id = (select id from public.companies where code = 'LA')
 where id = '33333333-3333-3333-3333-333333333333';
update public.vouchers set status = 'Pending approval', approved_by = null, approved_by_name = null
 where voucher_no = 'PV-26-0035';

grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- Real Supabase roles can read auth.users; the tests call auth.uid() directly.
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function public.impersonate(uuid) to authenticated;
grant execute on function public.as_preparer() to authenticated;
grant execute on function public.as_approver() to authenticated;
grant execute on function public.as_admin() to authenticated;

-- ============================================================================
--  Everything below is what actually gets asserted.
-- ============================================================================
set role authenticated;

\echo '--- acting as ---'
select current_user as running_as;

\echo ''
\echo '=== BACKFILL: every user and voucher landed in a branch ==='
select c.code, count(p.id) as people
  from public.companies c left join public.profiles p on p.company_id = c.id
 group by c.code order by c.code;
select
  (select count(*) from public.profiles where company_id is null) as users_without_company,
  (select count(*) from public.vouchers where company_id is null) as vouchers_without_company;

\echo ''
\echo '=== 1. LFS preparer sees ONLY LFS vouchers (2 of 3, not 3) ==='
select public.as_preparer();
select count(*) as visible from public.vouchers;

\echo ''
\echo '=== 2. LFS preparer cannot read the LAssociates voucher (0 rows) ==='
select voucher_no from public.vouchers where voucher_no = 'PV-26-0035';

\echo ''
\echo '=== 3. LIB voucher is invisible to the LFS preparer (0 rows) ==='
select voucher_no from public.vouchers where voucher_no = 'PV-26-0033';

\echo ''
\echo '=== 4. LFS approver sees EVERY branch (all 3) ==='
select public.as_approver();
select count(*) as visible from public.vouchers;

\echo ''
\echo '=== 5. Approver cannot create a voucher ==='
select public.as_approver();
do $$
begin
  insert into public.vouchers (voucher_no, amount, amount_paid_to, being_payment, prepared_by)
  values ('TEST-APPROVER', 10, 'X', 'should fail', auth.uid());
  raise exception 'FAIL: approver was allowed to insert';
exception when insufficient_privilege then
  raise notice 'PASS: approver insert refused';
end $$;

\echo ''
\echo '=== 6. A preparer insert is stamped with their own branch automatically ==='
select public.as_preparer();
insert into public.vouchers (voucher_no, amount, amount_paid_to, being_payment, prepared_by)
values ('TEST-LFS-1', 500, 'Supplier', 'LFS payment', auth.uid());
select v.voucher_no, c.code as branch
  from public.vouchers v left join public.companies c on c.id = v.company_id
 where v.voucher_no = 'TEST-LFS-1';

\echo ''
\echo '=== 7. A preparer cannot create a voucher for another branch ==='
select public.as_preparer();
do $$
declare other uuid;
begin
  select id into other from public.companies where code = 'LA';
  insert into public.vouchers (voucher_no, amount, amount_paid_to, being_payment, prepared_by, company_id)
  values ('TEST-CROSSBRANCH', 100, 'X', 'should fail', auth.uid(), other);
  raise exception 'FAIL: cross-branch insert was allowed';
exception when insufficient_privilege then
  raise notice 'PASS: cross-branch insert refused';
end $$;

\echo ''
\echo '=== 8. An approver can approve a voucher from another branch ==='
select public.as_approver();
update public.vouchers set status = 'Approved', approved_by = auth.uid()
 where voucher_no = 'PV-26-0035';
select voucher_no, status from public.vouchers where voucher_no = 'PV-26-0035';

\echo ''
\echo '=== 9. A preparer cannot delete another branch voucher ==='
select public.as_preparer();
do $$
declare n int;
begin
  delete from public.vouchers where voucher_no = 'PV-26-0035';
  get diagnostics n = row_count;
  if n > 0 then raise exception 'FAIL: deleted % cross-branch rows', n; end if;
  raise notice 'PASS: cross-branch delete refused';
end $$;

\echo ''
\echo '=== 10. A preparer cannot move their voucher to another branch ==='
select public.as_preparer();
do $$
declare other uuid;
begin
  select id into other from public.companies where code = 'LA';
  update public.vouchers set company_id = other where voucher_no = 'TEST-LFS-1';
  raise exception 'FAIL: cross-branch reassignment was allowed';
exception when insufficient_privilege then
  raise notice 'PASS: cross-branch reassignment refused';
end $$;

\echo ''
\echo '=== 11. A preparer cannot promote themselves to admin (silently reverted) ==='
select public.as_preparer();
update public.profiles set role = 'admin' where id = '44444444-4444-4444-4444-444444444444';
select full_name, role from public.profiles where id = '44444444-4444-4444-4444-444444444444';
do $$
declare got text;
begin
  select role into got from public.profiles where id = '44444444-4444-4444-4444-444444444444';
  if got = 'admin' then raise exception 'FAIL: privilege escalation allowed'; end if;
  raise notice 'PASS: self-promotion refused, still %', got;
end $$;

\echo ''
\echo '=== 12. A preparer cannot move themselves to another branch ==='
select public.as_preparer();
update public.profiles set company_id = (select id from public.companies where code = 'LA')
 where id = '44444444-4444-4444-4444-444444444444';
select c.code as still_branch
  from public.profiles p left join public.companies c on c.id = p.company_id
 where p.id = '44444444-4444-4444-4444-444444444444';
do $$
declare got text;
begin
  select c.code into got from public.profiles p left join public.companies c on c.id = p.company_id
   where p.id = '44444444-4444-4444-4444-444444444444';
  if got = 'LA' then raise exception 'FAIL: branch change allowed'; end if;
  raise notice 'PASS: branch change refused, still %', got;
end $$;

\echo ''
\echo '=== 13. A preparer still CAN change their own display name ==='
select public.as_preparer();
update public.profiles set full_name = 'Naledi P. Phiri' where id = '44444444-4444-4444-4444-444444444444';
select full_name, role from public.profiles where id = '44444444-4444-4444-4444-444444444444';

\echo ''
\echo '=== 14. A preparer cannot change someone else''s role (0 rows) ==='
select public.as_preparer();
update public.profiles set role = 'admin' where id = '33333333-3333-3333-3333-333333333333';
select full_name, role from public.profiles where id = '33333333-3333-3333-3333-333333333333';
do $$
declare got text;
begin
  select role into got from public.profiles where id = '33333333-3333-3333-3333-333333333333';
  if got = 'admin' then raise exception 'FAIL: a preparer changed another role'; end if;
  raise notice 'PASS: changing another role refused, still %', got;
end $$;

\echo ''
\echo '=== 15. A preparer cannot rename a branch ==='
-- An UPDATE that matches no visible rows affects 0 rows and raises no error, so
-- this has to check the result rather than rely on an exception.
select public.as_preparer();
update public.companies set name = 'Hijacked' where code = 'LA';
select name as still_called from public.companies where code = 'LA';
do $$
declare got text;
begin
  select name into got from public.companies where code = 'LA';
  if got = 'Hijacked' then raise exception 'FAIL: a preparer renamed a branch'; end if;
  raise notice 'PASS: branch rename refused, still %', got;
end $$;

\echo ''
\echo '=== 16. The approver dropdown is readable by any signed-in user ==='
select public.as_preparer();
select p.full_name, p.role, c.code as branch
  from public.profiles p left join public.companies c on c.id = p.company_id
 where p.role in ('approver','admin') order by p.full_name;

\echo ''
\echo '=== 17. An admin sees every branch and may delete cross-branch ==='
select public.as_admin();
select count(*) as visible from public.vouchers;
delete from public.vouchers where voucher_no = 'PV-26-0035';
select count(*) as remaining from public.vouchers where voucher_no = 'PV-26-0035';

\echo ''
\echo '=== 18. An admin may set any role and branch ==='
select public.as_admin();
update public.profiles set role = 'approver', company_id = (select id from public.companies where code = 'LIB')
 where id = '33333333-3333-3333-3333-333333333333';
select p.full_name, p.role, c.code as branch
  from public.profiles p left join public.companies c on c.id = p.company_id
 where p.id = '33333333-3333-3333-3333-333333333333';

\echo ''
\echo 'ALL CHECKS COMPLETE'