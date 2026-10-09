// ============================================================================
//  Longhorn Ledger — per-preparer workspace verification
// ============================================================================
//  Proves database/per_preparer_workspace.sql actually isolates each preparer
//  from their colleagues.
//
//  Runs the checks TWICE on the same database:
//    1. before the migration, asserting the problem IS present
//    2. after  the migration, asserting it is gone
//
//  The first pass is the point. A harness that only ran after the change would
//  happily report success against rules it was never measuring, and a policy
//  typo that hid everything would look like a fix.
//
//  Also re-runs the migration twice to prove it is idempotent, and runs the
//  looser database/vouchers_rls_policies.sql in between to prove the drop of
//  its DELETE policy is real and not just a comment.
//
//  Usage:  node database/verify-per-preparer.mjs
//
//  Requires psql and a superuser connection (set PGPASSWORD, or pass a
//  connection string via ADMIN_DATABASE_URL).
// ============================================================================
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = "lh_per_preparer_test";

const PREPARER_B = "77777777-7777-7777-7777-777777777777";

/**
 * Statements expected to be refused, run as the unprivileged role with preparer A
 * impersonated.
 *
 * Declared up here rather than inline so the checks below read as assertions
 * about behaviour instead of as SQL, and so a rejection is observed the way a
 * user would meet it: Postgres refusing the write outright.
 */
const asPreparerA = (sql) => `set role authenticated; select public.as_preparer_a(); ${sql}`;

const AS_PREPARER_A_FILING = asPreparerA(
  `insert into public.vouchers (voucher_no, amount, amount_paid_to, being_payment, prepared_by, prepared_by_name, status, company_id) ` +
    `values ('05/09/0009', 500, 'Someone Else', 'should be refused', '${PREPARER_B}', 'Kabaso Chanda', 'Pending approval', ` +
    `(select id from public.companies where code = 'LA'));`,
);

const AS_PREPARER_A_CROSS_BRANCH = asPreparerA(
  `update public.vouchers set company_id = (select id from public.companies where code = 'LFS') where voucher_no = '05/09/0001';`,
);

/**
 * An approver raising a voucher. Only roles 'preparer' and 'admin' may create,
 * so this has to be refused. It is also the check that catches the older
 * permissive "vouchers_insert_preparer" policy, whose only condition is that you
 * filled in your own id: while that policy is present Postgres ORs the two
 * together and this insert goes through.
 */
const AS_APPROVER_INSERT =
  `set role authenticated; select public.as_approver(); ` +
  `insert into public.vouchers (voucher_no, amount, amount_paid_to, being_payment, prepared_by, prepared_by_name, status, company_id) ` +
  `values ('06/09/0099', 100, 'Should Not Work', 'approver tried to create this', auth.uid(), 'Izukanji Mwanza', 'Pending approval', ` +
  `(select id from public.companies where code = 'LA'));`;

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

const parsed = new URL(connection);

const connectionFlags = () => ["-h", parsed.hostname, "-p", parsed.port || "5432", "-U", decodeURIComponent(parsed.username)];

/** psql reads the password from the environment, never from an argument. */
const connectionEnv = () => ({
  ...process.env,
  PGCONNECT_TIMEOUT: "10",
  ...(parsed.password ? { PGPASSWORD: decodeURIComponent(parsed.password) } : {}),
});

/** Runs a statement and returns stdout, throwing if psql exits non-zero. */
const query = (db, sql, { quiet = true } = {}) => {
  try {
    const stdout = execFileSync(psql, [...connectionFlags(), "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", sql], {
      encoding: "utf8",
      env: connectionEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!quiet) process.stdout.write(stdout);
    return stdout;
  } catch (error) {
    const detail = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    if (!quiet) process.stderr.write(detail);
    throw error;
  }
};

/** Runs a statement, returning whether Postgres accepted it. Never throws. */
const accepts = (db, sql) =>
  spawnSync(psql, [...connectionFlags(), "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", sql], {
    encoding: "utf8",
    env: connectionEnv(),
  }).status === 0;

const runFile = (db, file, { quiet = true } = {}) => {
  try {
    execFileSync(psql, [...connectionFlags(), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", db, "-f", path.join(here, file)], {
      encoding: "utf8",
      env: connectionEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (!quiet) process.stderr.write(`${error.stdout ?? ""}${error.stderr ?? ""}`);
    throw error;
  }
};

const failures = [];

/** Records one assertion and prints it. */
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label} (expected ${expected}, got ${actual})`);
  if (!ok) failures.push(`${label}: expected ${expected}, got ${actual}`);
  return ok;
};

const checkTruthy = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(label);
  return ok;
};

/**
 * Reads the `metric=value` lines printed by _per_preparer_verify.sql.
 *
 * \t and \a make psql emit unaligned, undecorated output, so every line is
 * exactly one metric and nothing else has to be stripped out of it.
 */
const measure = (db) => {
  const output = execFileSync(psql, [...connectionFlags(), "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-d", db, "-f", path.join(here, "_per_preparer_verify.sql")], {
    encoding: "utf8",
    env: connectionEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const values = {};
  for (const line of String(output).split("\n")) {
    const match = /^([a-z0-9_]+)=([\s\S]*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].trim();
  }
  if (!String(output).includes("ALL CHECKS COMPLETE")) {
    throw new Error(`verification script did not run to the end:\n${output}`);
  }
  return values;
};

/* ------------------------------------------------------------------ set up */

// `authenticated` is the unprivileged role PostgREST uses in Supabase, and row
// level security is BYPASSED for a table's owner. Measuring from `postgres`
// would therefore report the right numbers for a reason that proves nothing.
//
// CREATE ROLE has no IF NOT EXISTS, so a re-run fails with duplicate_object.
// That is the expected outcome and is ignored: roles are cluster-global, so
// creating it once is enough. Done here rather than in the fixture because the
// usual do-block guard needs plpgsql, which some machines cannot load at all.
if (!accepts("postgres", "create role authenticated")) {
  console.log("Role `authenticated` already exists, reusing it.");
}

console.log("Dropping any previous test database...");
query("postgres", `drop database if exists ${TEST_DB}`);

console.log("Creating a stand-in schema with two preparers in one branch...");
query("postgres", `create database ${TEST_DB}`);
runFile(TEST_DB, "_per_preparer_fixture.sql");

/* --------------------------------------------------------------- before */

console.log("\nBefore the change, confirming the problem is real:");
{
  const m = measure(TEST_DB);
  // A and B share the Longhorn Associates books, so this is the mixture of
  // vouchers the change is about, reproduced rather than assumed.
  check("preparer A sees a colleague's voucher", Number(m.preparer_a_colleague) > 0 ? "yes" : "no", "yes");
  check("preparer A can read the colleague's voucher by name", m.preparer_a_reads_b_voucher, "1");
  check("preparer A can edit the colleague's voucher", m.preparer_a_updated_b_rows, "1");
  check("preparer A can delete the colleague's voucher", m.preparer_a_deleted_b_rows, "1");
  check("preparer A can file a voucher under the colleague", accepts(TEST_DB, AS_PREPARER_A_FILING), true);
}

/* -------------------------------------------------------------- migration */

console.log("\nApplying database/per_preparer_workspace.sql...");
runFile(TEST_DB, "per_preparer_workspace.sql");
console.log("  applied");
runFile(TEST_DB, "per_preparer_workspace.sql");
console.log("  re-applied, so it is idempotent");

/*
 * Measured here, before anything else touches the table.
 *
 * Postgres ORs permissive policies together, so a leftover second rule quietly
 * re-widens whatever it covers. database/per_preparer_workspace.sql has to
 * leave exactly one policy per command, and these are the statements that make
 * that true.
 */
console.log("\nChecking the policy layout the migration leaves behind:");
for (const cmd of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
  const count = query(
    TEST_DB,
    `select count(*) from pg_policies where schemaname = 'public' and tablename = 'vouchers' and cmd = '${cmd}'`,
  ).trim();
  check(`exactly one ${cmd} policy on vouchers`, count, "1");
}

/*
 * The looser script in database/vouchers_rls_policies.sql adds a DELETE rule that
 * any preparer may delete any voucher with. Anyone who has run that file already
 * has it, and its own header now says not to re-run it, but the rule may well
 * still be sitting there.
 *
 * Re-running it here proves two things: that the isolation survives a loose rule
 * being present, because a row the preparer cannot even read cannot be deleted,
 * and that the migration removes the rule again when it is applied afterwards.
 * That is the recovery path the migration documents.
 */
console.log("\nRe-running the older database/vouchers_rls_policies.sql...");
runFile(TEST_DB, "vouchers_rls_policies.sql");
console.log("  applied, with its looser DELETE rule back in place");

const looseRuleCount = query(
  TEST_DB,
  "select count(*) from pg_policies where schemaname = 'public' and tablename = 'vouchers' and cmd = 'DELETE'",
).trim();
check("the old file does re-add a looser DELETE rule", looseRuleCount, "2");

/* ---------------------------------------------------------------- after */

console.log("\nAfter the change, checking each preparer is isolated:");
{
  const m = measure(TEST_DB);
  check("preparer A sees their own voucher", m.preparer_a_own, "1");
  check("preparer A sees no colleague's voucher", m.preparer_a_colleague, "0");
  check("preparer A still sees no other branch's voucher", m.preparer_a_other_branch, "0");
  check("preparer A's workspace holds only their own voucher", m.preparer_a_total, "1");
  check("preparer A cannot read the colleague's voucher by name", m.preparer_a_reads_b_voucher, "0");
  check("preparer A cannot edit the colleague's voucher", m.preparer_a_updated_b_rows, "0");
  check("preparer A cannot delete the colleague's voucher", m.preparer_a_deleted_b_rows, "0");
  checkTruthy("preparer A cannot file a voucher under the colleague", !accepts(TEST_DB, AS_PREPARER_A_FILING), "rejected by Postgres");
  checkTruthy("preparer A cannot move their voucher to another branch", !accepts(TEST_DB, AS_PREPARER_A_CROSS_BRANCH), "rejected by Postgres");

  // The older permissive INSERT policy that a real database may still carry.
  // While it exists, Postgres ORs it with the new rule, so it silently wins and
  // an approver can create a voucher. This is the check that says the migration
  // removed it by name rather than merely adding a tighter policy beside it.
  checkTruthy("an approver cannot create a voucher", !accepts(TEST_DB, AS_APPROVER_INSERT), "rejected by Postgres");

  // The rules are worthless if they also lock the owner out.
  check("preparer A still reads their own voucher", m.preparer_a_reads_own, "1");
  check("preparer A still edits their own voucher", m.preparer_a_updated_own_rows, "1");
  check("preparer A still deletes their own voucher", m.preparer_a_deleted_own_rows, "1");

  check("approver still sees the whole ledger", Number(m.approver_total) >= 3 ? "yes" : "no", "yes");
  check("approver can still approve a colleague's voucher", m.approver_updated_b_rows, "1");
  check("admin still sees the whole ledger", Number(m.admin_total) >= 3 ? "yes" : "no", "yes");
  check("admin can still delete another preparer's voucher", m.admin_deleted_b_rows, "1");
}

/* ----------------------------------------------------- the recovery path */

/*
 * Applying the migration again has to clear the loose rule the old file put
 * back, which is what the migration's own comments tell someone to do. If it did
 * not, a database that had run vouchers_rls_policies.sql would keep a rule that
 * says any preparer may delete anything.
 */
console.log("\nRe-applying the migration to clear the loose rule:");
runFile(TEST_DB, "per_preparer_workspace.sql");
const cleared = query(
  TEST_DB,
  "select count(*) from pg_policies where schemaname = 'public' and tablename = 'vouchers' and cmd = 'DELETE'",
).trim();
check("re-applying leaves exactly one DELETE policy again", cleared, "1");

/* --------------------------------------------------------------- teardown */

console.log("\nCleaning up...");
query("postgres", `drop database if exists ${TEST_DB}`);
console.log("  dropped " + TEST_DB);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("\nPer-preparer workspaces verified.");