import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyPayment, notifyReview, paymentNoticeText } from "@/server/services/telegram/notify";
import type { Order } from "@/server/services/orders/repository";
import type { PaymentSnapshot } from "@/shared/types/domain";
import type { AppEnv } from "@/server/types/env";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const payment: PaymentSnapshot = {
  address: "0xDcBE48b3F815C0bDeb31b8522E940f709dfF1b9c",
  amount: 8.85,
  currency: "usdt",
  driver: "bep20",
  tx: {
    confirmedBy: "system",
    timestamp: 1_775_124_768,
    txid: "0x2b5e0f44c32c6a10aca3aadeb49955104b8b44db98b00acebb50c90a2c873e12",
  },
};

describe("Telegram payment notifications", () => {
  it("formats a copyable order id, custom asset emoji, source, and transaction link", () => {
    const text = paymentNoticeText(order(), payment, "Telegram (Inline 收款)", "BSC 收款");

    expect(text).toContain("💰 新订单收款 （60 CNY）");
    expect(text).toContain("订单号：\n<pre>8BD516260F1629CC</pre>");
    expect(text).toContain("订单金额：60 CNY");
    expect(text).toContain('<tg-emoji emoji-id="6222280715564752360">💵</tg-emoji> 8.85 USDT');
    expect(text).toContain("收款通道：BSC 收款");
    expect(text).toContain("支付时间：2026-04-02 18:12:48");
    expect(text).toContain("订单来源：Telegram (Inline 收款)");
    expect(text).toContain('<a href="https://bscscan.com/tx/0x2b5e0f44c32c6a10aca3aadeb49955104b8b44db98b00acebb50c90a2c873e12">查看交易</a>');
  });

  it("sends the HTML message only to the configured administrator", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }), {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await notifyPayment(env(new Map([["admin_id", "123456"]])), order(), payment);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bottoken/sendMessage");
    expect(JSON.parse(String(init.body))).toMatchObject({
      chat_id: 123456,
      link_preview_options: { is_disabled: true },
      parse_mode: "HTML",
      text: expect.stringContaining("Telegram (Inline 收款)"),
    });
  });

  it("uses the merchant name as the order source", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }), {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const merchantOrder = order({ merchant: "merchant-1" });

    await notifyPayment(env(new Map([["admin_id", "123456"]]), "TGDash 商户"), merchantOrder, payment);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).text).toContain("订单来源：TGDash 商户");
  });

  it("shows the configured system currency amount in the title", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }), {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const configs = new Map([
      ["admin_id", "123456"],
      ["currency", "CNY"],
      ["fast_confirm", "false"],
      ["market_rates", JSON.stringify({
        assetUSD: { USDT: 1 },
        fiatPerUSD: { CNY: 7.2, USD: 1 },
        syncedAt: payment.tx!.timestamp,
      })],
      ["rate_adjust", "0"],
      ["timeout", "5"],
    ]);

    await notifyPayment(env(configs), order({ amount: 10, currency: "USD" }), payment);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const text = JSON.parse(String(init.body)).text as string;
    expect(text).toContain("💰 新订单收款 （72 CNY）");
    expect(text).toContain("订单金额：10 USD");
  });

  it("does not send when no administrator is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await notifyPayment(env(new Map()), order(), payment);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the review image before the questions and action buttons", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }), {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const answer = "你通过哪种网络完成付款？\nBEP20\n\n你支付了哪种币种？\nUSDT";
    const image = new Uint8Array([1, 2, 3]).buffer;

    await notifyReview(env(new Map([["admin_id", "123456"]])), order(), answer, image);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [photoUrl, photoInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(photoUrl).toBe("https://api.telegram.org/bottoken/sendPhoto");
    expect(photoInit.body).toBeInstanceOf(FormData);
    expect((photoInit.body as FormData).get("chat_id")).toBe("123456");

    const [messageUrl, messageInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(messageUrl).toBe("https://api.telegram.org/bottoken/sendMessage");
    const message = JSON.parse(String(messageInit.body));
    expect(message).toMatchObject({
      chat_id: 123456,
      reply_markup: {
        inline_keyboard: [[
          { callback_data: "audit:delete:8BD516260F1629CC", text: "❌ 删除订单" },
          { callback_data: "audit:confirm:8BD516260F1629CC", text: "✅ 确认收款" },
        ]],
      },
    });
    expect(message.text).toContain("💁 有订单需审核 （60 CNY）");
    expect(message.text).toContain(answer);
  });
});

function order(input: Partial<Order> = {}): Order {
  return {
    amount: 60,
    callback: null,
    createdAt: 1_775_122_300,
    currency: "CNY",
    description: null,
    expireAt: 1_775_122_600,
    id: "8BD516260F1629CC",
    merchant: "INLINE",
    merchantNo: "inline-order",
    paidAt: null,
    payment: JSON.stringify(payment),
    payway: 1,
    redirectUrl: null,
    status: "pending",
    updatedAt: 1_775_122_300,
    ...input,
  };
}

function env(configs: Map<string, string>, merchantName = "") {
  return {
    TGBOT_TOKEN: "token",
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
              const value = configs.get(String(values[0]));
              return value == null ? null : { value };
            }
            if (sql.includes("SELECT name FROM payments")) return { name: "BSC 收款" };
            if (sql.includes("SELECT * FROM merchants WHERE id = ?")) {
              return {
                callback: null,
                created_at: 1,
                id: values[0],
                name: merchantName,
                public_key: "",
                status: "enabled",
                type: "website",
                updated_at: 1,
              };
            }
            return null;
          },
        };
      },
    },
  } as unknown as AppEnv;
}
