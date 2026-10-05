import { all } from "@/server/db";
import { getMerchant } from "@/server/services/merchants";
import { deleteOrder } from "@/server/services/orders/create";
import { getDetailedOrder, listOrdersPage as queryOrdersPage, publicOrder } from "@/server/services/orders/repository";
import { checkOrderPayment, confirmOrder } from "@/server/services/orders/checkout";
import { resendNotify } from "@/server/services/orders/notifications";
import { getReview } from "@/server/services/orders/review";
import type { AppEnv } from "@/server/types/env";

export async function listOrdersPage(env: AppEnv, input: { page?: number; pageSize?: number; q?: string; status?: string } = {}) {
  const result = await queryOrdersPage(env, input);
  return {
    items: result.rows.map(publicOrder),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
  };
}

export async function getOrderDetail(env: AppEnv, id: string) {
  const order = await getDetailedOrder(env, id);
  const [merchant, notify, review] = await Promise.all([
    order.merchant === "INLINE"
      ? Promise.resolve({ name: "Telegram Internal Merchant" })
      : getMerchant(env, order.merchant).catch(() => null),
    all<{ attempts: number; id: number; last_error: string | null; next_run_at: number; status: string }>(env, "SELECT id, status, attempts, next_run_at, last_error FROM notify WHERE order_id = ? ORDER BY created_at DESC LIMIT 20", id),
    getReview(env, id),
  ]);
  return {
    merchantName: merchant?.name ?? null,
    notify: notify.map((row) => ({
      attempts: row.attempts,
      id: row.id,
      lastError: row.last_error,
      nextRunAt: row.next_run_at,
      status: row.status,
    })),
    order: publicOrder(order),
    review: review ? { answer: review.answer, image: review.image, imageUrl: review.imageUrl } : null,
  };
}

export { checkOrderPayment, confirmOrder, deleteOrder, resendNotify };
