-- ============================================================================
--  CURRENT: Make a voucher's department be the branch that raised it
-- ============================================================================
--
--  USE THIS FILE. It is safe to run more than once.
--
--  THE PROBLEM
--    Every voucher reads "General" under Department. All 780 of them, including
--    the Longhorn Associates ones that should say "Longhorn Associates".
--
--    Two columns were both claiming to hold the branch:
--
--      vouchers.company_id     the branch, which is what the app actually
--                             trusts: branch filters, row-level security and
--                             the approver list all read it
--      vouchers.department_id  pointed at a row called "General", because the
--                             bulk import defaulted every unrecognised value to
--                             it, and the composer forced departments[0]
--
--    company_id was correct the whole time. company_id is what this file reads,
--    and the app now reads it too, so the two cannot disagree again.
--
--  WHAT THIS CHANGES
--    1. A department row per branch, named exactly as the branch.
--    2. vouchers.department_id repointed from "General" to the voucher's own
--       branch, so the stored data agrees with what the app shows and any export
--       taken outside the app reads correctly.
--
--  NOTHING ELSE MOVES
--    company_id is not changed by this file. The voucher number, amount, dates,
--    approval and branch are all untouched.
--
--  HOW TO RUN
--    Supabase dashboard > SQL Editor > paste the WHOLE file > Run.
-- ============================================================================


-- ---------------------------------------------------------------------------
--  1. Before. Read-only. Shows what is reading "General" and what the branch
--     actually is, so you can see the gap before changing anything.
-- ---------------------------------------------------------------------------

-- === department on the voucher vs the branch it belongs to ===
select
  coalesce(d.name, '(none)')            as department_says,
  coalesce(c.name, '(no branch)')       as branch_actually_is,
  count(*)                             as vouchers
  from public.vouchers v
  left join public.departments d on d.id = v.department_id
  left join public.companies   c on c.id = v.company_id
 group by 1, 2
 order by 3 desc;

-- === how many still read "General" ===
select
  count(*) filter (where d.name = 'General')  as reading_general,
  count(*) filter (where d.name is not distinct from c.name) as already_correct,
  count(*) filter (where v.company_id is null)              as no_branch_set,
  count(*)                                          as total
  from public.vouchers v
  left join public.departments d on d.id = v.department_id
  left join public.companies   c on c.id = v.company_id;

-- === the branches that should have a department row of their own ===
select code, name, is_active
  from public.companies
 order by code;


-- ---------------------------------------------------------------------------
--  2. Give every branch a department row named after it.
-- ---------------------------------------------------------------------------
--  departments.name is unique, so this is safe to re-run. An existing row is
--  left alone rather than overwritten, since it may already be in use.

insert into public.departments (name, description)
select c.name, coalesce(c.description, c.name || ' branch')
  from public.companies c
 where c.is_active
   and not exists (select 1 from public.departments d where d.name = c.name)
on conflict (name) do nothing;

-- === department rows named after a branch (expect one per active branch) ===
select d.name
  from public.departments d
  join public.companies c on c.name = d.name
 order by c.code;


-- ---------------------------------------------------------------------------
--  3. Repoint each voucher's department at its own branch.
-- ---------------------------------------------------------------------------
--  Only rows that disagree are touched, so re-running changes nothing.

update public.vouchers v
   set department_id = d.id
  from public.companies   c
  join public.departments d on d.name = c.name
 where v.company_id = c.id
   and v.department_id is distinct from d.id;


-- ---------------------------------------------------------------------------
--  4. Keep it that way, so a later import cannot put "General" back.
-- ---------------------------------------------------------------------------
--  A trigger rather than app-side code, because the bulk importer is the thing
--  that caused this and it writes in large batches from a spreadsheet. RLS
--  already decides which branch a row may be written for, so this only mirrors
--  the branch already chosen for the row.

create or replace function public.vouchers_stamp_branch_department()
returns trigger
language plpgsql
as $fn$
declare
  branch_name text;
  target_id   uuid;
begin
  if new.company_id is null then
    return new;
  end if;

  select c.name into branch_name from public.companies c where c.id = new.company_id;

  if branch_name is null then
    return new;
  end if;

  -- Create the branch's department row on demand, so this works even on a
  -- database where the branch was added after this file was first run.
  select d.id into target_id from public.departments d where d.name = branch_name;

  if target_id is null then
    insert into public.departments (name, description)
    values (branch_name, branch_name || ' branch')
    on conflict (name) do nothing;
    select d.id into target_id from public.departments d where d.name = branch_name;
  end if;

  if target_id is not null then
    new.department_id := target_id;
  end if;

  return new;
end
$fn$;

drop trigger if exists trg_vouchers_stamp_branch_department on public.vouchers;
create trigger trg_vouchers_stamp_branch_department
  before insert or update of company_id, department_id
    on public.vouchers
    for each row execute function public.vouchers_stamp_branch_department();


-- ---------------------------------------------------------------------------
--  5. Verify. Both counts should be zero.
-- ---------------------------------------------------------------------------

-- === after: does the department now match the branch? ===
select
  coalesce(d.name, '(none)')      as department_now,
  coalesce(c.name, '(no branch)') as branch_is,
  count(*)                        as vouchers
  from public.vouchers v
  left join public.departments d on d.id = v.department_id
  left join public.companies   c on c.id = v.company_id
 group by 1, 2
 order by 3 desc;

select
  count(*) filter (where d.name = 'General')  as still_reading_general,
  count(*) filter (where v.company_id is not null
                     and d.name is distinct from c.name) as disagreeing_with_branch,
  count(*)                                    as total
  from public.vouchers v
  left join public.departments d on d.id = v.department_id
  left join public.companies   c on c.id = v.company_id;

-- === Longhorn Associates, as you will see it in the app ===
select v.voucher_no, v.voucher_date, c.name as department, v.status
  from public.vouchers v
  join public.companies c on c.id = v.company_id
 where c.code = 'LA'
 order by v.voucher_date desc
 limit 10;

-- Troubleshooting
--
-- * still_reading_general above zero. A voucher is pointed at a row called
--   "General" that the trigger could not replace, most likely because its
--   company_id is null. Find it:
--
--       select v.voucher_no, v.company_id, d.name
--         from public.vouchers v
--         left join public.departments d on d.id = v.department_id
--        where v.company_id is null;
--
-- * Undo, putting "General" back on everything this file touched:
--
--       update public.vouchers v
--          set department_id = (select id from public.departments where name = 'General')
--         where v.company_id is not null;
--       drop trigger if exists trg_vouchers_stamp_branch_department on public.vouchers;
