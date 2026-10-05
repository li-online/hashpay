import { createHash } from "node:crypto";
import { jsonParseObject } from "@/server/db";
import { timingSafeEqualString } from "@/server/utils/crypto";
import type { Merchant } from "@/server/services/merchants";
import type { Order } from "@/server/services/orders/repository";
import type { PaymentSnapshot } from "@/shared/types/domain";

const contextKey = "_ezfp";

export interface EzfpOrderContext {
  money: string;
  param: string;
  type: string;
}

type InternalPayment = Partial<PaymentSnapshot> & {
  [contextKey]?: EzfpOrderContext;
};

export class EzfpError extends Error {}

export function signEzfp(params: Record<string, string>, secret: string) {
  const payload = Object.entries(params)
    .filter(([key, value]) => key !== "sign" && key !== "sign_type" && value !== "")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("md5").update(`${payload}${secret}`).digest("hex");
}

export function verifyEzfp(params: Record<string, string>, secret: string) {
  const signType = params.sign_type?.trim();
  const signature = params.sign?.trim().toLowerCase();
  if (!signType || signType.toUpperCase() !== "MD5") throw new EzfpError("Only MD5 signatures are supported");
  if (!signature || !timingSafeEqualString(signature, signEzfp(params, secret))) {
    throw new EzfpError("Invalid signature");
  }
}

export function ezfpContext(payment: string | object) {
  const value = typeof payment === "string"
    ? jsonParseObject<InternalPayment>(payment, {})
    : payment as InternalPayment;
  return value[contextKey] ?? null;
}

export function ezfpInitialPayment(context: EzfpOrderContext) {
  return JSON.stringify({ [contextKey]: context });
}

export function preserveEzfpContext(payment: string, snapshot: PaymentSnapshot) {
  const context = ezfpContext(payment);
  return context ? { ...snapshot, [contextKey]: context } : snapshot;
}

export function ezfpNotification(order: Pick<Order, "currency" | "description" | "id" | "merchantNo">, merchant: Pick<Merchant, "id">, context: EzfpOrderContext) {
  return {
    fiat: order.currency,
    money: context.money,
    name: order.description || order.merchantNo,
    out_trade_no: order.merchantNo,
    param: context.param,
    pid: merchant.id,
    trade_no: order.id,
    trade_status: "TRADE_SUCCESS",
    type: context.type,
  };
}

export function ezfpReturnUrl(order: Order, merchant: Pick<Merchant, "authKey" | "id">) {
  if (order.status !== "paid" || !order.redirectUrl) return null;
  const context = ezfpContext(order.payment);
  if (!context) throw new Error("Ezfp order context is missing");
  return signedEzfpUrl(order.redirectUrl, ezfpNotification(order, merchant, context), merchant.authKey);
}

export function signedEzfpUrl(rawUrl: string, params: Record<string, string>, secret: string) {
  const url = new URL(rawUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  url.searchParams.set("sign_type", "MD5");
  url.searchParams.delete("sign");
  const signed = Object.fromEntries(url.searchParams.entries());
  url.searchParams.set("sign", signEzfp(signed, secret));
  return url.toString();
}
