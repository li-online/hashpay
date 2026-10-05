import { afterEach, describe, expect, it, vi } from "vitest";
import { currentMarketRates, marketAmount, payAmount, syncMarketRates } from "@/server/services/app/settings";
import type { AppEnv } from "@/server/types/env";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("market rates", () => {
  it("syncs fiat rates and keeps stablecoins fixed at 1 USD", async () => {
    const syncedAt = Math.floor(Date.parse("2026-07-04T06:00:00Z") / 1000);
    vi.useFakeTimers();
    vi.setSystemTime(syncedAt * 1000);
    const configs = new Map<string, string | null>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("open.er-api.com")) return json({ rates: { CNY: 7.18, EUR: 0.91, GBP: 0.78, TWD: 31.5 }, result: "success" });
      if (url.includes("bybit.com")) return json({
        result: {
          list: [
            { lastPrice: "610", symbol: "BNBUSDT" },
            { lastPrice: "3200", symbol: "ETHUSDT" },
            { lastPrice: "0.9", symbol: "POLUSDT" },
            { lastPrice: "0.12", symbol: "TRXUSDT" },
          ],
        },
        retCode: 0,
      });
      if (url.includes("coinbase.com")) return json({ data: { rates: { USD: "3" } } });
      throw new Error(`unexpected fetch ${url}`);
    });

    const rates = await syncMarketRates(env(configs));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(rates.fiatPerUSD.CNY).toBe(7.18);
    expect(rates.assetUSD.ETH).toBe(3200);
    expect(payAmount(71.8, "CNY", "USDT", rate(rates))).toBe(10);
    expect(payAmount(71.8, "CNY", "USDC", rate(rates))).toBe(10);
    expect(payAmount(6400, "USD", "ETH", rate(rates))).toBe(2);
    expect(JSON.parse(configs.get("market_rates") || "{}")).toEqual({
      assetUSD: { BNB: 610, ETH: 3200, GRAM: 3, MATIC: 0.9, TRX: 0.12, USDC: 1, USDT: 1 },
      fiatPerUSD: { CNY: 7.18, EUR: 0.91, GBP: 0.78, TWD: 31.5, USD: 1 },
      syncedAt,
    });
    await expect(currentMarketRates(env(configs))).resolves.toMatchObject({ syncedAt });
  });

  it("does not mark default rates as freshly synced when the fiat API fails", async () => {
    const configs = new Map<string, string | null>();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network failed"));

    const rates = await syncMarketRates(env(configs));

    expect(rates.messageKey).toBe("settings.rate_error_fiat");
    expect(rates.fiatPerUSD.CNY).toBe(7.2);
    await expect(currentMarketRates(env(configs))).resolves.toMatchObject({
      messageKey: "settings.rate_error_fiat",
      syncedAt: 0,
    });
  });

  it("keeps the last successful fiat rate when a later sync fails", async () => {
    const configs = new Map<string, string | null>([
      ["market_rates", JSON.stringify({
        assetUSD: { BNB: 600, ETH: 3000, GRAM: 2.8, MATIC: 0.8, TRX: 0.1, USDC: 1, USDT: 1 },
        fiatPerUSD: { CNY: 6.8, EUR: 0.9, GBP: 0.77, TWD: 31, USD: 1 },
        syncedAt: 1_783_148_400,
      })],
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-07-04T08:00:00Z"));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network failed"));

    const rates = await syncMarketRates(env(configs));

    expect(rates.messageKey).toBe("settings.rate_error_fiat");
    expect(rates.fiatPerUSD.CNY).toBe(6.8);
    expect(rates.assetUSD.ETH).toBe(3000);
    expect(rates.syncedAt).toBe(1_783_148_400);
    await expect(currentMarketRates(env(configs))).resolves.toMatchObject({
      messageKey: "settings.rate_error_fiat",
      syncedAt: 1_783_148_400,
    });
  });

  it("keeps market conversion separate from payable amount adjustment", () => {
    const rates = {
      assetUSD: { BNB: 610, ETH: 3200, GRAM: 3, MATIC: 0.9, TRX: 0.12, USDC: 1, USDT: 1 },
      fiatPerUSD: { CNY: 7.2, EUR: 0.93, GBP: 0.79, TWD: 32, USD: 1 },
      syncedAt: 0,
    };
    const adjusted = rate(rates, 2);

    expect(marketAmount(1, "USD", "CNY", adjusted)).toBe(7.2);
    expect(payAmount(72, "CNY", "USDT", adjusted)).toBe(9.81);
  });
});

function env(configs: Map<string, string | null>) {
  return {
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
              const key = String(values[0]);
              return configs.has(key) ? { value: configs.get(key) } : null;
            }
            return null;
          },
          async run() {
            if (sql.includes("INSERT INTO configs")) configs.set(String(values[0]), values[1] as string | null);
            return {};
          },
        };
      },
    },
  } as unknown as AppEnv;
}

function rate(rates: Awaited<ReturnType<typeof syncMarketRates>>, rateAdjust = 0) {
  return {
    rateAdjust,
    rates,
    settings: {
      currency: "CNY",
      fastConfirm: true,
      rateAdjust,
      timeout: 5,
    },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
