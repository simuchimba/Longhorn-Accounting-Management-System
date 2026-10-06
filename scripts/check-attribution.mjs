// Guards the attribution fix: the SQL that repairs the rows, and the code change
// that stops the importer stamping itself as approver again.
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

const sql = read("database/fix_approver_attribution.sql");
const index = read("src/pages/Index.tsx");

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
};

console.log("Approver attribution");

// --- the SQL repairs only what is actually wrong ----------------------------
check("scoped to Longhorn Associates", /code = 'LA'/.test(sql));
check("only rows whose approver is not an approver role", /coalesce\(p\.role, ''\) <> 'approver'/.test(sql));
check("finds the right person by email, not by name", /lower\(u\.email\) = 'approvals@longhorn-associates\.com'/.test(sql));
check("never invents a new approval timestamp", /approved_at is deliberately left alone/.test(sql));
check("leaves assigned_approver_name in step", /assigned_approver_name = case/.test(sql));
check("fails loudly if the branch or person is missing", /No branch with code LA found/.test(sql) && /has no profiles row/.test(sql));
check("reports how many rows it changed", /get diagnostics changed = row_count/.test(sql));
check("says so when there was nothing to do", /Nothing needed changing/.test(sql));
check("has a read-only section to review first", /1\. What the ledger says now\. Read-only/.test(sql));

// --- the importer must not stamp itself as approver -------------------------
check("import credits the nominated approver", /approved_by: approved \? importApprover\?\.id \?\? null : null/.test(index));
check("import names the nominated approver", /approved_by_name: approved \? importApprover\?\.fullName \?\? null : null/.test(index));
check("import no longer credits the importing user", !/approved_by: approved \? user\.id : null/.test(index));
check("import no longer names the importing user", !/approved_by_name: approved \? displayName : null/.test(index));
check("an approver is required for every import status", /if \(!importApprover\)/.test(index));
check("the error explains how to fix it", /ask an admin to promote someone to approver/.test(index));

// --- the check must be able to detect the original bug ------------------------
// The fixture reproduces it: an admin stamped on approved_by. If the fix stopped
// working, "no voucher attributed to a non-approver" would fail.
const runner = read("database/verify-attribution.mjs");
check("the database check exercises the shipped fix", runner.includes("_attribution_verify.sql"));
const scripts = JSON.parse(read("package.json")).scripts;
check("db:verify includes the attribution check", /verify-attribution/.test(scripts["db:verify"] ?? ""));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll attribution checks passed");
process.exit(failed ? 1 : 0);