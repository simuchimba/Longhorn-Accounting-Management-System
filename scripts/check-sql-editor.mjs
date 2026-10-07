// Guards the SQL files that are pasted into the Supabase SQL Editor.
//
// The editor sends statements straight to Postgres. psql client meta-commands
// (\echo, \o, \i, \set, \pset) are not SQL, so a file containing them fails with
//   ERROR: 42601: syntax error at or near "\"
// which is exactly what happened when the approval-date script was pasted.
//
// This also runs each shipped file against a real database with ON_ERROR_STOP,
// because a syntax error surfaces only at execution time.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(here, "..", "database");
const TEST_DB = "lh_sql_paste_test";

// Files a user is told to paste into the Supabase SQL Editor.
const RUNNABLE = [
  "multi_company_setup.sql",
  "fix_role_edits.sql",
  "fix_approver_attribution.sql",
  "find_duplicate_vouchers.sql",
  "prevent_duplicate_vouchers.sql",
  "align_approval_dates.sql",
  "set_approval_date_from_created.sql",
];

const findPsql = () => {
  if (process.env.PSQL_PATH && fs.existsSync(process.env.PSQL_PATH)) return process.env.PSQL_PATH;
  for (const root of ["C:\\Program Files\\PostgreSQL", "/usr/lib/postgresql", "/opt/homebrew/opt"]) {
    if (!fs.existsSync(root)) continue;
    for (const version of fs.readdirSync(root).sort().reverse()) {
      for (const leaf of ["bin/psql.exe", "bin/psql"]) {
        const candidate = path.join(root, version, leaf);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return "psql";
};

const psql = findPsql();
const parsed = new URL(process.env.ADMIN_DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres");
const flags = ["-h", parsed.hostname, "-p", parsed.port || "5432", "-U", decodeURIComponent(parsed.username)];
const env = { ...process.env, PGCONNECT_TIMEOUT: "10", ...(parsed.password ? { PGPASSWORD: decodeURIComponent(parsed.password) } : {}) };

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
};

console.log("Supabase SQL Editor compatibility");

// --- 0. the short block we hand out matches the canonical file --------------
// A condensed copy is offered in chat because a pasted fix that is short enough
// to read is less likely to be half-applied. It is a copy, though, so it can
// drift from database/align_approval_dates.sql and quietly become the wrong one.
console.log("\n-- the short paste block still matches the canonical file --");
{
  const short = fs.readFileSync(path.join(dbDir, "_paste_block_fixture.sql"), "utf8");
  const canonical = fs.readFileSync(path.join(dbDir, "align_approval_dates.sql"), "utf8");
  const mustContain = [
    ["drops the superseded trigger", "drop trigger if exists trg_vouchers_approval_date on public.vouchers;"],
    ["aligns the date to the voucher", "set approved_at = voucher_date::timestamptz"],
    ["installs the aligning trigger", "create trigger trg_vouchers_align_approval_date"],
    ["defines the aligning trigger", "create or replace function public.vouchers_align_approval_date()"],
    ["keeps the original timestamp", "add column if not exists approved_recorded_at timestamptz"],
  ];
  for (const [label, needle] of mustContain) {
    check(`short block: ${label}`, short.includes(needle));
    check(`canonical file: ${label}`, canonical.includes(needle));
  }
  // The superseded script must not reappear in the short block, or it would
  // install the very trigger that undoes the alignment.
  check(
    "short block never reinstalls the superseded trigger",
    !/create\s+trigger\s+trg_vouchers_approval_date/i.test(short),
  );
}

// --- 1. no psql client meta-commands anywhere -------------------------------
console.log("\n-- static: no meta-commands --");
for (const file of [...RUNNABLE, "_paste_block_fixture.sql"]) {
  const source = fs.readFileSync(path.join(dbDir, file), "utf8");
  // Only a real line starting with a backslash counts. Mentions inside -- comments
  // are documentation and are fine.
  const offending = [...source.matchAll(/^\\[a-z]+.*$/gim)].map((m) => m[0].trim().slice(0, 30));
  check(`${file} has no psql meta-commands`, offending.length === 0, offending.join(" | "));
}

// --- 2. each file actually executes -----------------------------------------
console.log("\n-- executed against a real database, ON_ERROR_STOP --");
const run = (args, cwd = dbDir) => {
  const result = spawnSync(psql, [...flags, ...args], { encoding: "utf8", env, cwd });
  return { status: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

run(["-c", `drop database if exists ${TEST_DB}`]);
run(["-c", `create database ${TEST_DB}`]);
run(["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", TEST_DB, "-f", "_migration_test_setup.sql"]);
run(["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", TEST_DB, "-f", "_voucher_cols.sql"]);

for (const file of ["multi_company_setup.sql", "fix_role_edits.sql"]) {
  const result = run(["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", TEST_DB, "-f", file]);
  check(`${file} executes cleanly`, result.status === 0, result.out.split("\n").filter((l) => /ERROR/.test(l))[0] || "");
}

// The remaining files need data or deliberately refuse, but they must not fail
// with a syntax error. Only 42601 counts as a defect here.
for (const file of [...RUNNABLE, "_paste_block_fixture.sql"].filter((f) => !["multi_company_setup.sql", "fix_role_edits.sql"].includes(f))) {
  const result = run(["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", TEST_DB, "-f", file]);
  const syntaxError = /42601|syntax error/i.test(result.out);
  check(`${file} has no syntax error`, !syntaxError, result.out.split("\n").filter((l) => /42601/.test(l))[0] || "");
}

run(["-c", `drop database if exists ${TEST_DB}`]);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll SQL files are safe to paste into Supabase");
process.exit(failed ? 1 : 0);