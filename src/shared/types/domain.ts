export type OrderStatus = "pending" | "paid" | "expired" | "invalid";
export type NotifyStatus = "pending" | "done" | "retry" | "failed";

export interface PaymentSnapshot {
  address?: string;
  amount: number;
  currency: string;
  driver: string;
  out_id?: string;
  tx?: PaymentTxEvidence;
  url?: string;
}

export interface PaymentTxEvidence {
  confirmedBy: "system" | "admin";
  timestamp: number;
  txid?: string;
}

export interface TxCandidate {
  amount: number;
  currency: string;
  from?: string;
  hash: string;
  raw: unknown;
  timestamp: number;
  to?: string;
}
