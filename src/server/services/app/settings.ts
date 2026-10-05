import Decimal from "decimal.js";
import { getConfig, setConfig, setConfigs } from "@/server/db";
import { AppError } from "@/server/http/api";
import { configureBotMiniApp, refreshBotInfo } from "@/server/services/telegram/api";
import { ceilAmount } from "@/shared/amount";
import { toHttpsSiteUrl } from "@/shared/domain";
import type { AppEnv } from "@/server/types/env";

const defaultFiatPerUSD: Record<string, number> = {
  CNY: 7.2,
  EUR: 0.93,
  GBP: 0.79,
  TWD: 32,
  USD: 1,
};

const defaultAssetUSD: Record<string, number> = {
  BNB: 610,
  ETH: 3200,
  GRAM: 3,
  MATIC: 0.9,
  TRX: 0.12,
  USDC: 1,
  USDT: 1,
};

const cryptoSymbols: Record<string, string> = {
  BNB: "BNBUSDT",
  ETH: "ETHUSDT",
  MATIC: "POLUSDT",
  TRX: "TRXUSDT",
};

const defaultTimeoutMinutes = 5;

export interface SystemSettings {
  currency: string;
  fastConfirm: boolean;
  rateAdjust: number;
  timeout: number;
}

export interface MarketRates {
  assetUSD: Record<string, number>;
  fiatPerUSD: Record<string, number>;
  messageKey?: string;
  syncedAt: number;
}

export interface RateContext {
  rateAdjust: number;
  rates: MarketRates;
  settings: SystemSettings;
}

let memoryRates: { expiresAt: number; snapshot: MarketRates } | null = null;

export async function adminSettings(env: AppEnv) {
  return {
    ...(await systemSettings(env)),
    botUsername: await getConfig(env, "bot_username") || "",
    domain: await getConfig(env, "domain") || "",
    marketRates: publicMarketRates(await currentMarketRates(env)),
    title: await getConfig(env, "title") || "HashPay",
  };
}

export async function rebindBot(env: AppEnv) {
  const bot = await refreshBotInfo(env);
  await configureBotMiniApp(env);
  return { username: bot.username };
}

export async function saveAdminSettings(env: AppEnv, input: Record<string, unknown>) {
  const settings = normalizeSettingsPayload(input);
  const domain = normalizeDomain(input.domain);
  const title = String(input.title ?? "").trim() || "HashPay";
  const [previousDomain, botUsername] = await Promise.all([
    getConfig(env, "domain"),
    getConfig(env, "bot_username"),
  ]);
  await setConfigs(env, {
    currency: settings.currency,
    domain,
    fast_confirm: String(settings.fastConfirm),
    rate_adjust: String(settings.rateAdjust),
    title,
    timeout: String(settings.timeout),
  });
  if (domain !== (previousDomain || "")) await configureBotMiniApp(env);
  return {
    ...settings,
    botUsername: botUsername || "",
    domain,
    marketRates: publicMarketRates(await currentMarketRates(env)),
    title,
  };
}

function publicMarketRates(rates: MarketRates) {
  return {
    assetUSD: rates.assetUSD,
    fiatPerUSD: rates.fiatPerUSD,
    messageKey: rates.messageKey,
    syncedAt: rates.syncedAt,
  };
}

export async function systemSettings(env: AppEnv): Promise<SystemSettings> {
  const [currency, timeout, rateAdjust, fastConfirm] = await Promise.all([
    getConfig(env, "currency"),
    getConfig(env, "timeout"),
    getConfig(env, "rate_adjust"),
    getConfig(env, "fast_confirm"),
  ]);
  return {
    currency: normalizeCurrency(currency || "CNY"),
    fastConfirm: fastConfirm === "true",
    rateAdjust: normalizeRateAdjust(rateAdjust),
    timeout: normalizeTimeoutMinutes(timeout),
  };
}

export async function rateContext(env: AppEnv): Promise<RateContext> {
  const settings = await systemSettings(env);
  return {
    rateAdjust: settings.rateAdjust,
    rates: await currentMarketRates(env),
    settings,
  };
}

export function marketAmount(amount: number, from: string, to: string, rate: RateContext) {
  return convert(amount, from || rate.settings.currency, to, rate).toNumber();
}

export function payAmount(amount: number, from: string, to: string, rate: RateContext) {
  const adjusted = convert(amount, from || rate.settings.currency, to, rate)
    .div(new Decimal(1).plus(new Decimal(rate.rateAdjust).div(100)));
  return ceilAmount(adjusted);
}

export function normalizeSettingsPayload(input: Record<string, unknown>) {
  return {
    currency: normalizeCurrency(String(input.currency ?? "CNY")),
    fastConfirm: input.fastConfirm === true || input.fastConfirm === "true",
    rateAdjust: normalizeRateAdjust(input.rateAdjust),
    timeout: normalizeTimeoutMinutes(input.timeout),
  };
}

function normalizeCurrency(value: string) {
  const upper = value.trim().toUpperCase();
  return ["CNY", "USD", "EUR", "GBP", "TWD"].includes(upper) ? upper : "CNY";
}

function normalizeRateAdjust(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, -99), 200);
}

function normalizeTimeoutMinutes(value: unknown) {
  if (value == null || (typeof value === "string" && !value.trim())) return defaultTimeoutMinutes;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultTimeoutMinutes;
  return Math.min(Math.max(Math.round(parsed), 1), 30);
}

function normalizeDomain(value: unknown) {
  try {
    return toHttpsSiteUrl(value);
  } catch {
    throw new AppError(400, "errors.domain_invalid");
  }
}

export async function currentMarketRates(env: AppEnv): Promise<MarketRates> {
  const nowMs = Date.now();
  if (memoryRates && memoryRates.expiresAt > nowMs) return memoryRates.snapshot;
  const cached = parseMarketRates(await getConfig(env, "market_rates"));
  memoryRates = { expiresAt: nowMs + 60_000, snapshot: cached };
  return cached;
}

export async function syncMarketRates(env: AppEnv): Promise<MarketRates> {
  const cached = await getConfig(env, "market_rates");
  const current = parseMarketRates(cached);
  const out = defaultMarketRates();
  try {
    out.fiatPerUSD = await fetchFiatRates();
    out.syncedAt = nowSeconds();
  } catch {
    out.fiatPerUSD = current.fiatPerUSD;
    out.messageKey = "settings.rate_error_fiat";
    out.syncedAt = current.syncedAt;
  }
  try {
    out.assetUSD = await fetchCryptoRates();
    out.syncedAt = out.syncedAt || nowSeconds();
  } catch {
    out.assetUSD = current.assetUSD;
    out.messageKey = out.messageKey ?? "settings.rate_error_crypto";
    out.syncedAt = out.syncedAt || current.syncedAt;
  }
  await setConfig(env, "market_rates", JSON.stringify(out));
  memoryRates = { expiresAt: Date.now() + 60_000, snapshot: out };
  return out;
}

function defaultMarketRates(): MarketRates {
  return {
    assetUSD: { ...defaultAssetUSD },
    fiatPerUSD: { ...defaultFiatPerUSD },
    syncedAt: 0,
  };
}

function parseMarketRates(value: string | null) {
  if (!value) return defaultMarketRates();
  try {
    const parsed = JSON.parse(value) as Partial<MarketRates>;
    if (!parsed || typeof parsed !== "object") return defaultMarketRates();
    return {
      assetUSD: { ...defaultAssetUSD, ...(parsed.assetUSD ?? {}) },
      fiatPerUSD: { ...defaultFiatPerUSD, ...(parsed.fiatPerUSD ?? {}) },
      messageKey: parsed.messageKey,
      syncedAt: Number(parsed.syncedAt) || 0,
    };
  } catch {
    return defaultMarketRates();
  }
}

async function fetchFiatRates() {
  const response = await fetch("https://open.er-api.com/v6/latest/USD", {
    signal: timeoutSignal(5000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`fiat rates status ${response.status}`);
  const payload = await response.json<{
    rates?: Record<string, number>;
    result?: string;
  }>();
  if (payload.result !== "success" || !payload.rates) throw new Error("fiat rates unavailable");
  const rates = { ...defaultFiatPerUSD };
  for (const currency of Object.keys(defaultFiatPerUSD)) {
    if (currency === "USD") rates.USD = 1;
    else if (payload.rates[currency] > 0) rates[currency] = payload.rates[currency];
  }
  return rates;
}

async function fetchCryptoRates() {
  const signal = timeoutSignal(5000);
  const [bybitResponse, tonResponse] = await Promise.all([
    fetch("https://api.bybit.com/v5/market/tickers?category=spot", {
      signal,
      headers: { accept: "application/json" },
    }),
    fetch("https://api.coinbase.com/v2/exchange-rates?currency=TON", {
      signal,
      headers: { accept: "application/json" },
    }),
  ]);
  if (!bybitResponse.ok || !tonResponse.ok) {
    throw new Error(`crypto rates status ${bybitResponse.status}/${tonResponse.status}`);
  }
  const [bybit, ton] = await Promise.all([
    bybitResponse.json<{
      result?: { list?: Array<{ lastPrice?: string; symbol?: string }> };
      retCode?: number;
    }>(),
    tonResponse.json<{ data?: { rates?: { USD?: string } } }>(),
  ]);
  if (bybit.retCode !== 0 || !bybit.result?.list) throw new Error("crypto rates unavailable");
  const prices = new Map(bybit.result.list.map((ticker) => [ticker.symbol, Number(ticker.lastPrice)]));
  const rates: Record<string, number> = { ...defaultAssetUSD, USDC: 1, USDT: 1 };
  for (const [asset, symbol] of Object.entries(cryptoSymbols)) {
    const price = Number(prices.get(symbol));
    if (!Number.isFinite(price) || price <= 0) throw new Error(`crypto rate missing: ${asset}`);
    rates[asset] = price;
  }
  const tonPrice = Number(ton.data?.rates?.USD);
  if (!Number.isFinite(tonPrice) || tonPrice <= 0) throw new Error("crypto rate missing: GRAM");
  rates.GRAM = tonPrice;
  return rates;
}

function convert(amount: number, from: string, to: string, rate: RateContext) {
  const source = from.trim().toUpperCase();
  const target = to.trim().toUpperCase();
  if (source === target) return new Decimal(amount);
  return new Decimal(amount).mul(usd(rate.rates, source)).div(usd(rate.rates, target));
}

function usd(snapshot: MarketRates, currency: string) {
  if (currency === "USD") return new Decimal(1);
  if (snapshot.assetUSD[currency] > 0) return new Decimal(snapshot.assetUSD[currency]);
  return new Decimal(1).div(snapshot.fiatPerUSD[currency]);
}

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
