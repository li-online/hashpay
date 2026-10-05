import { Hono } from "hono";
import type { Context } from "hono";
import { migrateD1 } from "@/server/db/migrations";
import { ensureDefaultBanner } from "@/server/services/images/banner";
import { publicCheckoutErrorBody } from "@/server/http/public-errors";
import { checkoutData, checkoutStatus, checkOrderPayment, okpayNotify, selectCheckoutPayment, submitPaymentReview } from "@/server/services/orders/checkout";
import { orderQrPng } from "@/server/services/images/qr";
import { handleTelegramWebhook } from "@/server/services/telegram/bot";
import { appState } from "@/server/services/app";
import type { HonoEnv } from "@/server/types/env";

const app = new Hono<HonoEnv>();

app.get("/health", (c) => c.json({ ok: true, service: "hashpay", ts: new Date().toISOString() }));

app.post("/okpay/notify", async (c) => {
  await migrateD1(c.env);
  return c.json(await okpayNotify(c.env, await okpayBody(c)));
});

app.get("/banner.webp", async (c) => {
  const banner = await ensureDefaultBanner(c.env);
  return new Response(banner, { headers: { "cache-control": "public, max-age=300", "content-type": "image/webp" } });
});
app.get("/order/:id/qr.png", async (c) => {
  const png = await orderQrPng(c.env, c.req.param("id"));
  if (!png) return new Response("QR is not available", { status: 404 });
  return new Response(new Uint8Array(png), { headers: { "cache-control": "no-store", "content-type": "image/png" } });
});

app.get("/api/state", async (c) => c.json(await appState(c.env, c.req.url)));

app.get("/api/checkout/:orderId", checkoutJson((c) => checkoutData(c.env, String(c.req.param("orderId") ?? ""))));
app.get("/api/checkout/:orderId/status", checkoutJson((c) => checkoutStatus(c.env, String(c.req.param("orderId") ?? ""))));
app.put("/api/checkout/:orderId/payment", checkoutJson(async (c) => {
  const body = (await c.req.json()) as { asset?: string; network?: string };
  return selectCheckoutPayment(c.env, String(c.req.param("orderId") ?? ""), String(body.asset ?? ""), String(body.network ?? ""));
}));
app.post("/api/checkout/:orderId/check", checkoutJson((c) => checkOrderPayment(c.env, String(c.req.param("orderId") ?? ""))));
app.post("/api/checkout/:orderId/review", checkoutJson(async (c) => {
  return submitPaymentReview(c.env, String(c.req.param("orderId") ?? ""), (await c.req.json()) as Record<string, unknown>);
}));

app.post("/telegram/webhook/:secret", async (c) => {
  await migrateD1(c.env);
  return handleTelegramWebhook(c);
});

export default app;

function checkoutJson<T>(handler: (c: Context<HonoEnv>) => T | Promise<T>) {
  return async (c: Context<HonoEnv>) => {
    try {
      return c.json(await handler(c) as never);
    } catch (error) {
      const { body, status } = publicCheckoutErrorBody(error);
      return c.json(body, status as never);
    }
  };
}

async function okpayBody(c: { req: { formData(): Promise<FormData>; header(name: string): string | undefined; json(): Promise<unknown> } }) {
  if (c.req.header("content-type")?.includes("application/json")) return await c.req.json() as Record<string, unknown>;
  const form = await c.req.formData();
  const out: Record<string, unknown> = {};
  const data: Record<string, unknown> = {};
  for (const [key, value] of form as unknown as Iterable<[string, FormDataEntryValue]>) {
    const text = String(value);
    const match = /^data\[(.+)]$/.exec(key);
    if (match) data[match[1]!] = text;
    else out[key] = text;
  }
  if (Object.keys(data).length) out.data = data;
  return out;
}
