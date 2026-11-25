import { getCloudflareContext } from "@opennextjs/cloudflare";
import { MIGRATIONS } from "./schema";
import { seedIfEmpty } from "./seed";

export type Env = {
  DB: D1Database;
  SESSION_SECRET?: string;
};

export async function getEnv(): Promise<Env> {
  const { env } = await getCloudflareContext({ async: true });
  return env as unknown as Env;
}

/**
 * Runs migrations once per isolate. Safe to call at the top of every request:
 * the promise is memoised, and each migration is guarded by a row in
 * _migrations, so a cold start after a deploy applies only what is missing.
 */
let migrated: Promise<void> | null = null;

export function db(): Promise<D1Database> {
  if (!migrated) migrated = migrate();
  return migrated.then(() => db_handle());
}

async function db_handle(): Promise<D1Database> {
  const env = await getEnv();
  if (!env.DB) {
    throw new Error(
      "D1 binding `DB` is missing. Run `next dev` with the wrangler config, or deploy with the database bound.",
    );
  }
  return env.DB;
}

async function migrate(): Promise<void> {
  const handle = await db_handle();
  await handle
    .prepare("CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
    .run();

  const applied = await handle.prepare("SELECT id FROM _migrations").all<{ id: string }>();
  const done = new Set((applied.results ?? []).map((row) => row.id));

  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    const statements = migration.sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await handle.prepare(statement).run();
    }
    await handle
      .prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)")
      .bind(migration.id, new Date().toISOString())
      .run();
  }

  // A fresh environment should never show an empty app.
  await seedIfEmpty(handle);
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
