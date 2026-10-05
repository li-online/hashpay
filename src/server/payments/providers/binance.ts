import { createHmac } from "node:crypto";
import { AppError } from "@/server/http/api";
import type { PaymentChannel } from "@/server/payments/channels";
import type { PaymentCheckInput } from "@/server/payments/driver";
import { fetchText } from "@/server/utils/http";
import { sameAmount } from "@/shared/amount";
import { key } from "@/shared/payments";
import type { PaymentSnapshot } from "@/shared/types/domain";

const api = "https://api-gcp.binance.com/sapi/v1/pay/transactions";
const accountApi = "https://api-gcp.binance.com/api/v3/account";

interface BinancePayRow {
  amount?: string | number;
  currency?: string;
  fundsDetail?: Array<{ amount?: string | number; currency?: string }>;
  receiverInfo?: { binanceId?: unknown };
  transactionId?: string;
  transactionTime?: string | number;
}

export async function check(input: Pick<PaymentChannel, "address" | "data">) {
  const payload = await signedGet<{ uid?: unknown }>(accountApi, input.data.apiKey, input.data.secretKey);
  const uid = String(payload.uid ?? "").trim();
  if (!uid) throw new AppError(400, "errors.payment_account_id_invalid", { detail: "Binance API 返回中没有账户ID" });
  if (uid !== input.address) {
    throw new AppError(400, "errors.payment_account_id_invalid", { detail: `API 返回账户ID ${uid}，与填写的 ${input.address} 不一致` });
  }
}

export async function scan(input: PaymentCheckInput) {
  const rows = await history(input);
  return input.orders.flatMap((order) => {
    const tx = rows.find((row) => match(order.snapshot, row, order.createdAt, order.expireAt));
    return tx ? [{ orderId: order.id, time: timestamp(tx), txid: String(tx.transactionId) }] : [];
  });
}

async function history(input: PaymentCheckInput) {
  const channel = input.channel;
  if (!channel) return [];
  const apiKey = String(channel.data.apiKey ?? "").trim();
  const secretKey = String(channel.data.secretKey ?? "").trim();
  if (!apiKey || !secretKey) throw new AppError(400, "errors.payment_credential_missing");

  const start = Math.min(...input.orders.map((order) => order.createdAt)) * 1000;
  const end = Math.max(...input.orders.map((order) => order.expireAt)) * 1000;
  const payload = await signedGet<{ code?: string; data?: unknown; success?: boolean }>(api, apiKey, secretKey, {
    endTime: String(end),
    limit: "100",
    recvWindow: "5000",
    startTime: String(start),
  });
  if (payload.success === false || (payload.code && payload.code !== "000000")) {
    throw new Error(`Binance response failed: ${payload.code ?? "unknown"}`);
  }
  return Array.isArray(payload.data) ? payload.data as BinancePayRow[] : [];
}

async function signedGet<T>(url: string, apiKey: string, secretKey: string, data: Record<string, string> = {}) {
  if (!apiKey || !secretKey) throw new AppError(400, "errors.payment_credential_missing");
  const query = new URLSearchParams({ ...data, timestamp: String(Date.now()) }).toString();
  const signature = createHmac("sha256", secretKey).update(query).digest("hex");
  const { res, text } = await fetchText(`${url}?${query}&signature=${signature}`, {
    headers: { accept: "application/json", "X-MBX-APIKEY": apiKey },
  });
  if (!res.ok) {
    throw new AppError(400, "errors.payment_api_credential_invalid", { detail: responseReason(res, text) });
  }
  return JSON.parse(text || "{}") as T;
}

function responseReason(res: Response, text: string) {
  const fallback = `HTTP ${res.status}`;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = parseJson(text) as { code?: unknown; msg?: unknown };
    const code = String(body.code ?? "").trim();
    const msg = String(body.msg ?? "").trim();
    return ([code, msg].filter(Boolean).join(" ") || fallback).replace(/\s+/g, " ").trim();
  }
  return (text || fallback).replace(/\s+/g, " ").trim();
}

function parseJson(text: string) {
  try {
    return JSON.parse(text || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function match(snapshot: PaymentSnapshot, row: BinancePayRow, created: number, expire: number) {
  const time = timestamp(row);
  return Boolean(row.transactionId)
    && time >= created
    && time <= expire
    && String(row.receiverInfo?.binanceId ?? "").trim() === String(snapshot.address).trim()
    && funds(row).some((fund) => key(fund.currency) === key(snapshot.currency) && sameAmount(Number(fund.amount), snapshot.amount));
}

function funds(row: BinancePayRow) {
  if (Array.isArray(row.fundsDetail) && row.fundsDetail.length) return row.fundsDetail;
  return [{ amount: row.amount, currency: row.currency }];
}

function timestamp(row: BinancePayRow) {
  const value = Number(row.transactionTime);
  return Math.floor(value > 10_000_000_000 ? value / 1000 : value);
}
