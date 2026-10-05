import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import auth from "@/server/http/routes/auth";
import type { AppEnv, HonoEnv } from "@/server/types/env";

function base64Lines(bytes: ArrayBuffer) {
  return Buffer.from(bytes).toString("base64").replace(/(.{64})/g, "$1\n").trim();
}

async function createKeyPair() {
  const pair = await crypto.subtle.generateKey(
    { hash: "SHA-256", modulusLength: 2048, name: "RSASSA-PKCS1-v1_5", publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("spki", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicKeyPem: `-----BEGIN PUBLIC KEY-----\n${base64Lines(publicKey)}\n-----END PUBLIC KEY-----`,
  };
}

function base64(bytes: ArrayBuffer) {
  return Buffer.from(bytes).toString("base64");
}

function testEnv(publicKeyPem: string) {
  const configs = new Map<string, string | null>([
    ["currency", "CNY"],
    ["timeout", "30"],
    ["rate_adjust", "0"],
    ["fast_confirm", "false"],
  ]);
  const merchant = {
    callback: "https://merchant.example/callback",
    created_at: 1,
    id: "merchant-1",
    name: "Demo Merchant",
    public_key: publicKeyPem,
    status: "enabled",
    type: "website",
    updated_at: 1,
  };
  const orders = new Map<string, Record<string, unknown>>();
  const env = {
    DB: {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...args: unknown[]) {
            values = args;
            return this;
          },
          async first() {
            if (sql.includes("SELECT value FROM configs")) {
              return { value: configs.get(String(values[0])) ?? null };
            }
            if (sql.includes("SELECT * FROM merchants WHERE id = ?")) {
              return values[0] === merchant.id ? merchant : null;
            }
            if (sql.includes("SELECT * FROM orders WHERE merchant = ? AND merchant_no = ?")) {
              return Array.from(orders.values()).find((order) => order.merchant === values[0] && order.merchant_no === values[1]) ?? null;
            }
            if (sql.includes("SELECT * FROM orders WHERE id = ?")) {
              return orders.get(String(values[0])) ?? null;
            }
            return null;
          },
          async run() {
            if (sql.startsWith("INSERT INTO orders")) {
              const row = {
                amount: values[5],
                callback: values[8],
                created_at: values[11],
                currency: values[6],
                description: values[3],
                expire_at: values[10],
                id: values[0],
                merchant: values[1],
                merchant_no: values[2],
                paid_at: null,
                payment: values[7],
                payway: null,
                redirect_url: values[9],
                status: values[4],
                updated_at: values[12],
              };
              orders.set(String(row.id), row);
            }
            return { meta: { last_row_id: 1 } };
          },
        };
      },
    },
  } as AppEnv;
  return env;
}

describe("signed merchant API", () => {
  it("creates an order with the new response shape", async () => {
    const { privateKey, publicKeyPem } = await createKeyPair();
    const env = testEnv(publicKeyPem);
    const app = new Hono<HonoEnv>();
    app.route("/api", auth);
    const body = JSON.stringify({ amount: 12, merchantNo: "M-1001" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = ["POST", "/api/merchant/new", timestamp, body].join("\n");
    const signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, privateKey, new TextEncoder().encode(payload));

    const response = await app.fetch(new Request("https://hashpay.test/api/merchant/new", {
      body,
      headers: {
        "content-type": "application/json",
        "x-merchant-id": "merchant-1",
        "x-signature": base64(signature),
        "x-timestamp": timestamp,
      },
      method: "POST",
    }), env);

    expect(response.status).toBe(200);
    const result = await response.json() as { checkoutUrl: string; order: { amount: number; expiresAt: number; id: string; status: string }; reused: boolean };
    expect(result).toMatchObject({
      checkoutUrl: expect.stringContaining("/pay/"),
      order: { amount: 12, status: "pending" },
      reused: false,
    });
    expect(result.order.expiresAt).toBeGreaterThan(0);
  });
});
