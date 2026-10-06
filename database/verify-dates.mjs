// Runs database/_date_align_verify.sql as part of npm run db:verify.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(here, "..", "database");
const TEST_DB = "lh_date_align_test";

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

const run = (args, cwd = dbDir) => {
  const result = spawnSync(psql, [...flags, ...args], { encoding: "utf8", env, cwd });
  if (result.status !== 0) throw new Error(result.stderr || "psql failed");
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
};

console.log("Verifying approval date alignment...");

run(["-c", `drop database if exists ${TEST_DB}`]);
run(["-c", `create database ${TEST_DB}`]);
run(["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", TEST_DB, "-f", "_migration_test_setup.sql"]);
run(["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", TEST_DB, "-f", "_voucher_cols.sql"]);
run(["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", TEST_DB, "-f", "multi_company_setup.sql"]);

let output = "";
try {
  output = run(["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", TEST_DB, "-f", "_date_align_verify.sql"]);
} catch (error) {
  console.error(String(error.message).slice(0, 2000));
  process.exit(1);
} finally {
  try {
    run(["-c", `drop database if exists ${TEST_DB}`]);
  } catch {
    // Nothing useful to do if cleanup fails.
  }
}

const lines = output.split("\n").filter((line) => /PASS:|FAIL:/.test(line));
let failed = 0;
for (const line of lines) {
  const label = line.replace(/^psql[^\n]*?NOTICE:\s*/, "").replace(/^(PASS|FAIL):\s*/, "");
  console.log(`  ${/PASS:/.test(line) ? "PASS" : "FAIL"}: ${label}`);
  if (/FAIL:/.test(line)) failed += 1;
}

if (!output.includes("DATE-ALIGNMENT CHECKS COMPLETE")) {
  console.error("  FAIL: the date-alignment checks did not run to the end");
  failed += 1;
}

process.exit(failed ? 1 : 0);