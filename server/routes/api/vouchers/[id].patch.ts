import { defineHandler } from "nitro";
import { createError, readBody } from "nitro/h3";
import { database, readSession } from "../../../utils/auth";

export default defineHandler(async (event) => {
  const session = readSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "Authentication required." });
  if (!["admin", "approver"].includes(session.role)) {
    throw createError({ statusCode: 403, statusMessage: "Only admins or approvers can approve vouchers." });
  }

  const id = String(event.context.params?.id || "");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Voucher id is required." });

  const body = (await readBody<{ action?: string }>(event)) || {};
  if (body.action !== "approve") throw createError({ statusCode: 400, statusMessage: "Unsupported action." });

  const result = await database().query(
    `UPDATE vouchers
     SET status = 'Approved', approved_by = $2, approved_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'Pending approval'
     RETURNING id, voucher_no AS "voucherNo", status`,
    [id, session.id],
  );

  if (!result.rows[0]) {
    throw createError({ statusCode: 404, statusMessage: "Voucher not found or already approved." });
  }
  return { voucher: result.rows[0] };
});
