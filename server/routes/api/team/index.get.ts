import { defineHandler } from "nitro";
import { createError } from "nitro/h3";
import { database, readSession } from "../../../utils/auth";

export default defineHandler(async (event) => {
  const session = readSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "Authentication required." });

  const pool = database();
  const [members, departments] = await Promise.all([
    pool.query(
      `SELECT id, email, full_name AS "fullName", role,
              is_active AS "isActive",
              last_login_at AS "lastLoginAt"
       FROM users ORDER BY created_at`,
    ),
    pool.query(
      `SELECT d.id, d.name,
              (SELECT count(*)::int FROM vouchers v WHERE v.department_id = d.id) AS "voucherCount"
       FROM departments d ORDER BY d.name`,
    ),
  ]);

  const approverCount = members.rows.filter((m) => m.role === "approver" || m.role === "admin").length;

  return {
    members: members.rows,
    departments: departments.rows,
    stats: {
      memberCount: members.rows.length,
      departmentCount: departments.rows.length,
      approverCount,
    },
  };
});
