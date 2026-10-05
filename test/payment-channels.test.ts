import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/http/api";
import { checkChannels, savePayment } from "@/server/payments/channels";
import { decryptSecret } from "@/server/utils/crypto";
import type { AppEnv } from "@/server/types/env";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("payment channels", () => {
  it("keeps Binance ID as address and verifies it with API details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ uid: 34355667 })));
    const env = envWithPayments();

    const saved = await savePayment(env, {
      address: "34355667",
      assets: ["usdt"],
      data: { apiKey: "api-key", secretKey: "secret-key" },
      driver: "binance",
      name: "Binance",
    });

    expect(saved.address).toBe("34355667");
    expect(saved.data).toEqual({ apiKey: "api-key", secretKey: "secret-key" });
    expect(env.storedCredentials()).toContain("enc:v1:");
    expect(env.storedCredentials()).not.toContain("secret-key");
  });

  it("rejects a Binance ID that does not match the API key pair", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ uid: 34355667 })));

    await expect(savePayment(envWithPayments(), {
      address: "999999",
      assets: ["usdt"],
      data: { apiKey: "api-key", secretKey: "secret-key" },
      driver: "binance",
      name: "Binance",
    })).rejects.toMatchObject(new AppError(400, "errors.payment_account_id_invalid", { detail: "API 返回账户ID 34355667，与填写的 999999 不一致" }));
  });

  it("rejects plaintext stored credentials", async () => {
    await expect(decryptSecret(envWithPayments(), "{\"secretKey\":\"plain\"}")).rejects.toMatchObject(new AppError(500, "errors.payment_credential_invalid"));
  });

  it("checks and recovers channels without orders", async () => {
    const env = envWithPayments();
    await savePayment(env, {
      address: "TY1ykSFu8N4mZgxsJABLGdhcs91h1N2qR2",
      assets: ["usdt"],
      driver: "trc20",
      name: "TRON",
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502 })));

    const errors = await checkChannels(env);

    expect(env.status()).toBe("error");
    expect(errors[1]).toContain("HTTP 502");
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [] })));

    const recovered = await checkChannels(env, "error");

    expect(env.status()).toBe("enabled");
    expect(recovered).toEqual({});
  });
});

function envWithPayments() {
  let row: Record<string, unknown> | null = null;
  return {
    APP_SECRET: "test-secret",
    DB: {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...args: unknown[]) {
            values = args;
            return this;
          },
          async all() {
            return { results: row ? [row] : [] };
          },
          async first() {
            return sql.includes("FROM payments WHERE id = ?") ? row : null;
          },
          async run() {
            if (sql.startsWith("INSERT INTO payments")) {
              row = {
                address: values[3],
                assets: values[4],
                createdAt: values[6],
                credentials: values[5],
                driver: values[0],
                id: 1,
                name: values[1],
                status: values[2],
                updatedAt: values[7],
              };
            }
            if (sql.startsWith("UPDATE payments SET status = CASE") && row) {
              row.status = row.status === "disabled" ? "disabled" : values[0] ? "error" : "enabled";
              row.updatedAt = values[1];
            }
            return { meta: { last_row_id: 1 } };
          },
        };
      },
    },
    status: () => String(row?.status ?? ""),
    storedCredentials: () => String(row?.credentials ?? ""),
  } as unknown as AppEnv & { status(): string; storedCredentials(): string };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
