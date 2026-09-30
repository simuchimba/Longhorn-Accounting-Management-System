import { defineHandler } from "nitro";
import { createError, readBody } from "nitro/h3";
import { database, readSession } from "../../../utils/auth";

type CreateBody = {
  date?: string;
  amount?: number;
  currency?: string;
  paidTo?: string;
  beingPayment?: string;
  amountWords?: string;
  paymentMethod?: string;
  reference?: string;
  department?: string;
  departmentId?: string;
};

export default defineHandler(async (event) => {
  const session = readSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "Authentication required." });

  const body = (await readBody<CreateBody>(event)) || {};
  const date = String(body.date || "").slice(0, 10);
  const amount = Number(body.amount);
  const currency = String(body.currency || "ZMW").slice(0, 3);
  const paidTo = String(body.paidTo || "").trim();
  const beingPayment = String(body.beingPayment || "").trim();
  const paymentMethod = String(body.paymentMethod || "Bank transfer");
  const reference = String(body.reference || "").trim() || null;
  const amountWords = String(body.amountWords || "").trim() || `${amount} ${currency} Only`;

  if (!date || !amount || amount <= 0 || !paidTo || !beingPayment) {
    throw createError({ statusCode: 400, statusMessage: "Amount, payee, payment purpose and date are required." });
  }

  const pool = database();

  // Resolve department
  let departmentId = String(body.departmentId || "");
  if (!departmentId && body.department) {
    const found = await pool.query("SELECT id FROM departments WHERE name = $1", [body.department]);
    departmentId = found.rows[0]?.id || "";
  }
  if (!departmentId) throw createError({ statusCode: 400, statusMessage: "Valid department is required." });

  // Generate next voucher number: PV-YY-NNNN
  const yearSuffix = String(new Date(`${date}T00:00:00`).getFullYear()).slice(-2);
  const maxResult = await pool.query("SELECT MAX(CAST(split_part(voucher_no, '-', 3) AS INT)) AS max_no FROM vouchers");
  const nextNumber = Number(maxResult.rows[0]?.max_no || 0) + 1;
  const voucherNo = `PV-${yearSuffix}-${String(nextNumber).padStart(4, "0")}`;

  try {
    const result = await pool.query(
      `INSERT INTO vouchers (voucher_no, voucher_date, amount, currency, amount_in_words, amount_paid_to, being_payment, payment_method, reference, department_id, prepared_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Pending approval')
       RETURNING id, voucher_no AS "voucherNo"`,
      [voucherNo, date, amount, currency, amountWords, paidTo, beingPayment, paymentMethod, reference, departmentId, session.id],
    );
    return { voucher: result.rows[0] };
  } catch (error) {
    // Retry once on voucher_no race conflict
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      const retryMax = await pool.query("SELECT MAX(CAST(split_part(voucher_no, '-', 3) AS INT)) AS max_no FROM vouchers");
      const retryNo = `PV-${yearSuffix}-${String(Number(retryMax.rows[0]?.max_no || 0) + 1).padStart(4, "0")}`;
      const result = await pool.query(
        `INSERT INTO vouchers (voucher_no, voucher_date, amount, currency, amount_in_words, amount_paid_to, being_payment, payment_method, reference, department_id, prepared_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Pending approval')
         RETURNING id, voucher_no AS "voucherNo"`,
        [retryNo, date, amount, currency, amountWords, paidTo, beingPayment, paymentMethod, reference, departmentId, session.id],
      );
      return { voucher: result.rows[0] };
    }
    throw createError({ statusCode: 500, statusMessage: "Unable to create voucher." });
  }
});
