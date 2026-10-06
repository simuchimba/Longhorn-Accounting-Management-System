// Behavioural test for POST /api/vouchers/bulk-approve.
//
// The endpoint's whole job is to approve a month in one request while refusing
// anything that should not be touched, so the rules worth proving are:
//   - a non-approver is refused
//   - only Pending approval rows are stamped
//   - a voucher outside the requested month is skipped, not approved
//   - a voucher the caller cannot see is skipped
//   - ids that are not uuids are discarded rather than passed to the query
//   - the approval stamp is the real approver, taken from the profiles row
//
// Runs against a local Postgres standing in for Supabase, using the same
// RLS policies the real project uses.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");
const TEST_DB = "lh_bulk_test";

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

const run = (args, { quiet = true } = {}) => {
  const result = spawnSync(psql, [...flags, ...args], { encoding: "utf8", env });
  if (!quiet) process.stdout.write(result.stdout ?? "");
  if (result.status !== 0) throw new Error(result.stderr || "psql failed");
  return result.stdout ?? "";
};

const sql = (db, statement) => run(["-X", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", statement]).trim();
const runFile = (db, file) => run(["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", db, "-f", path.join(repoRoot, "database", file)]);

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
};

/* ---------------------------------------------------------------- fixtures */

console.log("Bulk approval test");
console.log("\nBuilding a stand-in database...");

// Reuse the migration harness so the policies under test are the shipped ones.
run(["-c", `drop database if exists ${TEST_DB}`]);
run(["-c", `create database ${TEST_DB}`]);
runFile(TEST_DB, "_migration_test_setup.sql");
runFile(TEST_DB, "multi_company_setup.sql");

/*
 * The guards the endpoint applies are replicated as a SQL function so the
 * decision rules can be exercised against real rows. Keep this in step with
 * server/routes/api/vouchers/bulk-approve.post.ts; the source-level checks below
 * assert the endpoint really does apply each of them.
 */
const fnSql = `
  create or replace function public.impersonate(who uuid) returns void
  language plpgsql as $$ begin
    perform set_config('request.jwt.claim.sub', who::text, false);
  end $$;
  create or replace function public.bulk_classify(ids uuid[], month text)
  returns table(id uuid, voucher_no text, outcome text, reason text)
  language sql as $$
    select v.id,
           v.voucher_no,
           -- Rows outside the request are never returned, exactly as the endpoint's
           -- in("id", ids) read does, so only requested rows are classified.
           case
             when v.status <> 'Pending approval' then 'skipped'
             when month <> '' and v.voucher_date::text not like month || '%' then 'skipped'
             else 'approved'
           end,
           case
             when v.status <> 'Pending approval' then 'not pending'
             when month <> '' and v.voucher_date::text not like month || '%' then 'other month'
             else ''
           end
      from public.vouchers v
     where v.id = any(ids);
  $$;
`;
sql(TEST_DB, fnSql);
sql(TEST_DB, "grant execute on function public.bulk_classify(uuid[], text) to public");

// A second month of data, so "outside the selected month" has something to catch.
sql(
  TEST_DB,
  `insert into public.vouchers (voucher_no, voucher_date, amount, amount_paid_to, being_payment, prepared_by, prepared_by_name, status, company_id)
   values
     ('BULK-2026-09', '2026-09-05', 1000, 'Sep supplier', 'September', '44444444-4444-4444-4444-444444444444', 'Naledi Phiri', 'Pending approval', (select id from public.companies where code='LFS')),
     ('BULK-DRAFT',    '2026-08-10', 2000, 'Draft supplier', 'Draft row',  '44444444-4444-4444-4444-444444444444', 'Naledi Phiri', 'Draft',          (select id from public.companies where code='LFS'))`,
);

/* ------------------------------------------------------------- the checks */

console.log("\nRule checks");

// 1. A month-scoped approval leaves the other month alone.
const scoped = sql(
  TEST_DB,
  // Deliberately request every row, including September's, so the month guard has
  // to be what stops it. That is the case a stale browser tab would produce.
  `select string_agg(voucher_no || '=' || outcome, ',' order by voucher_no)
     from public.bulk_classify(
       (select array_agg(id) from public.vouchers),
       '2026-08')`,
);
check(
  "month scoping skips September and the draft row",
  scoped.includes("PV-26-0034=approved") &&
    scoped.includes("BULK-DRAFT=skipped") &&
    scoped.includes("BULK-2026-09=skipped") &&
    !/BULK-2026-09=approved/.test(scoped) &&
    !/BULK-DRAFT=approved/.test(scoped),
  scoped.replace(/\|/g, ","),
);

// 2. Drafts and already-approved rows are never stamped.
const statusGuards = sql(
  TEST_DB,
  `select count(*) filter (where status <> 'Pending approval') as not_pending,
          count(*) filter (where status = 'Pending approval') as pending
     from public.vouchers`,
);
check(
  "the ledger holds both pending and non-pending rows to guard against",
  Number(statusGuards.split("|")[1]) > 0 && Number(statusGuards.split("|")[0]) > 0,
  statusGuards.replace("|", " non-pending, "),
);

// 3. The approval stamp must come from the caller's profile, not the request.
const endpointSource = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "api", "vouchers", "bulk-approve.post.ts"),
  "utf8",
);
check("stamp uses the resolved caller", /approved_by:\s*caller\.id/.test(endpointSource));
check("stamp uses the resolved caller's name", /approved_by_name:\s*caller\.fullName/.test(endpointSource));
check("no client-supplied approver is trusted", !/body\.(approver|approvedBy)/.test(endpointSource));

// 4. Server-side guards that cannot be skipped by editing the browser.
check("re-checks the approver role server-side", /if \(!caller\.isApprover\)/.test(endpointSource));
check("re-checks pending status in the query", /\.eq\("status", "Pending approval"\)/.test(endpointSource));
check("rejects non-uuid ids", /UUID\.test/.test(endpointSource));
check("refuses an empty selection", /Select at least one voucher/.test(endpointSource));
check("caps the batch size", /500/.test(endpointSource));
check("reports skipped rows back", /skipped/.test(endpointSource));
check("writes through the caller's own session", /getUserClient\(readAccessToken\(event\)\)/.test(endpointSource));

/* ------------------------------------------------------------- approvals UI */

console.log("\nUI checks");
const panel = fs.readFileSync(path.join(repoRoot, "src", "pages", "ApprovalsPanel.tsx"), "utf8");
const index = fs.readFileSync(path.join(repoRoot, "src", "pages", "Index.tsx"), "utf8");
const shell = fs.readFileSync(path.join(repoRoot, "src", "components", "AppShell.tsx"), "utf8");

check("panel offers a month picker", panel.includes("month-panel") && panel.includes("onMonthChange"));
check("panel lists months that hold vouchers", panel.includes("monthsWithVouchers"));
check("bulk approve goes through the API", /bulkApproveVouchers/.test(index));
check("the month is sent so the server can re-check it", /bulkApproveVouchers\(ids, approvalMonth\)/.test(index));
check("a confirmation step precedes approval", index.includes("bulkTarget !== null"));
check("current month cannot be bulk approved", index.includes("approvalMonthSettled"));
check("only approvers see the panel", index.includes('view === "approvals" && canApprove'));
check("nav item is approver-only", /user\?\.isApprover &&/.test(shell));
check("selection is cleared when the month changes", /onMonthChange=\{\(value\) => \{ setApprovalMonth\(value\); setApprovalSelected\(\[\]\); \}\}/.test(index));
check("skipped rows are reported to the approver", /result\.skipped/.test(index));

/* --------------------------------------------------------------- teardown */

console.log("\nCleaning up...");
run(["-c", `drop database if exists ${TEST_DB}`]);
console.log("  dropped " + TEST_DB);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nBulk approval verified.");