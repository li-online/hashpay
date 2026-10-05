import { AppError } from "@/server/http/api";
import type { PaymentChannel } from "@/server/payments/channels";
import { check as checkAptos, scan as scanAptos } from "@/server/payments/providers/aptos";
import { check as checkBinance, scan as scanBinance } from "@/server/payments/providers/binance";
import { check as checkEvm, scan as scanEvm } from "@/server/payments/providers/evm";
import { check as checkOkpay, create as createOkpay, scan as scanOkpay } from "@/server/payments/providers/okpay";
import { check as checkOkx, scan as scanOkx } from "@/server/payments/providers/okx";
import { check as checkSolana, scan as scanSolana } from "@/server/payments/providers/solana";
import { check as checkTon, scan as scanTon } from "@/server/payments/providers/ton";
import { check as checkTrc20, scan as scanTrc20 } from "@/server/payments/providers/trc20";
import {
  defaultPayment,
  evmPayments,
  normalizeAssetCsv,
  key,
  paymentById,
  paymentExplorerUrl,
  payments,
  type Payment,
} from "@/shared/payments";
import { ceilAmount } from "@/shared/amount";
import type { Order } from "@/server/services/orders/repository";
import type { PaymentSnapshot } from "@/shared/types/domain";

export { defaultPayment, evmPayments, paymentExplorerUrl, payments };

export interface PaymentOption {
  asset: string;
  network: string;
  channelId: number;
}

export interface PaymentCheckInput {
  channel?: PaymentChannel;
  fastConfirm: boolean;
  orders: PaymentCheckOrder[];
}

export interface PaymentCheckOrder {
  createdAt: number;
  expireAt: number;
  id: string;
  snapshot: PaymentSnapshot;
}

export interface CheckResult {
  error?: string;
  status: "error" | "ok";
}

export interface PaymentCheckResult extends CheckResult {
  matches: PaymentCheckMatch[];
}

export interface PaymentCheckMatch {
  orderId: string;
  time?: number;
  txid?: string;
}

type Check = (channel: PaymentChannel) => Promise<void>;
type Scan = (input: PaymentCheckInput) => Promise<PaymentCheckMatch[]>;
type Create = (channel: PaymentChannel, order: Order, snapshot: PaymentSnapshot) => Promise<PaymentSnapshot>;
type Validate = (input: { address: string; data: Record<string, string> }) => Promise<void>;
type Provider = {
  check: Check;
  scan: Scan;
  scheduled?: true;
  validate?: Validate;
};

const providers: Record<string, Provider> = {
  aptos: { check: checkAptos, scan: scanAptos, scheduled: true },
  base: { check: checkEvm, scan: scanEvm, scheduled: true },
  bep20: { check: checkEvm, scan: scanEvm, scheduled: true },
  binance: { check: checkBinance, scan: scanBinance, scheduled: true, validate: checkBinance },
  erc20: { check: checkEvm, scan: scanEvm, scheduled: true },
  okpay: { check: checkOkpay, scan: scanOkpay },
  okx: { check: checkOkx, scan: scanOkx, scheduled: true, validate: checkOkx },
  polygon: { check: checkEvm, scan: scanEvm, scheduled: true },
  solana: { check: checkSolana, scan: scanSolana, scheduled: true },
  ton: { check: checkTon, scan: scanTon, scheduled: true },
  trc20: { check: checkTrc20, scan: scanTrc20, scheduled: true },
};

const creators: Partial<Record<string, Create>> = {
  okpay: createOkpay,
};

export function validateChannel(input: { address?: string; assets?: string[]; driver: string }) {
  const payment = byId(input.driver);
  address(payment, input.address ?? "");
  validateAssets(input.assets ?? [], payment.assets);
  return payment;
}

export function paymentOptions(channel: PaymentChannel): PaymentOption[] {
  const payment = byId(channel.driver);
  return enabledAssets(channel.assets, payment.assets).map((asset) => ({
    asset,
    channelId: channel.id,
    network: payment.network,
  }));
}

export function assignPayment(channel: PaymentChannel, amount: number, targetAsset: string): PaymentSnapshot {
  const payment = byId(channel.driver);
  return {
    address: address(payment, channel.address),
    amount: ceilAmount(amount),
    currency: key(targetAsset),
    driver: payment.id,
  };
}

export function createPayment(channel: PaymentChannel, order: Order, snapshot: PaymentSnapshot) {
  return creators[channel.driver]?.(channel, order, snapshot) ?? Promise.resolve(snapshot);
}

export async function validateData(driver: string, address: string, data: Record<string, string>) {
  await providers[byId(driver).id].validate?.({ address, data });
}

export async function checkChannel(channel: PaymentChannel): Promise<CheckResult> {
  const provider = providers[byId(channel.driver).id];
  try {
    await provider.check(channel);
    return { status: "ok" };
  } catch (error) {
    return { error: errorText(error), status: "error" };
  }
}

export async function checkPayment(input: PaymentCheckInput): Promise<PaymentCheckResult> {
  const driver = input.orders[0]?.snapshot.driver;
  if (!driver) return { matches: [], status: "ok" };
  try {
    return { matches: await providers[byId(driver).id].scan(input), status: "ok" };
  } catch (error) {
    return { error: errorText(error), matches: [], status: "error" };
  }
}

export function checksOnSchedule(driver: string) {
  return providers[byId(driver).id].scheduled === true;
}

function byId(id: string) {
  const payment = paymentById(id);
  if (!payment) throw new AppError(400, "errors.payment_driver_invalid");
  return payment;
}

function errorText(error: unknown) {
  const detail = error instanceof AppError ? error.params.detail : undefined;
  return String(detail ?? (error instanceof Error ? error.message : "Payment check failed"));
}

function address(payment: Payment, raw: string) {
  const value = raw.trim();
  if (!value) throw new AppError(400, "errors.payment_field_missing");
  if (payment.address.pattern && !payment.address.pattern.test(value)) {
    throw new AppError(400, "errors.payment_address_invalid");
  }
  return value;
}

function validateAssets(raw: string[], supported: readonly string[]) {
  const assets = Array.from(new Set(raw.map(key).filter(Boolean)));
  if (!assets.length) throw new AppError(400, "errors.payment_asset_invalid");
  const invalid = assets.filter((asset) => !supported.includes(asset));
  if (invalid.length) throw new AppError(400, "errors.payment_asset_invalid");
}

function enabledAssets(raw: unknown, supported: readonly string[]) {
  const allowed = new Set(supported);
  return (Array.isArray(raw) ? raw.map(key) : normalizeAssetCsv(raw, supported)).filter((asset) => allowed.has(asset));
}
