import { defineHandler } from "nitro";
import { createError, getQuery } from "nitro/h3";
import { database, readSession } from "../../../utils/auth";

export default defineHandler(async (event) => {
  const session = readSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "Authentication required." });

  const query = getQuery(event);
  const search = String(query.search || "").trim().toLowerCase();
  const status = String(query.status || "");
  const department = String(query.department || "");

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(lower(v.voucher_no) LIKE $${params.length} OR lower(v.amount_paid_to) LIKE $${params.length} OR lower(v.being_payment) LIKE $${params.length} OR lower(coalesce(v.reference, '')) LIKE $${params.length})`);
  }
  if (status && status !== "All statuses") {
    params.push(status);
    conditions.push(`v.status = $${params.length}`);
  }
  if (department && department !== "All departments") {
    params.push(department);
    conditions.push(`d.name = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await database().query(
    `SELECT v.id,
            v.voucher_no AS "voucherNo",
            to_char(v.voucher_date, 'YYYY-MM-DD') AS date,
            v.amount, v.currency,
            v.amount_paid_to AS "paidTo",
            v.being_payment AS "beingPayment",
            v.amount_in_words AS "amountWords",
            v.payment_method AS "paymentMethod",
            v.reference,
            d.name AS department,
            d.id AS "departmentId",
            prep.full_name AS "preparedBy",
            COALESCE(appr.full_name, '') AS "approvedBy",
            v.status
     FROM vouchers v
     JOIN departments d ON d.id = v.department_id
     JOIN users prep ON prep.id = v.prepared_by
     LEFT JOIN users appr ON appr.id = v.approved_by
     ${where}
     ORDER BY v.voucher_date DESC, v.created_at DESC
     LIMIT 500`,
    params,
  );

  return {
    vouchers: result.rows.map((row) => ({ ...row, amount: Number(row.amount) })),
  };
});
