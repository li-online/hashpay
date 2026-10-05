import { Hono } from "hono";
import type { Context } from "hono";
import { deletePayment, listPayments, publicPayment, savePayment } from "@/server/payments/channels";
import { consumePin, createPin, endSession, telegramLogin } from "@/server/services/auth/login";
import { requireAdmin } from "@/server/services/auth/session";
import { restoreDefaultBanner, uploadBanner } from "@/server/services/images/banner";
import { createMerchant, deleteMerchant, listMerchants, rotateCredential, updateMerchant, type MerchantInput } from "@/server/services/merchants";
import { checkOrderPayment, confirmOrder, deleteOrder, getOrderDetail, listOrdersPage, resendNotify } from "@/server/services/orders/manage";
import { checkDashboard, dashboard } from "@/server/services/app";
import { adminSettings, rebindBot, saveAdminSettings } from "@/server/services/app/settings";
import { startSetup } from "@/server/services/app/setup";
import type { HonoEnv } from "@/server/types/env";

const app = new Hono<HonoEnv>();
const session = new Hono<HonoEnv>();

function json<T>(handler: (c: Context<HonoEnv>) => T | Promise<T>) {
  return async (c: Context<HonoEnv>) => c.json(await handler(c) as never);
}

function reqJson(c: Context<HonoEnv>) {
  return c.req.json() as Promise<Record<string, unknown>>;
}

// Setup
app.post("/setup", json(async (c) => startSetup(c, await reqJson(c))));

// Session
session.delete("/", json((c) => endSession(c)));
session.get("/", json((c) => requireAdmin(c)));

session.post("/telegram", json(async (c) => telegramLogin(c, await reqJson(c))));

session.post("/pin", json(async (c) => createPin(c, await reqJson(c))));
session.get("/pin/:pin", json((c) => consumePin(c, c.req.param("pin")!, c.req.query("challenge"))));
app.route("/session", session);

// Admin guard
app.use("*", async (c, next) => {
  await requireAdmin(c);
  await next();
});

// Dashboard
app.get("/dashboard", json((c) => dashboard(c.env)));
app.post("/dashboard/check", json((c) => checkDashboard(c.env)));

// Payments
app.get("/payment", json(async (c) => (await listPayments(c.env)).map(publicPayment)));
app.post("/payment", json(async (c) => publicPayment(await savePayment(c.env, await reqJson(c) as never))));
app.put("/payment/:id", json(async (c) => {
  const body = await reqJson(c);
  return publicPayment(await savePayment(c.env, { ...(body as { address: string; assets: string[]; data?: Record<string, string>; driver: string; name: string; status?: "enabled" | "disabled" | "error" }), id: Number(c.req.param("id")!) }));
}));
app.delete("/payment/:id", json(async (c) => {
  await deletePayment(c.env, Number(c.req.param("id")!));
  return { ok: true };
}));

// Merchants
app.get("/merchants", json((c) => listMerchants(c.env)));
app.post("/merchants", json(async (c) => createMerchant(c.env, await reqJson(c) as unknown as MerchantInput)));
app.put("/merchants/:id", json(async (c) => {
  const body = await reqJson(c);
  return updateMerchant(c.env, c.req.param("id")!, body as unknown as MerchantInput);
}));
app.post("/merchants/:id/rotate-key", json((c) => rotateCredential(c.env, c.req.param("id")!)));
app.delete("/merchants/:id", json(async (c) => {
  await deleteMerchant(c.env, c.req.param("id")!);
  return { ok: true };
}));

// Orders
app.get("/orders", json((c) =>
  listOrdersPage(c.env, {
    page: Number(c.req.query("page") ?? 1),
    pageSize: Number(c.req.query("pageSize") ?? 20),
    q: c.req.query("q") ?? "",
    status: c.req.query("status") ?? "all",
  }),
));
app.get("/orders/:id", json((c) => getOrderDetail(c.env, c.req.param("id")!)));
app.delete("/orders/:id", json((c) => deleteOrder(c.env, c.req.param("id")!)));
app.post("/orders/:id/check", json((c) => checkOrderPayment(c.env, c.req.param("id")!)));
app.post("/orders/:id/confirm", json((c) => confirmOrder(c.env, c.req.param("id")!)));
app.post("/orders/:id/notify", json((c) => resendNotify(c.env, c.req.param("id")!)));

// Settings
app.get("/settings", json((c) => adminSettings(c.env)));
app.put("/settings", json(async (c) => saveAdminSettings(c.env, await reqJson(c))));
app.post("/settings/bot/rebind", json((c) => rebindBot(c.env)));
app.put("/banner", json(async (c) => uploadBanner(c.env, await c.req.arrayBuffer())));
app.post("/banner/restore", json(async (c) => {
  await restoreDefaultBanner(c.env);
  return { url: "/banner.webp" };
}));

export default app;
