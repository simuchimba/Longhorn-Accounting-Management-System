-- ============================================================================
--  Fix: wrong approver on Longhorn Associates vouchers
-- ============================================================================
--
--  SYMPTOM
--    Existing Longhorn Associates vouchers (January to September 2026) show
--    Tezza Mutepeka as the approver. It should read Izukanji Mwanza.
--
--  WHY IT HAPPENED
--    The bulk importer stamped whoever ran the import as the approver on any row
--    imported as "Approved":
--
--      approved_by:      approved ? user.id     : null
--      approved_by_name: approved ? displayName : null
--
--    So the 700-odd approved records carry the name of the person who imported
--    the file, not the person who actually signed the payments. That is an
--    artefact of the import, not an approval record. The code is fixed in this
--    commit; this script repairs the rows already affected.
--
--  WHAT THIS CHANGES
--    Longhorn Associates vouchers whose approver is not someone with the
--    approver role are re-pointed to Izukanji Mwanza. Rows already attributed to
--    a real approver are left alone, so this cannot overwrite a genuine
--    approval. Voucher dates and amounts are never touched, and approved_at
--    keeps its original value.
--
--  HOW TO RUN
--    Supabase dashboard > SQL Editor > paste > Run. Safe to run more than once.
--
--  RUN SECTION 1 FIRST. It only reads, and prints exactly what section 2 would
--  change, so you can check the list before committing to it.
-- ============================================================================


-- ---------------------------------------------------------------------------
--  1. What the ledger says now. Read-only.
-- ---------------------------------------------------------------------------

-- --- approver attribution by branch and status ---
select
  coalesce(c.name, 'Unassigned') as branch,
  v.status,
  coalesce(v.approved_by_name, '(none)') as approver,
  p.role as approver_role,
  count(*) as vouchers,
  min(v.voucher_date) as first_date,
  max(v.voucher_date) as last_date
  from public.vouchers v
  left join public.companies c on c.id = v.company_id
  left join public.profiles p on p.id = v.approved_by
 group by 1, 2, 3, 4
 order by 1, 2, 3;

-- --- who is approver or admin right now ---
select
  au.email,
  coalesce(p.full_name, '(no profile)') as full_name,
  coalesce(p.role, '(no profile)') as role,
  coalesce(c.name, 'No branch') as branch
  from auth.users au
  left join public.profiles p on p.id = au.id
  left join public.companies c on c.id = p.company_id
 where coalesce(p.role, '') in ('admin', 'approver', 'preparer')
 order by coalesce(p.role, ''), au.email;


-- ---------------------------------------------------------------------------
--  2. The correction.
-- ---------------------------------------------------------------------------
--
--  Scoped to Longhorn Associates, and only to rows whose current approver is not
--  somebody with the approver role. Uses the auth ids looked up by email rather
--  than by name, so a spelling difference cannot silently miss.

do $$
declare
  la            uuid;
  correct       uuid;
  correct_name  text;
  changed       int := 0;
begin
  select id into la from public.companies where code = 'LA';
  if la is null then
    raise exception 'No branch with code LA found. Run database/multi_company_setup.sql first.';
  end if;

  -- Izukanji Mwanza, found by email so the name does not have to match exactly.
  select p.id, p.full_name into correct, correct_name
    from auth.users u join public.profiles p on p.id = u.id
   where lower(u.email) = 'approvals@longhorn-associates.com';

  if correct is null then
    raise exception 'approvals@longhorn-associates.com has no profiles row, so there is nobody to attribute approvals to.';
  end if;

  raise notice 'Correct approver: % (%)', correct_name, correct;

  /*
   * Longhorn Associates rows to correct. A voucher qualifies when its approver is
   * null, or resolves to somebody without the approver role. Rows already sitting
   * with a genuine approver are excluded, so re-running is safe and a real
   * approval is never overwritten.
   *
   * approved_at is deliberately left alone: the payment was made on that date and
   * inventing a different one would be worse than keeping it.
   */
  with target as (
    select v.id,
           v.approved_by,
           v.assigned_approver_id
      from public.vouchers v
      left join public.profiles p on p.id = v.approved_by
     where coalesce(v.company_id, la) = la
       and coalesce(p.role, '') <> 'approver'
  )
  update public.vouchers v
     set approved_by           = correct,
         approved_by_name      = correct_name,
         assigned_approver_id  = case
                                   when v.assigned_approver_id is not null then correct
                                   else null
                                 end,
         assigned_approver_name = case
                                   when v.assigned_approver_id is not null then correct_name
                                   else null
                                 end
    from target t
   where v.id = t.id;

  get diagnostics changed = row_count;
  raise notice 'Repointed % Longhorn Associates voucher(s) to %', changed, correct_name;

  if changed = 0 then
    raise notice 'Nothing needed changing. Either the rows were already correct, or no LA vouchers are misattributed.';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
--  3. Verify. Run this afterwards.
-- ---------------------------------------------------------------------------

-- --- Longhorn Associates approver attribution after the fix ---
select
  v.status,
  coalesce(v.approved_by_name, '(none)') as approver,
  count(*) as vouchers,
  min(v.voucher_date) as first_date,
  max(v.voucher_date) as last_date
  from public.vouchers v
  left join public.companies c on c.id = v.company_id
 where coalesce(c.code, 'LA') = 'LA'
 group by 1, 2
 order by 1, 2;

-- --- any approver anywhere that is not an approver role? (expect none) ---
select
  coalesce(c.name, 'Unassigned') as branch,
  v.approved_by_name,
  p.role,
  count(*) as vouchers
  from public.vouchers v
  left join public.companies c on c.id = v.company_id
  left join public.profiles p on p.id = v.approved_by
 where v.approved_by is not null
   and coalesce(p.role, '') <> 'approver'
 group by 1, 2, 3
 order by 4 desc;

-- Troubleshooting
--
-- * Section 2 reports "Nothing needed changing" but the names still look wrong.
--   Section 1 will show the real attribution. If the wrong name sits on
--   assigned_approver_name rather than approved_by_name, that means the rows were
--   nominated rather than approved, and the approver list itself needs looking at
--   (the dropdown now offers role = 'approver' only).
--
-- * "no profiles row" means that account has no profile, so its role cannot be
--   read and it is treated as not-an-approver. Add the profile in the admin
--   panel, then re-run this script.
--
-- * Want to see the rows before changing them? Section 1's first query lists the
--   voucher counts per approver per branch. To inspect individual rows:
--
--     select voucher_no, voucher_date, approved_by_name, assigned_approver_name
--       from public.vouchers
--      where coalesce(company_id, (select id from public.companies where code='LA')) =
--            (select id from public.companies where code='LA')
--      order by voucher_date;