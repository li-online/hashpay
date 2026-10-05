import Decimal from "decimal.js";
import { sameAmount } from "@/shared/amount";
import { aptosAssets, evmAssets, key, tonAssets, trc20Assets } from "@/shared/payments";
import { trc20Candidate, trxCandidate, type TronGridNativeTx, type TronGridTokenTx } from "@/shared/trongrid";
import type { TxCandidate } from "@/shared/types/domain";

type ProbePayment = {
  address?: string;
  amount?: number;
  currency?: string;
  driver?: string;
};
type ProbeOrder = {
  createdAt?: number;
  expireAt?: number;
};
type Probe = (payment: ProbePayment, order: ProbeOrder, fastConfirm: boolean) => Promise<TxCandidate[]>;

const checks: Record<string, Probe> = {
  aptos,
  base,
  bep20,
  erc20,
  polygon,
  ton,
  trc20,
};
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function canProbeInBrowser(payment: ProbePayment) {
  return Boolean(payment.address && checks[key(payment.driver)]);
}

export async function browserMatches(payment: ProbePayment, order: ProbeOrder, fastConfirm: boolean) {
  const check = checks[key(payment.driver)];
  if (!payment.address || !check) return [];
  return (await check(payment, order, fastConfirm)).filter((tx) => matches(payment, order, tx));
}

async function trc20(payment: ProbePayment, order: ProbeOrder, fastConfirm: boolean) {
  const address = String(payment.address || "");
  const asset = key(payment.currency);
  const params = new URLSearchParams({
    limit: "50",
    min_timestamp: String(Math.max(0, Number(order.createdAt ?? 0)) * 1000),
    only_confirmed: fastConfirm ? "false" : "true",
  });

  if (asset === "trx") {
    params.set("only_to", "true");
    return valid((await tronGrid<TronGridNativeTx>(address, "transactions", params)).map((item) => trxCandidate(item, address)));
  }

  const token = trc20Assets[asset];
  if (!token) return [];
  params.set("contract_address", token.contract);
  return valid((await tronGrid<TronGridTokenTx>(address, "transactions/trc20", params)).map((item) => trc20Candidate(item, asset)));
}

function erc20(payment: ProbePayment) {
  return blockscout("https://eth.blockscout.com", payment);
}

function base(payment: ProbePayment) {
  return blockscout("https://base.blockscout.com", payment);
}

function polygon(payment: ProbePayment) {
  return blockscout("https://polygon.blockscout.com", payment);
}

async function bep20(payment: ProbePayment, order: ProbeOrder) {
  const asset = key(payment.currency);
  const token = evmAssets.bep20?.[asset];
  if (!token || !payment.address) return [];
  const latest = Number.parseInt(await rpc<string>("eth_blockNumber", []), 16);
  const checkedAt = Math.floor(Date.now() / 1000);
  const createdAt = Number(order.createdAt ?? checkedAt);
  const fromBlock = Math.max(0, latest - Math.ceil((checkedAt - createdAt) / 0.4) - 1000);
  const logs = await rpc<Array<Record<string, unknown>>>("eth_getLogs", [{
    address: token.contract,
    fromBlock: hex(fromBlock),
    toBlock: "latest",
    topics: [transferTopic, null, topicAddress(payment.address)],
  }]);
  return valid(logs.map((log) => ({
    amount: amount(log.data, token.decimals),
    currency: asset,
    hash: String(log.transactionHash ?? ""),
    raw: { ...log, contract: token.contract },
    timestamp: checkedAt,
    to: payment.address,
  })));
}

async function blockscout(baseUrl: string, payment: ProbePayment) {
  const network = key(payment.driver);
  const asset = key(payment.currency);
  const token = evmAssets[network]?.[asset];
  const address = String(payment.address || "");
  if (!address) return [];

  if (token) {
    const params = new URLSearchParams({ token: token.contract, type: "ERC-20" });
    const payload = await json<{ items?: unknown[] }>(`${baseUrl}/api/v2/addresses/${address}/token-transfers?${params}`);
    return valid((payload.items ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      const total = row.total as { value?: unknown } | undefined;
      return {
        amount: amount(total?.value, token.decimals),
        currency: asset,
        hash: String(row.transaction_hash ?? ""),
        raw: row,
        timestamp: time(row.timestamp),
        to: addressOf(row.to),
      };
    }));
  }

  const payload = await json<{ items?: unknown[] }>(`${baseUrl}/api/v2/addresses/${address}/transactions`);
  return valid((payload.items ?? []).map((item) => {
    const row = item as Record<string, unknown>;
    return {
      amount: amount(row.value, 18),
      currency: asset,
      hash: String(row.hash ?? ""),
      raw: row,
      timestamp: time(row.timestamp),
      to: addressOf(row.to),
    };
  }));
}

async function ton(payment: ProbePayment, order: ProbeOrder) {
  const address = String(payment.address || "");
  const asset = key(payment.currency);
  const start = Math.max(0, Number(order.createdAt ?? 0));
  const end = Math.max(start, Number(order.expireAt ?? 0));
  if (!address || !end) return [];

  if (asset === "gram") {
    const payload = await json<{ transactions?: unknown[] }>(`https://toncenter.com/api/v3/transactions?account=${encodeURIComponent(address)}&limit=50&sort=desc&start_utime=${start}&end_utime=${end}`);
    return valid((payload.transactions ?? []).map((item) => {
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
    }));
  }

  const token = tonAssets[asset];
  if (!token) return [];
  const payload = await json<{ jetton_transfers?: unknown[] }>(`https://toncenter.com/api/v3/jetton/transfers?owner_address=${encodeURIComponent(address)}&direction=in&limit=50&start_utime=${start}&end_utime=${end}`);
  return valid((payload.jetton_transfers ?? []).flatMap((item) => {
    const row = item as Record<string, unknown>;
    if (String(row.jetton_master ?? "") !== token.contract) return [];
    return [{
      amount: amount(row.amount, token.decimals),
      currency: asset,
      hash: String(row.transaction_hash ?? ""),
      raw: row,
      timestamp: Number(row.transaction_now),
      to: address,
    }];
  }));
}

async function aptos(payment: ProbePayment, order: ProbeOrder) {
  const address = String(payment.address || "");
  const asset = key(payment.currency);
  const token = aptosAssets[asset];
  if (!address || !token) return [];
  const payload = await json<{ data?: { fungible_asset_activities?: unknown[] } }>("https://api.mainnet.aptoslabs.com/v1/graphql", {
    body: JSON.stringify({
      query: `
        query($owner: String!, $assets: [String!], $start: timestamp!, $end: timestamp!) {
          fungible_asset_activities(
            where: {
              owner_address: { _eq: $owner }
              asset_type: { _in: $assets }
              transaction_timestamp: { _gte: $start, _lte: $end }
              type: { _eq: "deposit" }
              is_transaction_success: { _eq: true }
            }
            order_by: { transaction_timestamp: desc }
            limit: 50
          ) {
            amount
            asset_type
            transaction_timestamp
            transaction_version
            owner_address
          }
        }
      `,
      variables: {
        assets: [token.contract],
        end: new Date(Math.max(0, Number(order.expireAt ?? 0)) * 1000).toISOString(),
        owner: address,
        start: new Date(Math.max(0, Number(order.createdAt ?? 0)) * 1000).toISOString(),
      },
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return valid((payload.data?.fungible_asset_activities ?? []).map((item) => {
    const row = item as Record<string, unknown>;
    return {
      amount: amount(row.amount, token.decimals),
      currency: asset,
      hash: String(row.transaction_version ?? ""),
      raw: row,
      timestamp: time(row.transaction_timestamp),
      to: String(row.owner_address ?? ""),
    };
  }));
}

async function tronGrid<T>(address: string, path: string, params: URLSearchParams) {
  const payload = await json<{ data?: T[] }>(`https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}/${path}?${params}`);
  return Array.isArray(payload.data) ? payload.data : [];
}

async function rpc<T>(method: string, params: unknown[]) {
  const payload = await json<{ result?: T }>("https://bsc.rpc.blxrbdn.com", {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return payload.result as T;
}

async function json<T>(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return {} as T;
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

function matches(payment: ProbePayment, order: ProbeOrder, tx: TxCandidate) {
  const createdAt = Number(order.createdAt ?? 0);
  const expireAt = Number(order.expireAt ?? 0);
  const targetAmount = Number(payment.amount);
  return Boolean(tx.hash)
    && tx.timestamp >= createdAt
    && tx.timestamp <= expireAt
    && key(tx.currency) === key(payment.currency)
    && Number.isFinite(targetAmount)
    && sameAmount(tx.amount, targetAmount)
    && sameAddress(tx.to, payment.address);
}

function valid(candidates: Array<TxCandidate | null>) {
  return candidates.filter((item): item is TxCandidate => Boolean(item?.hash && Number.isFinite(item.amount) && Number.isFinite(item.timestamp)));
}

function sameAddress(a: unknown, b: unknown) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}

function addressOf(value: unknown) {
  return typeof value === "string" ? value : String((value as { hash?: unknown } | null)?.hash ?? "");
}

function amount(value: unknown, decimals: number) {
  const text = String(value ?? "0");
  return new Decimal(text.startsWith("0x") ? BigInt(text).toString() : text).div(new Decimal(10).pow(decimals)).toNumber();
}

function time(value: unknown) {
  return Math.floor(Date.parse(String(value)) / 1000);
}

function hex(value: number) {
  return `0x${value.toString(16)}`;
}

function topicAddress(address: string) {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}
