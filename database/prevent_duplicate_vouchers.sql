-- ============================================================================
--  Stop the same payment being entered twice
-- ============================================================================
--
--  WHY NOT "ONE VOUCHER PER DATE"
--    Several payments are legitimately made on the same day. A company pays fuel,
--    a courier and airtime on the same morning. Enforcing one voucher per date
--    would block real payments, so it is not done here.
--
--  WHAT IS BLOCKED INSTEAD
--    The same invoice being paid twice, which is how a duplicate entry actually
--    happens. A voucher is a duplicate when the same branch records the same
--    reference, or the same payee for the same amount on the same day. Both are
--    almost never a coincidence.
--
--  This is a database constraint, so it holds however the row arrives: the
--  composer, the bulk importer, or a hand-made request.
--
--  HOW TO RUN
--    Supabase dashboard > SQL Editor > paste > Run.
--
--    READ find_duplicate_vouchers.sql FIRST. If your ledger already contains
--    duplicates, this script will refuse to install the index and will tell you
--    how many it found. Clear those first, or this step will not proceed.
--
--  WHAT THIS CHANGES
--    vouchers.reference gets a per-branch unique index, where it already carries
--    a value. Blank references stay allowed, and many times because most vouchers
--    have none.
-- ============================================================================


-- ---------------------------------------------------------------------------
--  1. Find the conflicts first. Read-only.
-- ---------------------------------------------------------------------------
-- === duplicates that would block the change ===
select
  coalesce(c.name, 'Unassigned') as branch,
  lower(trim(v.paid_to)) as payee,
  v.amount,
  v.voucher_date,
  count(*) as copies,
  string_agg(v.voucher_no, ', ' order by v.voucher_no) as vouchers
  from public.vouchers v
  left join public.companies c on c.id = v.company_id
 group by 1, 2, 3, 4
having count(*) > 1;


-- ---------------------------------------------------------------------------
--  2. Install the guard, but only if the data is clean.
-- ---------------------------------------------------------------------------
do $$
declare
  conflicts int;
  ref_conflicts int;
  la uuid;
begin
  -- Looked up into a local variable rather than referenced inline: a bare column
  -- name inside these subqueries would be ambiguous with the outer SELECT.
  select id into la from public.companies where code = 'LA';
  if la is null then
    raise exception 'No branch with code LA found. Run database/multi_company_setup.sql first.';
  end if;

  -- Case-insensitive, trimmed, within one branch. The same invoice twice.
  select count(*) into ref_conflicts
    from (
      select coalesce(company_id, (select id from public.companies where code = 'LA'))
        from public.vouchers
       where reference is not null
         and trim(reference) <> ''
       group by 1, lower(trim(reference))
      having count(*) > 1
    ) repeated;

  -- Same payee, same amount, same day, within one branch.
  select count(*) into conflicts
    from (
      select coalesce(company_id, (select id from public.companies where code = 'LA'))
        from public.vouchers
       group by 1, lower(trim(paid_to)), amount, voucher_date
      having count(*) > 1
    ) repeated;

  if ref_conflicts > 0 then
    raise exception
      'Stopped: % invoice reference(s) are already used more than once in the same branch. See find_duplicate_vouchers.sql. Re-run this script once they are cleared.', ref_conflicts;
  end if;

  if conflicts > 0 then
    raise exception
      'Stopped: % payee/amount/date combination(s) already repeat in the same branch. See find_duplicate_vouchers.sql. Re-run this script once they are cleared.', conflicts;
  end if;

  raise notice 'No duplicates found, installing the guard.';

  -- One invoice per branch. A partial index, so vouchers with no reference are
  -- unaffected and there is no limit on how many blanks there may be.
  --
  -- Built with execute because plpgsql does not substitute variables into
  -- utility commands, and a subquery is not allowed inside an index expression,
  -- so the branch id has to come from the variable.
  execute format(
    'create unique index if not exists uniq_vouchers_reference_per_branch on public.vouchers (coalesce(company_id, %L), lower(trim(reference))) where reference is not null and trim(reference) <> ''''',
    la
  );

  -- A trigger for the same-amount-same-day case, because that involves four
  -- columns and needs a readable error message rather than a bare index violation.
  create or replace function public.vouchers_block_duplicate_payment()
  returns trigger
  language plpgsql
  as $fn$
  declare
    branch uuid := coalesce(new.company_id, (select id from public.companies where code = 'LA'));
    clash  text;
  begin
    select v.voucher_no into clash
      from public.vouchers v
     where v.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
       and coalesce(v.company_id, (select id from public.companies where code = 'LA')) = branch
       and lower(trim(v.paid_to)) = lower(trim(new.paid_to))
       and v.amount = new.amount
       and v.voucher_date = new.voucher_date
     limit 1;

    if clash is not null then
      raise exception
        'A voucher for % of % on % already exists (%). Check the date and amount, or change one of them if this really is a separate payment.',
        new.paid_to, new.amount, new.voucher_date, clash
        using errcode = '23505';
    end if;

    return new;
  end;
  $fn$;

  drop trigger if exists trg_vouchers_block_duplicate on public.vouchers;
  create trigger trg_vouchers_block_duplicate
    before insert or update of amount, paid_to, voucher_date, company_id
      on public.vouchers
      for each row execute function public.vouchers_block_duplicate_payment();

  raise notice 'Done. One invoice per branch, and no repeat of the same payee and amount on the same day.';
end;
$$;


-- ---------------------------------------------------------------------------
--  3. Verify.
-- ---------------------------------------------------------------------------

-- --- the index exists? ---
-- pg_indexes has no indexrelid; join through pg_class and pg_index instead.
select c.relname as index_name, pg_get_indexdef(i.indexrelid) as definition
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
 where i.indrelid = 'public.vouchers'::regclass
   and c.relname = 'uniq_vouchers_reference_per_branch';

-- --- the trigger exists? ---
select tgname, tgenabled
  from pg_trigger
 where tgrelid = 'public.vouchers'::regclass
   and not tgisinternal
   and tgname = 'trg_vouchers_block_duplicate';

-- Test it: this SHOULD fail with a message about the existing voucher.
-- select paid_to, amount, voucher_date, company_id, reference
--   from public.vouchers limit 1;
-- then try inserting a copy of that row. It should be refused.

-- Troubleshooting
--
-- * "Stopped: N invoice reference(s)..." means the ledger already has duplicates.
--   Run find_duplicate_vouchers.sql, delete or renumber the ones that are wrong,
--   then re-run this script.
--
-- * Someone genuinely needs to pay the same amount to the same payee twice on
--   one day, say two fuel runs. The trigger will refuse it. Give one of them a
--   different reference and an amount that reflects the actual payment; the
--   reference index alone will not catch it, so the trigger is the part to
--   think about.
--
-- * To remove the guard later:
--
--     drop index if exists public.uniq_vouchers_reference_per_branch;
--     drop trigger if exists trg_vouchers_block_duplicate on public.vouchers;