-- Adds the columns the real ledger has but the test harness omits, so the
-- duplicate-finding queries can be exercised against realistic data.
alter table public.vouchers add column if not exists paid_to text;
alter table public.vouchers add column if not exists being_payment text;
alter table public.vouchers add column if not exists reference text;
-- department_id is how the real ledger records which branch raised a voucher.
-- The harness omits it, so the department checks cannot run without it.
alter table public.vouchers add column if not exists department_id uuid references public.departments(id);