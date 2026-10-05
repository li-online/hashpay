import { afterEach, describe, expect, it, vi } from "vitest";
import { appState } from "@/server/services/app";
import type { AppEnv } from "@/server/types/env";

afterEach(() => {
  vi.restoreAllMocks();
});

function createEnv(configs: Map<string, string | null>) {
  return {
    DB: {
      batch: vi.fn(async (statements: { run: () => Promise<unknown> }[]) => {
        for (const statement of statements) await statement.run();
        return [];
      }),
      exec: vi.fn(async () => ({})),
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...args: unknown[]) {
            values = args;
            return this;
          },
          async all() {
            if (sql.includes("FROM d1_migrations")) return { results: [] };
            return { results: [] };
          },
          async first() {
            if (sql.includes("SELECT value FROM configs")) {
              const key = String(values[0]);
              return configs.has(key) ? { value: configs.get(key) } : null;
            }
            return { key: "domain" };
          },
          async run() {
            configs.set(String(values[0]), values[1] as string | null);
            return {};
          },
        };
      },
    },
    QUEUE_NOTIFY: {},
    TGBOT_TOKEN: "token",
  } as unknown as AppEnv;
}

describe("app state", () => {
  it("uses cached bot username after setup", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const configs = new Map<string, string | null>([
      ["admin_id", "123"],
      ["bot_username", "HashPayBot"],
      ["domain", "https://hashpay.test"],
      ["bot_secret", "secret"],
      ["title", "Demo Pay"],
    ]);

    const status = await appState(createEnv(configs), "https://hashpay.test/admin");

    expect(status.ready).toBe(true);
    expect(status.title).toBe("Demo Pay");
    expect(status.username).toBe("HashPayBot");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fills missing bot username cache once", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { username: "FreshHashPayBot" },
    })));
    const configs = new Map<string, string | null>([
      ["admin_id", "123"],
      ["domain", "https://hashpay.test"],
      ["bot_secret", "secret"],
    ]);

    const status = await appState(createEnv(configs), "https://hashpay.test/admin");

    expect(status.username).toBe("FreshHashPayBot");
    expect(status.title).toBe("HashPay");
    expect(configs.get("bot_username")).toBe("FreshHashPayBot");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
