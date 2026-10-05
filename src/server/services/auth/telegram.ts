import { AppError } from "@/server/http/api";
import { bytesToHex, timingSafeEqualString } from "@/server/utils/crypto";
import type { TelegramUser } from "@/server/types/env";

const encoder = new TextEncoder();

async function hmacSha256(key: ArrayBuffer | Uint8Array, value: string) {
  const keyData: ArrayBuffer =
    key instanceof Uint8Array
      ? key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer
      : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
}

export async function validateWebAppInitData(initData: string, token: string): Promise<TelegramUser> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new AppError(401, "errors.telegram_hash_missing");
  params.delete("hash");

  const pairs = Array.from(params.entries())
    .map(([key, value]) => `${key}=${value}`)
    .sort();
  const secret = await hmacSha256(encoder.encode("WebAppData"), token);
  const expected = bytesToHex(await hmacSha256(secret, pairs.join("\n")));
  if (!timingSafeEqualString(expected, hash)) {
    throw new AppError(401, "errors.telegram_hash_invalid");
  }

  const authDate = Number(params.get("auth_date") ?? "0");
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > 86400) {
    throw new AppError(401, "errors.telegram_auth_expired");
  }
  const userRaw = params.get("user");
  if (!userRaw) throw new AppError(401, "errors.telegram_user_missing");
  const user = JSON.parse(userRaw) as Record<string, unknown>;
  const id = Number(user.id);
  if (!Number.isFinite(id)) throw new AppError(401, "errors.telegram_user_invalid");
  return {
    firstName: typeof user.first_name === "string" ? user.first_name : "",
    id,
    lastName: typeof user.last_name === "string" ? user.last_name : "",
  };
}
