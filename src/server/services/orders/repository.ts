import { all, jsonParseObject, now, one, run } from "@/server/db";
import { AppError } from "@/server/http/api";
import type { D1Param } from "@/server/db";
import type { Order as ApiOrder } from "@/shared/types/api";
import type { OrderStatus, PaymentSnapshot } from "@/shared/types/domain";
import type { AppEnv } from "@/server/types/env";

interface OrderRow {
  amount: number;
  callback: string | null;
  created_at: number;
  currency: string;
  description: string | null;
  expire_at: number;
  id: string;
  merchant: string;
  merchant_no: string;
  paid_at: number | null;
  payment: string;
  payway: number | null;
  redirect_url: string | null;
  status: OrderStatus;
  updated_at: number;
}

type ListedOrderRow = OrderRow & { channel_name?: string | null };
type DetailedOrderRow = ListedOrderRow & {
  payway_driver?: string | null;
  payway_status?: string | null;
};

export interface Order {
  amount: number;
  callback: string | null;
  createdAt: number;
  currency: string;
  description: string | null;
  expireAt: number;
  id: string;
  merchant: string;
  merchantNo: string;
  paidAt: number | null;
  payment: string;
  payway: number | null;
  channelName?: string | null;
  redirectUrl: string | null;
  status: OrderStatus;
  updatedAt: number;
}

export function orderExpireAt(createdAt: number, timeoutMinutes: number) {
  return createdAt + timeoutMinutes * 60;
}

export async function getOrder(env: AppEnv, id: string) {
  const row = await one<OrderRow>(env, "SELECT * FROM orders WHERE id = ?", id);
  if (!row) throw new AppError(404, "errors.order_not_found");
  return order(row);
}

export async function getDetailedOrder(env: AppEnv, id: string) {
  const row = await one<DetailedOrderRow>(env, "SELECT orders.*, payments.name AS channel_name, payments.driver AS payway_driver, payments.status AS payway_status FROM orders LEFT JOIN payments ON payments.id = orders.payway WHERE orders.id = ?", id);
  if (!row) throw new AppError(404, "errors.order_not_found");
  return detailedOrder(row);
}

export async function findExistingMerchantOrder(env: AppEnv, merchantId: string, merchantNo: string) {
  const row = await one<OrderRow>(env, "SELECT * FROM orders WHERE merchant = ? AND merchant_no = ?", merchantId, merchantNo);
  return row ? order(row) : null;
}

export async function insertOrder(env: AppEnv, order: Order) {
  await run(env, "INSERT INTO orders(id, merchant, merchant_no, description, status, amount, currency, payment, callback, redirect_url, expire_at, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", order.id, order.merchant, order.merchantNo, order.description, order.status, order.amount, order.currency, order.payment, order.callback, order.redirectUrl, order.expireAt, order.createdAt, order.updatedAt);
}

function orderWhere(input: { q?: string; status?: string }) {
  const status = String(input.status || "all");
  const q = String(input.q || "").trim();
  const clauses: string[] = [];
  const params: D1Param[] = [];
  if (status !== "all") {
    clauses.push("orders.status = ?");
    params.push(status);
  }
  if (q) {
    const like = `%${q}%`;
    clauses.push("(orders.id LIKE ? OR orders.description LIKE ? OR orders.merchant_no LIKE ? OR orders.merchant LIKE ? OR orders.payment LIKE ? OR payments.name LIKE ?)");
    params.push(like, like, like, like, like, like);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return { params, where };
}

export async function listOrders(env: AppEnv, input: { limit?: number; q?: string; status?: string } = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 200);
  const { params, where } = orderWhere(input);
  return (await all<ListedOrderRow>(env, `SELECT orders.*, payments.name AS channel_name FROM orders LEFT JOIN payments ON payments.id = orders.payway${where} ORDER BY orders.created_at DESC LIMIT ?`, ...params, limit)).map(order);
}

export async function listOrdersPage(env: AppEnv, input: { page?: number; pageSize?: number; q?: string; status?: string } = {}) {
  const pageSize = Math.min(Math.max(Number(input.pageSize) || 20, 1), 100);
  const page = Math.max(Number(input.page) || 1, 1);
  const offset = (page - 1) * pageSize;
  const { params, where } = orderWhere(input);
  const [count, rows] = await Promise.all([
    one<{ count: number }>(env, `SELECT COUNT(*) AS count FROM orders LEFT JOIN payments ON payments.id = orders.payway${where}`, ...params),
    all<ListedOrderRow>(env, `SELECT orders.*, payments.name AS channel_name FROM orders LEFT JOIN payments ON payments.id = orders.payway${where} ORDER BY orders.created_at DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset),
  ]);
  return { page, pageSize, rows: rows.map(order), total: count?.count ?? 0 };
}

export async function listPendingPaymentOrders(env: AppEnv, limit = 20) {
  return (await all<OrderRow>(
    env,
    "SELECT * FROM orders WHERE status = 'pending' AND expire_at > ? AND json_extract(payment, '$.driver') IS NOT NULL ORDER BY created_at ASC LIMIT ?",
    now(),
    Math.min(Math.max(Number(limit) || 20, 1), 200),
  )).map(order);
}

export async function listReviewOrders(env: AppEnv, limit = 5) {
  return (await all<ListedOrderRow>(
    env,
    "SELECT orders.*, payments.name AS channel_name FROM review INNER JOIN orders ON orders.id = review.order_id LEFT JOIN payments ON payments.id = orders.payway WHERE (review.image IS NOT NULL OR review.image_url IS NOT NULL) AND orders.status <> 'paid' ORDER BY review.id DESC LIMIT ?",
    Math.min(Math.max(Number(limit) || 5, 1), 20),
  )).map(order);
}

export async function setOrderPayment(env: AppEnv, orderId: string, payway: number, payment: unknown, ts = now()) {
  await run(env, "UPDATE orders SET payway = ?, payment = ?, updated_at = ? WHERE id = ?", payway, JSON.stringify(payment), ts, orderId);
}

export async function refreshOrderPaymentWindow(env: AppEnv, orderId: string, payway: number, payment: unknown, timeoutMinutes: number, ts = now()) {
  await run(env, "UPDATE orders SET status = 'pending', payway = ?, payment = ?, paid_at = NULL, created_at = ?, expire_at = ?, updated_at = ? WHERE id = ?", payway, JSON.stringify(payment), ts, orderExpireAt(ts, timeoutMinutes), ts, orderId);
}

export function publicOrder(order: Order): ApiOrder {
  const payment = jsonParseObject<Partial<PaymentSnapshot> & { _ezfp?: unknown; out_id?: unknown }>(order.payment, {});
  delete payment._ezfp;
  delete payment.out_id;
  return {
    amount: order.amount,
    createdAt: order.createdAt,
    currency: order.currency,
    description: order.description,
    expireAt: order.expireAt,
    id: order.id,
    merchantId: order.merchant,
    merchantNo: order.merchant === "INLINE" ? "" : order.merchantNo,
    paidAt: order.paidAt,
    payment,
    payway: order.payway ? { id: order.payway, name: order.channelName ?? null } : null,
    returnUrl: order.redirectUrl,
    status: order.status,
    updatedAt: order.updatedAt,
  };
}

export function merchantOrderSummary(order: Order) {
  return {
    amount: order.amount,
    currency: order.currency,
    expiresAt: order.expireAt,
    id: order.id,
    status: order.status,
  };
}

function order(row: ListedOrderRow): Order {
  return {
    amount: row.amount,
    callback: row.callback,
    createdAt: row.created_at,
    currency: row.currency,
    description: row.description,
    expireAt: row.expire_at,
    id: row.id,
    merchant: row.merchant,
    merchantNo: row.merchant_no,
    paidAt: row.paid_at,
    payment: row.payment,
    payway: row.payway,
    channelName: row.channel_name,
    redirectUrl: row.redirect_url,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function detailedOrder(row: DetailedOrderRow) {
  return {
    ...order(row),
    paywayDriver: row.payway_driver,
    paywayStatus: row.payway_status,
  };
}
