import type { PaymentCheckMatch, PaymentCheckOrder } from "@/server/payments/driver";
import type { PaymentSnapshot } from "@/shared/types/domain";

export function paymentMatches<T>(
  orders: PaymentCheckOrder[],
  rows: T[],
  match: (snapshot: PaymentSnapshot, row: T, createdAt: number, expireAt: number) => boolean,
  evidence: (row: T) => Omit<PaymentCheckMatch, "orderId">,
) {
  return orders.flatMap((order) => {
    const row = rows.find((item) => match(order.snapshot, item, order.createdAt, order.expireAt));
    return row ? [{ orderId: order.id, ...evidence(row) }] : [];
  });
}
