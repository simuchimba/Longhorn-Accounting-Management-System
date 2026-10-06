-- ============================================================================
--  Test fixture: the ORIGINAL buggy version of profiles_protect_role()
-- ============================================================================
--  Do not run this against your real database.
--
--  database/verify-migration.mjs loads this to prove the role-edit checks are not
--  vacuous: with this version in place the dashboard promotion must FAIL, which
--  shows the checks genuinely detect the bug. The real trigger is put back
--  immediately afterwards.
-- ============================================================================

create or replace function public.profiles_protect_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_is_admin() then
    return new;
  end if;

  new.role       := old.role;
  new.company_id := old.company_id;

  if new.id <> old.id then
    new.id := old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_role on public.profiles;
create trigger trg_profiles_protect_role
  before update on public.profiles
  for each row execute function public.profiles_protect_role();