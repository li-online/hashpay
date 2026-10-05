import { describe, expect, it } from "vitest";
import { createApp } from "@/server/http/app";
import type { AppEnv } from "@/server/types/env";

describe("api CORS", () => {
  it("allows the configured domain origin", async () => {
    const response = await preflight("https://merchant.example", env("https://merchant.example"));

    expect(response.headers.get("access-control-allow-origin")).toBe("https://merchant.example");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("rejects unrelated origins", async () => {
    const response = await preflight("https://evil.example", env("https://merchant.example"));

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

function preflight(origin: string, env: AppEnv) {
  return createApp().fetch(new Request("https://hashpay.test/api/state", {
    headers: {
      "access-control-request-method": "GET",
      origin,
    },
    method: "OPTIONS",
  }), env);
}

function env(domain: string) {
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
            if (sql.includes("SELECT value FROM configs") && values[0] === "domain") return { value: domain };
            return null;
          },
        };
      },
    },
  } as unknown as AppEnv;
}
