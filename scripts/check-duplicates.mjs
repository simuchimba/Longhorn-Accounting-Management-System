// Guards the duplicate-prevention work.
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

const guard = read("database/prevent_duplicate_vouchers.sql");
const finder = read("database/find_duplicate_vouchers.sql");
const index = read("src/pages/Index.tsx");
const runner = read("database/verify-duplicates.mjs");

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
};

console.log("Duplicate prevention");

// --- the deliberate decision: NOT one voucher per date ----------------------
check("explicitly explains why one-per-date is wrong", /WHY NOT "ONE VOUCHER PER DATE"/.test(guard));
check("states that same-day payments are legitimate", /Several payments are legitimately made on the same day/.test(guard));
check("no date-only unique constraint is created", !/unique[\s\S]{0,80}\(\s*voucher_date\s*\)/.test(guard));
check("nothing enforces a single voucher per date", !/voucher_date\)\s*where/i.test(guard));

// --- what IS blocked ---------------------------------------------------------
check("blocks a repeated invoice reference", /uniq_vouchers_reference_per_branch/.test(guard));
check("the reference index is per branch", /coalesce\(company_id, %L\)/.test(guard));
check("the reference index ignores blank references", /where reference is not null and trim\(reference\) <> ''/.test(guard));
check("blocks the same payee and amount on one day", /vouchers_block_duplicate_payment/.test(guard));
check("the trigger message names the clashing voucher", /already exists \(%\)/.test(guard));
check("the trigger allows the same amount on another date", /voucher_date = new\.voucher_date/.test(guard));

// --- installer refuses on dirty data ----------------------------------------
check("refuses to install while duplicates exist", /Stopped: % invoice reference\(s\)/.test(guard) && /Stopped: % payee\/amount\/date/.test(guard));
check("points at the finder script", /find_duplicate_vouchers\.sql/.test(guard));
check("is idempotent", /create unique index if not exists/.test(guard) && /drop trigger if exists/.test(guard));
check("says how to remove the guard later", /drop index if exists public\.uniq_vouchers_reference_per_branch/.test(guard));

// --- the finder is read-only -------------------------------------------------
check("finder reports same date, payee and amount", /Same date \+ payee \+ amount/.test(finder));
check("finder reports repeated references", /Same reference used twice/.test(finder));
check("finder says it changes nothing", /Changes nothing/.test(finder));

// --- user-facing error text --------------------------------------------------
check("the composer explains a duplicate payment", /explainWriteError/.test(index) && /already been entered/.test(index));
check("the composer names the clashing voucher", /already been entered, on voucher/.test(index));
check("a duplicate voucher number is explained too", /voucher number is already taken/.test(index));
check("the importer uses the same explanation", /explainWriteError\(error\)/.test(index));
check("duplicate wording does not assume it is a date clash", /if this really is a separate payment/.test(index));

// --- the checks can actually catch a regression ------------------------------
const scripts = JSON.parse(read("package.json")).scripts;
check("the database check is wired into db:verify", /verify-duplicates/.test(scripts["db:verify"] ?? ""));
check("the check seeds real duplicates first", runner.includes("_duplicate_fixture.sql"));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll duplicate-prevention checks passed");
process.exit(failed ? 1 : 0);