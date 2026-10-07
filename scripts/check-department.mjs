// Guards "a voucher's department is the branch that raised it".
//
// Every voucher read "General" under Department, all 780 of them, including the
// Longhorn Associates ones. Two columns were both claiming to hold the branch:
// company_id, which the app trusts and which was correct throughout, and
// department_id, which the bulk import left pointing at a placeholder row.
// This asserts the app reads company_id and nothing writes "General" any more.
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");

const sql = read("database/fix_voucher_department.sql");
const index = read("src/pages/Index.tsx");
const panel = read("src/pages/ApprovalsPanel.tsx");
const printer = read("src/pages/Index.tsx");
const scripts = JSON.parse(read("package.json")).scripts;

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
};

console.log("Voucher department is the branch");

// --- the display ------------------------------------------------------------
console.log("\n-- what the user sees --");
check("is marked the current script", /CURRENT: Make a voucher's department be the branch/.test(sql));
check("names the symptom it fixes", /Every voucher reads "General"/.test(sql));
check("names all 780", /780/.test(sql));
check("explains the two columns disagreed", /Two columns were both claiming to hold the branch/.test(sql));
check("says company_id was already correct", /company_id was correct the whole time/.test(sql));
check("says the app now reads it too", /the app now reads it too/.test(sql));
check("mapVoucher reads the branch first", /department: company\?\.name \|\| departmentFromTable \|\| "Unassigned"/.test(index));
check("the fallback to the table is kept", /departmentFromTable/.test(index));
check("it explains why company_id is the source", /Two columns both claiming to hold the branch is how they ended up/.test(index));
check("a voucher with neither still renders", /\|\| "Unassigned"/.test(index));

// --- new writes -------------------------------------------------------------
console.log("\n-- new vouchers and imports --");
check("department follows the branch on the composer", /department_id: selectedDepartment\?\.id \?\? null/.test(index));
check("the composer resolves it from the branch", /departmentForBranch\(departments, myBranchLabel\)/.test(index));
check("the composer no longer demands a department", !/!selectedDepartment \|\|/.test(index));
check("the refusal message dropped department", /Add the amount, payee, payment purpose and prepared by name/.test(index) && !/Add the amount, department, payee/.test(index));
check("the import stamps the branch", /department_id: branchDept\?\.id \?\? null/.test(index));
check("the import no longer falls back to General", !/fallbackDept/.test(index));
check("the importer labels the branch read-only", /Department \(branch\)/.test(index));
check("it says where the branch comes from", /Taken from your profile/.test(index));
check("the form field is gone", !/department: string;\n  preparedBy/.test(index));
check("the placeholder constant documents itself", /PLACEHOLDER_DEPARTMENT = "General"/.test(index));
check("the helper prefers the branch's own row", /departments\.find\(\(department\) => department\.name === branchName\)/.test(index));
check("it never falls back to the placeholder", /departments\.find\(\(department\) => department\.name !== PLACEHOLDER_DEPARTMENT\)/.test(index));
// The old code inserted a General row directly. The current code upserts a list
// built from the branches, so the check has to cover the literal and the shape
// of the list as well, otherwise reintroducing General passes silently.
check("no path still inserts a General row directly", !/insert\(\{[^}]*name:\s*"General"/.test(index));
check("the upsert list is built from the branches", /missingBranchDepartments\s*=\s*loadedCompanies\s*\n?\s*\.filter\(\(company\)/.test(index));
check("the upsert list excludes retired branches", /company\.isActive && !loadedDepartments\.some/.test(index));
check("General is never a branch-derived name", !/name:\s*PLACEHOLDER_DEPARTMENT/.test(index));
check("branches get their own department rows", /missingBranchDepartments/.test(index) && /onConflict: "name"/.test(index));

// --- existing rows ----------------------------------------------------------
console.log("\n-- the existing 780 --");
check("it adds a department row per branch", /insert into public\.departments \(name, description\)/.test(sql));
check("only for active branches", /where c\.is_active/.test(sql));
check("it repoints department_id at the branch", /set department_id = d\.id/.test(sql));
check("only rows that disagree are touched", /is distinct from d\.id/.test(sql));
check("it shows the gap before changing anything", /1\. Before\. Read-only/.test(sql));
check("it reports how many read General", /reading_general/.test(sql));
check("it reports disagreement, not just the placeholder", /disagreeing_with_branch/.test(sql));
check("it says nothing else moves", /company_id is not changed by this file/.test(sql));
check("it is safe to re-run", /safe to run more than once/.test(sql));
check("the trigger keeps future writes right", /trg_vouchers_stamp_branch_department/.test(sql));
check("it fires on the columns that matter", /before insert or update of company_id, department_id/.test(sql));
check("it creates a branch row on demand", /insert into public\.departments[\s\S]{0,400}branch_name/.test(sql));
check("a voucher with no branch is left alone", /if new\.company_id is null then/.test(sql));
check("it can be undone", /Undo, putting "General" back/.test(sql));

// --- one filter, not two ----------------------------------------------------
// A department filter alongside a branch filter could only ever agree or
// contradict it, now that both mean the same thing.
console.log("\n-- no duplicate filter --");
check("the approvals panel takes no department", !/department: string;/.test(panel) || !/onDepartmentChange/.test(panel));
check("its department prop is gone", !/\n\s*department,\n/.test(panel));
check("its department state is gone", !/departments,\n/.test(panel));
check("Index passes no department to it", !/department=\{approvalDept\}/.test(index) && !/onDepartmentChange=/.test(index));
check("the approval filter state is gone", !/approvalDept/.test(index));
check("the dead pending-view filter is gone", !/departmentFilter/.test(index));
check("the dead approved-view filter is gone", !/approvedDept/.test(index));
check("the branch filter remains", /companyFilter/.test(panel) && /Filter by branch/.test(panel));

// --- the printed sheet ------------------------------------------------------
console.log("\n-- the printed voucher --");
check("the sheet still prints a department", /Department:<\/b> \{voucher\.department\}/.test(printer));
check("it prints whatever the branch resolved to", /department: company\?\.name/.test(printer));

// --- the checks -------------------------------------------------------------
console.log("\n-- guarded by tests --");
check("the database check is wired into db:verify", /verify-department/.test(scripts["db:verify"] ?? ""));
check("the check reproduces the bug first", /if n = 0 then[\s\S]{0,200}did not reproduce the bug/.test(read("database/_department_verify.sql")));
check("it asserts the 780 are fixed", /expected 781 Longhorn Associates vouchers/.test(read("database/_department_verify.sql")));
check("it covers a second branch", /stamped % to match its branch/.test(read("database/_department_verify.sql")));
check("it covers a branch with no department row", /created on demand/.test(read("database/_department_verify.sql")));
check("it covers a voucher with no branch", /no branch to infer/.test(read("database/_department_verify.sql")));
check("it proves the fix is idempotent", /PASS: idempotent/.test(read("database/_department_verify.sql")));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll department checks passed");
process.exit(failed ? 1 : 0);
