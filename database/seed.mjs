// Seeds the local longhorn-ledger Postgres database using database/longhorn_ledger_seed.sql
// Usage: npm run db:seed
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (avoids adding dotenv dependency)
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

const connectionString =
  process.env.NITRO_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error("Missing NITRO_DATABASE_URL in .env");
  process.exit(1);
}

const sqlPath = path.join(__dirname, "longhorn_ledger_seed.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

const client = new pg.Client({ connectionString });
try {
  await client.connect();
  await client.query(sql);
  const counts = await client.query(`
    SELECT (SELECT count(*) FROM users) AS users,
           (SELECT count(*) FROM departments) AS departments,
           (SELECT count(*) FROM vouchers) AS vouchers
  `);
  console.log("Seed complete:", counts.rows[0]);
} catch (error) {
  console.error("Seed failed:", error);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
