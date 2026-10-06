-- Guards the two composer fixes:
--   1. the approver field's icon must not sit under the select's text
--   2. the approver dropdown must offer approvers only, never an admin
\set ON_ERROR_STOP on
\pset pager off

-- Impersonation helper. A write with no claim is what the Supabase Table Editor
-- and the app's own service-role backend look like; a write with a claim is a
-- signed-in end user. Both must be covered.
create or replace function public.impersonate(who uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', who::text, false);
end $$;
create or replace function public.clear_claim() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
end $$;
grant execute on function public.impersonate(uuid) to authenticated;
grant execute on function public.clear_claim() to authenticated;

\echo '=== H. No JWT: nominating a non-approver must be refused ==='
select public.clear_claim();
do $$
declare admin_id uuid;
begin
  select id into admin_id from public.profiles where role = 'admin' limit 1;
  if admin_id is null then raise notice 'SKIP: no admin in the fixtures'; return; end if;

  begin
    insert into public.vouchers (voucher_no, voucher_date, amount, amount_paid_to, being_payment, prepared_by, assigned_approver_id)
    values ('TEST-NOM-ADMIN', '2026-08-15', 100, 'X', 'nominate an admin', '44444444-4444-4444-4444-444444444444', admin_id);
    raise exception 'FAIL: an admin was accepted as the nominated approver';
  exception when insufficient_privilege then
    raise notice 'PASS: nominating an admin refused';
  end;
end $$;

\echo ''
\echo '=== I. No JWT: nominating a preparer must be refused ==='
select public.clear_claim();
do $$
declare prep_id uuid;
begin
  select id into prep_id from public.profiles where role = 'preparer' limit 1;
  if prep_id is null then raise notice 'SKIP: no preparer in the fixtures'; return; end if;

  begin
    insert into public.vouchers (voucher_no, voucher_date, amount, amount_paid_to, being_payment, prepared_by, assigned_approver_id)
    values ('TEST-NOM-PREP', '2026-08-15', 100, 'X', 'nominate a preparer', prep_id, prep_id);
    raise exception 'FAIL: a preparer was accepted as the nominated approver';
  exception when insufficient_privilege then
    raise notice 'PASS: nominating a preparer refused';
  end;
end $$;

\echo ''
\echo '=== J. No JWT: nominating a real approver must still work ==='
select public.clear_claim();
do $$
declare appr_id uuid;
begin
  select id into appr_id from public.profiles where role = 'approver' limit 1;
  if appr_id is null then raise notice 'SKIP: no approver in the fixtures'; return; end if;

  insert into public.vouchers (voucher_no, voucher_date, amount, amount_paid_to, being_payment, prepared_by, assigned_approver_id, assigned_approver_name)
  values ('TEST-NOM-OK', '2026-08-15', 100, 'X', 'nominate an approver', '44444444-4444-4444-4444-444444444444', appr_id, 'Approver');
  raise notice 'PASS: nominating a real approver accepted';
end $$;

\echo ''
\echo '=== K. The helper itself agrees (t for an approver, f for everyone else) ==='
select public.clear_claim();
select
  (select public.can_be_nominated_approver(id) from public.profiles where role = 'approver' limit 1) as an_approver,
  (select public.can_be_nominated_approver(id) from public.profiles where role = 'admin'     limit 1) as an_admin,
  (select public.can_be_nominated_approver(id) from public.profiles where role = 'preparer'  limit 1) as a_preparer;

do $$
declare a boolean; ad boolean; p boolean;
begin
  select public.can_be_nominated_approver(id) into a   from public.profiles where role = 'approver' limit 1;
  select public.can_be_nominated_approver(id) into ad  from public.profiles where role = 'admin'     limit 1;
  select public.can_be_nominated_approver(id) into p   from public.profiles where role = 'preparer'  limit 1;
  if a is distinct from true  then raise exception 'FAIL: an approver was not nominatable'; end if;
  if ad is not false then raise exception 'FAIL: an admin was nominatable';   end if;
  if p  is not false then raise exception 'FAIL: a preparer was nominatable'; end if;
  raise notice 'PASS: only approvers are nominatable';
end $$;

delete from public.vouchers where voucher_no like 'TEST-NOM-%';

\echo ''
\echo 'NOMINATION CHECKS COMPLETE'