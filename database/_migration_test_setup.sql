-- Scratch harness: a stand-in for the Supabase schema, so database/multi_company_setup.sql
-- can be executed and its policies verified locally. Throwaway test database only.

create schema if not exists auth;

-- Supabase provides auth.uid() from request.jwt.claims. Stubs that here so the
-- migration's policies can be exercised locally.
create schema if not exists "request";

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  created_at         timestamptz not null default now(),
  last_sign_in_at    timestamptz
);

create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text
);

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  role          text,
  department_id uuid references public.departments(id)
);

create table if not exists public.vouchers (
  id                 uuid primary key default gen_random_uuid(),
  voucher_no         text unique,
  voucher_date       date,
  amount             numeric(14,2),
  amount_paid_to     text,
  being_payment      text,
  prepared_by        uuid references public.profiles(id),
  prepared_by_name   text,
  approved_by        uuid references public.profiles(id),
  approved_by_name   text,
  approved_at        timestamptz,
  status             text default 'Pending approval',
  created_at         timestamptz not null default now()
);

-- Representative data across all three branches.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@longhorn-associates.com'),
  ('22222222-2222-2222-2222-222222222222', 'approvals@longhorn-associates.com'),
  ('33333333-3333-3333-3333-333333333333', 'finance@longhorn-associates.com'),
  ('44444444-4444-4444-4444-444444444444', 'lfs.preparer@longhornfinancial.co'),
  ('55555555-5555-5555-5555-555555555555', 'lfs.approver@longhornfinancial.co'),
  ('66666666-6666-6666-6666-666666666666', 'lib.preparer@longhorninsurance.co')
on conflict (id) do nothing;

insert into public.profiles (id, full_name, role) values
  ('11111111-1111-1111-1111-111111111111', 'Tezza Mutepeka',   'admin'),
  ('22222222-2222-2222-2222-222222222222', 'Izukanji Mwanza',  'approver'),
  ('33333333-3333-3333-3333-333333333333', 'Chanda Mulenga',   'preparer'),
  ('44444444-4444-4444-4444-444444444444', 'Naledi Phiri',     'preparer'),
  ('55555555-5555-5555-5555-555555555555', 'Bwalya Kabaso',    'approver'),
  ('66666666-6666-6666-6666-666666666666', 'Chileshe Mutale',  'preparer')
on conflict (id) do nothing;

insert into public.vouchers (voucher_no, voucher_date, amount, amount_paid_to, being_payment, prepared_by, prepared_by_name, approved_by, approved_by_name, status) values
  ('PV-26-0035', '2026-08-31', 2866.00, 'Petty Cash', 'Solwezi petty cash', '33333333-3333-3333-3333-333333333333', 'Chanda Mulenga', '22222222-2222-2222-2222-222222222222', 'Izukanji Mwanza', 'Approved'),
  ('PV-26-0034', '2026-08-29', 12450.00, 'Copperbelt Couriers', 'Logistics', '44444444-4444-4444-4444-444444444444', 'Naledi Phiri', null, null, 'Pending approval'),
  ('PV-26-0033', '2026-08-26', 3780.00, 'Lusaka Supplies', 'Stationery', '66666666-6666-6666-6666-666666666666', 'Chileshe Mutale', null, null, 'Pending approval')
on conflict (voucher_no) do nothing;