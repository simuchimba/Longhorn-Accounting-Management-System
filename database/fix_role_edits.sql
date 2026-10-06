-- ============================================================================
--  Fix: role and branch edits made in the Supabase Table Editor were reverting
-- ============================================================================
--
--  SYMPTOM
--    Promoting someone to admin in the Table Editor appears to save, then the row
--    is back to 'preparer'. Same for changing a branch.
--
--  WHY
--    database/multi_company_setup.sql installs a trigger on public.profiles that
--    stops a signed-in non-admin from changing role or branch. It judged the
--    caller by public.current_user_is_admin(), which reads auth.uid(). The Table
--    Editor and any service-role write run with NO signed-in user, so auth.uid()
--    is NULL, the trigger decided "not an admin", and quietly put the old value
--    back.
--
--    So the trigger was protecting against the wrong thing while blocking you.
--
--  WHAT THIS CHANGES
--    No signed-in user is treated as a trusted backend or dashboard session, so
--    role and branch edits are allowed through. A signed-in non-admin is still
--    protected, which is the case that actually matters. The primary key is now
--    immutable for everyone, dashboard included.
--
--  HOW TO RUN
--    Supabase dashboard > SQL Editor > paste > Run. Safe to run more than once.
-- ============================================================================

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


-- ---------------------------------------------------------------------------
--  Make kuunda an admin, since that is what you were trying to do.
--  Only touches the row that is still a preparer, so it is safe to re-run.
-- ---------------------------------------------------------------------------

update public.profiles p
   set role = 'admin'
  from auth.users u
 where u.id = p.id
   and lower(u.email) = 'kuunda@longhorn-associates.com'
   and coalesce(p.role, 'preparer') <> 'admin';


-- ---------------------------------------------------------------------------
--  Verify
-- ---------------------------------------------------------------------------

-- e) Should now return admin.
-- select p.full_name, p.role, c.code as branch
--   from public.profiles p
--   left join public.companies c on c.id = p.company_id
--  where p.id in (select id from auth.users where email = 'kuunda@longhorn-associates.com');

-- f) Nobody should be left without a branch, or anyone still a plain preparer by
--    accident. Everyone should be preparer, approver or admin.
-- select role, count(*) from public.profiles group by role order by role;

-- g) The trigger itself, so you can confirm it is the new version.
-- select pg_get_functiondef('public.profiles_protect_role()'::regprocedure);