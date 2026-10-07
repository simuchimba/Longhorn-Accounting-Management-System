-- Proves a voucher's department becomes the branch that raised it.
--
-- Every voucher used to read "General", because two columns were both claiming
-- to hold the branch: vouchers.company_id, which the app trusts and which was
-- correct all along, and vouchers.department_id, which the bulk import pointed
-- at a placeholder row. This check reproduces that state, then proves the fix
-- resolves it and cannot drift back.
\set ON_ERROR_STOP on
\pset pager off

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;
grant usage on schema public, auth to authenticated;

alter table public.vouchers add column if not exists paid_to text;
alter table public.vouchers add column if not exists being_payment text;
alter table public.vouchers add column if not exists reference text;
alter table public.vouchers add column if not exists department_id uuid references public.departments(id);

insert into auth.users (id, email) values ('aaaa1111-1111-1111-1111-111111111111', 'a@x.com') on conflict (id) do nothing;
insert into public.profiles (id, full_name, role, company_id)
values ('aaaa1111-1111-1111-1111-111111111111', 'Tezza', 'admin', (select id from public.companies where code = 'LA'))
on conflict (id) do nothing;

-- The placeholder every voucher was given.
insert into public.departments (name, description)
values ('General', 'Default department')
on conflict (name) do nothing;

-- The shape of the real ledger: a batch import where everything landed on
-- "General" while company_id was correct on every row.
insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, company_id, prepared_by, prepared_by_name, status, department_id)
select
  'IMP-' || lpad(g::text, 4, '0'),
  date '2026-01-05' + ((g - 1) * 3),
  100 * g,
  'Payee ' || g,
  'Imported',
  (select id from public.companies where code = 'LA'),
  'aaaa1111-1111-1111-1111-111111111111',
  'Tezza',
  'Approved',
  (select id from public.departments where name = 'General')
from generate_series(1, 780) g
on conflict (voucher_no) do nothing;

\echo ''
\echo '=== 1. Before: the reported problem ==='
select
  count(*) filter (where d.name = 'General')  as reading_general,
  count(*) filter (where c.name is not null and d.name is distinct from c.name) as disagreeing_with_branch,
  count(*)                                    as total
  from public.vouchers v
  left join public.departments d on d.id = v.department_id
  left join public.companies   c on c.id = v.company_id;
do $$
declare n int;
begin
  select count(*) into n from public.vouchers v
    join public.departments d on d.id = v.department_id
   where d.name = 'General';
  if n = 0 then
    raise exception 'FAIL: the fixture did not reproduce the bug, so this check proves nothing';
  end if;
  raise notice 'reproduced: % voucher(s) read General', n;
end $$;

\echo ''
\echo '=== 2. Run the fix ==='
\o department_output.txt
\i fix_voucher_department.sql
\o

\echo ''
\echo '=== 3. After: every department names its own branch ==='
select
  count(*) filter (where d.name = 'General')  as still_reading_general,
  count(*) filter (where c.name is not null and d.name is distinct from c.name) as disagreeing_with_branch,
  count(*)                                    as total
  from public.vouchers v
  left join public.departments d on d.id = v.department_id
  left join public.companies   c on c.id = v.company_id;
do $$
declare n int;
begin
  select count(*) into n from public.vouchers v
    join public.departments d on d.id = v.department_id
   where d.name = 'General';
  if n > 0 then
    raise exception 'FAIL: % voucher(s) still read General', n;
  end if;
  raise notice 'PASS: no voucher reads General';
end $$;

-- The user's specific ask: the Longhorn Associates rows must say so.
do $$
declare n int;
begin
  select count(*) into n
    from public.vouchers v
    join public.companies   c on c.id = v.company_id
    join public.departments d on d.id = v.department_id
   where c.code = 'LA' and d.name = 'Longhorn Associates';
  -- One more than the batch, because multi_company_setup.sql seeds a Longhorn
  -- Associates voucher of its own.
  if n <> 781 then
    raise exception 'FAIL: expected 781 Longhorn Associates vouchers, got %', n;
  end if;
  raise notice 'PASS: all % Longhorn Associates vouchers read Longhorn Associates', n;
end $$;

\echo ''
\echo '=== 4. Each branch has a department row of its own ==='
do $$
declare missing text;
begin
  select string_agg(c.name, ', ') into missing
    from public.companies c
   where c.is_active
     and not exists (select 1 from public.departments d where d.name = c.name);
  if missing is not null then
    raise exception 'FAIL: no department row for %', missing;
  end if;
  raise notice 'PASS: every active branch has one';
end $$;

\echo ''
\echo '=== 5. A voucher cannot be stamped with the wrong branch ==='
do $$
declare got text; branch text;
begin
  insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, company_id, prepared_by, status, department_id)
  values ('CHK-01', '2026-09-30', 500, 'Payee', 'Purpose',
          (select id from public.companies where code = 'LFS'),
          'aaaa1111-1111-1111-1111-111111111111', 'Pending approval',
          (select id from public.departments where name = 'General'));

  select d.name, c.name into got, branch
    from public.vouchers v
    join public.departments d on d.id = v.department_id
    join public.companies   c on c.id = v.company_id
   where v.voucher_no = 'CHK-01';

  if got <> branch then
    raise exception 'FAIL: a Longhorn Financial Services voucher was stamped %', got;
  end if;
  raise notice 'PASS: stamped % to match its branch', got;
end $$;

\echo ''
\echo '=== 6. A branch with no department row yet still works ==='
do $$
declare got text;
begin
  insert into public.companies (name, code, description, color)
  values ('Longhorn Capital', 'LCA', 'New arm', '#8e65a5') on conflict (code) do nothing;

  insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, company_id, prepared_by, status, department_id)
  values ('CHK-02', '2026-09-30', 500, 'Payee', 'Purpose',
          (select id from public.companies where code = 'LCA'),
          'aaaa1111-1111-1111-1111-111111111111', 'Pending approval', null);

  select d.name into got
    from public.vouchers v
    join public.departments d on d.id = v.department_id
   where v.voucher_no = 'CHK-02';

  if got <> 'Longhorn Capital' then
    raise exception 'FAIL: a brand-new branch got %', coalesce(got, 'nothing');
  end if;
  raise notice 'PASS: the department row was created on demand';
end $$;

\echo ''
\echo '=== 7. A voucher with no branch is left alone, not guessed at ==='
do $$
declare
  before_id uuid;
  after_id  uuid;
begin
  insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, prepared_by, status, department_id)
  values ('CHK-03', '2026-09-30', 500, 'Payee', 'Purpose',
          'aaaa1111-1111-1111-1111-111111111111', 'Pending approval',
          (select id from public.departments where name = 'General'));

  select department_id into before_id from public.vouchers where voucher_no = 'CHK-03';
  update public.vouchers set status = 'Draft' where voucher_no = 'CHK-03';
  select department_id into after_id from public.vouchers where voucher_no = 'CHK-03';

  if after_id is distinct from before_id then
    raise exception 'FAIL: a branchless voucher had its department rewritten';
  end if;
  raise notice 'PASS: left as it was, because there is no branch to infer';
end $$;

\echo ''
\echo '=== 8. Re-running changes nothing ==='
\o department_output.txt
\i fix_voucher_department.sql
\o
do $$
declare n int;
begin
  select count(*) into n
    from public.vouchers v
    join public.companies   c on c.id = v.company_id
    join public.departments d on d.id = v.department_id
   where d.name is distinct from c.name;
  if n > 0 then raise exception 'FAIL: second run left % row(s) disagreeing', n; end if;
  raise notice 'PASS: idempotent';
end $$;

delete from public.vouchers where voucher_no like 'IMP-%' or voucher_no like 'CHK-%';

\echo ''
\echo 'DEPARTMENT CHECKS COMPLETE'
