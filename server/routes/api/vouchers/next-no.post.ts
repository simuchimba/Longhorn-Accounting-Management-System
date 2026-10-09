import { defineHandler } from "nitro";
import { createError, readBody } from "nitro/h3";
import { getServiceClient, requireCaller } from "../../../utils/supabase";

type NextNoBody = {
  /** Voucher dates the caller is about to number, as YYYY-MM-DD. */
  dates?: string[];
};

/** Voucher dates the caller is about to number, as YYYY-MM-DD. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DATES = 4000;

/**
 * Tells the caller which voucher numbers are already taken in a month.
 *
 * WHY THIS EXISTS
 *   `vouchers.voucher_no` is unique across the whole ledger, and each preparer
 *   now has a workspace of their own, so a preparer can only read their own
 *   vouchers. Picking the next number from that set would restart the sequence
 *   at 1 for every preparer, and two people paying on the same day would keep
 *   picking the same number. The insert would then be refused with 23505.
 *
 *   So the numbering is done here instead, reading past row level security.
 *   It has to: the whole point is to see numbers the caller may not be allowed
 *   to see.
 *
 * WHAT IT GIVES AWAY
 *   Only voucher numbers, and only for the months asked about. Nothing else:
 *   no payee, no amount, no branch, no preparer. It is the minimum needed to
 *   keep numbering unique, and a voucher number carries no payment detail.
 *
 *   It refuses outright rather than answering for anyone who cannot raise
 *   vouchers, so it is not a way to enumerate numbers.
 *
 * FALLBACK
 *   Needs the service key. If that is not configured this throws 503 and the
 *   browser falls back to numbering from the rows the caller can already see,
 *   which is what the app did before per-preparer workspaces existed. That is
 *   degraded, not broken: a clash is reported to the user as "that voucher
 *   number is already taken" and they retry.
 */
export default defineHandler(async (event) => {
  const caller = await requireCaller(event);
  if (!caller.canPrepare) {
    throw createError({ statusCode: 403, statusMessage: "Only preparers and admins can create vouchers." });
  }

  const body = (await readBody<NextNoBody>(event)) || {};
  const dates = Array.isArray(body.dates) ? body.dates.filter((date): date is string => typeof date === "string" && DATE.test(date)) : [];
  if (dates.length > MAX_DATES) {
    throw createError({ statusCode: 400, statusMessage: "Too many dates at once. Import in smaller batches." });
  }

  // One query per distinct month, rather than one wide range, so an import that
  // straddles a year end does not drag in the months in between.
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))].sort();
  const numbersByMonth: Record<string, string[]> = {};

  if (months.length) {
    const service = getServiceClient();

    for (const month of months) {
      const [year, index] = month.split("-").map(Number);
      const monthStart = `${month}-01`;
      const nextStart = index === 12 ? `${year + 1}-01-01` : `${year}-${String(index + 1).padStart(2, "0")}-01`;

      const { data, error } = await service
        .from("vouchers")
        .select("voucher_no")
        .gte("voucher_date", monthStart)
        .lt("voucher_date", nextStart);
      if (error) {
        throw createError({ statusCode: 500, statusMessage: `Could not read existing voucher numbers: ${error.message}` });
      }

      numbersByMonth[month] = (data ?? []).map((row) => String((row as { voucher_no: string | null }).voucher_no ?? "")).filter(Boolean);
    }
  }

  return { numbersByMonth };
});