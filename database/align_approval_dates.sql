-- ============================================================================
--  Make the approval date the voucher's own date
-- ============================================================================
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
--  1. Read-only. Shows the gap before and after.
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- before: approved vouchers whose approval date differs from the voucher date ---'
select
  coalesce(c.name, 'Unassigned') as branch,
  count(*) filter (where v.approved_at is not null
                     and v.approved_at::date <> v.voucher_date) as differing,
  count(*) filter (where v.approved_at is null)                    as never_approved_time,
  count(*) filter (where v.status = 'Approved')                     as approved_total
  from public.vouchers v
  left join public.companies c on c.id = v.company_id
 group by 1
 order by 1;


-- ---------------------------------------------------------------------------
--  2. Keep the real timestamp, then align the date.
-- ---------------------------------------------------------------------------

alter table public.vouchers
  add column if not exists approved_recorded_at timestamptz;

comment on column public.vouchers.approved_recorded_at is
  'When the approval actually happened in the system. approved_at holds the business date shown on the voucher.';

-- Preserve whatever was there before overwriting it. Done once, guarded, so a
-- re-run does not overwrite the kept value with the aligned one.
update public.vouchers
   set approved_recorded_at = approved_at
 where approved_recorded_at is null
   and approved_at is not null;

-- Now align the date an approved voucher carries.
update public.vouchers
   set approved_at = voucher_date::timestamptz
 where status = 'Approved'
   and approved_at is not null
   and approved_at::date <> voucher_date;

-- Vouchers that are approved but somehow carry no timestamp at all: give them
-- their own date rather than leaving the signature line blank.
update public.vouchers
   set approved_at = voucher_date::timestamptz
 where status = 'Approved'
   and approved_at is null;

-- Anything not approved must not claim to be approved.
update public.vouchers
   set approved_at = null
 where status <> 'Approved';


-- ---------------------------------------------------------------------------
--  3. Keep it that way for future rows.
-- ---------------------------------------------------------------------------
--  A trigger, so the rule holds for the composer, the bulk importer and any
--  hand-made request alike.

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
    -- The business date on the voucher is what gets shown, so keep the two equal.
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


-- ---------------------------------------------------------------------------
--  4. Verify.
-- ---------------------------------------------------------------------------

\echo ''
\echo '--- after: no approved voucher should have a mismatched date ---'
select
  coalesce(c.name, 'Unassigned') as branch,
  count(*) filter (where v.approved_at is not null
                     and v.approved_at::date <> v.voucher_date) as still_differing,
  count(*) filter (where v.approved_at is null and v.status = 'Approved') as approved_but_blank,
  count(*) filter (where v.approved_at is not null and v.status <> 'Approved') as not_approved_but_dated,
  count(*) filter (where v.approved_recorded_at is not null) as original_timestamp_kept
  from public.vouchers v
  left join public.companies c on c.id = v.company_id
 group by 1
 order by 1;

\echo ''
\echo '--- total: every line above should be zero except the last ---'
select
  count(*) filter (where v.approved_at is not null
                     and v.approved_at::date <> v.voucher_date) as still_differing,
  count(*) filter (where v.approved_at is null and v.status = 'Approved') as approved_but_blank,
  count(*) filter (where v.approved_at is not null and v.status <> 'Approved') as not_approved_but_dated,
  count(*) filter (where v.approved_recorded_at is not null) as original_timestamp_kept,
  count(*) as total_vouchers
  from public.vouchers v;

\echo ''
\echo '--- a sample, to eyeball ---'
select voucher_no, voucher_date, status, approved_at, approved_recorded_at
  from public.vouchers
 where approved_recorded_at is not null
 order by voucher_date
 limit 10;

-- Troubleshooting
--
-- * still_differing above zero after running. That should be impossible; if it
--   happens, a later update reintroduced a mismatch. Re-run the script.
--
-- * approved_but_blank above zero. Re-run section 2; it fills these from the
--   voucher's own date.
--
-- * To see the true approval times rather than the business dates:
--
--     select voucher_no, voucher_date, approved_at, approved_recorded_at
--       from public.vouchers
--      where approved_recorded_at is not null
--      order by approved_recorded_at desc;