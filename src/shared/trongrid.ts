import { key, trc20Assets } from "@/shared/payments";
import type { TxCandidate } from "@/shared/types/domain";

export interface TronGridTokenTx {
  block_timestamp?: number;
  from?: string;
  to?: string;
  token_info?: {
    address?: string;
    decimals?: number;
    symbol?: string;
  };
  transaction_id?: string;
  value?: string;
}

export interface TronGridNativeTx {
  block_timestamp?: number;
  raw_data?: {
    contract?: Array<{
      parameter?: {
        value?: {
          amount?: number;
          owner_address?: string;
        };
      };
      type?: string;
    }>;
  };
  txID?: string;
}

export function trc20Candidate(item: TronGridTokenTx, currency: string): TxCandidate | null {
  const asset = key(currency);
  const token = trc20Assets[asset];
  if (!token || item.token_info?.address !== token.contract || String(item.token_info?.symbol || "").toUpperCase() !== token.symbol) return null;
  return {
    amount: Number(item.value) / 10 ** Number(item.token_info?.decimals ?? 6),
    currency: asset,
    from: item.from,
    hash: String(item.transaction_id || ""),
    raw: item,
    timestamp: Math.floor(Number(item.block_timestamp) / 1000),
    to: item.to,
  };
}

export function trxCandidate(item: TronGridNativeTx, address: string): TxCandidate | null {
  const contract = item.raw_data?.contract?.[0];
  const value = contract?.parameter?.value;
  if (contract?.type !== "TransferContract" || !value?.amount) return null;
  return {
    amount: Number(value.amount) / 1_000_000,
    currency: "trx",
    from: value.owner_address,
    hash: String(item.txID || ""),
    raw: item,
    timestamp: Math.floor(Number(item.block_timestamp) / 1000),
    to: address,
  };
}

export function trc20ContractMatches(currency: string, raw: unknown) {
  const token = trc20Assets[key(currency)];
  return !token || String((raw as TronGridTokenTx).token_info?.address ?? "") === token.contract;
}
