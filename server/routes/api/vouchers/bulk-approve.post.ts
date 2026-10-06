import { defineHandler } from "nitro";
import { createError, readBody } from "nitro/h3";
import { getUserClient, readAccessToken, requireCaller } from "../../../utils/supabase";

type BulkBody = {
  ids?: string[];
  /** Optional guard: only approve vouchers dated inside this month (YYYY-MM). */
  month?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 100;

/**
 * Approves many vouchers in one go.
 *
 * An approver usually has a month of payments to clear, so this approves the
 * whole set in a single request rather than firing one update per row. It is
 * deliberately conservative about what it will touch:
 *
 *   - the caller must be an approver or admin, checked from their profile
 *   - only rows in `Pending approval` are affected, so an already-approved
 *     voucher cannot be re-stamped with a new approval time
 *   - `month`, when sent, narrows the update to that month as well, so a stale
 *     tab cannot approve a voucher that has since moved out of the chosen month
 *   - writes go through the caller's own Supabase session, so row level security
 *     still applies on top of the checks above
 *
 * Anything that no longer qualifies is reported back in `skipped` rather than
 * silently ignored, so the UI can tell the approver what did not happen.
 *
 * Only columns the app already owns are written. The live table has no
 * `updated_at`, so setting one would make the entire update fail.
 */
export default defineHandler(async (event) => {
  const caller = await requireCaller(event);
  if (!caller.isApprover) {
    throw createError({ statusCode: 403, statusMessage: "Only approvers and admins can approve vouchers." });
  }

  const body = (await readBody<BulkBody>(event)) || {};
  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const month = typeof body.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : "";

  // Reject anything that is not a plain uuid rather than passing it to the query.
  const ids = [...new Set(rawIds.filter((id): id is string => typeof id === "string" && UUID.test(id)))];
  const rejected = rawIds.length - ids.length;

  if (!ids.length) {
    throw createError({ statusCode: 400, statusMessage: "Select at least one voucher to approve." });
  }
  if (ids.length > 500) {
    throw createError({ statusCode: 400, statusMessage: "That is more than 500 vouchers. Approve them a month at a time." });
  }

  const client = getUserClient(readAccessToken(event));

  // Read first so the UI can report exactly which rows were skipped and why.
  const { data: found, error: readError } = await client
    .from("vouchers")
    .select("id, voucher_no, status, voucher_date, company_id")
    .in("id", ids);
  if (readError) throw createError({ statusCode: 500, statusMessage: `Could not read those vouchers: ${readError.message}` });

  const rows = found ?? [];
  const visible = new Set(rows.map((row) => String(row.id)));

  const skipped: Array<{ id: string; voucherNo: string | null; reason: string }> = [];
  const approvedIds: string[] = [];

  for (const id of ids) {
    if (!visible.has(id)) {
      skipped.push({ id, voucherNo: null, reason: "Not available to you" });
      continue;
    }
    const row = rows.find((item) => String(item.id) === id)!;
    const voucherNo = row.voucher_no ? String(row.voucher_no) : null;
    if (row.status !== "Pending approval") {
      skipped.push({ id, voucherNo, reason: `Already ${String(row.status).toLowerCase()}` });
      continue;
    }
    if (month && !String(row.voucher_date ?? "").startsWith(month)) {
      skipped.push({ id, voucherNo, reason: "Outside the selected month" });
      continue;
    }
    approvedIds.push(id);
  }

  if (rejected > 0) {
    skipped.push({ id: "", voucherNo: null, reason: `${rejected} invalid id(s) ignored` });
  }

  const approved: Array<{ id: string; voucherNo: string }> = [];
  const failed: Array<{ id: string; reason: string }> = [];

  for (let index = 0; index < approvedIds.length; index += CHUNK) {
    const chunk = approvedIds.slice(index, index + CHUNK);
    const { data: updated, error } = await client
      .from("vouchers")
      .update({
        status: "Approved",
        approved_by: caller.id,
        approved_by_name: caller.fullName,
        // Each voucher keeps its own date, so the printed sheet matches the
        // ledger. The database trigger sets approved_recorded_at to the real
        // moment, which is why it is not written here.
        approved_at: null,
      })
      .in("id", chunk)
      .eq("status", "Pending approval")
      .select("id, voucher_no");

    if (error) {
      for (const id of chunk) failed.push({ id, reason: error.message });
      continue;
    }
    for (const row of updated ?? []) {
      approved.push({ id: String(row.id), voucherNo: row.voucher_no ? String(row.voucher_no) : "" });
    }
  }

  return {
    approved,
    approvedCount: approved.length,
    skipped,
    failed,
    approvedBy: caller.fullName,
    month: month || null,
  };
});