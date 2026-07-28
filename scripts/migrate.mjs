// Migration runner for supabase/migrations/*.sql.
//
// Applies pending migration files in filename order against the linked Supabase
// project and records each one in mykan.schema_migrations, so "which migrations
// have run?" has an answer that doesn't depend on anyone's memory.
//
//   npm run db:migrate                 apply everything pending
//   npm run db:migrate -- --status     what's applied, what's pending, any drift
//   npm run db:migrate -- --dry-run    show what would run, change nothing
//   npm run db:migrate -- --baseline   mark all current files applied WITHOUT running
//
// --baseline exists for adoption: the 14 migrations that predate this runner were
// already applied by hand, and several are not safely re-runnable (a drop column,
// a data backfill). Baseline seeds the ledger from the files on disk so the first
// real run only picks up what comes next. Use it once, on a database you know
// already matches the tree.
//
// Local-only dev tool. It talks to the Management API with a personal access
// token, which must never reach Vercel runtime or git.
//
// Transactions: each file is wrapped in begin/commit together with its ledger
// insert, so a failure rolls the whole thing back and the migration stays
// pending — no half-applied file recorded as done. A file that manages its own
// transaction (2026-06-28-move-to-mykan-schema.sql does) is detected and left
// alone; so is one marked `-- migrate:no-transaction`, which you need for
// statements Postgres refuses to run inside a transaction block (CREATE INDEX
// CONCURRENTLY, ALTER TYPE ... ADD VALUE). In both of those cases the ledger
// insert lands in its own statement immediately after.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

const LEDGER_DDL = `
create table if not exists mykan.schema_migrations (
  filename   text primary key,
  checksum   text not null,
  applied_at timestamptz not null default now()
);
-- Same posture as every other mykan table: RLS on, no policies. The app reaches
-- Supabase only with the service role key, which bypasses RLS, so this is a
-- deny-all for anon/authenticated. Without it the security advisor would flag a
-- brand new rls_disabled_in_public the moment this table is created.
alter table mykan.schema_migrations enable row level security;
`;

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  // Written by `supabase link`; gitignored, so it's per-machine, not shared.
  try {
    return readFileSync(join(ROOT, "supabase", ".temp", "project-ref"), "utf8").trim();
  } catch {
    fail(
      "Cannot determine the Supabase project ref.\n" +
        "Set SUPABASE_PROJECT_REF in your environment or .env.local, or run `supabase link`.",
    );
  }
}

const REF = projectRef();
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  fail(
    "Missing SUPABASE_ACCESS_TOKEN.\n" +
      "It is a Supabase personal access token (account-level, not the database password).\n" +
      "Export it in your shell or add it to .env.local — never commit it.",
  );
}

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const checksum = (contents) => createHash("sha256").update(contents).digest("hex");

// A file "owns its transaction" if it opens one itself, or opts out explicitly.
// Matching at line start avoids false hits on the word inside a comment or string.
function ownsTransaction(sql) {
  return /^\s*begin\s*;/im.test(sql) || /^\s*--\s*migrate:no-transaction\s*$/im.test(sql);
}

async function readMigrations() {
  let entries;
  try {
    entries = await readdir(MIGRATIONS_DIR);
  } catch {
    fail(`No migrations directory at ${MIGRATIONS_DIR}`);
  }
  // Filenames are date-prefixed (2026-07-28-…), so lexicographic order is
  // chronological order. Anything added later must keep that prefix.
  const files = entries.filter((f) => f.endsWith(".sql")).sort();
  return Promise.all(
    files.map(async (filename) => {
      const sql = await readFile(join(MIGRATIONS_DIR, filename), "utf8");
      return { filename, sql, checksum: checksum(sql) };
    }),
  );
}

async function readLedger() {
  await query(LEDGER_DDL);
  const rows = await query(
    "select filename, checksum, applied_at from mykan.schema_migrations order by filename;",
  );
  return new Map(rows.map((r) => [r.filename, r]));
}

// An applied file whose contents changed since it ran is a real problem: the
// database no longer matches the tree, and nothing will ever re-run it. Report
// it rather than silently carrying on.
function reportDrift(migrations, ledger) {
  const drifted = migrations.filter((m) => {
    const row = ledger.get(m.filename);
    return row && row.checksum !== m.checksum;
  });
  for (const m of drifted) {
    console.error(`  ! ${m.filename} — edited since it was applied (checksum mismatch)`);
  }
  return drifted;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.find((a) => ["--status", "--dry-run", "--baseline"].includes(a)) ?? "--apply";
  const unknown = args.filter((a) => a.startsWith("-") && a !== mode);
  if (unknown.length) fail(`Unknown option(s): ${unknown.join(", ")}`);

  const migrations = await readMigrations();
  const ledger = await readLedger();
  const pending = migrations.filter((m) => !ledger.has(m.filename));

  if (mode === "--status") {
    console.log(`${migrations.length} migration file(s), ${ledger.size} applied:\n`);
    for (const m of migrations) {
      const row = ledger.get(m.filename);
      const when = row ? new Date(row.applied_at).toISOString().slice(0, 16).replace("T", " ") : "";
      console.log(`  ${row ? "✓" : "·"} ${m.filename}${when ? `  ${when}` : "  (pending)"}`);
    }
    const drifted = reportDrift(migrations, ledger);
    console.log(`\n${pending.length} pending, ${drifted.length} drifted.`);
    process.exit(drifted.length ? 1 : 0);
  }

  if (mode === "--baseline") {
    if (!pending.length) return console.log("Nothing to baseline — every file is already recorded.");
    const values = pending.map((m) => `(${quote(m.filename)}, ${quote(m.checksum)})`).join(", ");
    await query(
      `insert into mykan.schema_migrations (filename, checksum) values ${values} on conflict (filename) do nothing;`,
    );
    console.log(`Baselined ${pending.length} file(s) as already applied (nothing was executed):`);
    for (const m of pending) console.log(`  = ${m.filename}`);
    return;
  }

  const drifted = reportDrift(migrations, ledger);
  if (drifted.length) console.error("");

  if (!pending.length) {
    console.log(`Up to date — ${ledger.size} migration(s) applied, 0 pending.`);
    process.exit(drifted.length ? 1 : 0);
  }

  if (mode === "--dry-run") {
    console.log(`${pending.length} pending migration(s) would run, in this order:`);
    for (const m of pending) {
      console.log(`  → ${m.filename}${ownsTransaction(m.sql) ? "  (manages its own transaction)" : ""}`);
    }
    process.exit(drifted.length ? 1 : 0);
  }

  console.log(`Applying ${pending.length} migration(s) to ${REF}:\n`);
  for (const m of pending) {
    const record = `insert into mykan.schema_migrations (filename, checksum) values (${quote(m.filename)}, ${quote(m.checksum)});`;
    const sql = ownsTransaction(m.sql)
      ? `${m.sql}\n${record}`
      : `begin;\n${m.sql}\n${record}\ncommit;`;
    process.stdout.write(`  → ${m.filename} … `);
    try {
      await query(sql);
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      console.error(`\n${err.message}\n`);
      console.error(
        ownsTransaction(m.sql)
          ? "This file manages its own transaction, so it may be partially applied — check the database before retrying."
          : "Rolled back; nothing was applied and the migration is still pending.",
      );
      console.error(`Stopped. ${pending.length - pending.indexOf(m) - 1} later migration(s) not attempted.`);
      process.exit(1);
    }
  }
  console.log(`\nDone — ${pending.length} applied, ${ledger.size + pending.length} total.`);
  if (drifted.length) process.exit(1);
}

await main();
