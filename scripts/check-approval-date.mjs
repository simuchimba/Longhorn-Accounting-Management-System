// Guards the approval-date alignment.
//
// The current script sets approved_at to the date printed on the voucher. An
// earlier attempt used created_at, which is wrong for batch-imported data: every
// row in this ledger was loaded on the same day, so created_at reads the batch
// date and September vouchers kept showing an October approval date.
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

const sql = read("database/align_approval_dates.sql");
const superseded = read("database/set_approval_date_from_created.sql");
const index = read("src/pages/Index.tsx");
const bulk = read("server/routes/api/vouchers/bulk-approve.post.ts");
const readme = read("README.md");
const scripts = JSON.parse(read("package.json")).scripts;

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
};

console.log("Approval date alignment");

// --- the rule itself --------------------------------------------------------
check("is marked the current script", /CURRENT: Make the approval date the date on the voucher/.test(sql));
check("uses voucher_date, not created_at", /set approved_at = voucher_date::timestamptz/.test(sql));
check("the trigger uses voucher_date too", /new\.approved_at := new\.voucher_date::timestamptz/.test(sql));
check("explains why created_at was wrong", /WHY created_at WAS THE WRONG SOURCE/.test(sql));
check("names the batch-load date as the cause", /loaded into the database in one batch/.test(sql));
check("says voucher_date is never touched", /voucher_date is never touched/.test(sql));
check("says no voucher changes month", /no voucher changes month/i.test(sql));

// --- review before change ----------------------------------------------------
// --- the ordering fault that left 780 vouchers showing the batch date -------
// The old trigger must be dropped BEFORE any row is written, or it rewrites each
// one as it lands. Asserted on position, because that is what failed.
const dropIndex = sql.indexOf("drop trigger if exists trg_vouchers_approval_date on public.vouchers;");
const updateIndex = sql.indexOf("set approved_at = voucher_date::timestamptz\n where status = 'Approved'");
const createIndex = sql.indexOf("create trigger trg_vouchers_align_approval_date");
check("the superseded trigger is dropped before any row is written", dropIndex > 0 && dropIndex < updateIndex);
check("the new trigger is created only after the rows are fixed", updateIndex < createIndex);
check("the ordering trap is explained in the file", /ORDER MATTERS, and getting it wrong is silent/.test(sql));
check("it names the symptom it caused", /780 vouchers/.test(sql));
check("the regression check installs the old trigger first", /_trigger_order_verify/.test(read("database/verify-trigger-order.mjs")));
check("wired into db:verify", /verify-trigger-order/.test(scripts["db:verify"] ?? ""));

// --- review before change ----------------------------------------------------
check("compares created_at against the voucher date", /created_at vs the date on the voucher/.test(sql));
check("counts how far apart they are", /different_month/.test(sql));

// --- audit trail preserved ---------------------------------------------------
check("keeps the original timestamp", /approved_recorded_at = approved_at/.test(sql));
check("documents the kept column", /comment on column public\.vouchers\.approved_recorded_at/.test(sql));
check("stamps rows that had no timestamp", /approved_recorded_at = voucher_date::timestamptz/.test(sql));
check("clears the date on anything not approved", /set approved_at = null\s+where status <> 'Approved'/.test(sql));
check("trigger records the real moment going forward", /new\.approved_recorded_at := now\(\)/.test(sql));
check("inner function uses its own dollar tag", /\$fn\$/.test(sql));

// --- only one script is live ------------------------------------------------
check("drops the superseded trigger so they cannot fight", /drop trigger if exists trg_vouchers_approval_date on public\.vouchers/.test(sql));
check("the creation-date script is marked superseded", /SUPERSEDED\. Do not run this file/.test(superseded));
check("it points at the right file", /Use database\/align_approval_dates\.sql instead/.test(superseded));
check("README names one file plainly", /Run that one file and nothing else/.test(readme));

// --- the UI agrees with whatever the script stores --------------------------
check("the signature block shows the stored approval date", /approvedAt \? formatDate\(voucher\.approvedAt\.slice\(0, 10\)\) : "__________________"/.test(index));
check("single approval leaves the date to the trigger", /approved_at: `\$\{vouchers\.find/.test(index));
check("bulk approval leaves the date to the trigger", /approved_at: null/.test(bulk));

// --- checks can catch a regression ------------------------------------------
check("the database suite is wired into db:verify", /verify-dates/.test(scripts["db:verify"] ?? ""));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll approval-date checks passed");
process.exit(failed ? 1 : 0);