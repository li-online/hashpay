import Decimal from "decimal.js";
import type { PaymentChannel } from "@/server/payments/channels";
import type { PaymentCheckInput } from "@/server/payments/driver";
import { paymentMatches } from "@/server/payments/match";
import { fetchText, host, reason } from "@/server/utils/http";
import { sameAmount } from "@/shared/amount";
import { key, solanaAssets } from "@/shared/payments";
import type { PaymentSnapshot, TxCandidate } from "@/shared/types/domain";

const endpoint = "https://public.rpc.solanavibestation.com/";

export async function check(channel: PaymentChannel) {
  const token = channel.assets.map((asset) => solanaAssets[key(asset)]).find(Boolean);
  if (!token) throw new Error("Solana asset is not configured");
  await tokenAccounts(channel.address, token.contract, "finalized");
}

export async function scan(input: PaymentCheckInput) {
  const txs = await transactions(input);
  return paymentMatches(input.orders, txs, match, (tx) => ({ time: tx.timestamp, txid: tx.hash }));
}

async function transactions(input: PaymentCheckInput) {
  const owner = String(input.channel?.address ?? input.orders[0]?.snapshot.address ?? "");
  if (!owner) return [];
  const createdAt = Math.min(...input.orders.map((order) => order.createdAt));
  const expireAt = Math.max(...input.orders.map((order) => order.expireAt));
  const commitment = input.fastConfirm ? "confirmed" : "finalized";
  const txs = [];
  for (const asset of Array.from(new Set(input.orders.map((order) => key(order.snapshot.currency)).filter(Boolean)))) {
    txs.push(...await scanAsset(owner, asset, createdAt, expireAt, commitment));
  }
  return txs;
}

async function scanAsset(owner: string, asset: string, createdAt: number, expireAt: number, commitment: string) {
  const token = solanaAssets[asset];
  if (!token) return [];
  const accounts = await tokenAccounts(owner, token.contract, commitment);
  const out = [];
  for (const account of accounts) {
    const signatures = await rpc<Array<{ blockTime?: number; err?: unknown; signature: string }>>("getSignaturesForAddress", [
      account,
      { commitment, limit: 50 },
    ]);
    for (const row of signatures.filter((item) => item.err == null && item.blockTime && item.blockTime >= createdAt && item.blockTime <= expireAt)) {
      const tx = await transaction(row.signature, commitment);
      if (!tx) continue;
      out.push(...transfers(tx, {
        account,
        asset,
        decimals: token.decimals,
        mint: token.contract,
        owner,
        signature: row.signature,
      }));
    }
  }
  return out;
}

async function tokenAccounts(owner: string, mint: string, commitment: string) {
  const payload = await rpc<{ value?: Array<{ pubkey?: string }> }>("getTokenAccountsByOwner", [
    owner,
    { mint },
    { commitment, encoding: "jsonParsed" },
  ]);
  return (payload.value ?? []).map((item) => String(item.pubkey ?? "")).filter(Boolean);
}

async function transaction(signature: string, commitment: string) {
  const tx = await rpc<Record<string, unknown> | null>("getTransaction", [
    signature,
    { commitment, encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
  ]);
  return tx && typeof tx === "object" ? tx : null;
}

function transfers(tx: Record<string, unknown>, input: { account: string; asset: string; decimals: number; mint: string; owner: string; signature: string }) {
  const meta = tx.meta as { err?: unknown } | undefined;
  if (meta?.err != null) return [];
  return instructions(tx)
    .map((instruction) => transfer(instruction, tx, input))
    .filter((item): item is TxCandidate => item !== null);
}

function transfer(instruction: Record<string, unknown>, tx: Record<string, unknown>, input: { account: string; asset: string; decimals: number; mint: string; owner: string; signature: string }): TxCandidate | null {
  const parsed = instruction.parsed as { info?: Record<string, unknown>; type?: string } | undefined;
  const info = parsed?.info;
  if (!info || !String(parsed?.type ?? "").startsWith("transfer")) return null;
  if (String(info.destination ?? "") !== input.account) return null;
  const mint = String(info.mint ?? input.mint);
  if (mint !== input.mint) return null;
  return {
    amount: tokenAmount(info, input.decimals),
    currency: input.asset,
    hash: input.signature,
    raw: { instruction, mint },
    timestamp: Number(tx.blockTime ?? 0),
    to: input.owner,
  };
}

function instructions(tx: Record<string, unknown>) {
  const transaction = tx.transaction as { message?: { instructions?: unknown[] } } | undefined;
  const meta = tx.meta as { innerInstructions?: Array<{ instructions?: unknown[] }> } | undefined;
  return [
    ...(transaction?.message?.instructions ?? []),
    ...(meta?.innerInstructions ?? []).flatMap((group) => group.instructions ?? []),
  ].filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
}

function match(snapshot: PaymentSnapshot, tx: TxCandidate, created: number, expire: number) {
  const asset = key(snapshot.currency);
  const token = solanaAssets[asset];
  return Boolean(tx.hash)
    && tx.timestamp >= created
    && tx.timestamp <= expire
    && key(tx.currency) === asset
    && (!token || mint(tx.raw) === token.contract)
    && sameAmount(tx.amount, snapshot.amount)
    && snapshot.address === tx.to;
}

async function rpc<T>(method: string, params: unknown[]) {
  const { res, text } = await fetchText(endpoint, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!res.ok) throw new Error(`Solana ${host(endpoint)} ${method}: HTTP ${res.status} ${reason(text || res.statusText)}`.trim());
  const payload = parseRpc<T>(text, method);
  if (payload.error || payload.result === undefined) {
    throw new Error(`Solana ${host(endpoint)} ${method}: ${reason(payload.error?.message ?? "response is invalid")}`);
  }
  return payload.result;
}

function parseRpc<T>(text: string, method: string) {
  try {
    return JSON.parse(text || "{}") as { error?: { message?: string }; result?: T };
  } catch {
    throw new Error(`Solana ${host(endpoint)} ${method}: invalid JSON ${reason(text)}`);
  }
}

function tokenAmount(info: Record<string, unknown>, decimals: number) {
  const token = info.tokenAmount as { amount?: unknown; uiAmountString?: unknown } | undefined;
  if (token?.uiAmountString != null) return Number(token.uiAmountString);
  return new Decimal(String(token?.amount ?? info.amount ?? "0")).div(new Decimal(10).pow(decimals)).toNumber();
}

function mint(raw: unknown) {
  return String((raw as Record<string, unknown>).mint ?? "");
}
