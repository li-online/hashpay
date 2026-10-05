export type PaymentKind = "chain" | "exchange" | "wallet";
export type NetworkKey =
  | "aptos"
  | "base"
  | "binance"
  | "bep20"
  | "erc20"
  | "okpay"
  | "okx"
  | "polygon"
  | "solana"
  | "ton"
  | "trc20";

export type PaymentAssetKey =
  | "bnb"
  | "eth"
  | "gram"
  | "matic"
  | "trx"
  | "usdc"
  | "usdt";

export type Trc20Asset = {
  contract: string;
  decimals: number;
  symbol: string;
};

export type TokenAsset = {
  contract: string;
  decimals: number;
  symbol: string;
};

export interface PaymentAddress {
  helpKey: string;
  nameKey: string;
  pattern?: RegExp;
}

export interface PaymentData {
  id: string;
  helpKey?: string;
  nameKey: string;
}

export interface Payment {
  address: PaymentAddress;
  assets: string[];
  data?: PaymentData[];
  evm?: boolean;
  explorer?: {
    transaction: string;
  };
  icon: string;
  id: string;
  kind: PaymentKind;
  nameKey: string;
  network: string;
  telegramEmojiId?: string;
}

export interface PaymentAsset {
  icon: string;
  name: string;
  symbol: string;
  telegramEmojiId?: string;
}

export const paymentAssets: Record<PaymentAssetKey, PaymentAsset> = {
  bnb: { icon: "icon-bnb", name: "BNB", symbol: "BNB" },
  eth: { icon: "icon-ethereum", name: "ETH", symbol: "ETH", telegramEmojiId: "6221781623185088657" },
  gram: { icon: "icon-ton", name: "GRAM (ex TON)", symbol: "GRAM" },
  matic: { icon: "icon-polygon", name: "MATIC", symbol: "MATIC" },
  trx: { icon: "icon-tron", name: "TRX", symbol: "TRX" },
  usdc: { icon: "icon-usdc", name: "USDC", symbol: "USDC", telegramEmojiId: "6222075845624734726" },
  usdt: { icon: "icon-usdt", name: "USDT", symbol: "USDT", telegramEmojiId: "6222280715564752360" },
};

export const trc20Assets: Record<string, Trc20Asset> = {
  usdt: {
    contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    decimals: 6,
    symbol: "USDT",
  },
};

export const evmAssets: Record<string, Record<string, TokenAsset>> = {
  base: {
    usdc: { contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6, symbol: "USDC" },
    usdt: { contract: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", decimals: 6, symbol: "USDT" },
  },
  erc20: {
    usdt: { contract: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6, symbol: "USDT" },
    usdc: { contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6, symbol: "USDC" },
  },
  bep20: {
    usdt: { contract: "0x55d398326f99059ff775485246999027b3197955", decimals: 18, symbol: "USDT" },
    usdc: { contract: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", decimals: 18, symbol: "USDC" },
  },
  polygon: {
    usdt: { contract: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", decimals: 6, symbol: "USDT" },
    usdc: { contract: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", decimals: 6, symbol: "USDC" },
  },
};

export const tonAssets: Record<string, TokenAsset> = {
  usdt: {
    contract: "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe",
    decimals: 6,
    symbol: "USDT",
  },
};

export const aptosAssets: Record<string, TokenAsset> = {
  usdc: {
    contract: "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b",
    decimals: 6,
    symbol: "USDC",
  },
  usdt: {
    contract: "0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b",
    decimals: 6,
    symbol: "USDT",
  },
};

export const solanaAssets: Record<string, TokenAsset> = {
  usdc: {
    contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    symbol: "USDC",
  },
  usdt: {
    contract: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    decimals: 6,
    symbol: "USDT",
  },
};

export function key(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function assetInfo(value: unknown) {
  return paymentAssets[key(value) as PaymentAssetKey];
}

export function assetName(value: unknown) {
  return assetInfo(value)?.name ?? text(value).toUpperCase();
}

export function normalizeAssetCsv(raw: unknown, fallback: readonly string[] = []) {
  const source = text(raw) || fallback.join(",");
  return Array.from(new Set(source.split(",").map(key).filter(Boolean)));
}

export const trc20: Payment = {
  address: {
    helpKey: "payment.help.tron",
    nameKey: "payment.address.tron",
    pattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  },
  assets: ["usdt", "trx"],
  explorer: {
    transaction: "https://tronscan.org/#/transaction/{hash}",
  },
  icon: "icon-tron",
  id: "trc20",
  kind: "chain",
  nameKey: "network.trc20",
  network: "trc20",
  telegramEmojiId: "6221973857331323093",
};

export const erc20: Payment = {
  address: {
    helpKey: "payment.help.evm",
    nameKey: "payment.address.evm",
    pattern: /^0x[a-fA-F0-9]{40}$/,
  },
  assets: ["usdt", "usdc", "eth"],
  evm: true,
  explorer: {
    transaction: "https://etherscan.io/tx/{hash}",
  },
  icon: "icon-ethereum",
  id: "erc20",
  kind: "chain",
  nameKey: "network.erc20",
  network: "erc20",
  telegramEmojiId: "6221781623185088657",
};

export const base: Payment = {
  address: {
    helpKey: "payment.help.evm",
    nameKey: "payment.address.evm",
    pattern: /^0x[a-fA-F0-9]{40}$/,
  },
  assets: ["usdt", "usdc", "eth"],
  evm: true,
  explorer: {
    transaction: "https://basescan.org/tx/{hash}",
  },
  icon: "icon-base",
  id: "base",
  kind: "chain",
  nameKey: "network.base",
  network: "base",
};

export const bep20: Payment = {
  address: {
    helpKey: "payment.help.evm",
    nameKey: "payment.address.evm",
    pattern: /^0x[a-fA-F0-9]{40}$/,
  },
  assets: ["usdt", "usdc", "bnb"],
  evm: true,
  explorer: {
    transaction: "https://bscscan.com/tx/{hash}",
  },
  icon: "icon-bnb",
  id: "bep20",
  kind: "chain",
  nameKey: "network.bep20",
  network: "bep20",
  telegramEmojiId: "6221954916525558708",
};

export const polygon: Payment = {
  address: {
    helpKey: "payment.help.evm",
    nameKey: "payment.address.evm",
    pattern: /^0x[a-fA-F0-9]{40}$/,
  },
  assets: ["usdt", "usdc", "matic"],
  evm: true,
  explorer: {
    transaction: "https://polygonscan.com/tx/{hash}",
  },
  icon: "icon-polygon",
  id: "polygon",
  kind: "chain",
  nameKey: "network.polygon",
  network: "polygon",
};

export const ton: Payment = {
  address: {
    helpKey: "payment.help.ton",
    nameKey: "payment.address.ton",
    pattern: /^(EQ|UQ)[A-Za-z0-9_-]{46}$/,
  },
  assets: ["usdt", "gram"],
  explorer: {
    transaction: "https://tonviewer.com/transaction/{hash}",
  },
  icon: "icon-ton",
  id: "ton",
  kind: "chain",
  nameKey: "network.ton",
  network: "ton",
  telegramEmojiId: "6222235515328928786",
};

export const aptos: Payment = {
  address: {
    helpKey: "payment.help.aptos",
    nameKey: "payment.address.aptos",
    pattern: /^0x[a-fA-F0-9]{64}$/,
  },
  assets: ["usdt", "usdc"],
  explorer: {
    transaction: "https://explorer.aptoslabs.com/txn/{hash}?network=mainnet",
  },
  icon: "icon-aptos",
  id: "aptos",
  kind: "chain",
  nameKey: "network.aptos",
  network: "aptos",
};

export const solana: Payment = {
  address: {
    helpKey: "payment.help.solana",
    nameKey: "payment.address.solana",
    pattern: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  },
  assets: ["usdt", "usdc"],
  explorer: {
    transaction: "https://solscan.io/tx/{hash}",
  },
  icon: "icon-solana",
  id: "solana",
  kind: "chain",
  nameKey: "network.solana",
  network: "solana",
  telegramEmojiId: "6221755831906475362",
};

export const binance: Payment = {
  address: {
    helpKey: "payment.binance.id_help",
    nameKey: "payment.binance.id",
    pattern: /^[1-9]\d*$/,
  },
  assets: ["usdt", "usdc"],
  data: [
    {
      id: "apiKey",
      helpKey: "payment.binance.api_key_help",
      nameKey: "payment.binance.api_key",
    },
    { id: "secretKey", helpKey: "payment.binance.secret_key_help", nameKey: "payment.binance.secret_key" },
  ],
  icon: "icon-binance",
  id: "binance",
  kind: "exchange",
  nameKey: "network.binance",
  network: "binance",
  telegramEmojiId: "6222038930380823799",
};

export const okx: Payment = {
  address: {
    helpKey: "payment.okx.uid_help",
    nameKey: "payment.okx.uid",
    pattern: /^[1-9]\d*$/,
  },
  assets: ["usdt", "usdc"],
  data: [
    { id: "apiKey", helpKey: "payment.okx.api_key_help", nameKey: "payment.okx.api_key" },
    { id: "secretKey", helpKey: "payment.okx.secret_key_help", nameKey: "payment.okx.secret_key" },
    { id: "passphrase", helpKey: "payment.okx.passphrase_help", nameKey: "payment.okx.passphrase" },
  ],
  icon: "icon-okx",
  id: "okx",
  kind: "exchange",
  nameKey: "network.okx",
  network: "okx",
  telegramEmojiId: "6224164522580516460",
};

export const okpay: Payment = {
  address: {
    helpKey: "payment.okpay.id_help",
    nameKey: "payment.okpay.id",
    pattern: /^[1-9]\d*$/,
  },
  assets: ["usdt", "trx"],
  data: [{ id: "key", helpKey: "payment.okpay.key_help", nameKey: "payment.okpay.key" }],
  icon: "icon-okpay",
  id: "okpay",
  kind: "wallet",
  nameKey: "network.okpay",
  network: "okpay",
};

export const payments: Payment[] = [
  trc20,
  erc20,
  base,
  bep20,
  polygon,
  ton,
  aptos,
  solana,
  binance,
  okx,
  okpay,
];

const byId = new Map(payments.map((payment) => [payment.id, payment]));
const byNetwork = new Map(payments.map((payment) => [payment.network, payment]));

export const evmPayments = payments.filter((payment) => payment.evm);
export const defaultPayment = payments[0]!;

export function paymentById(id: unknown) {
  return byId.get(String(id));
}

export function paymentByNetwork(network: unknown) {
  return byNetwork.get(key(network));
}

export function networkLabel(network: unknown) {
  const raw = text(network);
  return paymentByNetwork(raw)?.nameKey ?? raw.toUpperCase();
}

export function paymentExplorerUrl(network: unknown, hash: unknown) {
  const value = String(hash || "").trim();
  const template = paymentByNetwork(network)?.explorer?.transaction;
  return value && template ? template.replace("{hash}", encodeURIComponent(value)) : "";
}

export function paymentAssetIcon(asset: unknown) {
  return assetInfo(asset)?.icon ?? "";
}

export function paymentAssetTelegramEmojiId(asset: unknown) {
  return assetInfo(asset)?.telegramEmojiId ?? "";
}

export function paymentNetworkTelegramEmojiId(network: unknown) {
  const value = key(network);
  return (paymentByNetwork(value) ?? paymentById(value))?.telegramEmojiId ?? paymentAssets.eth.telegramEmojiId ?? "";
}
