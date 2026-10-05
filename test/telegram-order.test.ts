import { describe, expect, it } from "vitest";
import { createTelegramOrder } from "@/server/services/orders/create";
import { publicOrder } from "@/server/services/orders/repository";
import { createBot } from "@/server/services/telegram/bot";
import type { AppEnv } from "@/server/types/env";

describe("Telegram inline orders", () => {
  it("uses timestamp as the internal merchant number", async () => {
    const env = telegramEnv();

    const result = await createTelegramOrder(env, {
      amount: 12,
      currency: "USDT",
      description: "Telegram inline payment",
      timestamp: "mabc123",
    });

    expect(result.order).toMatchObject({
      merchant: "INLINE",
      merchantNo: "mabc123",
    });
    expect(env.inserted?.merchant_no).toBe("mabc123");
    expect(publicOrder(result.order).merchantNo).toBe("");
  });

  it("answers stale inline payment callbacks without throwing", async () => {
    const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
    const bot = await createBot(telegramEnv());
    bot.botInfo = { first_name: "HashPay", id: 123456, is_bot: true, username: "HashPayBot" } as never;
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      return true as never;
    });
    await bot.handleUpdate({
      callback_query: {
        chat_instance: "chat",
        data: "payasset:missing-order:usdt",
        from: { first_name: "Admin", id: 123, is_bot: false, language_code: "zh" },
        id: "callback-id",
        inline_message_id: "inline-message-id",
      },
      update_id: 1,
    });

    expect(calls).toContainEqual({
      method: "answerCallbackQuery",
      payload: { callback_query_id: "callback-id", show_alert: true, text: "订单已失效" },
    });
  });
});

function telegramEnv() {
  const configs = new Map<string, string | null>([
    ["timeout", "5"],
    ["currency", "CNY"],
    ["rate_adjust", "0"],
    ["fast_confirm", "false"],
  ]);
  const env = {
    TGBOT_TOKEN: "test-token",
    inserted: null as Record<string, unknown> | null,
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
            return null;
          },
          async run() {
            if (sql.startsWith("INSERT INTO orders")) {
              env.inserted = {
                amount: values[5],
                merchant: values[1],
                merchant_no: values[2],
              };
            }
            return { meta: { last_row_id: 1 } };
          },
        };
      },
    },
  } as unknown as AppEnv & { inserted: Record<string, unknown> | null };
  return env;
}
