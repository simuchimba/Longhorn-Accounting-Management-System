-- Reproduces the reported bug: promoting someone in the Supabase Table Editor
-- silently reverts to the old role.
--
-- The Table Editor and any service-role/backend write run with no JWT, so
-- auth.uid() is NULL. The role-protection trigger treated "no signed-in user" as
-- "not an admin" and discarded the change. These checks pin down who is allowed
-- to change a role, and prove a dashboard edit is no longer reverted.
\set ON_ERROR_STOP on
\pset pager off

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;
grant usage on schema public, auth to authenticated;

create or replace function public.impersonate(who uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', who::text, false);
end $$;
create or replace function public.clear_claim() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
end $$;
grant execute on function public.impersonate(uuid) to authenticated;
grant execute on function public.clear_claim() to authenticated;

\echo ''
\echo '--- fixtures ---'
select c.code, count(p.id) as people
  from public.companies c left join public.profiles p on p.company_id = c.id
 group by c.code order by c.code;

\echo ''
\echo '=== A. No JWT at all (Table Editor / service role): promotion MUST stick ==='
select public.clear_claim();
update public.profiles set role = 'admin' where id = '44444444-4444-4444-4444-444444444444';
select role as after_dashboard_edit from public.profiles where id = '44444444-4444-4444-4444-444444444444';
do $$
declare got text;
begin
  select role into got from public.profiles where id = '44444444-4444-4444-4444-444444444444';
  if got <> 'admin' then
    raise exception 'FAIL: dashboard edit was reverted back to %', got;
  end if;
  raise notice 'PASS: dashboard promotion stuck (role = %)', got;
end $$;

\echo ''
\echo '=== B. No JWT: branch assignment MUST stick ==='
select public.clear_claim();
update public.profiles
   set company_id = (select id from public.companies where code = 'LIB')
 where id = '44444444-4444-4444-4444-444444444444';
select c.code as branch_after
  from public.profiles p left join public.companies c on c.id = p.company_id
 where p.id = '44444444-4444-4444-4444-444444444444';
do $$
declare got text;
begin
  select c.code into got from public.profiles p left join public.companies c on c.id = p.company_id
   where p.id = '44444444-4444-4444-4444-444444444444';
  if got <> 'LIB' then raise exception 'FAIL: branch change reverted to %', got; end if;
  raise notice 'PASS: dashboard branch change stuck (branch = %)', got;
end $$;

\echo ''
\echo '=== C. A signed-in ADMIN may still change roles ==='
select public.impersonate('11111111-1111-1111-1111-111111111111');
update public.profiles set role = 'approver' where id = '44444444-4444-4444-4444-444444444444';
select role as after_admin_edit from public.profiles where id = '44444444-4444-4444-4444-444444444444';
do $$
declare got text;
begin
  select role into got from public.profiles where id = '44444444-4444-4444-4444-444444444444';
  if got <> 'approver' then raise exception 'FAIL: admin edit reverted to %', got; end if;
  raise notice 'PASS: admin edit stuck (role = %)', got;
end $$;

\echo ''
\echo '=== D. A signed-in PREPARER must NOT be able to promote themselves ==='
select public.impersonate('44444444-4444-4444-4444-444444444444');
update public.profiles set role = 'admin' where id = '44444444-4444-4444-4444-444444444444';
select role as after_preparer_attempt from public.profiles where id = '44444444-4444-4444-4444-444444444444';
do $$
declare got text;
begin
  select role into got from public.profiles where id = '44444444-4444-4444-4444-444444444444';
  if got = 'admin' then raise exception 'FAIL: a preparer promoted themselves'; end if;
  raise notice 'PASS: self-promotion refused, still %', got;
end $$;

\echo ''
\echo '=== E. A signed-in PREPARER must NOT be able to move their own branch ==='
select public.impersonate('44444444-4444-4444-4444-444444444444');
update public.profiles
   set company_id = (select id from public.companies where code = 'LA')
 where id = '44444444-4444-4444-4444-444444444444';
select c.code as branch_after
  from public.profiles p left join public.companies c on c.id = p.company_id
 where p.id = '44444444-4444-4444-4444-444444444444';
do $$
declare got text;
begin
  select c.code into got from public.profiles p left join public.companies c on c.id = p.company_id
   where p.id = '44444444-4444-4444-4444-444444444444';
  if got = 'LA' then raise exception 'FAIL: a preparer moved their own branch'; end if;
  raise notice 'PASS: branch change refused, still %', got;
end $$;

\echo ''
\echo '=== F. A signed-in PREPARER may still edit their own display name ==='
select public.impersonate('44444444-4444-4444-4444-444444444444');
update public.profiles set full_name = 'Naledi P. Phiri' where id = '44444444-4444-4444-4444-444444444444';
select full_name, role from public.profiles where id = '44444444-4444-4444-4444-444444444444';
do $$
declare got text;
begin
  select full_name into got from public.profiles where id = '44444444-4444-4444-4444-444444444444';
  if got <> 'Naledi P. Phiri' then raise exception 'FAIL: own name change refused'; end if;
  raise notice 'PASS: own display name still editable';
end $$;

\echo ''
\echo '=== G. No JWT: the id is still immutable even for the dashboard ==='
-- A standalone profile row, so the foreign keys from vouchers do not fire first
-- and the trigger is what actually has to hold the id in place.
insert into auth.users (id, email) values
  ('88888888-8888-8888-8888-888888888888', 'immutable-check@example.com')
  on conflict (id) do nothing;
insert into public.profiles (id, full_name, role)
values ('88888888-8888-8888-8888-888888888888', 'Id Check', 'preparer')
  on conflict (id) do nothing;
select public.clear_claim();
update public.profiles set id = gen_random_uuid()
 where id = '88888888-8888-8888-8888-888888888888';
select id as id_after_attempt from public.profiles where full_name = 'Id Check';
do $$
declare got uuid;
begin
  select id into got from public.profiles where full_name = 'Id Check';
  if got <> '88888888-8888-8888-8888-888888888888' then
    raise exception 'FAIL: the primary key was rewritten to %', got;
  end if;
  raise notice 'PASS: primary key held at its original value';
end $$;

\echo ''
\echo '=== H. A brand new user created with no profile can still be promoted ==='
insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999999', 'kuunda@longhorn-associates.com')
  on conflict (id) do nothing;
select public.clear_claim();
update public.profiles set role = 'admin', full_name = 'Kuunda Simuchimba'
 where id = '99999999-9999-9999-9999-999999999999';
select full_name, role from public.profiles where id = '99999999-9999-9999-9999-999999999999';
do $$
declare got text;
begin
  select role into got from public.profiles where id = '99999999-9999-9999-9999-999999999999';
  if got <> 'admin' then raise exception 'FAIL: new user promotion reverted to %', got; end if;
  raise notice 'PASS: new user promoted to admin';
end $$;

\echo ''
\echo 'ROLE-EDIT CHECKS COMPLETE'