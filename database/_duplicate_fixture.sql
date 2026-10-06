-- Fixture for the duplicate-guard check: two genuine duplicates, so the
-- installer must refuse on its first attempt. Cleared later by the check file.
insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, reference, company_id, prepared_by, status)
values
 ('D-0004', '2026-03-11', 1500, 'Lusaka Fuel', 'Fuel', 'INV-01',
  (select id from public.companies where code = 'LA'),
  '33333333-3333-3333-3333-333333333333', 'Approved'),
 ('D-0005', '2026-03-11', 1500, 'Lusaka Fuel', 'Fuel', 'INV-01',
  (select id from public.companies where code = 'LA'),
  '33333333-3333-3333-3333-333333333333', 'Approved');