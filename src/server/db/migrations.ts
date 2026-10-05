import { all, exec } from "@/server/db";
import type { AppEnv } from "@/server/types/env";

const migrationSources = import.meta.glob("./d1/migrations/*.sql", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

export const d1Migrations = Object.entries(migrationSources)
  .map(([path, sql]) => ({ name: path.split("/").pop()!, sql: sql.trim() }))
  .sort((a, b) => a.name.localeCompare(b.name));

type MigrationResult = { applied: string[] };

let migrated = false;
let migration: Promise<MigrationResult> | null = null;

export async function migrateD1(env: AppEnv) {
  if (migrated) return { applied: [] };
  migration ??= runD1Migrations(env).then(
    (result) => {
      migrated = true;
      migration = null;
      return result;
    },
    (error) => {
      migration = null;
      throw error;
    },
  );
  return migration;
}

async function runD1Migrations(env: AppEnv): Promise<MigrationResult> {
  await exec(env, "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);");

  const applied = await appliedMigrations(env);
  const missing = d1Migrations.filter((migration) => !applied.has(migration.name));
  if (!missing.length) return { applied: [] };

  const migrated: string[] = [];
  for (const migration of missing) {
    await exec(env, `${sqlBlock(migration.sql)}\nINSERT INTO d1_migrations (name) VALUES (${sqlString(migration.name)});`);
    migrated.push(migration.name);
  }

  return { applied: migrated };
}

async function appliedMigrations(env: AppEnv) {
  return new Set((await all<{ name: string }>(env, "SELECT name FROM d1_migrations ORDER BY id")).map((row) => row.name));
}

function sqlBlock(sql: string) {
  const compact = sql.split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
  return compact.endsWith(";") ? compact : `${compact};`;
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
