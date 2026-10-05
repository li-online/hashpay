import { all, now, run } from "@/server/db";
import { migrateD1 } from "@/server/db/migrations";
import { checkChannels } from "@/server/payments/channels";
import { checkPendingPayments } from "@/server/services/orders/checkout";
import { deliverNotify } from "@/server/services/orders/notifications";
import { syncMarketRates } from "@/server/services/app/settings";
import type { AppEnv } from "@/server/types/env";

const isTopOfHour = (time: Date) => time.getUTCMinutes() === 0;

export async function runJobs(env: AppEnv, time = new Date()) {
  await migrateD1(env);
  if (isTopOfHour(time)) await syncMarketRates(env).catch(() => undefined);
  const ts = now();
  await run(env, "UPDATE orders SET status = 'expired', updated_at = ? WHERE status = 'pending' AND expire_at < ?", ts, ts);
  await checkChannels(env, "error");
  await checkPendingPayments(env);
  const dueNotify = await all<{ id: number }>(env, "SELECT id FROM notify WHERE status IN ('pending', 'retry') AND next_run_at <= ? ORDER BY next_run_at ASC LIMIT 20", ts);
  for (const { id: notifyId } of dueNotify) {
    await env.QUEUE_NOTIFY?.send({ notifyId });
  }
}

export async function handleNotifyQueue(batch: MessageBatch<unknown>, env: AppEnv) {
  await migrateD1(env);
  for (const message of batch.messages) {
    const notifyId = Number((message.body as { notifyId?: unknown } | undefined)?.notifyId);
    if (Number.isFinite(notifyId)) await deliverNotify(env, notifyId).catch(() => undefined);
    message.ack();
  }
}
