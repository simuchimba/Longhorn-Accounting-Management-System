-- Scratch harness for database/per_preparer_workspace.sql: a stand-in for the
-- Supabase schema, so the migration can be executed and its policies verified
-- locally. Throwaway test database only.
--
-- The people that matter: two preparers in ONE branch. Isolating a preparer from
-- another BRANCH is easy and was already true; isolating them from a COLLEAGUE
-- is the whole point of the change, and the shared _migration_test_setup.sql
-- has only one preparer per branch so it cannot tell the two apart.
--
-- WHY THIS FILE AND NOT multi_company_setup.sql
--   The baseline is declared here instead of by running database/
--   multi_company_setup.sql, because that migration also creates two plpgsql
--   trigger functions. Some machines refuse to load plpgsql at all (an
--   Application Control policy blocking plpgsql.dll is one way), which stops
--   the branch migration dead and with it every policy in it. The policies
--   under test are plain SQL, so declaring the starting point here lets them be
--   verified even where the plpgsql triggers cannot be.
--
--   What is declared below is exactly the state multi_company_setup.sql leaves
--   the database in: one branch shared by its preparers. database/
--   per_preparer_workspace.sql is then applied verbatim on top of it, so the
--   file being tested is the real one.

-- ---------------------------------------------------------------- plumbing
create schema if not exists auth;
create schema if not exists "request";

-- Supabase provides auth.uid() from request.jwt.claims. Stubbed so the
-- migration's policies can be exercised locally.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Set the JWT subject claim, exactly as PostgREST does for a real request.
-- Written as a plain SQL function rather than plpgsql so this harness still
-- runs where plpgsql is unavailable. set_config returns the new value, which is
-- all the caller needs.
create or replace function public.impersonate(who uuid) returns text
language sql
as $$ select set_config('request.jwt.claim.sub', who::text, false) $$;

-- RLS reads the branch and role from the `profiles` row named by the claim, not
-- from the database role, so one database role covers every persona.
create or replace function public.as_preparer_a() returns text
language sql as $$ select public.impersonate('33333333-3333-3333-3333-333333333333') $$;
create or replace function public.as_preparer_b() returns text
language sql as $$ select public.impersonate('77777777-7777-7777-7777-777777777777') $$;
create or replace function public.as_approver() returns text
language sql as $$ select public.impersonate('22222222-2222-2222-2222-222222222222') $$;
create or replace function public.as_admin() returns text
language sql as $$ select public.impersonate('11111111-1111-1111-1111-111111111111') $$;

-- `authenticated` is the unprivileged role PostgREST uses in Supabase. Row level
-- security is BYPASSED for the table owner, so measuring from `postgres` would
-- report the right numbers for a reason that proves nothing.
--
-- The role itself is created by verify-per-preparer.mjs rather than here,
-- because CREATE ROLE has no IF NOT EXISTS and the usual do-block guard needs
-- plpgsql, which some machines cannot load at all.

-- ---------------------------------------------------------------- schema
create table if not exists auth.users (
  id              uuid primary key default gen_random_uuid(),
  email           text unique,
  created_at      timestamptz not null default now(),
  last_sign_in_at timestamptz
);

create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  code        text not null unique,
  description text,
  color       text not null default '#d71939',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text
);

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  role          text,
  department_id uuid references public.departments(id),
  company_id    uuid references public.companies(id) on delete set null
);

create table if not exists public.vouchers (
  id                 uuid primary key default gen_random_uuid(),
  voucher_no         text unique,
  voucher_date       date,
  amount             numeric(14,2),
  amount_paid_to     text,
  being_payment      text,
  prepared_by        uuid references public.profiles(id),
  prepared_by_name   text,
  approved_by        uuid references public.profiles(id),
  approved_by_name   text,
  approved_at        timestamptz,
  status             text default 'Pending approval',
  created_at         timestamptz not null default now(),
  company_id         uuid references public.companies(id) on delete set null
);

-- ---------------------------------------------------------------- data
insert into public.companies (name, code, description, color) values
  ('Longhorn Associates',         'LA',  'Head office and group services', '#d71939'),
  ('Longhorn Financial Services', 'LFS', 'Financial services arm',         '#345d97')
on conflict (code) do nothing;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@longhorn-associates.com'),
  ('22222222-2222-2222-2222-222222222222', 'approver@longhorn-associates.com'),
  ('33333333-3333-3333-3333-333333333333', 'preparer.a@longhorn-associates.com'),
  -- Preparer B. Same branch as A, different person. The pair under test.
  ('77777777-7777-7777-7777-777777777777', 'preparer.b@longhorn-associates.com'),
  ('55555555-5555-5555-5555-555555555555', 'preparer.lfs@longhornfinancial.co')
on conflict (id) do nothing;

insert into public.profiles (id, full_name, role, company_id) values
  ('11111111-1111-1111-1111-111111111111', 'Tezza Mutepeka',  'admin',    (select id from public.companies where code = 'LA')),
  ('22222222-2222-2222-2222-222222222222', 'Izukanji Mwanza', 'approver', (select id from public.companies where code = 'LA')),
  ('33333333-3333-3333-3333-333333333333', 'Chanda Mulenga',  'preparer', (select id from public.companies where code = 'LA')),
  ('77777777-7777-7777-7777-777777777777', 'Kabaso Chanda',   'preparer', (select id from public.companies where code = 'LA')),
  ('55555555-5555-5555-5555-555555555555', 'Naledi Phiri',    'preparer', (select id from public.companies where code = 'LFS'))
on conflict (id) do nothing;

-- One voucher each for A and B. Same branch, and deliberately the same day so
-- they also collide on the number sequence: with private workspaces the client
-- can no longer see the other's row to pick a free number, which is what
-- /api/vouchers/next-no exists to answer.
insert into public.vouchers (voucher_no, voucher_date, amount, amount_paid_to, being_payment, prepared_by, prepared_by_name, status, company_id) values
  ('05/09/0001', '2026-09-05', 2500.00, 'Lusaka Supplies', 'Stationery for A', '33333333-3333-3333-3333-333333333333', 'Chanda Mulenga', 'Pending approval', (select id from public.companies where code = 'LA')),
  ('05/09/0002', '2026-09-05', 1750.00, 'Ndola Hardware',  'Tools for B',      '77777777-7777-7777-7777-777777777777', 'Kabaso Chanda',  'Pending approval', (select id from public.companies where code = 'LA')),
  -- A third branch, so "isolated from colleagues" is distinguishable from
  -- "isolated from other branches", which was already true before this change.
  ('06/09/0001', '2026-09-06', 900.00,  'LFS Broker',      'Premium',          '55555555-5555-5555-5555-555555555555', 'Naledi Phiri',    'Pending approval', (select id from public.companies where code = 'LFS'))
on conflict (voucher_no) do nothing;

-- ---------------------------------------------------------------- grants
alter table public.vouchers  enable row level security;
alter table public.profiles  enable row level security;
alter table public.companies enable row level security;
alter table public.departments enable row level security;

grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function public.impersonate(uuid) to authenticated;
grant execute on function public.as_preparer_a() to authenticated;
grant execute on function public.as_preparer_b() to authenticated;
grant execute on function public.as_approver() to authenticated;
grant execute on function public.as_admin() to authenticated;

-- ------------------------------------------------- the state BEFORE the change
-- Copied from database/multi_company_setup.sql: a preparer sees and may edit
-- everything raised in their own branch, whoever raised it.

create or replace function public.current_profile_role() returns text
language sql stable security definer set search_path = public
as $$ select p.role from public.profiles p where p.id = auth.uid(); $$;

create or replace function public.current_profile_company_id() returns uuid
language sql stable security definer set search_path = public
as $$ select p.company_id from public.profiles p where p.id = auth.uid(); $$;

create or replace function public.current_user_is_approver() returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.current_profile_role() in ('approver', 'admin'), false); $$;

create or replace function public.current_user_is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.current_profile_role() = 'admin', false); $$;

create or replace function public.current_user_can_prepare() returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.current_profile_role() in ('preparer', 'admin'), false); $$;

create or replace function public.user_can_see_company(target_company uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_user_is_approver()
      or target_company is not null
         and target_company = public.current_profile_company_id();
$$;

grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_company_id() to authenticated;
grant execute on function public.current_user_is_approver() to authenticated;
grant execute on function public.current_user_is_admin() to authenticated;
grant execute on function public.current_user_can_prepare() to authenticated;
grant execute on function public.user_can_see_company(uuid) to authenticated;

drop policy if exists "companies_read_authenticated" on public.companies;
create policy "companies_read_authenticated" on public.companies for select to authenticated using (true);

drop policy if exists "profiles_read_authenticated" on public.profiles;
create policy "profiles_read_authenticated" on public.profiles for select to authenticated using (true);

drop policy if exists "vouchers_select_scoped" on public.vouchers;
create policy "vouchers_select_scoped" on public.vouchers for select to authenticated
  using (public.current_user_is_approver() or prepared_by = auth.uid() or public.user_can_see_company(company_id));

drop policy if exists "vouchers_insert_scoped" on public.vouchers;
create policy "vouchers_insert_scoped" on public.vouchers for insert to authenticated
  with check (public.current_user_can_prepare() and (public.current_user_is_admin() or company_id = public.current_profile_company_id()));

drop policy if exists "vouchers_update_scoped" on public.vouchers;
create policy "vouchers_update_scoped" on public.vouchers for update to authenticated
  using (public.current_user_is_approver() or (public.current_user_can_prepare() and (public.current_user_is_admin() or company_id = public.current_profile_company_id())))
  with check (public.current_user_is_approver() or (public.current_user_can_prepare() and (public.current_user_is_admin() or company_id = public.current_profile_company_id())));

drop policy if exists "vouchers_delete_scoped" on public.vouchers;
create policy "vouchers_delete_scoped" on public.vouchers for delete to authenticated
  using (public.current_user_is_admin() or (public.current_user_can_prepare() and company_id is not null and company_id = public.current_profile_company_id()));

-- ------------------------------------------------ policies from an older setup
-- Names that exist on some databases and in none of this project's files. They
-- are PERMISSIVE, so Postgres ORs them with the rules above instead of replacing
-- them, and the migration has to drop them by name.
--
-- "vouchers_insert_preparer" is the dangerous one: its only condition is that you
-- filled in your own id, which is looser than the branch check that was supposed
-- to apply and lets an approver create a voucher. Without these in the fixture
-- the migration would look correct here and still leave a hole open on a real
-- database.
drop policy if exists "vouchers_insert_preparer" on public.vouchers;
create policy "vouchers_insert_preparer" on public.vouchers for insert to authenticated
  with check (auth.uid() = prepared_by);

drop policy if exists "vouchers_update_owner_or_approver" on public.vouchers;
create policy "vouchers_update_owner_or_approver" on public.vouchers for update to authenticated
  using (auth.uid() = prepared_by or auth.uid() = approved_by or public.current_user_is_approver())
  with check (auth.uid() = prepared_by or auth.uid() = approved_by or public.current_user_is_approver());