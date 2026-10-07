-- ============================================================================
--  Finding duplicates in your existing vouchers
-- ============================================================================
--
--  Read-only. Reports where the same payee and amount recur, which is what
--  double-keying a payment looks like in practice.
--
--  HOW TO RUN
--    Supabase dashboard > SQL Editor > paste > Run. Changes nothing.
-- ============================================================================


-- ---------------------------------------------------------------------------
--  1. Same branch, date, payee and amount. The clearest double-entry.
-- ---------------------------------------------------------------------------
-- === Same date + payee + amount (likely double entries) ===
select
  coalesce(c.name, 'Unassigned') as branch,
  v.voucher_date,
  lower(trim(v.paid_to))    as payee,
  v.amount,
  count(*)                  as copies,
  string_agg(v.voucher_no, ', ' order by v.voucher_no) as voucher_numbers
  from public.vouchers v
  left join public.companies c on c.id = v.company_id
 group by 1, 2, 3, 4
having count(*) > 1
 order by copies desc, v.voucher_date desc;


-- ---------------------------------------------------------------------------
--  2. Same reference used more than once. Invoices should be unique.
-- ---------------------------------------------------------------------------
-- === Same reference used twice (one invoice paid twice) ===
select
  coalesce(c.name, 'Unassigned') as branch,
  trim(v.reference) as reference,
  count(*)          as copies,
  string_agg(v.voucher_no, ', ' order by v.voucher_no) as voucher_numbers,
  min(v.voucher_date) as first_date,
  max(v.voucher_date) as last_date
  from public.vouchers v
  left join public.companies c on c.id = v.company_id
 where v.reference is not null
   and trim(v.reference) <> ''
 group by 1, 2
having count(*) > 1
 order by copies desc;


-- ---------------------------------------------------------------------------
--  3. Same payee and amount on the same day, whatever the date column says.
-- ---------------------------------------------------------------------------
-- === Same payee + amount on one day, across all dates ===
select
  coalesce(c.name, 'Unassigned') as branch,
  lower(trim(v.paid_to)) as payee,
  v.amount,
  count(*)                as copies,
  string_agg(v.voucher_no || ' (' || v.voucher_date || ')', ', ' order by v.voucher_date) as vouchers
  from public.vouchers v
  left join public.companies c on c.id = v.company_id
 group by 1, 2, 3
having count(*) > 1
 order by copies desc, 3 desc;


-- ---------------------------------------------------------------------------
--  4. Just how many vouchers share a date. Context for the question.
-- ---------------------------------------------------------------------------
-- === How many vouchers per date (top 20) ===
select
  v.voucher_date,
  count(*) as vouchers,
  sum(v.amount) as total_value
  from public.vouchers v
 group by v.voucher_date
 order by vouchers desc, v.voucher_date desc
 limit 20;

-- === Distinct dates vs total vouchers ===
select
  count(*)                                        as total_vouchers,
  count(distinct voucher_date)                    as distinct_dates,
  round(count(*)::numeric / nullif(count(distinct voucher_date), 0), 1) as vouchers_per_date
  from public.vouchers;