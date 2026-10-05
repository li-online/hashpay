import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "@/server/types/env";

const migrationNames = ["0001_init.sql", "0002_order_tx.sql"];

describe("D1 migrations", () => {
  it("loads SQL migration files in filename order", async () => {
    const { d1Migrations } = await loadMigrations();

    expect(d1Migrations.map((migration) => migration.name)).toEqual(migrationNames);
  });

  it("applies migration files through the Worker D1 binding", async () => {
    const { migrateD1 } = await loadMigrations();
    const env = migrationEnv(false);

    const result = await migrateD1(env);

    expect(result.applied).toEqual(migrationNames);
    expect(env.DB.exec).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS d1_migrations"));
    expect(env.DB.exec).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS configs"));
    expect(env.DB.exec).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS notify"));
    expect(env.DB.exec).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS review"));
    expect(env.DB.exec).toHaveBeenCalledWith(expect.stringContaining("ALTER TABLE orders ADD COLUMN driver TEXT"));
    expect(env.DB.exec).toHaveBeenCalledWith(expect.stringContaining("CREATE UNIQUE INDEX orders_driver_txid_unique"));
    expect(env.DB.exec).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE orders"));
    expect(env.applied).toEqual(new Set(migrationNames));
  });

  it("uses migration records as the source of truth", async () => {
    const { migrateD1 } = await loadMigrations();
    const env = migrationEnv(migrationNames);

    const result = await migrateD1(env);

    expect(result).toEqual({ applied: [] });
    expect(env.DB.exec).toHaveBeenCalledTimes(1);
    expect(env.DB.batch).not.toHaveBeenCalled();
    expect(env.applied).toEqual(new Set(migrationNames));
  });

  it("does not touch D1 again after a successful migration in the same isolate", async () => {
    const { migrateD1 } = await loadMigrations();
    const env = migrationEnv(false);

    await migrateD1(env);
    vi.mocked(env.DB.exec).mockClear();
    vi.mocked(env.DB.batch).mockClear();

    await expect(migrateD1(env)).resolves.toEqual({ applied: [] });
    expect(env.DB.exec).not.toHaveBeenCalled();
    expect(env.DB.batch).not.toHaveBeenCalled();
  });

  it("shares one migration promise for concurrent first requests", async () => {
    const { migrateD1 } = await loadMigrations();
    const env = migrationEnv(false);
    let release: (() => void) | undefined;
    vi.mocked(env.DB.exec).mockImplementation(async (sql: string) => {
      if (!release) await new Promise<void>((resolve) => { release = resolve; });
      return env.applyExec(sql);
    });

    const first = migrateD1(env);
    const second = migrateD1(env);
    release?.();

    const [a, b] = await Promise.all([first, second]);

    expect(a.applied).toEqual(migrationNames);
    expect(b).toBe(a);
    expect(env.DB.exec).toHaveBeenCalledTimes(migrationNames.length + 1);
  });
});

async function loadMigrations() {
  vi.resetModules();
  return import("@/server/db/migrations");
}

function migrationEnv(applied: string[] | false) {
  const state = {
    applied: new Set(applied || []),
  };
  const applyExec = async (sql: string) => {
    const name = sql.match(/INSERT INTO d1_migrations \(name\) VALUES \('([^']+)'\)/)?.[1];
    if (name) state.applied.add(name);
    return {};
  };
  const env = {
    applied: state.applied,
    applyExec,
    DB: {
      batch: vi.fn(async (statements: { run: () => Promise<unknown> }[]) => {
        for (const statement of statements) await statement.run();
        return [];
      }),
      exec: vi.fn(applyExec),
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...args: unknown[]) {
            values = args;
            return this;
          },
          async all() {
            if (sql.includes("FROM d1_migrations")) {
              return { results: [...state.applied].map((name) => ({ name })) };
            }
            return { results: [] };
          },
          async first() {
            return null;
          },
          async run() {
            state.applied.add(String(values[0]));
            return {};
          },
        };
      },
    },
  } as unknown as AppEnv & {
    applied: Set<string>;
    applyExec: (sql: string) => Promise<Record<string, never>>;
    DB: AppEnv["DB"] & { batch: ReturnType<typeof vi.fn>; exec: ReturnType<typeof vi.fn> };
  };
  return env;
}
