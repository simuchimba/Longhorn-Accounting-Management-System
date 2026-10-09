-- ============================================================================
--  CURRENT: Give every preparer a workspace of their own
-- ============================================================================
--
--  USE THIS FILE. It is safe to run more than once.
--
--  THE PROBLEM
--    A preparer's workspace used to be their branch. Everyone working at
--    Longhorn Associates shared one set of books, so two people preparing
--    payments for the same branch both saw every voucher the other had
--    entered. That is the "mixture of vouchers" problem: your own draft sits
--    in a list you cannot tell apart from a colleague's, it is easy to print
--    or export the wrong one, and the totals on the overview are a blend of
--    several people's work rather than your own.
--
--  WHAT CHANGES
--    A preparer now sees, edits and deletes only the vouchers they prepared
--    themselves (vouchers.prepared_by = auth.uid()). Their branch still
--    decides what company a voucher belongs to, who it is sent to, and which
--    department is stamped on it, so nothing about branch ownership moves.
--
--    Roles that are not preparers are deliberately untouched:
--      approver  still reads every branch, because approving a month means
--                seeing other people's vouchers
--      admin     still reads everything, and still deletes anything
--
--    A preparer can no longer set `prepared_by` to somebody else, so vouchers
--    cannot be attributed to another person either.
--
--  WHAT DOES NOT CHANGE
--    No data is rewritten. Voucher numbers, amounts, dates, branches,
--    approvers and approval trails are all left exactly as they are. This file
--    only tightens who may read and write each row.
--
--  HOW TO RUN
--    Supabase dashboard > SQL Editor > New query > paste the WHOLE file > Run.
--    Safe to run more than once: every statement is guarded.
--
--  AFTER RUNNING
--    Check the verification block in section 7. Then sign in as a preparer who
--    has colleagues in the same branch and confirm their ledger shows only
--    their own vouchers.
-- ============================================================================


-- ---------------------------------------------------------------------------
--  1. Before. Read-only. Shows what a preparer's workspace looks like now,
--     and whether any rows would fall out of their sight.
-- ---------------------------------------------------------------------------

-- === how many vouchers each preparer currently has, per branch ===
select
  c.code                                        as branch,
  p.full_name                                   as preparer,
  p.role,
  count(v.id)                                   as vouchers,
  count(*) filter (where v.prepared_by is null) as never_prepared_by_anyone
  from public.vouchers v
  left join public.profiles  p on p.id = v.prepared_by
  left join public.companies c on c.id = v.company_id
 group by 1, 2, 3
 order by 1, 4 desc;

-- === READ THIS ONE BEFORE RUNNING THE REST ===
-- Any row returned here has no preparer recorded, so after this file runs no
-- preparer will be able to see it. Approvers and admins still can, and that is
-- how you fix it: assign each one to whoever should own it.
--
--   update public.vouchers v
--      set prepared_by     = '<the preparers uuid>',
--          prepared_by_name = '<their full name>'
--    where v.id = '<the voucher id>';
--
select v.id, v.voucher_no, v.voucher_date, v.company_id
  from public.vouchers v
 where v.prepared_by is null
 order by v.voucher_date desc
 limit 50;


-- ---------------------------------------------------------------------------
--  2. Helper: does this row belong to the person looking at it?
-- ---------------------------------------------------------------------------
--  SECURITY DEFINER so it can read profiles even though profiles has its own
--  row level security rules. search_path is pinned for safety.
--
--  Kept as a function rather than inlined into each policy so that the
--  SELECT, UPDATE and DELETE rules cannot drift apart from one another. They
--  were separate copies of the same condition before, which is exactly how the
--  three of them end up disagreeing.

create or replace function public.user_owns_voucher(target_preparer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_preparer is not null and target_preparer = auth.uid();
$$;

comment on function public.user_owns_voucher(uuid) is
  'True when the signed-in preparer is the one who raised the voucher. Drives the per-preparer workspace.';

revoke all on function public.user_owns_voucher(uuid) from public;
grant execute on function public.user_owns_voucher(uuid) to authenticated;


-- ---------------------------------------------------------------------------
--  3. Row Level Security: who may read a voucher
-- ---------------------------------------------------------------------------
--  Approvers and admins read everything. Everyone else reads only the rows
--  they prepared themselves.

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
    or public.user_owns_voucher(prepared_by)
  );


-- ---------------------------------------------------------------------------
--  4. Row Level Security: who may create a voucher
-- ---------------------------------------------------------------------------
--  Unchanged from before, plus one rule: a preparer cannot put somebody else's
--  name on a voucher. Without it a voucher they raise could be filed under a
--  colleague, and that colleague would then see it in their workspace and be
--  responsible for a payment they never made.
--
--  "vouchers_insert_preparer" is dropped here too, and it is not a stale name
--  like the others. It is a PERMISSIVE policy from an earlier setup whose only
--  condition is (auth.uid()) = prepared_by. Permissive policies are ORed
--  together, so while it exists it overrides this rule's own with_check and lets
--  anyone who fills in their own id create a voucher, approvers included.

drop policy if exists "vouchers_insert_scoped"      on public.vouchers;
drop policy if exists "vouchers_insert_own_company" on public.vouchers;
drop policy if exists "vouchers_insert_preparers"   on public.vouchers;
drop policy if exists "vouchers_insert_preparer"    on public.vouchers;

create policy "vouchers_insert_scoped"
  on public.vouchers for insert
  to authenticated
  with check (
    public.current_user_can_prepare()
    and (public.current_user_is_admin()
         or (public.user_owns_voucher(prepared_by)
             and company_id = public.current_profile_company_id()))
  );


-- ---------------------------------------------------------------------------
--  5. Row Level Security: who may edit a voucher
-- ---------------------------------------------------------------------------
--  Approvers still stamp approvals anywhere, which is what lets them clear a
--  month for the whole group. A preparer may only touch their own rows, and
--  may never move one to another branch or reattribute it.
--
--  "vouchers_update_owner_or_approver" is dropped as well. A row must satisfy
--  the SELECT policy above before UPDATE can reach it, so while reading stays
--  owner-scoped this one cannot widen anything by itself. It is dropped anyway:
--  it is PERMISSIVE, it carries no branch check, and leaving it means the moment
--  the SELECT rule is ever widened, updates follow it straight through.

drop policy if exists "vouchers_update_approvers"         on public.vouchers;
drop policy if exists "vouchers_update_preparers"         on public.vouchers;
drop policy if exists "vouchers_update_owner_or_approver" on public.vouchers;
drop policy if exists "vouchers_update_scoped"            on public.vouchers;

create policy "vouchers_update_scoped"
  on public.vouchers for update
  to authenticated
  using (
    public.current_user_is_approver()
    or (public.current_user_can_prepare()
        and (public.current_user_is_admin()
             or (public.user_owns_voucher(prepared_by)
                 and company_id = public.current_profile_company_id())))
  )
  with check (
    public.current_user_is_approver()
    or (public.current_user_can_prepare()
        and (public.current_user_is_admin()
             or (public.user_owns_voucher(prepared_by)
                 and company_id = public.current_profile_company_id())))
  );


-- ---------------------------------------------------------------------------
--  6. Row Level Security: who may delete a voucher
-- ---------------------------------------------------------------------------
--  database/vouchers_rls_policies.sql adds a looser DELETE rule, `using
--  (current_user_can_prepare())`, which reads as "any preparer may delete any
--  voucher". It is dropped here so there is exactly one DELETE rule on this
--  table and that rule means "my own".
--
--  Dropping it is belt and braces rather than the thing that makes isolation
--  work: a row has to satisfy the SELECT policy before DELETE can reach it, and
--  the rule above already hides a colleague's vouchers. What it would cost to
--  leave it is a rule that contradicts the system on its face, and a live hole
--  the moment the SELECT rule is ever widened again.

drop policy if exists "vouchers_delete_preparers" on public.vouchers;
drop policy if exists "vouchers_delete_companies" on public.vouchers;
drop policy if exists "vouchers_delete_scoped"    on public.vouchers;

create policy "vouchers_delete_scoped"
  on public.vouchers for delete
  to authenticated
  using (
    public.current_user_is_admin()
    or (public.current_user_can_prepare() and public.user_owns_voucher(prepared_by))
  );


-- ---------------------------------------------------------------------------
--  7. Verify
-- ---------------------------------------------------------------------------

-- a) There should now be exactly one policy per command. If any row below shows
--    more than one for a command, the permissive policies are being combined
--    with OR and the stricter one is not the only rule in play.
select cmd, count(*) as policies, string_agg(policyname::text, ', ' order by policyname::text) as names
  from pg_policies
 where schemaname = 'public'
   and tablename = 'vouchers'
 group by cmd
 order by cmd;
-- Expect: 4 rows. delete, insert, select, update.

-- b) The rules themselves.
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename = 'vouchers'
 order by cmd, policyname;

-- c) Rows that no preparer can now see, because nobody is recorded as raising
--    them. Should be zero. Anything listed here needs an owner assigned by hand.
select count(*) as orphaned_vouchers
  from public.vouchers
 where prepared_by is null;

-- d) The rules resolve. Sign in as a preparer, run this in the SQL editor, and
--    visible_vouchers should equal your own count, not your branch's.
select
  auth.uid()                                     as caller,
  public.current_profile_role()                  as role,
  public.current_profile_company_id()            as branch_id,
  public.current_user_is_approver()              as sees_every_branch,
  (select count(*) from public.vouchers)                            as visible_vouchers,
  (select count(*) from public.vouchers where prepared_by = auth.uid()) as my_vouchers,
  (select count(*) from public.vouchers) =
    (select count(*) from public.vouchers where prepared_by = auth.uid())
                                                      as workspace_is_private;

-- e) Sign in as an approver and repeat (d). Here visible_vouchers must be the
--    whole ledger, so workspace_is_private is expected to be false.

-- Troubleshooting
--
-- * A preparer still sees a colleague's vouchers. There is more than one
--   SELECT policy on the table; check (a) and drop any left over from an older
--   script:
--
--     select policyname, cmd from pg_policies
--      where schemaname='public' and tablename='vouchers' and cmd='SELECT';
--
-- * A preparer sees nothing at all. Either they have no vouchers yet, which is
--   correct, or their profile row is missing:
--
--     select p.role, p.company_id, (select email from auth.users u where u.id = p.id)
--       from public.profiles p where p.id = auth.uid();
--
-- * An approver can no longer approve. The update rule must still allow
--   current_user_is_approver() to reach any row; check (b).
--
-- * Undo, putting the shared branch workspace back. Everything else about the
--   ledger is untouched by this file, so there is no data to restore.
--
--     drop policy "vouchers_select_scoped" on public.vouchers;
--     drop policy "vouchers_update_scoped" on public.vouchers;
--     drop policy "vouchers_delete_scoped" on public.vouchers;
--     drop policy "vouchers_insert_scoped" on public.vouchers;
--
--     create policy "vouchers_select_scoped" on public.vouchers for select to authenticated
--       using (public.current_user_is_approver() or prepared_by = auth.uid()
--              or public.user_can_see_company(company_id));
--     create policy "vouchers_update_scoped" on public.vouchers for update to authenticated
--       using (public.current_user_is_approver() or (public.current_user_can_prepare()
--              and (public.current_user_is_admin() or company_id = public.current_profile_company_id())))
--       with check (public.current_user_is_approver() or (public.current_user_can_prepare()
--              and (public.current_user_is_admin() or company_id = public.current_profile_company_id())));
--     create policy "vouchers_delete_scoped" on public.vouchers for delete to authenticated
--       using (public.current_user_is_admin() or (public.current_user_can_prepare()
--              and company_id is not null and company_id = public.current_profile_company_id()));
--     create policy "vouchers_insert_scoped" on public.vouchers for insert to authenticated
--       with check (public.current_user_can_prepare()
--              and (public.current_user_is_admin() or company_id = public.current_profile_company_id()));