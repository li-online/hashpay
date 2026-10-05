import { describe, expect, it } from "vitest";
import admin from "@/server/http/routes/admin";
import { signSession } from "@/server/services/auth/session";
import type { AppEnv, TelegramUser } from "@/server/types/env";

describe("admin routes", () => {
  it("confirms an order without a request body", async () => {
    const adminUser: TelegramUser = { firstName: "Admin", id: 1, lastName: "" };
    const env = envForConfirm(adminUser.id);
    const token = await signSession(env, adminUser);

    const response = await admin.fetch(new Request("https://hashpay.test/orders/order-a/confirm", {
      headers: { cookie: `hashpay_session=${token}` },
      method: "POST",
    }), env);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      tx: { confirmedBy: "admin" },
    });
    expect(env.paidSql).toContain("status IN ('pending', 'expired')");
  });
});

function envForConfirm(adminId: number) {
  const ts = Math.floor(Date.now() / 1000);
  const order = {
    amount: 10,
    callback: null,
    created_at: ts,
    currency: "USD",
    description: "order-a",
    expire_at: ts + 300,
    id: "order-a",
    merchant: "INLINE",
    merchant_no: "order-a",
    paid_at: null,
    payment: JSON.stringify({ address: "address", amount: 10, currency: "USDT", driver: "binance" }),
    payway: 1,
    redirect_url: null,
    status: "expired",
    updated_at: ts,
  };
  const env = {
    APP_SECRET: "test-secret",
    paidSql: "",
    DB: {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...args: unknown[]) {
            values = args;
            return this;
          },
          async first() {
            if (sql.includes("SELECT value FROM configs") && values[0] === "admin_id") return { value: String(adminId) };
            if (sql.includes("SELECT * FROM orders WHERE id = ?")) return order;
            return null;
          },
          async run() {
            if (sql.startsWith("UPDATE orders SET status = 'paid'")) env.paidSql = sql;
            return { meta: { changes: 1, last_row_id: 1 } };
          },
        };
      },
    },
  } as unknown as AppEnv & { paidSql: string };
  return env;
}
