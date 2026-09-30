import { defineHandler } from "nitro";
import { createError } from "nitro/h3";
import { database, readSession } from "../../../utils/auth";

export default defineHandler(async (event) => {
  const session = readSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "Authentication required." });

  const result = await database().query(
    `SELECT d.id, d.name, d.description,
            (SELECT count(*)::int FROM vouchers v WHERE v.department_id = d.id) AS "voucherCount"
     FROM departments d
     ORDER BY d.name`,
  );
  return { departments: result.rows };
});
