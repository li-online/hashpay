import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ezfp from "@/server/http/routes/ezfp";
import { getMerchant } from "@/server/services/merchants";
import { getOrder, publicOrder } from "@/server/services/orders/repository";
import {
  ezfpContext,
  ezfpReturnUrl,
  preserveEzfpContext,
  signEzfp,
  verifyEzfp,
} from "@/server/services/merchants/ezfp";
import type { AppEnv, HonoEnv } from "@/server/types/env";
import type { PaymentSnapshot } from "@/shared/types/domain";

vi.mock("@/server/db/migrations", () => ({
  migrateD1: vi.fn(async () => ({ applied: [] })),
}));

const secret = "merchant-secret";

describe("Ezfp signatures", () => {
  it("sorts non-empty fields, excludes signature fields, and keeps values unencoded", () => {
    const params = {
      empty: "",
      name: "测试商品 & VIP",
      out_trade_no: "ORDER-1001",
      pid: "merchant-1",
      sign: "ignored",
      sign_type: "MD5",
    };

    expect(signEzfp(params, secret)).toBe("3e7d69bdab2a75041f714397db738bd0");
    expect(() => verifyEzfp({ ...params, sign: signEzfp(params, secret) }, secret)).not.toThrow();
    expect(() => verifyEzfp({ ...params, sign: "invalid" }, secret)).toThrow("Invalid signature");
    expect(() => verifyEzfp({ ...params, sign_type: "RSA", sign: "invalid" }, secret)).toThrow("Only MD5");
  });

  it("preserves internal context when a payment method is selected", () => {
    const initial = JSON.stringify({ _ezfp: { money: "12.30", param: "source=shop", type: "custom" } });
    const snapshot: PaymentSnapshot = { amount: 2, currency: "USDT", driver: "trc20" };
    const stored = preserveEzfpContext(initial, snapshot);

    expect(ezfpContext(stored)).toEqual({ money: "12.30", param: "source=shop", type: "custom" });
    expect(stored).toMatchObject(snapshot);
  });
});

describe("Ezfp routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an API order and returns a HashPay checkout URL", async () => {
    const state = ezfpEnv();
    const params = signed({
      fiat: "usd",
      money: "12.3",
      name: "VIP 会员",
      notify_url: "https://merchant.example/notify",
      out_trade_no: "ORDER-1001",
      param: "account-7",
      pid: "merchant-1",
      return_url: "https://merchant.example/return",
      type: "custom",
    });

    const response = await app().fetch(new Request("https://hashpay.test/mapi.php", {
      body: new URLSearchParams(params),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    }), state.env);

    expect(response.status).toBe(200);
    const result = await response.json() as { code: number; payurl: string; trade_no: string };
    expect(result).toMatchObject({
      code: 1,
      payurl: `https://hashpay.test/pay/${result.trade_no}`,
    });
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0]?.currency).toBe("USD");
    expect(ezfpContext(String(state.orders[0]?.payment))).toEqual({
      money: "12.30",
      param: "account-7",
      type: "custom",
    });

    const pending = await getOrder(state.env, result.trade_no);
    const merchant = await getMerchant(state.env, "merchant-1");
    expect(publicOrder(pending).payment).not.toHaveProperty("_ezfp");
    expect(ezfpReturnUrl(pending, merchant)).toBeNull();
    state.merchant.public_key = "rotated-secret";
    state.orders[0]!.status = "paid";
    const paidOrder = await getOrder(state.env, result.trade_no);
    const currentMerchant = await getMerchant(state.env, "merchant-1");
    const returnUrl = new URL(ezfpReturnUrl(paidOrder, currentMerchant)!);
    expect(returnUrl.origin + returnUrl.pathname).toBe("https://merchant.example/return");
    expect(returnUrl.searchParams.get("trade_status")).toBe("TRADE_SUCCESS");
    expect(returnUrl.searchParams.get("fiat")).toBe("USD");
    expect(returnUrl.searchParams.get("type")).toBe("custom");
    expect(returnUrl.searchParams.get("param")).toBe("account-7");
    expect(signEzfp(Object.fromEntries(returnUrl.searchParams), "rotated-secret")).toBe(returnUrl.searchParams.get("sign"));
  });

  it("redirects submit.php GET requests and defaults an omitted type to usdt", async () => {
    const state = ezfpEnv();
    const params = signed({
      money: "8",
      name: "充值",
      notify_url: "https://merchant.example/notify",
      out_trade_no: "ORDER-GET",
      pid: "merchant-1",
      return_url: "https://merchant.example/return",
    });

    const response = await app().fetch(new Request(`https://hashpay.test/submit.php?${new URLSearchParams(params)}`), state.env);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(/^https:\/\/hashpay\.test\/pay\//);
    expect(state.orders[0]?.currency).toBe("CNY");
    expect(ezfpContext(String(state.orders[0]?.payment))?.type).toBe("usdt");
  });

  it("accepts submit.php form POST requests", async () => {
    const state = ezfpEnv();
    const params = signed({
      money: "8.80",
      name: "充值",
      notify_url: "https://merchant.example/notify",
      out_trade_no: "ORDER-POST",
      pid: "merchant-1",
      return_url: "https://merchant.example/return",
      type: "usdt",
    });

    const response = await app().fetch(formRequest("/submit.php", params), state.env);

    expect(response.status).toBe(302);
    expect(state.orders).toHaveLength(1);
  });

  it("returns compatible errors for invalid signatures and unsupported merchants", async () => {
    const state = ezfpEnv();
    const params = {
      money: "1.00",
      name: "Test",
      notify_url: "https://merchant.example/notify",
      out_trade_no: "ORDER-BAD",
      pid: "merchant-1",
      sign: "bad",
      sign_type: "MD5",
      type: "usdt",
    };

    const invalid = await app().fetch(formRequest("/mapi.php", params), state.env);
    expect(await invalid.json()).toEqual({ code: -1, msg: "Invalid signature" });

    state.merchant.type = "website";
    const unsupported = await app().fetch(formRequest("/mapi.php", signed(params)), state.env);
    expect(await unsupported.json()).toEqual({ code: -1, msg: "Merchant does not support Ezfp" });
  });

  it("rejects disabled merchants", async () => {
    const state = ezfpEnv();
    state.merchant.status = "disabled";
    const params = signed({
      money: "1.00",
      name: "Test",
      notify_url: "https://merchant.example/notify",
      out_trade_no: "ORDER-DISABLED",
      pid: "merchant-1",
      type: "usdt",
    });

    const response = await app().fetch(formRequest("/mapi.php", params), state.env);

    expect(await response.json()).toEqual({ code: -1, msg: "Merchant is disabled" });
    expect(state.orders).toHaveLength(0);
  });

  it.each([
    {
      expected: "Missing name",
      input: {
        money: "1.00",
        name: "",
        notify_url: "https://merchant.example/notify",
        out_trade_no: "ORDER-MISSING",
        pid: "merchant-1",
        type: "usdt",
      },
    },
    {
      expected: "Invalid money",
      input: {
        money: "1.001",
        name: "Test",
        notify_url: "https://merchant.example/notify",
        out_trade_no: "ORDER-MONEY",
        pid: "merchant-1",
        type: "usdt",
      },
    },
    {
      expected: "Invalid money",
      input: {
        money: "1e1000",
        name: "Test",
        notify_url: "https://merchant.example/notify",
        out_trade_no: "ORDER-MONEY-RANGE",
        pid: "merchant-1",
        type: "usdt",
      },
    },
    {
      expected: "Invalid fiat",
      input: {
        fiat: "EUR",
        money: "1.00",
        name: "Test",
        notify_url: "https://merchant.example/notify",
        out_trade_no: "ORDER-FIAT",
        pid: "merchant-1",
        type: "usdt",
      },
    },
  ] as Array<{ expected: string; input: Record<string, string> }>)("returns $expected for invalid request fields", async ({ expected, input }) => {
    const state = ezfpEnv();
    const response = await app().fetch(formRequest("/mapi.php", signed(input)), state.env);

    expect(await response.json()).toEqual({ code: -1, msg: expected });
    expect(state.orders).toHaveLength(0);
  });

  it("rejects non-MD5 signatures", async () => {
    const state = ezfpEnv();
    const params = signed({
      money: "1.00",
      name: "Test",
      notify_url: "https://merchant.example/notify",
      out_trade_no: "ORDER-RSA",
      pid: "merchant-1",
      type: "usdt",
    });
    params.sign_type = "RSA";

    const response = await app().fetch(formRequest("/mapi.php", params), state.env);

    expect(await response.json()).toEqual({ code: -1, msg: "Only MD5 signatures are supported" });
    expect(state.orders).toHaveLength(0);
  });

  it("rejects invalid callback URLs before inserting an order", async () => {
    const state = ezfpEnv();
    const params = signed({
      money: "1.00",
      name: "Test",
      notify_url: "https://merchant.example/notify",
      out_trade_no: "ORDER-URL",
      pid: "merchant-1",
      return_url: "http://127.0.0.1/return",
      type: "usdt",
    });

    const response = await app().fetch(formRequest("/mapi.php", params), state.env);

    expect(await response.json()).toEqual({
      code: -1,
      msg: "notify_url or return_url must be a public HTTPS URL",
    });
    expect(state.orders).toHaveLength(0);
  });

  it("reuses the same pid and out_trade_no", async () => {
    const state = ezfpEnv();
    const params = signed({
      money: "3.00",
      name: "Order",
      notify_url: "https://merchant.example/notify",
      out_trade_no: "ORDER-SAME",
      pid: "merchant-1",
      type: "usdt",
    });

    const first = await app().fetch(formRequest("/mapi.php", params), state.env);
    const second = await app().fetch(formRequest("/mapi.php", params), state.env);
    const firstResult = await first.json() as { trade_no: string };
    const secondResult = await second.json() as { trade_no: string };

    expect(secondResult.trade_no).toBe(firstResult.trade_no);
    expect(state.orders).toHaveLength(1);
  });
});

function app() {
  const value = new Hono<HonoEnv>();
  value.route("/", ezfp);
  return value;
}

function signed(input: Record<string, string>) {
  const params = { ...input, sign_type: "MD5" };
  return { ...params, sign: signEzfp(params, secret) };
}

function formRequest(path: string, params: Record<string, string>) {
  return new Request(`https://hashpay.test${path}`, {
    body: new URLSearchParams(params),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

function ezfpEnv() {
  const configs = new Map<string, string>([
    ["currency", "USD"],
    ["fast_confirm", "false"],
    ["rate_adjust", "0"],
    ["timeout", "30"],
  ]);
  const merchant = {
    callback: null,
    created_at: 1,
    id: "merchant-1",
    name: "Ezfp Merchant",
    public_key: secret,
    status: "enabled",
    type: "ezfp",
    updated_at: 1,
  };
  const orders: Array<Record<string, unknown>> = [];
  const env = {
    DB: {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...args: unknown[]) {
            values = args;
            return this;
          },
          async all() {
            return { results: [] };
          },
          async first() {
            if (sql.includes("SELECT * FROM merchants WHERE id = ?")) {
              return values[0] === merchant.id ? merchant : null;
            }
            if (sql.includes("SELECT value FROM configs")) {
              const value = configs.get(String(values[0]));
              return value == null ? null : { value };
            }
            if (sql.includes("SELECT * FROM orders WHERE merchant = ? AND merchant_no = ?")) {
              return orders.find((order) => order.merchant === values[0] && order.merchant_no === values[1]) ?? null;
            }
            if (sql.includes("SELECT * FROM orders WHERE id = ?")) {
              return orders.find((order) => order.id === values[0]) ?? null;
            }
            return null;
          },
          async run() {
            if (sql.startsWith("INSERT INTO orders")) {
              orders.push({
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
              });
            }
            return { meta: { changes: 1, last_row_id: 1 } };
          },
        };
      },
    },
  } as unknown as AppEnv;
  return { env, merchant, orders };
}
