-- Longhorn Ledger - allow deleting vouchers
--
-- Symptom this fixes:
--   "Could not delete: permission denied for table vouchers"
--
-- Importing and approving vouchers already work, so INSERT and UPDATE policies
-- are in place. Only DELETE is missing, and with row level security switched on
-- anything without a matching policy is refused - Postgres reports that as
-- "permission denied for table vouchers".
--
-- This script therefore only ADDS the missing DELETE policy. It does not touch
-- the policies you already have, so it cannot widen access to anything.
--
-- HOW TO RUN
--   Supabase dashboard > SQL Editor > New query > paste > Run.
--   Safe to run more than once.
--
-- Sign in as a preparer or admin before testing. Approvers keep read and
-- update rights but cannot delete, which matches what the app enforces.

-- ---------------------------------------------------------------------------
-- Optional: look at what is already there before you change anything.
-- ---------------------------------------------------------------------------
-- select policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename in ('vouchers', 'profiles')
-- order by tablename, cmd, policyname;

-- ---------------------------------------------------------------------------
-- Helper: may the signed-in user create, change or remove vouchers?
--
-- SECURITY DEFINER so this can read profiles even if profiles has its own row
-- level security rules. search_path is pinned for safety.
-- ---------------------------------------------------------------------------
create or replace function public.current_user_can_prepare()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('preparer', 'admin')
  );
$$;

revoke all on function public.current_user_can_prepare() from public;
grant execute on function public.current_user_can_prepare() to authenticated;

-- ---------------------------------------------------------------------------
-- Safety net: if vouchers somehow has RLS off, turn it on, otherwise this
-- policy would sit unused and deletes would still be allowed for everyone.
-- ---------------------------------------------------------------------------
alter table public.vouchers enable row level security;

-- ---------------------------------------------------------------------------
-- Table privilege.
--
-- Postgres reports a missing table GRANT and a missing row level security
-- policy with the same message, "permission denied for table vouchers", so
-- this covers both. The grant on its own allows nothing, because RLS is on
-- and the policy below still decides every row.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.vouchers to authenticated;

-- ---------------------------------------------------------------------------
-- The fix: preparers and admins may delete.
-- ---------------------------------------------------------------------------
drop policy if exists "vouchers_delete_preparers" on public.vouchers;
create policy "vouchers_delete_preparers"
  on public.vouchers for delete
  to authenticated
  using (public.current_user_can_prepare());

-- ---------------------------------------------------------------------------
-- Check: run this after to confirm the policy is now in place.
-- ---------------------------------------------------------------------------
-- select policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'public' and tablename = 'vouchers' and cmd = 'DELETE';

-- You should see one row: vouchers_delete_preparers | DELETE | {authenticated}

-- ---------------------------------------------------------------------------
-- Troubleshooting
--
-- Still "permission denied"? Compare these two values in the SQL editor.
-- They tell you whether the database agrees with the app about who you are.
--
--   select auth.uid() as caller;                       -- your auth user id
--   select current_user_can_prepare() as can_prepare; -- should be true for a preparer
--
-- If auth.uid() is not null but can_prepare is false, the profiles row is
-- missing or the role is not 'preparer' / 'admin'. Check it:
--
--   select id, full_name, role from public.profiles where id = auth.uid();
--
-- If DELETE is refused for an admin too, the table may not be the one the app
-- talks to, or a policy is still missing - run the first diagnostic again.
-- ---------------------------------------------------------------------------