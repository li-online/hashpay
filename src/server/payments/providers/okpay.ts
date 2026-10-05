import { createHash } from "node:crypto";
import { AppError } from "@/server/http/api";
import type { PaymentChannel } from "@/server/payments/channels";
import type { PaymentCheckInput } from "@/server/payments/driver";
import { fetchJson } from "@/server/utils/http";
import { sameAmount } from "@/shared/amount";
import { key } from "@/shared/payments";
import type { Order } from "@/server/services/orders/repository";
import type { PaymentSnapshot } from "@/shared/types/domain";

const api = "https://api.okaypay.me/shop";

export async function create(channel: PaymentChannel, order: Order, snapshot: PaymentSnapshot) {
  const payload = await post(channel, "payLink", {
    amount: snapshot.amount,
    coin: key(snapshot.currency).toUpperCase(),
    name: order.description || order.merchantNo || order.id,
    return_url: order.redirectUrl || undefined,
    unique_id: order.id,
  });
  const data = responseData(payload);
  const url = String(data.pay_url ?? "").trim();
  const out_id = String(data.order_id ?? "").trim();
  if (!url || !out_id) throw new AppError(502, "errors.payment_create_failed");
  return {
    ...snapshot,
    out_id,
    url,
  };
}

export async function check(channel: PaymentChannel) {
  await post(channel, "checkTransferByTxid", { txid: "0" });
}

export async function scan(input: PaymentCheckInput) {
  const channel = input.channel;
  if (!channel) return [];
  const matches = [];
  for (const order of input.orders) {
    const out_id = String(order.snapshot.out_id ?? "").trim();
    if (!out_id) continue;
    const payload = await post(channel, "checkTransferByTxid", { txid: out_id });
    const data = responseData(payload);
    if (Number(data.status) !== 1) continue;
    const amount = Number(data.amount);
    const coin = key(data.coin);
    if (!sameAmount(amount, order.snapshot.amount) || coin !== key(order.snapshot.currency)) continue;
    matches.push({ orderId: order.id, time: Math.floor(Date.now() / 1000), txid: String(data.order_id ?? out_id) });
  }
  return matches;
}

export function verify(channel: PaymentChannel, input: Record<string, unknown>) {
  const current = String(input.sign ?? "");
  const data = { ...input };
  delete data.sign;
  return Boolean(current) && current === signature(channel, clean(data));
}

export function notifyData(input: Record<string, unknown>) {
  const nested = typeof input.data === "string" ? parseJson(input.data) : input.data;
  const source = nested && typeof nested === "object" ? nested as Record<string, unknown> : input;
  return {
    amount: Number(source.amount),
    coin: key(source.coin),
    orderId: String(source.order_id ?? ""),
    uniqueId: String(source.unique_id ?? ""),
  };
}

async function post(channel: PaymentChannel, path: string, data: Record<string, unknown>) {
  const body = sign(channel, data);
  return fetchJson<Record<string, unknown>>(`${api}/${path}`, {
    body: new URLSearchParams(body),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

function sign(channel: PaymentChannel, input: Record<string, unknown>) {
  const data = clean({ ...input, id: channel.address });
  data.sign = signature(channel, data);
  return data;
}

function signature(channel: PaymentChannel, data: Record<string, string>) {
  const token = String(channel.data.key ?? "").trim();
  if (!token) throw new AppError(400, "errors.payment_credential_missing");
  return createHash("md5").update(`${query(data)}&token=${token}`).digest("hex").toUpperCase();
}

function clean(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined && value !== null && value !== "" && value !== false)
      .map(([key, value]) => [key, String(value)]),
  );
}

function query(input: Record<string, string>) {
  const params = new URLSearchParams();
  for (const key of Object.keys(input).sort()) params.set(key, input[key]);
  return decodeURIComponent(params.toString().replace(/\+/g, " "));
}

function responseData(payload: Record<string, unknown>) {
  const data = payload.data;
  if (Array.isArray(data)) return (data[0] ?? {}) as Record<string, unknown>;
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return {};
}

function parseJson(input: string) {
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}
