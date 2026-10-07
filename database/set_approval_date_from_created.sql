-- ============================================================================
--  Set the approval date to the date the voucher was created
-- ============================================================================
--
--  THE PROBLEM
--    Vouchers created in September show an approval date in October. September
--    vouchers were stamped approved on the 6th, which is the day the batch was
--    loaded, not a date anything was signed. The printed signature block therefore
--    disagreed with the month the voucher belongs to.
--
--  WHAT THIS CHANGES
--    approved_at becomes the voucher's creation date. Run section 1 first to see
--    exactly which rows will move.
--
--  RUN THE SECTIONS IN ORDER. Section 2 is optional but worth reading: it lists
--    the rows where the creation date and the voucher's own date disagree, which
--    are back-dated entries. Read those before committing.
--
--  NOTHING ELSE MOVES
--    voucher_date is never touched, so no voucher changes month in any list,
--    report or monthly approval view. Only approved_at changes.
--
--  THE ORIGINAL TIMESTAMP IS KEPT
--    Moved to approved_recorded_at, so you can still audit exactly when each
--    approval happened in the system. If that column already exists from an
--    earlier run, the original value is left alone rather than overwritten.
--
--  HOW TO RUN
--    Supabase dashboard > SQL Editor > paste the WHOLE file > Run.
--    Safe to run more than once.
--
-- ============================================================================
--  SUPERSEDED. Do not run this file.
-- ============================================================================
--  Use database/align_approval_dates.sql instead.
--
--  WHY THIS FILE IS WRONG
--    It sets the approval date to created_at, which is when the row was written
--    to the database. Every voucher in this ledger was loaded in one batch on
--    5 October, so created_at reads 05 Oct 2026 for all of them, including the
--    ones dated September. Running this file therefore left every September
--    voucher still showing an October approval date, which was the exact problem
--    it was written to fix.
--
--  IF YOU ALREADY RAN THIS ONE
--    Nothing to undo. Run align_approval_dates.sql afterwards: it switches you
--    over to the date printed on the voucher, and is idempotent.
--
--  Everything below is the original script, kept for reference only.
-- ============================================================================

-- ============================================================================
--  ORIGINAL: set the approval date to the voucher's creation date
-- ============================================================================


-- ---------------------------------------------------------------------------
--  1. The problem, by month. Read-only.
-- ---------------------------------------------------------------------------
-- === approval month vs creation month (September rows should show October) ===
select
  to_char(v.created_at, 'YYYY-MM') as created_month,
  to_char(v.approved_at, 'YYYY-MM') as approved_month,
  count(*) as vouchers
  from public.vouchers v
 where v.status = 'Approved'
   and v.approved_at is not null
   and to_char(v.approved_at, 'YYYY-MM') <> to_char(v.created_at, 'YYYY-MM')
 group by 1, 2
 order by 1, 2;


-- ---------------------------------------------------------------------------
--  2. Rows where the two dates disagree. Read-only. CHECK THESE.
-- ---------------------------------------------------------------------------
--  A voucher created on a different day from the date printed on it is a
--  back-dated entry. For those, section 3 sets the approval date to the CREATION
--  date, which is later than the date on the voucher. That is what "approved on
--  the day it was entered" means, but confirm it is what you want.
-- === back-dated vouchers: created on a different day from the voucher date ===
select
  v.voucher_no,
  v.voucher_date                                  as date_on_voucher,
  v.created_at::date                              as created,
  v.approved_at::date                             as approved_currently,
  to_char(v.created_at, 'YYYY-MM')                as creation_month
  from public.vouchers v
 where v.created_at::date <> v.voucher_date
   and v.status = 'Approved'
 order by v.voucher_date desc
 limit 50;

-- === how many in total, and how many change month as a result ===
select
  count(*) filter (where v.created_at::date <> v.voucher_date) as back_dated,
  count(*) filter (where v.created_at::date <> v.voucher_date
                     and to_char(v.created_at, 'YYYY-MM') <> to_char(v.voucher_date, 'YYYY-MM')) as change_month
  from public.vouchers v
 where v.status = 'Approved';


-- ---------------------------------------------------------------------------
--  3. The change.
-- ---------------------------------------------------------------------------

-- Keep the real moment before anything is overwritten. Guarded, so a re-run does
-- not overwrite the kept value with the aligned one.
alter table public.vouchers
  add column if not exists approved_recorded_at timestamptz;

comment on column public.vouchers.approved_recorded_at is
  'When the approval actually happened in the system. approved_at holds the creation date shown on the voucher.';

update public.vouchers
   set approved_recorded_at = approved_at
 where approved_recorded_at is null
   and approved_at is not null;

-- The change itself: approved date becomes the creation date.
update public.vouchers
   set approved_at = created_at
 where status = 'Approved'
   and created_at is not null
   and approved_at is distinct from created_at;

-- An approved voucher should never have a blank approval date.
update public.vouchers
   set approved_at = created_at
 where status = 'Approved'
   and approved_at is null
   and created_at is not null;

-- Those rows had no timestamp to preserve, because the approval was recorded
-- without one. Stamp the creation date as the best available estimate, so the
-- audit column is never silently empty on an approved voucher. Anything that
-- already has a real value is left alone.
update public.vouchers
   set approved_recorded_at = created_at
 where status = 'Approved'
   and approved_recorded_at is null
   and created_at is not null;

-- Anything not approved must not claim to be approved.
update public.vouchers
   set approved_at = null
 where status <> 'Approved';


-- ---------------------------------------------------------------------------
--  4. Keep it that way, so it does not drift back.
-- ---------------------------------------------------------------------------
--  A trigger, so the rule holds for single approval, monthly bulk approval and
--  the bulk importer alike.

create or replace function public.vouchers_approval_date_from_created()
returns trigger
language plpgsql
as $fn$
begin
  if new.status = 'Approved' then
    -- Stamp the real moment once, only when it is not already known.
    if new.approved_recorded_at is null then
      new.approved_recorded_at := now();
    end if;
    -- The creation date is what the signature block shows.
    new.approved_at := new.created_at;
  else
    new.approved_at := null;
  end if;
  return new;
end
$fn$;

drop trigger if exists trg_vouchers_approval_date on public.vouchers;
create trigger trg_vouchers_approval_date
  before insert or update of status, approved_at, created_at
    on public.vouchers
    for each row execute function public.vouchers_approval_date_from_created();


-- ---------------------------------------------------------------------------
--  5. Verify. Every count below should now be zero.
-- ---------------------------------------------------------------------------

-- === approval date now equals the creation date, for every voucher? ===
select
  count(*) filter (where v.status = 'Approved' and v.approved_at is distinct from v.created_at) as still_wrong,
  count(*) filter (where v.status = 'Approved' and v.approved_at is null)                       as approved_but_blank,
  count(*) filter (where v.status <> 'Approved' and v.approved_at is not null)                  as not_approved_but_dated,
  count(*) filter (where v.approved_recorded_at is not null)                                    as original_timestamp_kept,
  count(*)                                                                                     as total_vouchers
  from public.vouchers v;

-- === the September rows specifically ===
select
  v.voucher_no,
  v.voucher_date                                  as date_on_voucher,
  to_char(v.created_at, 'YYYY-MM-DD')              as created,
  v.approved_at::date                             as approved,
  v.status
  from public.vouchers v
 where to_char(v.created_at, 'YYYY-MM') = '2026-09'
 order by v.voucher_date
 limit 20;

-- === approval month now matches creation month for all of them? ===
select
  count(*) as approved_vouchers,
  count(*) filter (where to_char(v.approved_at, 'YYYY-MM') = to_char(v.created_at, 'YYYY-MM')) as month_matches,
  count(*) filter (where to_char(v.approved_at, 'YYYY-MM') <> to_char(v.created_at, 'YYYY-MM')) as month_differs
  from public.vouchers v
 where v.status = 'Approved';

-- === confirm no voucher changed its own month (must be untouched) ===
select voucher_no, voucher_date, status
  from public.vouchers
 order by voucher_date desc
 limit 10;

-- Troubleshooting
--
-- * still_wrong above zero after running. A later write reintroduced it. Re-run
--   the file; section 3 is idempotent.
--
-- * Want the original approval times back:
--
--     select voucher_no, voucher_date, approved_at, approved_recorded_at
--       from public.vouchers
--      where approved_recorded_at is not null
--      order by approved_recorded_at desc;
--
-- * Section 2 listed back-dated vouchers. If you would rather those keep the
--   date printed on the voucher, say so and this becomes voucher_date instead of
--   created_at. The trigger is the only other place that needs changing.
--
-- * To undo the trigger, leaving the data as it is:
--
--     drop trigger if exists trg_vouchers_approval_date on public.vouchers;