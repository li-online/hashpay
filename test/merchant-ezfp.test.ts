import { describe, expect, it } from "vitest";
import { createMerchant, rotateCredential, updateMerchant } from "@/server/services/merchants";
import type { AppEnv } from "@/server/types/env";

describe("Ezfp merchant credentials", () => {
  it("uses the merchant id as pid and stores a 32-character MD5 key in public_key", async () => {
    const state = merchantEnv();

    const result = await createMerchant(state.env, {
      callback: null,
      name: "Legacy shop",
      status: "enabled",
      type: "ezfp",
    });

    expect(result.credential).toBe(result.merchant.authKey);
    expect(result.merchant).toMatchObject({
      callback: null,
      id: expect.any(String),
      name: "Legacy shop",
      type: "ezfp",
    });
    expect(result.merchant.authKey).toMatch(/^[0-9A-Za-z]{32}$/);
    expect(state.row?.public_key).toBe(result.merchant.authKey);
  });

  it("rotates Ezfp secrets without generating an RSA private key", async () => {
    const state = merchantEnv({
      callback: null,
      created_at: 1,
      id: "merchant-1",
      name: "Ezfp",
      public_key: "old-secret",
      status: "enabled",
      type: "ezfp",
      updated_at: 1,
    });

    const result = await rotateCredential(state.env, "merchant-1");

    expect(result.credential).toBe(result.merchant.authKey);
    expect(result.merchant.authKey).toMatch(/^[0-9A-Za-z]{32}$/);
    expect(result.merchant.authKey).not.toBe("old-secret");
  });

  it("regenerates credentials when switching between RSA and Ezfp types", async () => {
    const state = merchantEnv({
      callback: "https://merchant.example/notify",
      created_at: 1,
      id: "merchant-1",
      name: "Website",
      public_key: "-----BEGIN PUBLIC KEY-----\nold\n-----END PUBLIC KEY-----",
      status: "enabled",
      type: "website",
      updated_at: 1,
    });

    const ezfp = await updateMerchant(state.env, "merchant-1", {
      callback: "https://merchant.example/notify",
      name: "Website",
      status: "enabled",
      type: "ezfp",
    });
    expect(ezfp.merchant.authKey).toMatch(/^[0-9A-Za-z]{32}$/);
    expect(ezfp.credential).toBe(ezfp.merchant.authKey);
    expect(ezfp.merchant.callback).toBe("https://merchant.example/notify");

    const website = await updateMerchant(state.env, "merchant-1", {
      callback: "https://merchant.example/notify",
      name: "Website",
      status: "enabled",
      type: "website",
    });
    expect(website.credential).toContain("-----BEGIN PRIVATE KEY-----");
    expect(website.merchant.authKey).toContain("-----BEGIN PUBLIC KEY-----");
  });

  it("keeps credentials when business types use the same authentication mode", async () => {
    const publicKey = "-----BEGIN PUBLIC KEY-----\nold\n-----END PUBLIC KEY-----";
    const state = merchantEnv({
      callback: "https://merchant.example/notify",
      created_at: 1,
      id: "merchant-1",
      name: "Website",
      public_key: publicKey,
      status: "enabled",
      type: "website",
      updated_at: 1,
    });

    const result = await updateMerchant(state.env, "merchant-1", {
      callback: "https://merchant.example/notify",
      name: "Telegram",
      status: "enabled",
      type: "telegram",
    });

    expect(result.credential).toBeUndefined();
    expect(result.merchant.authKey).toBe(publicKey);
    expect(result.merchant.type).toBe("telegram");
  });
});

interface MerchantRow {
  callback: string | null;
  created_at: number;
  id: string;
  name: string;
  public_key: string;
  status: string;
  type: string;
  updated_at: number;
}

function merchantEnv(initial: MerchantRow | null = null) {
  const state: { row: MerchantRow | null } = { row: initial };
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
            return { results: state.row ? [state.row] : [] };
          },
          async first() {
            if (sql.startsWith("SELECT * FROM merchants WHERE id = ?")) {
              return state.row?.id === values[0] ? state.row : null;
            }
            if (sql.startsWith("INSERT INTO merchants")) {
              state.row = {
                callback: values[4] as string | null,
                created_at: Number(values[6]),
                id: String(values[0]),
                name: String(values[2]),
                public_key: String(values[3]),
                status: String(values[5]),
                type: String(values[1]),
                updated_at: Number(values[7]),
              };
              return state.row;
            }
            if (sql.startsWith("UPDATE merchants SET type")) {
              if (!state.row || state.row.id !== values[6]) return null;
              state.row = {
                ...state.row,
                callback: values[3] as string | null,
                name: String(values[1]),
                public_key: String(values[2]),
                status: String(values[4]),
                type: String(values[0]),
                updated_at: Number(values[5]),
              };
              return state.row;
            }
            if (sql.startsWith("UPDATE merchants SET public_key")) {
              if (!state.row || state.row.id !== values[2]) return null;
              state.row = {
                ...state.row,
                public_key: String(values[0]),
                updated_at: Number(values[1]),
              };
              return state.row;
            }
            return null;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  } as unknown as AppEnv;
  return {
    env,
    get row() {
      return state.row;
    },
  };
}
