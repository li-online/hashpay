import { describe, expect, it } from "vitest";
import { AppError } from "@/server/http/api";
import { createMerchant } from "@/server/services/merchants";
import type { AppEnv } from "@/server/types/env";

describe("callback URL validation", () => {
  it("rejects localhost callback URLs", async () => {
    await expect(createMerchant(env(), {
      callback: "https://localhost/callback",
      name: "Merchant",
      status: "enabled",
      type: "website",
    })).rejects.toMatchObject(new AppError(400, "errors.callback_url_invalid"));
  });

  it("rejects private IP callback URLs", async () => {
    await expect(createMerchant(env(), {
      callback: "https://192.168.1.10/callback",
      name: "Merchant",
      status: "enabled",
      type: "website",
    })).rejects.toMatchObject(new AppError(400, "errors.callback_url_invalid"));
  });
});

function env() {
  return {
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
        };
      },
    },
  } as unknown as AppEnv;
}
