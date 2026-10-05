import { createHmac } from "node:crypto";
import { AppError } from "@/server/http/api";
import type { PaymentChannel } from "@/server/payments/channels";
import type { PaymentCheckInput } from "@/server/payments/driver";
import { paymentMatches } from "@/server/payments/match";
import { fetchText } from "@/server/utils/http";
import { sameAmount } from "@/shared/amount";
import { key } from "@/shared/payments";
import type { PaymentSnapshot } from "@/shared/types/domain";

const origin = "https://www.okx.com";
const configApi = "/api/v5/account/config";
const billsApi = "/api/v5/asset/bills";

interface OkxResponse<T> {
  code?: string;
  data?: T[];
  msg?: string;
}

interface OkxConfig {
  uid?: unknown;
}

interface OkxBill {
  balChg?: string | number;
  billId?: string;
  ccy?: string;
  ts?: string | number;
  type?: string | number;
}

export async function check(input: Pick<PaymentChannel, "address" | "data">) {
  const rows = await signedGet<OkxConfig>(configApi, input.data);
  const uid = String(rows[0]?.uid ?? "").trim();
  if (!uid) throw new AppError(400, "errors.payment_account_id_invalid", { detail: "OKX API 返回中没有账户ID" });
  if (uid !== input.address) {
    throw new AppError(400, "errors.payment_account_id_invalid", { detail: `API 返回账户ID ${uid}，与填写的 ${input.address} 不一致` });
  }
}

export async function scan(input: PaymentCheckInput) {
  const rows = await bills(input);
  return paymentMatches(input.orders, rows, match, (tx) => ({ time: timestamp(tx), txid: String(tx.billId) }));
}

async function bills(input: PaymentCheckInput) {
  if (!input.channel) return [];
  const currencies = [...new Set(input.orders.map((order) => key(order.snapshot.currency)).filter(Boolean))];
  const rows = await Promise.all(currencies.map((ccy) => signedGet<OkxBill>(billsApi, input.channel!.data, {
    ccy: ccy.toUpperCase(),
    limit: "100",
  })));
  return rows.flat();
}

async function signedGet<T>(path: string, data: Record<string, string>, query: Record<string, string> = {}) {
  const apiKey = String(data.apiKey ?? "").trim();
  const secretKey = String(data.secretKey ?? "").trim();
  const passphrase = String(data.passphrase ?? "").trim();
  if (!apiKey || !secretKey || !passphrase) throw new AppError(400, "errors.payment_credential_missing");

  const search = new URLSearchParams(query).toString();
  const requestPath = `${path}${search ? `?${search}` : ""}`;
  const timestamp = new Date().toISOString();
  const sign = createHmac("sha256", secretKey).update(`${timestamp}GET${requestPath}`).digest("base64");
  const { res, text } = await fetchText(`${origin}${requestPath}`, {
    headers: {
      accept: "application/json",
      "OK-ACCESS-KEY": apiKey,
      "OK-ACCESS-PASSPHRASE": passphrase,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": timestamp,
    },
  });
  if (!res.ok) {
    throw new AppError(400, "errors.payment_api_credential_invalid", { detail: responseReason(res, text) });
  }
  const payload = JSON.parse(text || "{}") as OkxResponse<T>;
  if (payload.code && payload.code !== "0") {
    throw new AppError(400, "errors.payment_api_credential_invalid", { detail: `${payload.code} ${payload.msg ?? ""}`.replace(/\s+/g, " ").trim() });
  }
  return payload.data ?? [];
}

function responseReason(res: Response, text: string) {
  const fallback = `HTTP ${res.status}`;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = parseJson(text);
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

function match(snapshot: PaymentSnapshot, row: OkxBill, created: number, expire: number) {
  const amount = Number(row.balChg);
  const time = timestamp(row);
  return Boolean(row.billId)
    && ["1", "72"].includes(String(row.type))
    && time >= created
    && time <= expire
    && key(row.ccy) === key(snapshot.currency)
    && amount > 0
    && sameAmount(amount, snapshot.amount);
}

function timestamp(row: OkxBill) {
  const value = Number(row.ts);
  return Math.floor(value > 10_000_000_000 ? value / 1000 : value);
}
