-- ============================================================================
-- ============================================================================
--  CURRENT: Make the approval date the date on the voucher
-- ============================================================================
--
--  USE THIS FILE. It supersedes database/set_approval_date_from_created.sql,
--  which is now marked SUPERSEDED. You do not need to run anything else.
--
--  WHY created_at WAS THE WRONG SOURCE
--    Every voucher in the ledger was loaded into the database in one batch on
--    5 October. So created_at reads 05 Oct 2026 for all of them, including the
--    ones dated 30 September. Aligning the approval date to created_at left every
--    September voucher still showing an October approval date, which is what it
--    was meant to fix.
--
--    voucher_date is the business date: what is printed on the voucher, and the
--    month it is filed under. That is the date the signature block should show,
--    and it is what this file uses.
--
--  WHAT THIS CHANGES
--    approved_at becomes voucher_date. A voucher dated 30 September shows
--    "Date: 30 Sep 2026" next to the approver's signature, matching the date at
--    the top of the same sheet.
--
--  NOTHING ELSE MOVES
--    voucher_date is never touched, so no voucher changes month in any list,
--    report or monthly approval view. Only approved_at changes.
--
--  IF YOU ALREADY RAN set_approval_date_from_created.sql
--    Nothing to undo. Running this file afterwards switches you over, and it is
--    idempotent, so it is safe to run either way.
--
--  HOW TO RUN
--    Supabase dashboard > SQL Editor > paste the WHOLE file > Run.
-- ============================================================================

-- ============================================================================
--  HISTORICAL NOTES, kept for reference
-- ============================================================================
--  An earlier version of this file installed a trigger on approved_at. An even
--  earlier version aligned to created_at, which is wrong for batch-imported data.
--  See README section 9.
--
--  WHAT THIS CHANGES
--    approved_at is aligned to voucher_date, the date printed on the voucher.
--    The signature block previously showed a blank line for the approver's date,
--    because approved_at held the moment the button was clicked in the system,
--    which is not a business date and often differed from the voucher's date.
--
--    So the ledger recorded one thing and the paper said another. This makes the
--    approved date equal the voucher's date, so the record and the printed sheet
--    agree.
--
--  WHAT THIS DOES NOT CHANGE
--    voucher_date itself is never touched. Nothing moves between months, so a
--    payment dated 15 January stays in January in every list, report and monthly
--    approval view.
--
--    The original timestamp is not lost. It is kept in approved_recorded_at, so
--    you can still audit exactly when each approval happened in the system.
--
--  HOW TO RUN
--    Supabase dashboard > SQL Editor > paste > Run. Safe to run more than once.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- ============================================================================
--  Read-only. Shows the gap between the approval date and the voucher's own date.
-- ============================================================================
-- === before: approved vouchers whose approval date is not the date on the voucher ===
select
  coalesce(c.name, 'Unassigned') as branch,
  count(*) filter (where v.approved_at is not null
                     and v.approved_at::date <> v.voucher_date) as differing,
  count(*) filter (where v.approved_at is null and v.status = 'Approved') as approved_but_blank,
  count(*) filter (where v.status = 'Approved') as approved_total
  from public.vouchers v
  left join public.companies c on c.id = v.company_id
 group by 1
 order by 1;

-- === the September vouchers, before ===
select
  v.voucher_no,
  v.voucher_date                                  as date_on_voucher,
  v.created_at::date                              as created_in_db,
  v.approved_at::date                             as approved_currently
  from public.vouchers v
 where v.voucher_date >= date '2026-09-01'
   and v.voucher_date <  date '2026-10-01'
 order by v.voucher_date
 limit 20;


-- ---------------------------------------------------------------------------
--  1. Why voucher_date, and not created_at
-- ---------------------------------------------------------------------------
--  Every voucher here was loaded into the database in a single batch, so
--  created_at is the day of that batch for all of them. A voucher dated
--  30 September therefore has a created_at in October, and aligning the approval
--  date to created_at leaves it showing an October date.
--
--  The check below shows how far apart the two are. If every row agrees, either
--  source would do, but they will not agree on batch-imported data.
-- === created_at vs the date on the voucher ===
select
  count(*)                                                                  as total,
  count(*) filter (where created_at::date = voucher_date)                  as same_day,
  count(*) filter (where created_at::date <> voucher_date)                 as different_day,
  count(*) filter (where to_char(created_at,'YYYY-MM') <> to_char(voucher_date,'YYYY-MM')) as different_month
  from public.vouchers;

-- === sample rows where they differ, so you can eyeball the choice ===
select
  voucher_no,
  voucher_date                                as date_on_voucher,
  created_at::date                            as created_in_db,
  to_char(voucher_date, 'YYYY-MM')            as month_it_belongs_to,
  to_char(created_at, 'YYYY-MM')              as month_created_in
  from public.vouchers
 where created_at::date <> voucher_date
 order by voucher_date desc
 limit 20;


-- ---------------------------------------------------------------------------
--  2. Remove the old trigger FIRST, then fix the rows.
-- ---------------------------------------------------------------------------
--  ORDER MATTERS, and getting it wrong is silent.
--
--  An earlier attempt installed trg_vouchers_approval_date, which forces
--  approved_at back to created_at on every update. If it is still installed when
--  the UPDATE below runs, it overwrites each row the instant it is written, and
--  the whole fix is silently undone. That is exactly what happened: 780 vouchers
--  read as "approved on 05 Oct" no matter how many times this script was run.
--
--  So the trigger is dropped before anything is written, not after.

drop trigger if exists trg_vouchers_approval_date on public.vouchers;
drop trigger if exists trg_vouchers_align_approval_date on public.vouchers;

-- --- triggers that could rewrite the approval date (expect none) ---
select tgname
  from pg_trigger
 where tgrelid = 'public.vouchers'::regclass
   and not tgisinternal
   and tgname in ('trg_vouchers_approval_date', 'trg_vouchers_align_approval_date');

-- ---------------------------------------------------------------------------
--  3. Keep the real timestamp, then align the date.
-- ---------------------------------------------------------------------------
alter table public.vouchers
  add column if not exists approved_recorded_at timestamptz;

comment on column public.vouchers.approved_recorded_at is
  'When the approval actually happened in the system. approved_at holds the date printed on the voucher.';

-- Preserve what was there before overwriting it. Guarded, so a re-run does not
-- overwrite the kept value with the aligned one.
update public.vouchers
   set approved_recorded_at = approved_at
 where approved_recorded_at is null
   and approved_at is not null;

-- The change itself: the approval date becomes the date on the voucher.
update public.vouchers
   set approved_at = voucher_date::timestamptz
 where status = 'Approved'
   and approved_at is distinct from voucher_date::timestamptz;

-- An approved voucher should never have a blank approval date.
update public.vouchers
   set approved_at = voucher_date::timestamptz
 where status = 'Approved'
   and approved_at is null;

-- Rows approved without a timestamp have nothing to preserve, so record the
-- voucher's own date rather than leaving the audit column silently empty.
update public.vouchers
   set approved_recorded_at = voucher_date::timestamptz
 where status = 'Approved'
   and approved_recorded_at is null;

-- Anything not approved must not claim to be approved.
update public.vouchers
   set approved_at = null
 where status <> 'Approved';


-- ---------------------------------------------------------------------------
--  4. Keep it that way for future rows, so it does not drift back.
-- ---------------------------------------------------------------------------
create or replace function public.vouchers_align_approval_date()
returns trigger
language plpgsql
as $fn$
begin
  if new.status = 'Approved' then
    -- Stamp the real moment once, only when it is not already known.
    if new.approved_recorded_at is null then
      new.approved_recorded_at := now();
    end if;
    -- The date printed on the voucher is what the signature block shows.
    new.approved_at := new.voucher_date::timestamptz;
  else
    new.approved_at := null;
  end if;
  return new;
end
$fn$;

drop trigger if exists trg_vouchers_align_approval_date on public.vouchers;
create trigger trg_vouchers_align_approval_date
  before insert or update of status, approved_at, voucher_date
    on public.vouchers
    for each row execute function public.vouchers_align_approval_date();
-- (the superseded trigger was already dropped in section 2, before any row was written)


-- ---------------------------------------------------------------------------
--  5. Verify. Every count below should now be zero.
-- ---------------------------------------------------------------------------
-- === after: approval date matches the date on every voucher ===
select
  count(*) filter (where v.status = 'Approved'
                     and v.approved_at is distinct from v.voucher_date::timestamptz) as still_wrong,
  count(*) filter (where v.status = 'Approved' and v.approved_at is null)              as approved_but_blank,
  count(*) filter (where v.status <> 'Approved' and v.approved_at is not null)         as not_approved_but_dated,
  count(*) filter (where v.approved_recorded_at is not null)                           as original_timestamp_kept,
  count(*)                                                                            as total_vouchers
  from public.vouchers v;

-- === the September vouchers, after ===
select
  v.voucher_no,
  v.voucher_date                                  as date_on_voucher,
  v.approved_at::date                             as shows_approved_on,
  (v.approved_at::date = v.voucher_date)          as matches
  from public.vouchers v
 where v.voucher_date >= date '2026-09-01'
   and v.voucher_date <  date '2026-10-01'
 order by v.voucher_date
 limit 20;

-- === the whole ledger agrees? ===
select
  count(*) as approved_vouchers,
  count(*) filter (where v.approved_at::date = v.voucher_date) as date_matches,
  count(*) filter (where v.approved_at::date <> v.voucher_date) as date_differs
  from public.vouchers v
 where v.status = 'Approved';

-- Troubleshooting
--
-- * still_wrong above zero after running. A later write reintroduced it. Re-run
--   the file; section 2 is idempotent.
--
-- * Want the original approval times back:
--
--     select voucher_no, voucher_date, approved_at, approved_recorded_at
--       from public.vouchers
--      where approved_recorded_at is not null
--      order by approved_recorded_at desc;
--
-- * Removing the guard entirely, leaving the data as it is:
--
--     drop trigger if exists trg_vouchers_align_approval_date on public.vouchers;
--     drop trigger if exists trg_vouchers_approval_date on public.vouchers;