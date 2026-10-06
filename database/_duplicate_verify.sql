-- Proves the duplicate guard works, and that it does NOT block legitimate
-- payments.
--
-- The distinction matters: a duplicate is the same invoice paid twice, not two
-- payments made on the same day. A company pays fuel, a courier and airtime on
-- one morning without any of that being a mistake.
\set ON_ERROR_STOP on
\pset pager off

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;
grant usage on schema public, auth to authenticated;

-- The columns the real ledger has and the test harness omits.
alter table public.vouchers add column if not exists paid_to text;
alter table public.vouchers add column if not exists being_payment text;
alter table public.vouchers add column if not exists reference text;

create or replace function public.clear_claim() returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', '', false);
end
$fn$;
grant execute on function public.clear_claim() to authenticated;

\echo ''
\echo '=== 0. With duplicates present, the guard must refuse to install ==='
-- find_duplicate_vouchers.sql reports them; prevent_duplicate_vouchers.sql then
-- stops. Asserted in the runner rather than here, because this file runs after.

-- The installer deliberately raises when it finds duplicates. Let psql carry on
-- past that one error so this file still gets to run its assertions, then check
-- that nothing was installed.
\set ON_ERROR_STOP off
\o dup_guard_output.txt
\i prevent_duplicate_vouchers.sql
\o
\set ON_ERROR_STOP on

do $$
begin
  if exists (select 1 from pg_class c
              join pg_index i on i.indexrelid = c.oid
             where c.relname = 'uniq_vouchers_reference_per_branch'
               and i.indrelid = 'public.vouchers'::regclass) then
    raise exception 'FAIL: the guard installed even though duplicates exist';
  end if;
  raise notice 'PASS: refused to install while duplicates remain';
end $$;

\echo ''
\echo '=== 1. Clear the duplicates, then install the guard ==='
delete from public.vouchers where voucher_no in ('D-0004', 'D-0005');
\set ON_ERROR_STOP on
\o dup_guard_output.txt
\i prevent_duplicate_vouchers.sql
\o
do $$
begin
  if not exists (select 1 from pg_class c
                  join pg_index i on i.indexrelid = c.oid
                 where c.relname = 'uniq_vouchers_reference_per_branch'
                   and i.indrelid = 'public.vouchers'::regclass) then
    raise exception 'FAIL: the guard did not install once the data was clean';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.vouchers'::regclass
                   and tgname = 'trg_vouchers_block_duplicate') then
    raise exception 'FAIL: the duplicate trigger did not install';
  end if;
  raise notice 'PASS: guard installed';
end $$;

\echo ''
\echo '=== 2. Several payments on one date must still be allowed ==='
do $$
begin
  -- Three different payees, three different amounts, same day.
  insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, reference, company_id, prepared_by, status)
  values ('G-0001','2026-04-10',1500,'Lusaka Fuel','Fuel','REF-A',(select id from public.companies where code='LA'),'33333333-3333-3333-3333-333333333333','Pending approval');
  insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, reference, company_id, prepared_by, status)
  values ('G-0002','2026-04-10',2300,'Copperbelt Couriers','Courier','REF-B',(select id from public.companies where code='LA'),'33333333-3333-3333-3333-333333333333','Pending approval');
  insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, reference, company_id, prepared_by, status)
  values ('G-0003','2026-04-10',890,'Airtime','Airtime','REF-C',(select id from public.companies where code='LA'),'33333333-3333-3333-3333-333333333333','Pending approval');
  raise notice 'PASS: three payments on one date accepted';
end $$;

\echo ''
\echo '=== 3. The same invoice reference must be refused ==='
do $$
begin
  insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, reference, company_id, prepared_by, status)
  values ('G-0004','2026-04-20',1500,'Lusaka Fuel','Fuel','REF-A',(select id from public.companies where code='LA'),'33333333-3333-3333-3333-333333333333','Pending approval');
  raise exception 'FAIL: the same invoice reference was accepted twice';
exception when unique_violation then
  raise notice 'PASS: duplicate invoice reference refused';
end $$;

\echo ''
\echo '=== 4. The same payee and amount on the same day must be refused ==='
do $$
begin
  insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, reference, company_id, prepared_by, status)
  values ('G-0005','2026-04-10',1500,'Lusaka Fuel','Fuel','REF-D',(select id from public.companies where code='LA'),'33333333-3333-3333-3333-333333333333','Pending approval');
  raise exception 'FAIL: the same payee and amount on one day was accepted twice';
exception when unique_violation then
  raise notice 'PASS: duplicate payment refused';
end $$;

\echo ''
\echo '=== 5. The same amount on a DIFFERENT day is fine ==='
do $$
begin
  insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, reference, company_id, prepared_by, status)
  values ('G-0006','2026-04-15',1500,'Lusaka Fuel','Fuel monthly','REF-E',(select id from public.companies where code='LA'),'33333333-3333-3333-3333-333333333333','Pending approval');
  raise notice 'PASS: same amount on another date accepted';
exception when unique_violation then
  raise exception 'FAIL: a legitimate repeat payment was blocked';
end $$;

\echo ''
\echo '=== 6. The same reference in ANOTHER branch is fine ==='
do $$
begin
  insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, reference, company_id, prepared_by, status)
  values ('G-0007','2026-04-10',1500,'Lusaka Fuel','Fuel','REF-A',(select id from public.companies where code='LFS'),'44444444-4444-4444-4444-444444444444','Pending approval');
  raise notice 'PASS: same invoice reference in a different branch accepted';
exception when unique_violation then
  raise exception 'FAIL: branches are not independent for references';
end $$;

\echo ''
\echo '=== 7. Vouchers with NO reference are unaffected ==='
do $$
begin
  insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, reference, company_id, prepared_by, status)
  values ('G-0008','2026-04-10',400,'Petty Cash','Top up',NULL,(select id from public.companies where code='LA'),'33333333-3333-3333-3333-333333333333','Pending approval');
  insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, reference, company_id, prepared_by, status)
  values ('G-0009','2026-04-11',400,'Petty Cash','Top up',NULL,(select id from public.companies where code='LA'),'33333333-3333-3333-3333-333333333333','Pending approval');
  raise notice 'PASS: blank references accepted, no false positives';
exception when unique_violation then
  raise exception 'FAIL: blank references were wrongly blocked';
end $$;

\echo ''
\echo '=== 8. Re-running the installer is safe ==='
\set ON_ERROR_STOP on
\o dup_guard_output.txt
\i prevent_duplicate_vouchers.sql
\o
do $$
begin
  if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                   where i.indrelid = 'public.vouchers'::regclass
                     and c.relname = 'uniq_vouchers_reference_per_branch') then
    raise exception 'FAIL: the index disappeared on a re-run';
  end if;
  raise notice 'PASS: idempotent';
end $$;

delete from public.vouchers where voucher_no like 'G-%';

\echo ''
\echo 'DUPLICATE-GUARD CHECKS COMPLETE'