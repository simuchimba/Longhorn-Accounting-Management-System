// Guards the approval-date alignment.
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

const sql = read("database/align_approval_dates.sql");
const index = read("src/pages/Index.tsx");
const bulk = read("server/routes/api/vouchers/bulk-approve.post.ts");

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
};

console.log("Approval date alignment");

// --- the decision: align the date, never move the voucher -------------------
check("explicitly says voucher_date is never touched", /voucher_date itself is never touched/.test(sql));
check("says nothing moves between months", /nothing moves between months/i.test(sql));
check("aligns approved_at to the voucher date", /set approved_at = voucher_date::timestamptz/.test(sql));
check("keeps the real moment in a separate column", /approved_recorded_at/.test(sql));
check("the kept column is documented", /comment on column public\.vouchers\.approved_recorded_at/.test(sql));
check("keeps the existing value before overwriting", /set approved_recorded_at = approved_at\n where approved_recorded_at is null/.test(sql));
check("fills approved vouchers that had no timestamp", /status = 'Approved'\s+and approved_at is null/.test(sql));
check("clears the date on anything not approved", /set approved_at = null\s+where status <> 'Approved'/.test(sql));

// --- a trigger, so it holds however the row arrives --------------------------
check("installs a trigger", /create trigger trg_vouchers_align_approval_date/.test(sql));
check("trigger stamps the real moment once", /if new\.approved_recorded_at is null then[\s\S]{0,80}now\(\)/.test(sql));
check("trigger forces the two dates equal", /new\.approved_at := new\.voucher_date::timestamptz/.test(sql));
check("trigger clears the date when not approved", /else[\s\S]{0,60}new\.approved_at := null/.test(sql));
check("inner function uses its own dollar tag", /\$fn\$/.test(sql));

// --- the printed voucher no longer shows a blank approver date --------------
check("approver date is printed, not a blank line", /approvedAt \? formatDate\(voucher\.approvedAt\.slice\(0, 10\)\) : "__________________"/.test(index));
check("no bare underscore-only approver date remains", !/Date: __________________<\/small>/.test(index));

// --- every write path uses the voucher's own date ----------------------------
check("single approval stamps the voucher's date", /approved_at: `\$\{vouchers\.find\(\(voucher\) => voucher\.id === id\)\?\.date/.test(index));
check("bulk approval leaves the date to the trigger", /approved_at: null/.test(bulk));
check("bulk approval explains why", /keeps its own date/.test(bulk));
check("import stamps each row's own date", /approved_at: approved \? `\$\{row\.date\}T00:00:00Z` : null/.test(index));
check("import no longer stamps the load date", !/approved_at: approved \? now : null/.test(index));
check("local state after bulk approval uses each voucher's date", /approvedAt: `\$\{voucher\.date\}T00:00:00Z`/.test(index));

// --- checks can catch a regression ------------------------------------------
const scripts = JSON.parse(read("package.json")).scripts;
check("wired into db:verify", /verify-dates/.test(scripts["db:verify"] ?? ""));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll date-alignment checks passed");
process.exit(failed ? 1 : 0);