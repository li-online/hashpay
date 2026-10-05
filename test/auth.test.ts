import { describe, expect, it } from "vitest";
import { confirmLoginPin, consumeLoginPin, createLoginChallenge } from "@/server/services/auth/pin";
import { signSession, verifySession } from "@/server/services/auth/session";
import type { AppEnv } from "@/server/types/env";

function testEnv() {
  const configs = new Map<string, string | null>();
  const env = {
    APP_SECRET: "test-secret",
    DB: {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...args: unknown[]) {
            values = args;
            return this;
          },
          async first() {
            if (!sql.includes("SELECT value FROM configs")) return null;
            const key = String(values[0]);
            return configs.has(key) ? { value: configs.get(key) } : null;
          },
          async run() {
            const key = String(values[0]);
            if (sql.includes("DELETE FROM configs")) configs.delete(key);
            else configs.set(key, values[1] as string | null);
            return {};
          },
        };
      },
    },
  } as AppEnv;
  return env;
}

describe("jwt session", () => {
  it("signs and verifies telegram user", async () => {
    const env = { APP_SECRET: "test-secret" } as AppEnv;
    const token = await signSession(env, { firstName: "Admin", id: 123, lastName: "User" });
    await expect(verifySession(env, token)).resolves.toMatchObject({ firstName: "Admin", id: 123, lastName: "User" });
  });
});

describe("web login pin", () => {
  it("only authenticates after bot confirmation and consumes once", async () => {
    const env = testEnv();
    const { challenge, command } = await createLoginChallenge(env, "123456");

    expect(command).toBe("/login 123456");
    await expect(consumeLoginPin(env, "123456", challenge)).resolves.toBeNull();

    await confirmLoginPin(env, "123456", { firstName: "Admin", id: 123, lastName: "" });
    await expect(consumeLoginPin(env, "123456", challenge)).resolves.toMatchObject({ firstName: "Admin", id: 123 });
    await expect(consumeLoginPin(env, "123456", challenge)).resolves.toBeNull();
  });
});
