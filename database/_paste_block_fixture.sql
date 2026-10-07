-- ---------------------------------------------------------------------------
-- Same effect as align_approval_dates.sql, without the read-only checks.
-- Kept out of the shipped files on purpose: one fix, one file, so there is never
-- any doubt about which one to run. This copy exists purely so the block can be
-- tested with ON_ERROR_STOP, the way the Supabase SQL Editor executes it.
-- ---------------------------------------------------------------------------

-- 1. Remove the trigger that has been undoing the fix.
drop trigger if exists trg_vouchers_approval_date on public.vouchers;
drop trigger if exists trg_vouchers_align_approval_date on public.vouchers;

-- 2. Keep the real approval time for the audit trail.
alter table public.vouchers
  add column if not exists approved_recorded_at timestamptz;

update public.vouchers
   set approved_recorded_at = approved_at
 where approved_recorded_at is null
   and approved_at is not null;

-- 3. The approval date becomes the date printed on the voucher.
update public.vouchers
   set approved_at = voucher_date::timestamptz
 where status = 'Approved'
   and approved_at is distinct from voucher_date::timestamptz;

update public.vouchers
   set approved_recorded_at = voucher_date::timestamptz
 where status = 'Approved'
   and approved_recorded_at is null;

update public.vouchers
   set approved_at = null
 where status <> 'Approved';

-- 4. Keep it true for every future approval.
create or replace function public.vouchers_align_approval_date()
returns trigger
language plpgsql
as $fn$
begin
  if new.status = 'Approved' then
    if new.approved_recorded_at is null then
      new.approved_recorded_at := now();
    end if;
    new.approved_at := new.voucher_date::timestamptz;
  else
    new.approved_at := null;
  end if;
  return new;
end
$fn$;

create trigger trg_vouchers_align_approval_date
  before insert or update of status, approved_at, voucher_date
    on public.vouchers
  for each row execute function public.vouchers_align_approval_date();

-- 5. Confirm.
select
  count(*)                                                  as approved_vouchers,
  count(*) filter (where approved_at::date = voucher_date)  as matching,
  count(*) filter (where approved_at::date <> voucher_date) as still_wrong
  from public.vouchers
 where status = 'Approved';
