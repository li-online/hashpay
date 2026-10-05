import { Hono } from "hono";
import { AppError } from "@/server/http/api";
import { requireSignedMerchant } from "@/server/services/merchants";
import { createMerchantOrder } from "@/server/services/orders/create";
import { merchantOrderSummary, publicOrder } from "@/server/services/orders/repository";
import { getOrder } from "@/server/services/orders/repository";
import type { HonoEnv } from "@/server/types/env";

const app = new Hono<HonoEnv>();

app.post("/merchant/new", async (c) => {
  const body = await c.req.text();
  const merchant = await requireSignedMerchant(c.env, c.req, body);
  const { order, reused } = await createMerchantOrder(c.env, merchant, JSON.parse(body || "{}") as Record<string, unknown>);
  return c.json({
    checkoutUrl: `${new URL(c.req.url).origin}/pay/${order.id}`,
    order: merchantOrderSummary(order),
    reused,
  });
});
app.get("/order/:orderId", async (c) => {
  const merchant = await requireSignedMerchant(c.env, c.req, "");
  const order = await getOrder(c.env, c.req.param("orderId"));
  if (order.merchant !== merchant.id) throw new AppError(404, "errors.order_not_found");
  return c.json(publicOrder(order));
});

export default app;
