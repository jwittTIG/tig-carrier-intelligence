/**
 * One-time move of the app's data from this PC's database to the new Render database
 * (DECISIONS D8a; steps in docs/DEPLOY.md).
 *
 *   npm run data:move               dry run: checks both databases and prints row counts
 *   npm run data:move -- --commit   copies every row, in one transaction, then checks counts
 *
 * Source: DATABASE_URL from .env.local (only read, never changed).
 * Target: MOVE_TARGET_DATABASE_URL, set in your own terminal for this one command (Render's
 *         "External Database URL"). It is never saved to a file.
 *
 * Refuses unless the target has exactly the same migrations applied and every app table in
 * it is empty: it never overwrites or merges. Uploaded files are copied separately (scp).
 */
import { config } from "dotenv";
import pg from "pg";
import { insertOrder, orderSelfReferencing, type ForeignKey } from "./move-data-lib";

config({ path: ".env.local", quiet: true });

type Column = { name: string; type: string };

async function tables(c: pg.Client): Promise<string[]> {
  const r = await c.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`,
  );
  return r.rows.map((x) => x.table_name);
}

async function foreignKeys(c: pg.Client): Promise<ForeignKey[]> {
  const r = await c.query<{ child: string; parent: string; columns: string[]; refs: string[] }>(`
    SELECT cl.relname AS child, pcl.relname AS parent,
      ARRAY(SELECT a.attname::text FROM unnest(co.conkey) WITH ORDINALITY k(n, i) JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = k.n ORDER BY k.i) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(co.confkey) WITH ORDINALITY k(n, i) JOIN pg_attribute a ON a.attrelid = co.confrelid AND a.attnum = k.n ORDER BY k.i) AS refs
    FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    JOIN pg_class pcl ON pcl.oid = co.confrelid
    WHERE co.contype = 'f' AND ns.nspname = 'public'`);
  return r.rows;
}

async function columns(c: pg.Client, table: string): Promise<Column[]> {
  const r = await c.query<{ column_name: string; data_type: string; is_generated: string }>(
    `SELECT column_name, data_type, is_generated FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return r.rows.filter((x) => x.is_generated !== "ALWAYS").map((x) => ({ name: x.column_name, type: x.data_type }));
}

async function migrations(c: pg.Client): Promise<string[]> {
  const r = await c.query<{ migration_name: string }>(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`);
  return r.rows.map((x) => x.migration_name);
}

async function count(c: pg.Client, table: string): Promise<number> {
  const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${table}"`);
  return Number(r.rows[0].n);
}

const q = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function main() {
  const commit = process.argv.includes("--commit");
  const sourceUrl = process.env.DATABASE_URL;
  const targetUrl = process.env.MOVE_TARGET_DATABASE_URL;
  if (!sourceUrl) throw new Error("DATABASE_URL (this PC's database) is not set in .env.local");
  if (!targetUrl) throw new Error("Set MOVE_TARGET_DATABASE_URL to the Render database's External Database URL for this command (docs/DEPLOY.md)");
  if (sourceUrl === targetUrl) throw new Error("Refusing: source and target are the same database");

  const source = new pg.Client({ connectionString: sourceUrl });
  const target = new pg.Client({ connectionString: targetUrl, ssl: /localhost|127\.0\.0\.1/.test(targetUrl) ? undefined : { rejectUnauthorized: true } });
  await source.connect();
  await target.connect();
  try {
    // Same schema on both sides.
    const [sm, tm] = await Promise.all([migrations(source), migrations(target)]);
    if (sm.join() !== tm.join()) {
      throw new Error(`Refusing: the databases are at different migrations.\n  this PC: ${sm.length} (last ${sm.at(-1)})\n  target:  ${tm.length} (last ${tm.at(-1) ?? "none"})\nDeploy the same code to Render first (it applies migrations on start).`);
    }
    const names = await tables(source);
    const targetNames = await tables(target);
    if (names.join() !== targetNames.join()) throw new Error("Refusing: the two databases have different tables.");

    // Target must be empty: never merge or overwrite.
    const notEmpty: string[] = [];
    for (const t of targetNames) if ((await count(target, t)) > 0) notEmpty.push(t);
    if (notEmpty.length) throw new Error(`Refusing: the target already has data in ${notEmpty.length} table(s): ${notEmpty.slice(0, 8).join(", ")}${notEmpty.length > 8 ? ", …" : ""}`);

    const fks = await foreignKeys(source);
    const order = insertOrder(names, fks);
    const counts = new Map<string, number>();
    for (const t of order) counts.set(t, await count(source, t));
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    console.log(`This PC: ${names.length} tables, ${total} rows. Target: same ${sm.length} migrations, empty.`);
    for (const t of order) if (counts.get(t)) console.log(`  ${t}: ${counts.get(t)}`);
    if (!commit) {
      console.log("\nDry run only. Nothing was copied. Run again with --commit to copy.");
      return;
    }

    await target.query("BEGIN");
    try {
      for (const t of order) {
        if (!counts.get(t)) continue;
        const cols = await columns(source, t);
        const selfRefs = fks.filter((f) => f.child === t && f.parent === t);
        let rows = (await source.query(`SELECT ${cols.map((c) => q(c.name)).join(", ")} FROM ${q(t)}`)).rows as Record<string, unknown>[];
        if (selfRefs.length) rows = orderSelfReferencing(rows, selfRefs);
        const json = new Set(cols.filter((c) => c.type === "json" || c.type === "jsonb").map((c) => c.name));
        const batch = Math.max(1, Math.floor(10_000 / cols.length));
        for (let i = 0; i < rows.length; i += batch) {
          const chunk = rows.slice(i, i + batch);
          const values: unknown[] = [];
          const tuples = chunk.map((row) =>
            `(${cols.map((c) => {
              const v = row[c.name];
              values.push(json.has(c.name) && v !== null ? JSON.stringify(v) : v);
              return `$${values.length}`;
            }).join(", ")})`,
          );
          await target.query(`INSERT INTO ${q(t)} (${cols.map((c) => q(c.name)).join(", ")}) VALUES ${tuples.join(", ")}`, values);
        }
        console.log(`  copied ${t}: ${rows.length}`);
      }
      // Check every count before committing.
      for (const t of order) {
        const n = await count(target, t);
        if (n !== counts.get(t)) throw new Error(`Count mismatch in ${t}: this PC ${counts.get(t)}, target ${n}`);
      }
      await target.query("COMMIT");
    } catch (e) {
      await target.query("ROLLBACK");
      throw e;
    }
    console.log(`\nDone: ${total} rows copied and counts match in all ${names.length} tables.`);
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error && e.message ? e.message : e);
  process.exit(1);
});
