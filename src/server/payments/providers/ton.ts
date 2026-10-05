import Decimal from "decimal.js";
import type { PaymentChannel } from "@/server/payments/channels";
import type { PaymentCheckInput } from "@/server/payments/driver";
import { paymentMatches } from "@/server/payments/match";
import { fetchJson } from "@/server/utils/http";
import { sameAmount } from "@/shared/amount";
import { key, tonAssets } from "@/shared/payments";
import type { TxCandidate } from "@/shared/types/domain";
import type { PaymentSnapshot } from "@/shared/types/domain";

export async function check(channel: PaymentChannel) {
  const payload = await json<{ transactions?: unknown[] }>(`https://toncenter.com/api/v3/transactions?account=${encodeURIComponent(channel.address)}&limit=1&sort=desc`);
  if (!Array.isArray(payload.transactions)) throw new Error("TON response is invalid");
}

export async function scan(input: PaymentCheckInput) {
  const txs = await transactions(input);
  return paymentMatches(input.orders, txs, match, (tx) => ({ time: tx.timestamp, txid: tx.hash }));
}

async function transactions(input: PaymentCheckInput) {
  const address = String(input.channel?.address ?? input.orders[0]?.snapshot.address ?? "");
  const createdAt = Math.min(...input.orders.map((order) => order.createdAt));
  const expireAt = Math.max(...input.orders.map((order) => order.expireAt));
  if (!address) return [];
  const txs = [];
  for (const asset of Array.from(new Set(input.orders.map((order) => key(order.snapshot.currency)).filter(Boolean)))) {
    txs.push(...(asset === "gram" ? await tonTransactions(address, asset, createdAt, expireAt) : await jettonTransfers(address, asset, createdAt, expireAt)));
  }
  return txs;
}

async function jettonTransfers(address: string, asset: string, createdAt: number, expireAt: number) {
  const token = tonAssets[asset];
  if (!token) return [];
  const url = `https://toncenter.com/api/v3/jetton/transfers?owner_address=${encodeURIComponent(address)}&direction=in&limit=50&start_utime=${createdAt}&end_utime=${expireAt}`;
  const payload = await json<{ jetton_transfers?: unknown[] }>(url);
  return (payload.jetton_transfers ?? []).map((item) => {
    const row = item as Record<string, unknown>;
    return {
      amount: amount(row.amount, token.decimals),
      currency: asset,
      hash: String(row.transaction_hash ?? ""),
      raw: row,
      timestamp: Number(row.transaction_now),
      to: address,
    };
  });
}

async function tonTransactions(address: string, asset: string, createdAt: number, expireAt: number) {
  const url = `https://toncenter.com/api/v3/transactions?account=${encodeURIComponent(address)}&limit=50&sort=desc&start_utime=${createdAt}&end_utime=${expireAt}`;
  const payload = await json<{ transactions?: unknown[] }>(url);
  return (payload.transactions ?? []).map((item) => {
    const row = item as Record<string, unknown>;
    const inMsg = row.in_msg as { value?: unknown } | undefined;
    return {
      amount: amount(inMsg?.value, 9),
      currency: asset,
      hash: String(row.hash ?? ""),
      raw: row,
      timestamp: Number(row.now),
      to: address,
    };
  });
}

function match(snapshot: PaymentSnapshot, tx: TxCandidate, created: number, expire: number) {
  const asset = key(snapshot.currency);
  const token = tonAssets[asset];
  return Boolean(tx.hash)
    && tx.timestamp >= created
    && tx.timestamp <= expire
    && key(tx.currency) === asset
    && (!token || master(tx.raw).toLowerCase() === token.contract.toLowerCase())
    && sameAmount(tx.amount, snapshot.amount)
    && snapshot.address === tx.to;
}

async function json<T>(url: string) {
  return fetchJson<T>(url);
}

function amount(value: unknown, decimals: number) {
  return new Decimal(String(value ?? "0")).div(new Decimal(10).pow(decimals)).toNumber();
}

function master(raw: unknown) {
  return String((raw as Record<string, unknown>).jetton_master ?? "");
}
