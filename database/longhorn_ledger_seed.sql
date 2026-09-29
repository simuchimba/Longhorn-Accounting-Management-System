-- Longhorn Ledger PostgreSQL schema + sample seed data
-- Run this entire file in pgAdmin Query Tool.
-- Sample sign-in credentials are listed at the bottom of this file.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'preparer', 'approver')),
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_no text NOT NULL UNIQUE,
  voucher_date date NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL DEFAULT 'ZMW',
  amount_in_words text NOT NULL,
  amount_paid_to text NOT NULL,
  being_payment text NOT NULL,
  payment_method text NOT NULL,
  reference text,
  department_id uuid NOT NULL REFERENCES departments(id),
  prepared_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'Pending approval' CHECK (status IN ('Draft', 'Pending approval', 'Approved')),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vouchers_voucher_date ON vouchers(voucher_date DESC);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);
CREATE INDEX IF NOT EXISTS idx_vouchers_department ON vouchers(department_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_reference ON vouchers(reference);

INSERT INTO departments (name, description) VALUES
  ('Finance', 'Financial controls, reporting and treasury'),
  ('Operations', 'Field operations and office administration'),
  ('Human Resources', 'People, staff welfare and travel'),
  ('Procurement', 'Supplier payments and purchasing'),
  ('Projects', 'Project delivery and programme costs')
ON CONFLICT (name) DO NOTHING;

-- Passwords are hashed with PostgreSQL pgcrypto's bcrypt implementation.
INSERT INTO users (email, password_hash, full_name, role) VALUES
  ('admin@longhorn-associates.com', crypt('Longhorn@2026', gen_salt('bf')), 'Tezza Mutepeka', 'admin'),
  ('approvals@longhorn-associates.com', crypt('Approve@2026', gen_salt('bf')), 'Izukanji Mwanza', 'approver'),
  ('finance@longhorn-associates.com', crypt('Finance@2026', gen_salt('bf')), 'Chanda Mulenga', 'preparer'),
  ('operations@longhorn-associates.com', crypt('Operations@2026', gen_salt('bf')), 'Naledi Phiri', 'preparer')
ON CONFLICT (email) DO NOTHING;

INSERT INTO vouchers (
  voucher_no, voucher_date, amount, currency, amount_in_words, amount_paid_to,
  being_payment, payment_method, reference, department_id, prepared_by, approved_by,
  status, prepared_at, approved_at
)
SELECT
  seed.voucher_no,
  seed.voucher_date::date,
  seed.amount,
  'ZMW',
  seed.amount_in_words,
  seed.amount_paid_to,
  seed.being_payment,
  seed.payment_method,
  seed.reference,
  department.id,
  preparer.id,
  approver.id,
  seed.status,
  seed.voucher_date::date + time '09:15',
  CASE WHEN seed.status = 'Approved' THEN seed.voucher_date::date + time '14:30' ELSE NULL END
FROM (VALUES
  ('PV-26-0035', '2026-08-31', 2866.00, 'Two Thousand Eight Hundred and Sixty Six Kwacha Only', 'Petty Cash', 'Solwezi petty cash replenishment', 'Petty cash', 'PC-SOL-0831', 'Operations', 'operations@longhorn-associates.com', 'approvals@longhorn-associates.com', 'Approved'),
  ('PV-26-0034', '2026-08-29', 12450.00, 'Twelve Thousand Four Hundred and Fifty Kwacha Only', 'Copperbelt Couriers Ltd', 'August logistics and delivery services', 'Bank transfer', 'INV-CCL-8821', 'Procurement', 'finance@longhorn-associates.com', 'approvals@longhorn-associates.com', 'Pending approval'),
  ('PV-26-0033', '2026-08-26', 3780.00, 'Three Thousand Seven Hundred and Eighty Kwacha Only', 'Lusaka Office Supplies', 'Stationery and print supplies', 'Mobile money', 'LOS-44109', 'Finance', 'finance@longhorn-associates.com', 'approvals@longhorn-associates.com', 'Approved'),
  ('PV-26-0032', '2026-08-22', 950.00, 'Nine Hundred and Fifty Kwacha Only', 'M. Kunda', 'Staff transport reimbursement', 'Petty cash', 'TR-0822-14', 'Human Resources', 'admin@longhorn-associates.com', 'approvals@longhorn-associates.com', 'Draft'),
  ('PV-26-0031', '2026-08-18', 8750.00, 'Eight Thousand Seven Hundred and Fifty Kwacha Only', 'Lusaka Power & Water', 'August utilities and service charges', 'Bank transfer', 'LPW-AUG-26', 'Operations', 'operations@longhorn-associates.com', 'approvals@longhorn-associates.com', 'Approved'),
  ('PV-26-0030', '2026-08-12', 2150.00, 'Two Thousand One Hundred and Fifty Kwacha Only', 'Mwamba Travel Services', 'Project site travel bookings', 'Bank transfer', 'MTS-7018', 'Projects', 'finance@longhorn-associates.com', 'approvals@longhorn-associates.com', 'Pending approval')
) AS seed(voucher_no, voucher_date, amount, amount_in_words, amount_paid_to, being_payment, payment_method, reference, department_name, preparer_email, approver_email, status)
JOIN departments department ON department.name = seed.department_name
JOIN users preparer ON preparer.email = seed.preparer_email
JOIN users approver ON approver.email = seed.approver_email
ON CONFLICT (voucher_no) DO NOTHING;

-- Sample accounts created by this file:
-- admin@longhorn-associates.com       / Longhorn@2026
-- approvals@longhorn-associates.com   / Approve@2026
-- finance@longhorn-associates.com     / Finance@2026
-- operations@longhorn-associates.com  / Operations@2026
