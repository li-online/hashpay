import QRCode from "qrcode";
import { jsonParseObject } from "@/server/db";
import { getOrder } from "@/server/services/orders/repository";
import type { PaymentSnapshot } from "@/shared/types/domain";
import type { AppEnv } from "@/server/types/env";

export async function orderQrPng(env: AppEnv, orderId: string) {
  const order = await getOrder(env, orderId);
  const payment = jsonParseObject<PaymentSnapshot>(order.payment, {} as PaymentSnapshot);
  const value = payment.address?.trim();
  if (!value) return null;
  return QRCode.toBuffer(value, {
    errorCorrectionLevel: "M",
    margin: 1,
    type: "png",
    width: 720,
  });
}
