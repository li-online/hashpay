import { key, trc20Assets } from "@/shared/payments";
import type { PaymentChannel } from "@/server/payments/channels";
import type { PaymentCheckInput } from "@/server/payments/driver";
import { paymentMatches } from "@/server/payments/match";
import { fetchJson } from "@/server/utils/http";
import type { PaymentSnapshot } from "@/shared/types/domain";
import { sameAmount } from "@/shared/amount";
import { trc20Candidate, trc20ContractMatches, trxCandidate, type TronGridNativeTx, type TronGridTokenTx } from "@/shared/trongrid";
import type { TxCandidate } from "@/shared/types/domain";

export async function check(channel: PaymentChannel) {
  const result = await fetchJson<{ data?: unknown[] }>(`https://api.trongrid.io/v1/accounts/${encodeURIComponent(channel.address)}`);
  if (!Array.isArray(result.data)) throw new Error("TronGrid response is invalid");
}

export async function scan(input: PaymentCheckInput) {
  const txs = await transactions(input);
  return paymentMatches(input.orders, txs, match, (tx) => ({ time: tx.timestamp, txid: tx.hash }));
}

async function transactions(input: PaymentCheckInput) {
  const address = String(input.channel?.address ?? input.orders[0]?.snapshot.address ?? "");
  const from = Math.min(...input.orders.map((order) => order.createdAt));
  const assets = Array.from(new Set(input.orders.map((order) => key(order.snapshot.currency)).filter(Boolean)));
  const txs = [];
  for (const asset of assets) txs.push(...await scanAsset(address, asset, from, input.fastConfirm));
  return txs;
}

async function scanAsset(address: string, asset: string, from: number, fast: boolean) {
  const params = new URLSearchParams({
    limit: "50",
    min_timestamp: String(Math.max(0, from) * 1000),
    only_confirmed: fast ? "false" : "true",
  });

  if (asset === "trx") {
    params.set("only_to", "true");
    return (await tronGrid<TronGridNativeTx>(address, "transactions", params))
      .map((item) => trxCandidate(item, address))
      .filter((item): item is TxCandidate => item !== null);
  }

  const tokenAsset = trc20Assets[asset];
  if (tokenAsset) {
    params.set("contract_address", tokenAsset.contract);
    return (await tronGrid<TronGridTokenTx>(address, "transactions/trc20", params))
      .map((item) => trc20Candidate(item, asset))
      .filter((item): item is TxCandidate => item !== null);
  }

  return [];
}

async function tronGrid<T>(address: string, path: string, params: URLSearchParams) {
  const url = `https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}/${path}?${params}`;
  const result = await fetchJson<{ data?: T[] }>(url);
  if (!Array.isArray(result.data)) throw new Error("TronGrid response is invalid");
  return result.data;
}

function match(snapshot: PaymentSnapshot, tx: TxCandidate, created: number, expire: number) {
  const asset = key(snapshot.currency);
  return Boolean(tx.hash)
    && tx.timestamp >= created
    && tx.timestamp <= expire
    && key(tx.currency) === asset
    && trc20ContractMatches(asset, tx.raw)
    && sameAmount(tx.amount, snapshot.amount)
    && snapshot.address === tx.to;
}
