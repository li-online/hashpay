import { AppError, errorBody } from "@/server/http/api";

const checkoutVisibleErrors = new Set<string>([
  "errors.order_not_found",
  "errors.order_paid",
  "errors.order_unavailable",
  "errors.payment_not_selected",
  "errors.review_answer_required",
  "errors.review_image_invalid",
  "errors.review_image_too_large",
]);

const checkoutPendingErrors = new Set<string>([
  "errors.payment_check_failed",
  "errors.tx_not_found",
]);

export function publicCheckoutErrorBody(error: unknown) {
  if (error instanceof AppError && checkoutVisibleErrors.has(error.key)) return errorBody(error);
  const status = error instanceof AppError ? error.status : 500;
  const key = error instanceof AppError && checkoutPendingErrors.has(error.key)
    ? "errors.checkout_payment_pending"
    : "errors.checkout_unavailable";
  return {
    body: { error: { key, params: {} } },
    status,
  };
}
