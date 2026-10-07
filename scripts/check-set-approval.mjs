// Guards the creation-date approval script, and pins down how it differs from the
// voucher-date one, since the two are easy to confuse.
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

const sql = read("database/set_approval_date_from_created.sql");
const index = read("src/pages/Index.tsx");
const bulk = read("server/routes/api/vouchers/bulk-approve.post.ts");
const scripts = JSON.parse(read("package.json")).scripts;

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
};

console.log("Approval date from creation date");

// --- the rule itself --------------------------------------------------------
check("uses created_at, not voucher_date", /set approved_at = created_at/.test(sql));
check("the trigger uses created_at too", /new\.approved_at := new\.created_at/.test(sql));
check("voucher_date is explicitly left alone", /voucher_date is never touched/.test(sql));
check("says no voucher changes month", /no voucher changes month/i.test(sql));
check("the reported problem is named", /September vouchers stop showing|created in September/i.test(sql));

// --- audit trail preserved ---------------------------------------------------
check("keeps the original timestamp", /approved_recorded_at = approved_at/.test(sql));
check("documents the kept column", /comment on column public\.vouchers\.approved_recorded_at/.test(sql));
check("stamps rows that had no timestamp at all", /approved_recorded_at = created_at\n where status = 'Approved'/.test(sql));
check("clears the date on anything not approved", /set approved_at = null\n where status <> 'Approved'/.test(sql));
check("trigger records the real moment going forward", /new\.approved_recorded_at := now\(\)/.test(sql));
check("inner function uses its own dollar tag", /\$fn\$/.test(sql));

// --- review-before-change ----------------------------------------------------
check("section 1 is read-only", /The problem, by month\. Read-only/.test(sql));
check("section 2 flags back-dated entries", /Rows where the two dates disagree\. Read-only\. CHECK THESE/.test(sql));
check("warns the two scripts must not both run", /Run one, not both/.test(read("README.md")));

const dateScript = read("database/align_approval_dates.sql");
check("the two scripts differ only in the date source", /voucher_date::timestamptz/.test(dateScript) && /new\.voucher_date::timestamptz/.test(dateScript));
check("both install a trigger, so the last one run wins", /trg_vouchers_align_approval_date/.test(dateScript) && /trg_vouchers_approval_date on/.test(sql));

// --- the UI agrees with whichever script you run -----------------------------
check("the signature block shows the stored approval date", /approvedAt \? formatDate\(voucher\.approvedAt\.slice\(0, 10\)\) : "__________________"/.test(index));
check("single approval leaves the date to the trigger", /approved_at: `\$\{vouchers\.find/.test(index));
check("bulk approval leaves the date to the trigger", /approved_at: null/.test(bulk));

// --- checks can catch a regression ------------------------------------------
check("wired into db:verify", /verify-set-approval/.test(scripts["db:verify"] ?? ""));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll creation-date approval checks passed");
process.exit(failed ? 1 : 0);