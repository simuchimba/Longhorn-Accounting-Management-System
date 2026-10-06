// ============================================================================
//  Longhorn Ledger — run the local migration test suite
// ============================================================================
//  Proves database/multi_company_setup.sql actually enforces the branch rules.
//  Creates a throwaway database, runs the migration, then impersonates a real
//  user for each rule.
//
//  Usage:  node database/verify-migration.mjs
//
//  Requires psql and a superuser connection (set PGPASSWORD, or pass a
//  connection string via ADMIN_DATABASE_URL).
// ============================================================================
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = "lh_migration_test";

/** Locates psql on Windows, or falls back to whatever is on PATH elsewhere. */
const findPsql = () => {
  if (process.env.PSQL_PATH && fs.existsSync(process.env.PSQL_PATH)) return process.env.PSQL_PATH;
  const roots = ["C:\\Program Files\\PostgreSQL", "/usr/lib/postgresql", "/opt/homebrew/opt"];
  for (const root of roots) {
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

/**
 * A superuser connection, without a database name.
 *
 * psql would otherwise fall back to the OS username, which usually is not a
 * Postgres role. Override with ADMIN_DATABASE_URL when yours differs.
 */
const connection = process.env.ADMIN_DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres";

/** Splits the connection URL into the -h/-p/-U flags psql wants. */
const parsed = new URL(connection);

const connectionFlags = () => [
  "-h",
  parsed.hostname,
  "-p",
  parsed.port || "5432",
  "-U",
  decodeURIComponent(parsed.username),
];

/** psql reads the password from the environment, never from an argument. */
const connectionEnv = () => ({
  ...process.env,
  PGCONNECT_TIMEOUT: "10",
  ...(parsed.password ? { PGPASSWORD: decodeURIComponent(parsed.password) } : {}),
});

/**
 * Runs psql and returns stdout. Notices and errors go to stderr, and the rule
 * checks in _migration_verify.sql report PASS/FAIL through RAISE NOTICE, so
 * stderr is captured too rather than only being used for crash messages.
 */
const run = (args, { quiet = false } = {}) => {
  try {
    const stdout = execFileSync(psql, [...connectionFlags(), ...args], {
      encoding: "utf8",
      env: connectionEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!quiet) process.stdout.write(stdout);
    return stdout;
  } catch (error) {
    // A non-zero exit means ON_ERROR_STOP tripped. Surface the notices that led
    // up to it so the failing check is visible, not just the abort.
    const detail = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    if (!quiet) process.stderr.write(detail);
    throw error;
  }
};

const runFile = (db, file) => run(["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", db, "-f", path.join(here, file)]);

/* ------------------------------------------------------------------ set up */

console.log("Dropping any previous test database...");
run(["-c", `drop database if exists ${TEST_DB}`], { quiet: true });

console.log("Creating a stand-in schema...");
run(["-c", `create database ${TEST_DB}`], { quiet: true });
runFile(TEST_DB, "_migration_test_setup.sql");

console.log("Running the migration three times to prove it is idempotent...");
for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    runFile(TEST_DB, "multi_company_setup.sql");
    console.log(`  run ${attempt}: ok`);
  } catch (error) {
    const detail = String(error.stderr || error.message);
    console.error(`  run ${attempt}: FAILED\n${detail}`);
    process.exit(1);
  }
}

/* --------------------------------------------------------------- assertions */

const failures = [];

/**
 * Role and branch edits made outside the app: the Supabase Table Editor and the
 * SQL editor both write with no signed-in user, which a security trigger must not
 * mistake for an attack.
 *
 * These run against their own throwaway database, because the checks change roles
 * and add rows, which would otherwise skew the voucher-counting checks above.
 */
const ROLE_DB = `${TEST_DB}_role`;
console.log("\nVerifying role edits from the dashboard...");
run(["-c", `drop database if exists ${ROLE_DB}`], { quiet: true });
run(["-c", `create database ${ROLE_DB}`], { quiet: true });
runFile(ROLE_DB, "_migration_test_setup.sql");
runFile(ROLE_DB, "multi_company_setup.sql");

const roleRun = () =>
  spawnSync(
    psql,
    [...connectionFlags(), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", ROLE_DB, "-f", path.join(here, "_role_edit_verify.sql")],
    { encoding: "utf8", env: connectionEnv() },
  );

const roleChecks = roleRun();
const roleOutput = `${roleChecks.stdout ?? ""}${roleChecks.stderr ?? ""}`;
if (roleChecks.status !== 0) {
  console.error(roleOutput);
  process.exit(1);
}
for (const line of roleOutput.split("\n").filter((l) => /PASS:|FAIL:/.test(l))) {
  const label = line.replace(/^psql[^\n]*?NOTICE:\s*/, "").replace(/^(PASS|FAIL):\s*/, "");
  console.log(`  ${/PASS:/.test(line) ? "PASS" : "FAIL"}: ${label}`);
  if (/FAIL:/.test(line)) failures.push(label);
}

// Prove the checks are not vacuous: with the original buggy trigger back in place
// the dashboard promotion must fail. If this passes, the test proves nothing.
runFile(ROLE_DB, "_revert_role_trigger.sql");
const revertOutput = `${(() => {
  const result = roleRun();
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
})()}`;
const caughtRegression = /FAIL: dashboard edit was reverted/.test(revertOutput);
console.log(`  ${caughtRegression ? "PASS" : "FAIL"}: the checks catch the original dashboard-revert bug`);
if (!caughtRegression) failures.push("role-edit checks do not detect the original bug");
run(["-c", `drop database if exists ${ROLE_DB}`], { quiet: true });

/**
 * The rule checks report through RAISE NOTICE, which psql writes to stderr, so
 * both streams are needed to see every result. spawnSync returns them together
 * in one run, rather than re-running the file to collect the other stream.
 */
const verified = spawnSync(
  psql,
  [...connectionFlags(), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", TEST_DB, "-f", path.join(here, "_migration_verify.sql")],
  { encoding: "utf8", env: connectionEnv() },
);

if (verified.error) {
  console.error(String(verified.error.message));
  process.exit(1);
}

const output = `${verified.stdout}${verified.stderr}`;

if (verified.status !== 0) {
  console.error(output);
  process.exit(1);
}

const passes = output.split("\n").filter((line) => line.includes("PASS:"));

for (const line of output.split("\n")) {
  if (/FAIL:|ERROR/.test(line)) failures.push(line.trim());
}

// The counts that prove scoping, read back from the printed result tables.
const scopeChecks = [
  { label: "LFS preparer sees only LFS vouchers", expected: "1", pattern: /=== 1\.[\s\S]*?visible\s*\n-+\s*\n\s*(\d+)/ },
  { label: "LFS approver sees every branch", expected: "3", pattern: /=== 4\.[\s\S]*?visible\s*\n-+\s*\n\s*(\d+)/ },
];

for (const check of scopeChecks) {
  const match = check.pattern.exec(output);
  const actual = match ? match[1] : "not found";
  const ok = actual === check.expected;
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${check.label} (expected ${check.expected}, got ${actual})`);
  if (!ok) failures.push(`${check.label}: expected ${check.expected}, got ${actual}`);
}

// 0-row queries proving one branch is invisible to another.
for (const [label, marker] of [
  ["LAssociates voucher hidden from LFS preparer", /=== 2\.[\s\S]*?\(0 rows\)/],
  ["Insurance Broking voucher hidden from LFS preparer", /=== 3\.[\s\S]*?\(0 rows\)/],
]) {
  const ok = marker.test(output);
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) failures.push(label);
}

console.log(`  ${passes.length} further rule checks reported PASS`);
if (!output.includes("ALL CHECKS COMPLETE")) failures.push("verification did not run to the end");

/* --------------------------------------------------------------- teardown */

console.log("\nCleaning up...");
run(["-c", `drop database if exists ${TEST_DB}`], { quiet: true });
console.log("  dropped " + TEST_DB);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("\nAll multi-company rules verified.");