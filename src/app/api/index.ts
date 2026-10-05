export * from "@/shared/types/api";
export * from "@/app/api/http";

import { del, get, post, put, upload, type ApiRequestOptions } from "@/app/api/http";
import type {
  Checkout,
  Dashboard,
  Merchant,
  MerchantInput,
  OrderDetail,
  Order,
  Payment,
  Settings,
  AppState,
  TelegramUser,
} from "@/shared/types/api";

function endpoints(options: ApiRequestOptions = {}) {
  return {
    state: {
      get: () => get<AppState>("/api/state", options),
    },
    setup: {
      submit: (domain: string) => post<{ domain: string }>("/api/admin/setup", { domain }, options),
    },
    session: {
      current: () => get<TelegramUser>("/api/admin/session", options),
      logout: () => del<{ ok: boolean }>("/api/admin/session", options),
      createCode: (pin: string) => post<{ challenge: string; command: string; expiresAt: number }>("/api/admin/session/pin", { pin }, options),
      checkCode: (pin: string, challenge: string) =>
        get<{ authenticated: boolean; user?: TelegramUser }>(`/api/admin/session/pin/${id(pin)}?challenge=${id(challenge)}`, options),
      telegram: (initData: string) => post<TelegramUser & { setupRequired: boolean }>("/api/admin/session/telegram", { initData }, options),
    },
    checkout: {
      order: (orderId: string) => get<Checkout>(`/api/checkout/${id(orderId)}`, options),
      status: (orderId: string) => get<Order>(`/api/checkout/${id(orderId)}/status`, options),
      select: (orderId: string, input: { asset: string; network: string }) =>
        put<Record<string, unknown>>(`/api/checkout/${id(orderId)}/payment`, input, options),
      check: (orderId: string) =>
        post<Record<string, unknown>>(`/api/checkout/${id(orderId)}/check`, undefined, options),
      review: (orderId: string, input: { answer: string; image: string }) =>
        post<{ review: unknown }>(`/api/checkout/${id(orderId)}/review`, input, options),
    },
    dashboard: {
      get: () => get<Dashboard>("/api/admin/dashboard", options),
      check: () => post<Dashboard>("/api/admin/dashboard/check", undefined, options),
    },
    orders: {
      list: (input: { page: number; pageSize: number; q?: string; status: string }) =>
        get<{ items: Order[]; page: number; pageSize: number; total: number }>(`/api/admin/orders?${orderQuery(input)}`, options),
      get: (orderId: string) => get<OrderDetail>(`/api/admin/orders/${id(orderId)}`, options),
      remove: (orderId: string) => del<{ ok: boolean }>(`/api/admin/orders/${id(orderId)}`, options),
      check: (orderId: string) => post(`/api/admin/orders/${id(orderId)}/check`, undefined, options),
      confirm: (orderId: string) => post(`/api/admin/orders/${id(orderId)}/confirm`, undefined, options),
      resend: (orderId: string) => post(`/api/admin/orders/${id(orderId)}/notify`, undefined, options),
    },
    payments: {
      list: () => get<Payment[]>("/api/admin/payment", options),
      create: (input: { address: string; assets: string[]; data: Record<string, string>; driver: string; name: string; status: "disabled" | "enabled" }) =>
        post<Payment>("/api/admin/payment", input, options),
      update: (paymentId: number, input: { address: string; assets: string[]; data: Record<string, string>; driver: string; name: string; status: "disabled" | "enabled" }) =>
        put<Payment>(`/api/admin/payment/${paymentId}`, input, options),
      remove: (paymentId: number) => del<{ ok: boolean }>(`/api/admin/payment/${paymentId}`, options),
    },
    merchants: {
      list: () => get<Merchant[]>("/api/admin/merchants", options),
      create: (input: MerchantInput) => post<{ credential: string; merchant: Merchant }>("/api/admin/merchants", input, options),
      update: (merchantId: string, input: MerchantInput) =>
        put<{ credential?: string; merchant: Merchant }>(`/api/admin/merchants/${id(merchantId)}`, input, options),
      remove: (merchantId: string) => del<{ ok: boolean }>(`/api/admin/merchants/${id(merchantId)}`, options),
      rotateCredential: (merchantId: string) => post<{ credential: string; merchant: Merchant }>(`/api/admin/merchants/${id(merchantId)}/rotate-key`, undefined, options),
    },
    settings: {
      get: () => get<Settings>("/api/admin/settings", options),
      save: (input: { currency: string; domain: string; fastConfirm: boolean; rateAdjust: number; title: string; timeout: number }) => put<Settings>("/api/admin/settings", input, options),
      rebindBot: () => post<{ username: string }>("/api/admin/settings/bot/rebind", undefined, options),
    },
    banner: {
      upload: (body: ArrayBuffer) => upload<{ url: string }>("/api/admin/banner", body, "image/webp", options),
      restore: () => post<{ url: string }>("/api/admin/banner/restore", undefined, options),
    },
  };
}

export const api = {
  ...endpoints(),
  silent: endpoints({ silent: true }),
};

function id(value: string) {
  return encodeURIComponent(value);
}

function orderQuery(input: { page: number; pageSize: number; q?: string; status: string }) {
  const query = new URLSearchParams({
    page: String(input.page),
    pageSize: String(input.pageSize),
    status: input.status,
  });
  if (input.q?.trim()) query.set("q", input.q.trim());
  return query.toString();
}
