import type { NotifyStatus, OrderStatus, PaymentSnapshot } from "@/shared/types/domain";

export interface TelegramUser {
  id: number;
  firstName: string;
  lastName: string;
}

export interface AppState {
  bot: "admin" | "domain" | "invalid" | "missing" | "ready";
  db: string | null;
  domain: string | null;
  queue: string | null;
  ready: boolean;
  title: string;
  username: string;
}

export interface Order {
  amount: number;
  createdAt: number;
  currency: string;
  description: string | null;
  expireAt: number;
  id: string;
  merchantId: string;
  merchantNo: string;
  paidAt: number | null;
  payment: Partial<PaymentSnapshot>;
  payway: { id: number; name: string | null } | null;
  returnUrl: string | null;
  status: OrderStatus;
  updatedAt: number;
}

export interface Checkout {
  fastConfirm: boolean;
  merchant: { id: string; name: string };
  options: Array<{
    amount: number;
    asset: string;
    network: string;
  }>;
  order: Order;
  title: string;
}

export interface Payment {
  address: string;
  assets: string[];
  createdAt: number;
  driver: string;
  id: number;
  name: string;
  status: "disabled" | "enabled" | "error";
  updatedAt: number;
}

export interface Merchant {
  authKey: string;
  callback: string | null;
  createdAt: number;
  id: string;
  name: string;
  status: "disabled" | "enabled";
  type: "ezfp" | "telegram" | "website";
  updatedAt: number;
}

export interface MerchantInput {
  callback: string | null;
  name: string;
  status: Merchant["status"];
  type: Merchant["type"];
}

export interface Dashboard {
  actions: Order[];
  health: Array<{ details: string; id: number; name: string; network: string; status: "ok" | "warn" }>;
  orders: Order[];
  pending: number;
  trends: Record<"td" | "yd" | "7d" | "15d" | "30d", Array<{
    amount: number;
    label: string;
    orders: number;
    paidOrders: number;
    timestamp: number;
  }>>;
}

export interface OrderDetail {
  merchantName: string | null;
  notify: Array<{
    attempts: number;
    id: number;
    lastError: string | null;
    nextRunAt: number;
    status: NotifyStatus;
  }>;
  order: Order;
  review: {
    answer: string;
    image: string | null;
    imageUrl: string | null;
  } | null;
}

export interface Settings {
  botUsername: string;
  currency: string;
  domain: string;
  fastConfirm: boolean;
  marketRates: {
    assetUSD: Record<string, number>;
    fiatPerUSD: Record<string, number>;
    messageKey?: string;
    syncedAt: number;
  };
  rateAdjust: number;
  title: string;
  timeout: number;
}
