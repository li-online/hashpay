import { all, getConfig, one } from "@/server/db";
import { migrateD1 } from "@/server/db/migrations";
import { checkChannels, listPayments, paymentHealth } from "@/server/payments/channels";
import { marketAmount, rateContext, type RateContext } from "@/server/services/app/settings";
import { listOrders, listReviewOrders, publicOrder } from "@/server/services/orders/repository";
import { getBotInfo, refreshBotInfo } from "@/server/services/telegram/api";
import type { AppEnv } from "@/server/types/env";

type Range = {
  count: number;
  label: (timestamp: number) => string;
  size: number;
  start: number;
};

export async function appState(env: AppEnv, _requestUrl: string) {
  let db: string | null = null;
  let domain: string | null = null;
  let adminId: string | null = null;
  let webhookSecret: string | null = null;
  let title = "HashPay";
  let username = "";
  try {
    await migrateD1(env);
    const configs = await Promise.all([
      getConfig(env, "domain"),
      getConfig(env, "admin_id"),
      getConfig(env, "bot_secret"),
      getConfig(env, "bot_username"),
      getConfig(env, "title"),
    ]);
    [domain, adminId, webhookSecret] = configs;
    username = configs[3] || "";
    title = configs[4] || title;
  } catch (error) {
    db = error instanceof Error ? error.message : "Database is not available";
  }
  let bot: "admin" | "domain" | "invalid" | "missing" | "ready" = "missing";
  if (!env.TGBOT_TOKEN) {
    bot = "missing";
  } else {
    try {
      username = username || (db ? await getBotInfo(env) : await refreshBotInfo(env)).username;
      bot = !domain || !webhookSecret ? "domain" : !adminId ? "admin" : "ready";
    } catch {
      bot = "invalid";
    }
  }
  return {
    db,
    bot,
    domain,
    queue: env.QUEUE_NOTIFY ? null : "QUEUE_NOTIFY binding is not configured",
    ready: bot === "ready",
    title,
    username,
  };
}

export async function dashboard(env: AppEnv) {
  const today = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const rate = await rateContext(env);
  const [pending, payments, trends, actions, orders] = await Promise.all([
    one<{ count: number }>(env, "SELECT COUNT(*) AS count FROM orders WHERE status = 'pending'"),
    listPayments(env),
    trendData(env, today, rate),
    listReviewOrders(env).then((orders) => orders.map(publicOrder)),
    listOrders(env, { limit: 5, status: "all" }).then((orders) => orders.map(publicOrder)),
  ]);
  return {
    actions,
    health: payments
      .filter((payment) => payment.status !== "disabled")
      .map(paymentHealth)
      .filter((item) => item.status === "warn"),
    orders,
    pending: pending?.count ?? 0,
    trends,
  };
}

export async function checkDashboard(env: AppEnv) {
  const errors = await checkChannels(env, "error");
  const stats = await dashboard(env);
  return {
    ...stats,
    health: stats.health.map((item) => ({ ...item, details: errors[item.id] ?? item.details })),
  };
}

async function trendData(env: AppEnv, today: number, rate: RateContext) {
  const day = 86400;
  const [td, yd, d7, d15, d30] = await Promise.all([
    trend(env, { count: 24, label: hourLabel, size: 3600, start: today }, rate),
    trend(env, { count: 24, label: hourLabel, size: 3600, start: today - day }, rate),
    trend(env, { count: 7, label: dayLabel, size: day, start: today - 6 * day }, rate),
    trend(env, { count: 15, label: dayLabel, size: day, start: today - 14 * day }, rate),
    trend(env, { count: 30, label: dayLabel, size: day, start: today - 29 * day }, rate),
  ]);
  return {
    "15d": d15,
    "30d": d30,
    "7d": d7,
    td,
    yd,
  };
}

function hourLabel(timestamp: number) {
  return `${String(new Date(timestamp * 1000).getHours()).padStart(2, "0")}:00`;
}

function dayLabel(timestamp: number) {
  const date = new Date(timestamp * 1000);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

async function trend(env: AppEnv, range: Range, rate: RateContext) {
  const end = range.start + range.size * range.count;
  const points = Array.from({ length: range.count }, (_, bucket) => ({
    amount: 0,
    label: range.label(range.start + bucket * range.size),
    orders: 0,
    paidOrders: 0,
    timestamp: range.start + bucket * range.size,
  }));
  const [orders, paid] = await Promise.all([
    all<{ bucket: number; count: number }>(env, "SELECT CAST((created_at - ?) / ? AS INTEGER) AS bucket, COUNT(*) AS count FROM orders WHERE created_at >= ? AND created_at < ? GROUP BY bucket", range.start, range.size, range.start, end),
    all<{ amount: number; bucket: number; currency: string }>(env, "SELECT CAST((paid_at - ?) / ? AS INTEGER) AS bucket, amount, currency FROM orders WHERE status = 'paid' AND paid_at >= ? AND paid_at < ?", range.start, range.size, range.start, end),
  ]);
  for (const row of orders) {
    const point = points[Number(row.bucket)];
    if (point) point.orders = Number(row.count) || 0;
  }
  for (const row of paid) {
    const point = points[Number(row.bucket)];
    if (point) {
      point.amount += marketAmount(Number(row.amount), row.currency, rate.settings.currency, rate);
      point.paidOrders += 1;
    }
  }
  return points;
}
