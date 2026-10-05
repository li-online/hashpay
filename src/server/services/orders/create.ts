import { batch, now } from "@/server/db";
import { AppError } from "@/server/http/api";
import { randomBase62 } from "@/server/utils/crypto";
import { systemSettings } from "@/server/services/app/settings";
import { findExistingMerchantOrder, insertOrder, orderExpireAt } from "@/server/services/orders/repository";
import { normalizeCallbackUrl } from "@/server/utils/url";
import { ezfpInitialPayment, type EzfpOrderContext } from "@/server/services/merchants/ezfp";
import type { Merchant } from "@/server/services/merchants";
import type { Order } from "@/server/services/orders/repository";
import type { AppEnv } from "@/server/types/env";

export async function createMerchantOrder(env: AppEnv, merchant: Merchant, input: Record<string, unknown>) {
  const merchantNo = String(input.merchantNo ?? "").trim();
  const amount = Number(input.amount);
  if (!merchantNo) throw new AppError(400, "errors.merchant_no_missing");
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError(400, "errors.amount_invalid");
  const settings = await systemSettings(env);
  return createOrder(env, {
    amount,
    callback: merchant.callback,
    currency: String(input.currency ?? settings.currency).trim().toUpperCase(),
    description: String(input.description ?? "").trim() || null,
    merchant: merchant.id,
    merchantNo,
    redirectUrl: String(input.return_url ?? "").trim() || null,
    timeout: settings.timeout,
  });
}

export async function createEzfpOrder(env: AppEnv, merchant: Merchant, input: {
  fiat: string;
  money: string;
  name: string;
  notifyUrl: string;
  outTradeNo: string;
  param: string;
  returnUrl: string;
  type: string;
}) {
  const settings = await systemSettings(env);
  const callback = normalizeCallbackUrl(input.notifyUrl);
  const returnUrl = input.returnUrl ? normalizeCallbackUrl(input.returnUrl) : null;
  const context: EzfpOrderContext = {
    money: input.money,
    param: input.param,
    type: input.type,
  };
  return createOrder(env, {
    amount: Number(input.money),
    callback,
    currency: input.fiat,
    description: input.name,
    merchant: merchant.id,
    merchantNo: input.outTradeNo,
    payment: ezfpInitialPayment(context),
    redirectUrl: returnUrl,
    timeout: settings.timeout,
  });
}

export async function createTelegramOrder(env: AppEnv, input: { amount: number; currency?: string; description?: string; timestamp: string }) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError(400, "errors.amount_invalid");
  const settings = await systemSettings(env);
  return createOrder(env, {
    amount,
    callback: null,
    currency: String(input.currency || "USDT").trim().toUpperCase(),
    description: String(input.description || "").trim() || null,
    merchant: "INLINE",
    merchantNo: input.timestamp.trim(),
    redirectUrl: null,
    timeout: settings.timeout,
  });
}

async function createOrder(env: AppEnv, input: { amount: number; callback: string | null; currency: string; description: string | null; merchant: string; merchantNo: string; payment?: string; redirectUrl: string | null; timeout: number }) {
  const existing = await findExistingMerchantOrder(env, input.merchant, input.merchantNo);
  if (existing) return { order: existing, reused: true };
  const ts = now();
  const order: Order = {
    amount: input.amount,
    callback: input.callback,
    createdAt: ts,
    currency: input.currency,
    description: input.description,
    expireAt: orderExpireAt(ts, input.timeout),
    id: randomBase62(18),
    merchant: input.merchant,
    merchantNo: input.merchantNo,
    paidAt: null,
    payment: input.payment ?? "{}",
    payway: null,
    redirectUrl: input.redirectUrl,
    status: "pending",
    updatedAt: ts,
  };
  try {
    await insertOrder(env, order);
  } catch (error) {
    const reused = await findExistingMerchantOrder(env, input.merchant, input.merchantNo);
    if (reused) return { order: reused, reused: true };
    throw error;
  }
  return { order, reused: false };
}

export async function deleteOrder(env: AppEnv, orderId: string) {
  await batch(env, [
    ["DELETE FROM notify WHERE order_id = ?", orderId],
    ["DELETE FROM review WHERE order_id = ?", orderId],
    ["DELETE FROM orders WHERE id = ?", orderId],
  ]);
  return { ok: true };
}
