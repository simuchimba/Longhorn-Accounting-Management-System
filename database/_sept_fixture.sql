-- Fixture reproducing the reported problem: vouchers created in September whose
-- approval date landed in October, plus back-dated and same-day cases.
insert into public.vouchers (voucher_no, voucher_date, amount, paid_to, being_payment, reference, company_id, prepared_by, prepared_by_name, status, approved_by, approved_by_name, approved_at, created_at)
values
 -- Created and dated September, approved in October. The reported problem.
 ('SEP-0001','2026-09-03',1500,'Lusaka Fuel','Fuel','S-01',(select id from public.companies where code='LA'),
  '33333333-3333-3333-3333-333333333333','Chanda Mulenga','Approved',
  '22222222-2222-2222-2222-222222222222','Izukanji Mwanza','2026-10-06 09:15:00+00','2026-09-03 08:05:00+00'),
 ('SEP-0002','2026-09-18',2300,'Copperbelt Couriers','Courier','S-02',(select id from public.companies where code='LA'),
  '33333333-3333-3333-3333-333333333333','Chanda Mulenga','Approved',
  '22222222-2222-2222-2222-222222222222','Izukanji Mwanza','2026-10-06 09:15:00+00','2026-09-18 14:22:00+00'),
 ('SEP-0003','2026-09-30',890,'Airtime','Airtime','S-03',(select id from public.companies where code='LA'),
  '33333333-3333-3333-3333-333333333333','Chanda Mulenga','Approved',
  '22222222-2222-2222-2222-222222222222','Izukanji Mwanza','2026-10-06 09:15:00+00','2026-09-30 16:40:00+00'),
 -- Dated August but entered in September. The case where the two differ.
 ('LATE-0001','2026-08-25',4000,'Consultant','August work',NULL,(select id from public.companies where code='LA'),
  '33333333-3333-3333-3333-333333333333','Chanda Mulenga','Approved',
  '22222222-2222-2222-2222-222222222222','Izukanji Mwanza','2026-09-02 11:00:00+00','2026-09-02 10:50:00+00'),
 -- Still awaiting approval. Must stay untouched.
 ('PEND-0001','2026-09-12',600,'Petty Cash','Top up',NULL,(select id from public.companies where code='LA'),
  '33333333-3333-3333-3333-333333333333','Chanda Mulenga','Pending approval',null,null,null,'2026-09-12 09:00:00+00')
on conflict (voucher_no) do nothing;