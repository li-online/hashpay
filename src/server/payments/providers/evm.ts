import Decimal from "decimal.js";
import type { PaymentChannel } from "@/server/payments/channels";
import type { PaymentCheckInput } from "@/server/payments/driver";
import { paymentMatches } from "@/server/payments/match";
import { fetchJson, fetchText, host, reason } from "@/server/utils/http";
import { sameAmount } from "@/shared/amount";
import { evmAssets, key } from "@/shared/payments";
import type { TxCandidate } from "@/shared/types/domain";
import type { PaymentSnapshot } from "@/shared/types/domain";

const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type Chain = {
  blockSeconds: number;
  explorer?: string;
  native: string;
  rpc?: string;
};

const chains: Record<string, Chain> = {
  base: { blockSeconds: 2, explorer: "https://base.blockscout.com", native: "eth" },
  bep20: {
    blockSeconds: 0.4,
    native: "bnb",
    rpc: "https://bsc.rpc.blxrbdn.com",
  },
  erc20: { blockSeconds: 12, explorer: "https://eth.blockscout.com", native: "eth" },
  polygon: { blockSeconds: 2, explorer: "https://polygon.blockscout.com", native: "matic" },
};

export async function check(channel: PaymentChannel) {
  const chain = chains[key(channel.driver)];
  if (!chain) throw new Error("EVM network is not configured");
  if (!chain.explorer) {
    await rpc(chain, "eth_blockNumber", []);
    return;
  }
  await json<Record<string, unknown>>(`${chain.explorer}/api/v2/addresses/${channel.address}`);
}

export async function scan(input: PaymentCheckInput) {
  const txs = await transactions(input);
  return paymentMatches(input.orders, txs, match, (tx) => ({ time: tx.timestamp, txid: tx.hash }));
}

async function transactions(input: PaymentCheckInput) {
  const first = input.orders[0]?.snapshot;
  const network = key(first?.driver);
  const chain = chains[network];
  const address = String(input.channel?.address ?? first?.address ?? "");
  if (!chain || !address) return [];
  const from = Math.min(...input.orders.map((order) => order.createdAt));
  const assets = Array.from(new Set(input.orders.map((order) => key(order.snapshot.currency)).filter(Boolean)));
  const txs = [];
  for (const asset of assets) {
    if (chain.explorer) txs.push(...await blockscout(chain.explorer, address, asset, network));
    else txs.push(...await rpcScan(chain, address, asset, network, from));
  }
  return txs;
}

async function blockscout(baseUrl: string, address: string, asset: string, network: string) {
  const token = evmAssets[network]?.[asset];
  if (token) {
    const params = new URLSearchParams({ token: token.contract, type: "ERC-20" });
    const payload = await json<{ items?: unknown[] }>(`${baseUrl}/api/v2/addresses/${address}/token-transfers?${params}`);
    return (payload.items ?? []).map((item) => {
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
    });
  }

  const payload = await json<{ items?: unknown[] }>(`${baseUrl}/api/v2/addresses/${address}/transactions`);
  return (payload.items ?? []).map((item) => {
    const row = item as Record<string, unknown>;
    return {
      amount: amount(row.value, 18),
      currency: asset,
      hash: String(row.hash ?? ""),
      raw: row,
      timestamp: time(row.timestamp),
      to: addressOf(row.to),
    };
  });
}

async function rpcScan(chain: Chain, address: string, asset: string, network: string, createdAt: number) {
  const token = evmAssets[network]?.[asset];
  return token ? tokenLogs(chain, address, asset, token.contract, token.decimals, createdAt) : [];
}

async function tokenLogs(chain: Chain, address: string, asset: string, contract: string, decimals: number, createdAt: number) {
  const latest = Number.parseInt(await rpc<string>(chain, "eth_blockNumber", []), 16);
  const checkedAt = Math.floor(Date.now() / 1000);
  const fromBlock = Math.max(0, latest - Math.ceil((checkedAt - createdAt) / chain.blockSeconds) - 1000);
  const logs = await rpc<Array<Record<string, unknown>>>(chain, "eth_getLogs", [{
    address: contract,
    fromBlock: hex(fromBlock),
    toBlock: "latest",
    topics: [transferTopic, null, topicAddress(address)],
  }]);
  return logs.map((log) => ({
    amount: amount(log.data, decimals),
    currency: asset,
    hash: String(log.transactionHash ?? ""),
    raw: { ...log, contract },
    timestamp: rpcTimestamp(log.blockTimestamp),
    to: address,
  }));
}

function match(snapshot: PaymentSnapshot, tx: TxCandidate, created: number, expire: number) {
  const network = key(snapshot.driver);
  const asset = key(snapshot.currency);
  const token = evmAssets[network]?.[asset];
  return Boolean(tx.hash)
    && tx.timestamp >= created
    && tx.timestamp <= expire
    && key(tx.currency) === asset
    && (!token || lower(contract(tx.raw)) === lower(token.contract))
    && sameAmount(tx.amount, snapshot.amount)
    && lower(snapshot.address) === lower(tx.to);
}

async function json<T>(url: string) {
  return fetchJson<T>(url);
}

async function rpc<T>(chain: Chain, method: string, params: unknown[]) {
  if (!chain.rpc) throw new Error("RPC is not configured");
  const { res, text } = await fetchText(chain.rpc, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!res.ok) throw new Error(`${host(chain.rpc)} ${method}: HTTP ${res.status} ${reason(text || res.statusText)}`.trim());
  const payload = parseRpc<T>(text, chain.rpc, method);
  if (payload.error || payload.result === undefined) {
    throw new Error(`${host(chain.rpc)} ${method}: ${reason(payload.error?.message ?? "RPC response is invalid")}`);
  }
  return payload.result;
}

function amount(value: unknown, decimals: number) {
  const text = String(value ?? "0");
  return new Decimal(text.startsWith("0x") ? BigInt(text).toString() : text).div(new Decimal(10).pow(decimals)).toNumber();
}

function addressOf(value: unknown) {
  return typeof value === "string" ? value : String((value as { hash?: unknown } | null)?.hash ?? "");
}

function contract(raw: unknown) {
  const row = raw as Record<string, unknown>;
  const token = row.token as { address_hash?: unknown } | undefined;
  return row.contract ?? row.address ?? row.contractAddress ?? token?.address_hash ?? "";
}

function lower(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function parseRpc<T>(text: string, url: string, method: string) {
  try {
    return JSON.parse(text || "{}") as { error?: { message?: string }; result?: T };
  } catch {
    throw new Error(`${host(url)} ${method}: invalid JSON ${reason(text)}`);
  }
}

function time(value: unknown) {
  return Math.floor(Date.parse(String(value)) / 1000);
}

function rpcTimestamp(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^0x[\da-f]+$/i.test(raw)) throw new Error("EVM RPC log blockTimestamp is invalid");
  const timestamp = Number.parseInt(raw, 16);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error("EVM RPC log blockTimestamp is invalid");
  return timestamp;
}

function hex(value: number) {
  return `0x${value.toString(16)}`;
}

function topicAddress(address: string) {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}
