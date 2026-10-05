import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorBody } from "@/server/http/api";
import { startSetup } from "@/server/services/app/setup";
import { bindSetupAdmin } from "@/server/services/telegram/setup";
import type { AppEnv, HonoEnv } from "@/server/types/env";

const mocks = vi.hoisted(() => ({
  configureBotMiniApp: vi.fn(),
  ensureDefaultBanner: vi.fn(),
  syncMarketRates: vi.fn(),
}));

vi.mock("@/server/services/app/settings", () => ({
  syncMarketRates: mocks.syncMarketRates,
}));

vi.mock("@/server/services/images/banner", () => ({
  ensureDefaultBanner: mocks.ensureDefaultBanner,
}));

vi.mock("@/server/services/telegram/api", async () => {
  const actual = await vi.importActual<typeof import("@/server/services/telegram/api")>("@/server/services/telegram/api");
  return {
    ...actual,
    configureBotMiniApp: mocks.configureBotMiniApp,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configureBotMiniApp.mockResolvedValue(undefined);
  mocks.ensureDefaultBanner.mockResolvedValue(new Uint8Array());
  mocks.syncMarketRates.mockResolvedValue({});
});

describe("setup", () => {
  it("completes setup when the admin account is bound", async () => {
    const configs = new Map<string, string | null>();
    const replies: string[] = [];

    const completed = await bindSetupAdmin(createEnv(configs), {
      from: { first_name: "Admin", id: 123, language_code: "zh" },
      reply: vi.fn(async (text: string) => {
        replies.push(text);
        return {} as never;
      }),
    } as never);

    expect(completed).toBe(true);
    expect(mocks.ensureDefaultBanner).toHaveBeenCalledTimes(1);
    expect(mocks.syncMarketRates).toHaveBeenCalledTimes(1);
    expect(mocks.configureBotMiniApp).toHaveBeenCalledTimes(1);
    expect(configs.get("currency")).toBe("CNY");
    expect(configs.get("fast_confirm")).toBe("false");
    expect(configs.get("rate_adjust")).toBe("0");
    expect(configs.get("timeout")).toBe("5");
    expect(configs.get("admin_id")).toBe("123");
    expect(configs.get("admin_user")).toBe(JSON.stringify({ firstName: "Admin", id: 123, lastName: "" }));
    expect(replies).toEqual(["🎉", "管理员账户已绑定，请返回页面进入后台。"]);
  });

  it("does not expose a setup session handoff", async () => {
    const app = setupApp();
    const configs = new Map<string, string | null>([
      ["admin_id", "123"],
      ["admin_user", JSON.stringify({ firstName: "Admin", id: 123, lastName: "" })],
    ]);

    const response = await app.fetch(new Request("https://hashpay.test/setup"), createEnv(configs));

    expect(response.status).toBe(404);
    expect(mocks.ensureDefaultBanner).not.toHaveBeenCalled();
    expect(mocks.syncMarketRates).not.toHaveBeenCalled();
    expect(mocks.configureBotMiniApp).not.toHaveBeenCalled();
  });

  it("rejects setup start after admin_id exists", async () => {
    const app = setupApp();
    const configs = new Map<string, string | null>([
      ["admin_id", "123"],
      ["admin_user", JSON.stringify({ firstName: "Admin", id: 123, lastName: "" })],
    ]);

    const response = await app.fetch(new Request("https://hashpay.test/setup", {
      body: JSON.stringify({ domain: "https://hashpay.test" }),
      method: "POST",
    }), createEnv(configs));

    expect(response.status).toBe(409);
    expect(mocks.ensureDefaultBanner).not.toHaveBeenCalled();
    expect(mocks.syncMarketRates).not.toHaveBeenCalled();
    expect(mocks.configureBotMiniApp).not.toHaveBeenCalled();
  });
});

function setupApp() {
  const app = new Hono<HonoEnv>();
  app.onError((error, c) => {
    const { body, status } = errorBody(error);
    return c.json(body, status as never);
  });
  app.post("/setup", async (c) => c.json(await startSetup(c, await c.req.json<Record<string, unknown>>())));
  return app;
}

function createEnv(configs: Map<string, string | null>) {
  return {
    APP_SECRET: "test-secret",
    TGBOT_TOKEN: "test-token",
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
      batch(statements: Array<{ run: () => Promise<unknown> }>) {
        return Promise.all(statements.map((statement) => statement.run()));
      },
    },
  } as unknown as AppEnv;
}
