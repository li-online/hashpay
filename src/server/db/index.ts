import type { AppEnv } from "@/server/types/env";

export type D1Param = string | number | boolean | null | ArrayBuffer;

export function db(env: AppEnv) {
  if (!env.DB) throw new Error("DB binding is not configured");
  return env.DB;
}

export function statement(env: AppEnv, sql: string, params: readonly D1Param[] = []) {
  const prepared = db(env).prepare(sql);
  return params.length ? prepared.bind(...params) : prepared;
}

export function exec(env: AppEnv, sql: string) {
  return db(env).exec(sql);
}

export async function one<T>(env: AppEnv, sql: string, ...params: D1Param[]) {
  return statement(env, sql, params).first<T>();
}

export async function all<T>(env: AppEnv, sql: string, ...params: D1Param[]) {
  const result = await statement(env, sql, params).all<T>();
  return result.results ?? [];
}

export function run(env: AppEnv, sql: string, ...params: D1Param[]) {
  return statement(env, sql, params).run();
}

export function batch(env: AppEnv, statements: Array<[sql: string, ...params: D1Param[]]>) {
  return statements.length ? db(env).batch(statements.map(([sql, ...params]) => statement(env, sql, params))) : Promise.resolve([]);
}

export function now() {
  return Math.floor(Date.now() / 1000);
}

export function jsonParseObject<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export async function getConfig(env: AppEnv, key: string) {
  const row = await one<{ value: string | null }>(env, "SELECT value FROM configs WHERE key = ?", key);
  return row?.value ?? null;
}

export async function getConfigBlob(env: AppEnv, key: string) {
  const row = await one<{ blob: ArrayBuffer | null }>(env, "SELECT blob FROM configs WHERE key = ?", key);
  return row?.blob ?? null;
}

export async function setConfig(env: AppEnv, key: string, value: string | null, blob?: ArrayBuffer | null) {
  await run(
    env,
    `
      INSERT INTO configs(key, value, blob, updated_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        blob = excluded.blob,
        updated_at = excluded.updated_at
      `,
    key,
    value,
    blob ?? null,
    now(),
  );
}

export async function deleteConfig(env: AppEnv, key: string) {
  await run(env, "DELETE FROM configs WHERE key = ?", key);
}

export async function listConfigs(env: AppEnv) {
  const rows = await all<{ key: string; value: string | null }>(env, "SELECT key, value FROM configs ORDER BY key");
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (row.value != null) out[row.key] = row.value;
  }
  return out;
}

export async function setConfigs(env: AppEnv, values: Record<string, string>) {
  await batch(
    env,
    Object.entries(values).map(([key, value]) => [
      `
        INSERT INTO configs(key, value, updated_at)
        VALUES(?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
        `,
      key,
      value,
      now(),
    ]),
  );
}
