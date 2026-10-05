import { all, now, one, run } from "@/server/db";
import { AppError } from "@/server/http/api";
import { generateRsaKeyPair, randomBase62, verifyRsaSha256 } from "@/server/utils/crypto";
import { normalizeCallbackUrl } from "@/server/utils/url";
import { authMode, type AuthMode } from "@/shared/merchants";
import type { Merchant as ApiMerchant, MerchantInput as ApiMerchantInput } from "@/shared/types/api";
import type { AppEnv } from "@/server/types/env";

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

export type Merchant = ApiMerchant;
export type MerchantInput = ApiMerchantInput;

function merchant(row: MerchantRow): Merchant {
  return {
    authKey: row.public_key,
    callback: row.callback,
    createdAt: row.created_at,
    id: row.id,
    name: row.name,
    status: row.status as Merchant["status"],
    type: row.type as Merchant["type"],
    updatedAt: row.updated_at,
  };
}

export async function listMerchants(env: AppEnv) {
  return (await all<MerchantRow>(env, "SELECT * FROM merchants ORDER BY created_at DESC")).map(merchant);
}

export async function getMerchant(env: AppEnv, id: string) {
  const row = await one<MerchantRow>(env, "SELECT * FROM merchants WHERE id = ?", id);
  if (!row) throw new AppError(404, "errors.merchant_not_found");
  return merchant(row);
}

export async function createMerchant(env: AppEnv, input: MerchantInput) {
  const time = now();
  const { callback, name, status, type } = fields(input);
  const id = crypto.randomUUID();
  const created = await createCredential(authMode(type));
  const row = await one<MerchantRow>(env, "INSERT INTO merchants(id, type, name, public_key, callback, status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?) RETURNING *", id, type, name, created.authKey, callback, status, time, time);
  if (!row) throw new AppError(500, "errors.merchant_create_failed");
  return { credential: created.credential, merchant: merchant(row) };
}

export async function updateMerchant(env: AppEnv, id: string, input: MerchantInput) {
  const current = await getMerchant(env, id);
  const { callback, name, status, type } = fields(input);
  const mode = authMode(type);
  const created = authMode(current.type) === mode ? null : await createCredential(mode);
  const authKey = created?.authKey ?? current.authKey;
  const row = await one<MerchantRow>(env, "UPDATE merchants SET type = ?, name = ?, public_key = ?, callback = ?, status = ?, updated_at = ? WHERE id = ? RETURNING *", type, name, authKey, callback, status, now(), id);
  if (!row) throw new AppError(404, "errors.merchant_not_found");
  return { ...(created ? { credential: created.credential } : {}), merchant: merchant(row) };
}

export async function rotateCredential(env: AppEnv, id: string) {
  const current = await getMerchant(env, id);
  const created = await createCredential(authMode(current.type));
  const row = await one<MerchantRow>(env, "UPDATE merchants SET public_key = ?, updated_at = ? WHERE id = ? RETURNING *", created.authKey, now(), id);
  if (!row) throw new AppError(404, "errors.merchant_not_found");
  return { credential: created.credential, merchant: merchant(row) };
}

function fields(input: MerchantInput) {
  const name = input.name.trim();
  if (!name) throw new AppError(400, "errors.merchant_name_missing");
  return {
    callback: normalizeCallbackUrl(input.callback),
    name,
    status: input.status,
    type: input.type,
  };
}

async function createCredential(mode: AuthMode) {
  if (mode === "md5") {
    const secret = randomBase62(32);
    return { authKey: secret, credential: secret };
  }
  const pair = await generateRsaKeyPair();
  return { authKey: pair.publicKeyPem, credential: pair.privateKeyPem };
}

export async function deleteMerchant(env: AppEnv, id: string) {
  await run(env, "DELETE FROM merchants WHERE id = ?", id);
}

export async function requireSignedMerchant(
  env: AppEnv,
  request: { header(name: string): string | undefined; method: string; url: string },
  body: string,
) {
  const merchantId = request.header("x-merchant-id")?.trim();
  const signature = request.header("x-signature")?.trim();
  const timestamp = request.header("x-timestamp")?.trim();
  if (!merchantId) throw new AppError(401, "errors.merchant_id_missing");
  if (!signature) throw new AppError(401, "errors.signature_missing");
  if (!timestamp) throw new AppError(401, "errors.timestamp_missing");
  const unix = Number(timestamp);
  if (!Number.isFinite(unix) || Math.abs(Math.floor(Date.now() / 1000) - unix) > 300) {
    throw new AppError(401, "errors.timestamp_invalid");
  }
  const merchant = await getMerchant(env, merchantId);
  if (merchant.status !== "enabled") throw new AppError(401, "errors.merchant_disabled");
  if (authMode(merchant.type) !== "rsa") throw new AppError(401, "errors.signature_invalid");
  if (!merchant.authKey.trim()) throw new AppError(401, "errors.merchant_public_key_missing");
  const url = new URL(request.url);
  const signedPayload = [request.method.toUpperCase(), `${url.pathname}${url.search}`, timestamp, body].join("\n");
  if (!await verifyRsaSha256(merchant.authKey, signature, signedPayload)) {
    throw new AppError(401, "errors.signature_invalid");
  }
  return merchant;
}
