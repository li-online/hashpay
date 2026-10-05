import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/http/api";
import { normalizeSettingsPayload, rebindBot, saveAdminSettings } from "@/server/services/app/settings";
import type { AppEnv } from "@/server/types/env";

const mocks = vi.hoisted(() => ({
  configureBotMiniApp: vi.fn(),
  refreshBotInfo: vi.fn(),
}));

vi.mock("@/server/services/telegram/api", () => ({
  configureBotMiniApp: mocks.configureBotMiniApp,
  refreshBotInfo: mocks.refreshBotInfo,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configureBotMiniApp.mockResolvedValue(undefined);
  mocks.refreshBotInfo.mockResolvedValue({ username: "HashPayBot" });
});

describe("settings payload", () => {
  it("uses the 5 minute default when timeout is empty", () => {
    expect(normalizeSettingsPayload({ timeout: null }).timeout).toBe(5);
    expect(normalizeSettingsPayload({ timeout: "" }).timeout).toBe(5);
  });

  it("normalizes site domain and reconfigures Telegram when it changes", async () => {
    const configs = new Map<string, string | null>([["domain", "https://old.example.com"]]);
    const saved = await saveAdminSettings(env(configs), {
      currency: "USD",
      domain: "https://Pay.Example.com/admin?x=1",
      fastConfirm: true,
      rateAdjust: 2,
      title: "  Demo Pay  ",
      timeout: 8,
    });

    expect(saved.domain).toBe("https://pay.example.com");
    expect(saved.title).toBe("Demo Pay");
    expect(configs.get("domain")).toBe("https://pay.example.com");
    expect(configs.get("currency")).toBe("USD");
    expect(configs.get("fast_confirm")).toBe("true");
    expect(configs.get("rate_adjust")).toBe("2");
    expect(configs.get("title")).toBe("Demo Pay");
    expect(configs.get("timeout")).toBe("8");
    expect(mocks.configureBotMiniApp).toHaveBeenCalledTimes(1);
  });

  it("rejects non-HTTPS domains", async () => {
    await expect(saveAdminSettings(env(new Map()), {
      currency: "CNY",
      domain: "http://pay.example.com",
      fastConfirm: false,
      rateAdjust: 0,
      timeout: 5,
    })).rejects.toMatchObject(new AppError(400, "errors.domain_invalid"));
    expect(mocks.configureBotMiniApp).not.toHaveBeenCalled();
  });

  it("refreshes and reconfigures the bound bot", async () => {
    await expect(rebindBot(env(new Map()))).resolves.toEqual({ username: "HashPayBot" });
    expect(mocks.refreshBotInfo).toHaveBeenCalledTimes(1);
    expect(mocks.configureBotMiniApp).toHaveBeenCalledTimes(1);
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
            if (sql.includes("INSERT INTO configs")) configs.set(String(values[0]), String(values[1]));
            return {};
          },
        };
      },
      batch(statements: Array<{ run: () => Promise<unknown> }>) {
        return Promise.all(statements.map((statement) => statement.run()));
      },
    },
  } as unknown as AppEnv;
}
