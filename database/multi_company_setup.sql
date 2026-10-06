-- ============================================================================
--  Longhorn Ledger — multi-company setup
-- ============================================================================
--
--  Adds branches/companies to the ledger so that Longhorn Associates,
--  Longhorn Financial Services and Longhorn Insurance Broking can all use the
--  same system, and enforces the visibility rules in the database itself.
--
--  WHAT THIS CHANGES
--    1. companies            — the three branches, admin-manageable
--    2. profiles.company_id  — which company each user works for
--    3. vouchers.company_id  — which company a voucher belongs to
--    4. vouchers.assigned_approver_id
--                          — the approver a preparer nominated in the composer
--    5. Row Level Security   — preparers can only ever read/write their own
--                          company's vouchers; approvers and admins can read
--                          every company and filter in the UI
--
--  HOW TO RUN
--    Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
--    Safe to run more than once: every statement is guarded.
--
--  AFTER RUNNING, check the verification block at the very bottom. Every
--  query there should return rows / true.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Companies (branches)
-- ---------------------------------------------------------------------------
--  "code" is the short label shown on vouchers and in the admin panel.

create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  code        text not null unique,
  description text,
  color       text not null default '#d71939',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.companies is
  'The Longhorn branches that share this ledger. A voucher belongs to exactly one.';

-- Seed the three branches. ON CONFLICT keeps this safe to re-run.
insert into public.companies (name, code, description, color) values
  ('Longhorn Associates',           'LA',  'Head office and group services',        '#d71939'),
  ('Longhorn Financial Services',   'LFS', 'Financial services arm',                '#345d97'),
  ('Longhorn Insurance Broking',    'LIB', 'Insurance broking arm',                 '#46a177')
on conflict (code) do update
  set name        = excluded.name,
      description = excluded.description,
      color       = excluded.color;


-- ---------------------------------------------------------------------------
-- 2. Which company does each user work for?
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists company_id uuid
  references public.companies(id) on delete set null;

create index if not exists idx_profiles_company on public.profiles(company_id);


-- ---------------------------------------------------------------------------
-- 3. Voucher ownership + the nominated approver
-- ---------------------------------------------------------------------------
--  company_id is denormalised onto the voucher on purpose: the ledger must keep
--  saying "this was a Longhorn Financial Services payment" even if the person
--  who prepared it later moves company.

alter table public.vouchers add column if not exists company_id uuid
  references public.companies(id) on delete set null;

alter table public.vouchers add column if not exists assigned_approver_id uuid
  references public.profiles(id) on delete set null;

-- Denormalised name, matching the existing approved_by_name pattern, so the
-- printed voucher can show the approver without joining profiles.
alter table public.vouchers add column if not exists assigned_approver_name text;

create index if not exists idx_vouchers_company on public.vouchers(company_id);
create index if not exists idx_vouchers_assigned_approver on public.vouchers(assigned_approver_id);


-- ---------------------------------------------------------------------------
-- 4. Backfill existing rows
-- ---------------------------------------------------------------------------
--  Users: map the email domain onto a branch. Anything unrecognised stays NULL
--  and you can set it by hand from the admin panel.
--
--  Change the CASE here if your staff use different domains.

update public.profiles p
   set company_id = c.id
  from public.companies c
 where p.company_id is null
   and case
         when lower(coalesce((select u.email from auth.users u where u.id = p.id), '')) like '%@longhorn-associates.com' then 'LA'
         when lower(coalesce((select u.email from auth.users u where u.id = p.id), '')) like '%@longhornfinancial.co'    then 'LFS'
         when lower(coalesce((select u.email from auth.users u where u.id = p.id), '')) like '%@longhorninsurance.co'    then 'LIB'
       end = c.code;

-- Anyone whose email domain matched nothing stays NULL on purpose. Set those by
-- hand from the admin panel, or extend the CASE above with your own domains.

-- Vouchers inherit their preparer's company.
update public.vouchers v
   set company_id = p.company_id
  from public.profiles p
 where v.company_id is null
   and p.id = v.prepared_by
   and p.company_id is not null;

-- Anything still unassigned is treated as Longhorn Associates, because that is
-- what the ledger was before this change.
update public.vouchers v
   set company_id = (select id from public.companies where code = 'LA')
 where v.company_id is null;

-- Nominate the existing approvers' company for vouchers that already had an
-- approval trail, so the printed sheet shows the right signatory.
update public.vouchers v
   set assigned_approver_id   = v.approved_by,
       assigned_approver_name = v.approved_by_name
 where v.assigned_approver_id is null
   and v.approved_by is not null;

update public.vouchers v
   set assigned_approver_id   = a.id,
       assigned_approver_name = a.full_name
  from public.profiles a
 where v.assigned_approver_id is null
   and a.role in ('approver', 'admin');


-- ---------------------------------------------------------------------------
-- 5. Helper functions
-- ---------------------------------------------------------------------------
--  SECURITY DEFINER so they can read profiles even though profiles has its own
--  row level security rules. search_path is pinned for safety.
--  These all resolve to NULL / false when the caller has no profile row, which
--  is the safe direction: no profile means no access.

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.current_profile_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.company_id from public.profiles p where p.id = auth.uid();
$$;

-- Admins are treated as approvers everywhere, so there is one rule to remember.
create or replace function public.current_user_is_approver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() in ('approver', 'admin'), false);
$$;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'admin', false);
$$;

-- Preparers and admins may create, edit and remove vouchers. Approvers may not.
create or replace function public.current_user_can_prepare()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() in ('preparer', 'admin'), false);
$$;

-- The single rule behind "each prepare only sees their own company's vouchers".
create or replace function public.user_can_see_company(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_is_approver()
      or target_company is not null
         and target_company = public.current_profile_company_id();
$$;

revoke all on function public.current_profile_role()          from public;
revoke all on function public.current_profile_company_id()   from public;
revoke all on function public.current_user_is_approver()     from public;
revoke all on function public.current_user_is_admin()         from public;
revoke all on function public.current_user_can_prepare()     from public;
revoke all on function public.user_can_see_company(uuid)     from public;
grant execute on function public.current_profile_role()          to authenticated;
grant execute on function public.current_profile_company_id()   to authenticated;
grant execute on function public.current_user_is_approver()     to authenticated;
grant execute on function public.current_user_is_admin()         to authenticated;
grant execute on function public.current_user_can_prepare()     to authenticated;
grant execute on function public.user_can_see_company(uuid)     to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Vouchers always land in the preparer's own company
-- ---------------------------------------------------------------------------
--  Belt and braces for the RLS policy: if the client omits company_id, stamp the
--  preparer's own company on the row. If the client sends somebody else's
--  company and is not an admin, refuse the insert outright.

create or replace function public.vouchers_assign_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_company uuid;
  actor_role    text;
begin
  select p.company_id, p.role into actor_company, actor_role
    from public.profiles p where p.id = auth.uid();

  if new.company_id is null then
    new.company_id := actor_company;
  elsif actor_role <> 'admin' and new.company_id is distinct from actor_company then
    raise exception 'You can only create vouchers for your own company.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_vouchers_assign_company on public.vouchers;
create trigger trg_vouchers_assign_company
  before insert on public.vouchers
  for each row execute function public.vouchers_assign_company();


-- ---------------------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------------------
--  This is the part that actually keeps Longhorn Financial Services staff out of
--  Longhorn Associates' books. The UI filters are a convenience on top of this;
--  changing them in the browser cannot reveal another company's vouchers.

alter table public.vouchers   enable row level security;
alter table public.profiles   enable row level security;
alter table public.companies  enable row level security;
alter table public.departments enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.vouchers   to authenticated;
grant select, insert, update, delete on table public.profiles   to authenticated;
grant select, insert, update, delete on table public.companies  to authenticated;
grant select on table public.departments to authenticated;

-- Companies: everyone signed in can read the branch list, only admins can change it.
drop policy if exists "companies_read_authenticated" on public.companies;
create policy "companies_read_authenticated"
  on public.companies for select
  to authenticated
  using (true);

drop policy if exists "companies_admin_write" on public.companies;
create policy "companies_admin_write"
  on public.companies for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- Profiles: the ledger needs everyone's name, role and company to build the
-- approver dropdown, so any signed-in user may read the directory. Only admins
-- may change another person's role or company; you may always edit your own name.
drop policy if exists "profiles_read_authenticated" on public.profiles;
create policy "profiles_read_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- A row level policy cannot say which COLUMNS may change, so the
-- "you may edit your own profile" rule above would also let someone promote
-- themselves to admin. This trigger puts that one field back unless the caller
-- really is an admin, which is the part people forget to lock down.
--
-- The auth.uid() check matters: writes with no signed-in user are not attacks.
-- The Supabase Table Editor, the SQL editor, and this project's own service-role
-- backend all run without a JWT, and treating those as "not an admin" silently
-- reverted legitimate promotions made in the dashboard.
create or replace function public.profiles_protect_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The primary key is never editable, by anyone, for any reason. Set this before
  -- any early return so it always holds.
  new.id := old.id;

  -- No signed-in user means a trusted backend or dashboard session, not an end user
  -- trying to escalate, so role and branch changes are allowed through.
  if auth.uid() is null then
    return new;
  end if;

  if public.current_user_is_admin() then
    return new;
  end if;

  -- A signed-in non-admin. Only an admin may move a person between roles or
  -- branches, so quietly discard the attempt and keep their own name change.
  new.role       := old.role;
  new.company_id := old.company_id;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_role on public.profiles;
create trigger trg_profiles_protect_role
  before update on public.profiles
  for each row execute function public.profiles_protect_role();

-- Reading the trigger helper requires a role, which needs the grant below.
drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin"
  on public.profiles for insert
  to authenticated
  with check (public.current_user_is_admin());

-- Anyone may edit their own row (that is how the settings page saves a display
-- name); admins may edit anyone's. The trg_profiles_protect_role trigger above
-- stops a non-admin from using that to change role or branch.
drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin"
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or public.current_user_is_admin())
  with check (id = auth.uid() or public.current_user_is_admin());

drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin"
  on public.profiles for delete
  to authenticated
  using (public.current_user_is_admin());

-- Vouchers: read. Approvers and admins see every company. Everyone else sees
-- only their own company, plus anything they prepared themselves (so a voucher
-- stays visible to its author even if they are later moved).
-- Note: inside a policy the row is referenced without a table alias, so these
-- use bare column names rather than v.company_id.
drop policy if exists "vouchers_select_scoped"   on public.vouchers;
drop policy if exists "vouchers_read_authenticated" on public.vouchers;
drop policy if exists "vouchers_read_preparers"  on public.vouchers;
drop policy if exists "vouchers_read_approvers"  on public.vouchers;
drop policy if exists "vouchers_select_all"      on public.vouchers;
create policy "vouchers_select_scoped"
  on public.vouchers for select
  to authenticated
  using (
    public.current_user_is_approver()
    or prepared_by = auth.uid()
    or public.user_can_see_company(company_id)
  );

-- Vouchers: write. A preparer may only create inside their own company.
drop policy if exists "vouchers_insert_scoped" on public.vouchers;
drop policy if exists "vouchers_insert_own_company" on public.vouchers;
drop policy if exists "vouchers_insert_preparers" on public.vouchers;
create policy "vouchers_insert_scoped"
  on public.vouchers for insert
  to authenticated
  with check (
    public.current_user_can_prepare()
    and (public.current_user_is_admin() or company_id = public.current_profile_company_id())
  );

-- Vouchers: update. Approvers can approve anywhere; preparers can only touch
-- their own company's vouchers and can never move a voucher to another company.
drop policy if exists "vouchers_update_approvers" on public.vouchers;
drop policy if exists "vouchers_update_preparers" on public.vouchers;
drop policy if exists "vouchers_update_scoped" on public.vouchers;
create policy "vouchers_update_scoped"
  on public.vouchers for update
  to authenticated
  using (
    public.current_user_is_approver()
    or (public.current_user_can_prepare()
        and (public.current_user_is_admin() or company_id = public.current_profile_company_id()))
  )
  with check (
    public.current_user_is_approver()
    or (public.current_user_can_prepare()
        and (public.current_user_is_admin() or company_id = public.current_profile_company_id()))
  );

-- Vouchers: delete. Preparers may remove their own company's records; admins
-- may remove anything. Approvers never delete.
drop policy if exists "vouchers_delete_preparers" on public.vouchers;
drop policy if exists "vouchers_delete_scoped" on public.vouchers;
drop policy if exists "vouchers_delete_companies" on public.vouchers;
create policy "vouchers_delete_scoped"
  on public.vouchers for delete
  to authenticated
  using (
    public.current_user_is_admin()
    or (public.current_user_can_prepare()
        and company_id is not null
        and company_id = public.current_profile_company_id())
  );


-- ---------------------------------------------------------------------------
-- 8. Verification — run these after the script
-- ---------------------------------------------------------------------------

-- a) Three branches should be listed.
-- select name, code, color from public.companies order by name;

-- b) No user or voucher should be left without a company.
-- select
--   (select count(*) from public.profiles where company_id is null) as users_without_company,
--   (select count(*) from public.vouchers where company_id is null) as vouchers_without_company;

-- c) Vouchers per branch.
-- select c.code, count(v.id) as vouchers
--   from public.companies c left join public.vouchers v on v.company_id = c.id
--  group by c.code order by c.code;

-- d) The policies that are doing the work.
-- select tablename, policyname, cmd, roles
--   from pg_policies
--  where schemaname = 'public'
--    and tablename in ('vouchers', 'profiles', 'companies')
--  order by tablename, cmd, policyname;

-- e) While signed in as a Longhorn Financial Services preparer, this must return
--    false, and counting vouchers must only ever see their own branch.
-- select
--   auth.uid() as caller,
--   public.current_profile_role() as role,
--   public.current_profile_company_id() as company_id,
--   public.current_user_is_approver() as is_approver,
--   public.current_user_can_prepare() as can_prepare,
--   (select count(*) from public.vouchers) as visible_vouchers;

-- Troubleshooting
--   * "permission denied for table X" — a GRANT or policy is missing. Re-run
--     this file; every statement is idempotent.
--   * Someone can see too much — check that public.vouchers has RLS on and that
--     "vouchers_select_scoped" is the only SELECT policy:
--     select count(*) from pg_policies
--      where schemaname='public' and tablename='vouchers' and cmd='SELECT';
--     The answer should be 1.
--   * Someone sees nothing — their profile row is missing or has no company_id:
--     select p.role, p.company_id, (select email from auth.users u where u.id = p.id)
--       from public.profiles p where p.id = auth.uid();