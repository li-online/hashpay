import Decimal from "decimal.js";
import { Hono } from "hono";
import { AppError } from "@/server/http/api";
import { migrateD1 } from "@/server/db/migrations";
import { createEzfpOrder } from "@/server/services/orders/create";
import { EzfpError, verifyEzfp } from "@/server/services/merchants/ezfp";
import { getMerchant } from "@/server/services/merchants";
import type { HonoEnv } from "@/server/types/env";

const app = new Hono<HonoEnv>();

app.on(["GET", "POST"], "/submit.php", async (c) => {
  try {
    await migrateD1(c.env);
    const params = await requestParams(c.req);
    const { order } = await createEzfpCheckout(c.env, params, true);
    return c.redirect(`${new URL(c.req.url).origin}/pay/${order.id}`, 302);
  } catch (error) {
    return c.text(errorMessage(error), 400);
  }
});

app.post("/mapi.php", async (c) => {
  try {
    await migrateD1(c.env);
    const params = await requestParams(c.req);
    const { order } = await createEzfpCheckout(c.env, params, false);
    return c.json({
      code: 1,
      msg: "success",
      payurl: `${new URL(c.req.url).origin}/pay/${order.id}`,
      trade_no: order.id,
    });
  } catch (error) {
    return c.json({ code: -1, msg: errorMessage(error) });
  }
});

async function createEzfpCheckout(env: HonoEnv["Bindings"], params: Record<string, string>, requireReturnUrl: boolean) {
  const pid = required(params, "pid");
  const merchant = await getMerchant(env, pid);
  if (merchant.type !== "ezfp") throw new EzfpError("Merchant does not support Ezfp");
  if (merchant.status !== "enabled") throw new EzfpError("Merchant is disabled");
  if (!merchant.authKey.trim()) throw new EzfpError("Merchant key is missing");
  verifyEzfp(params, merchant.authKey);

  const fiat = (params.fiat || "CNY").trim().toUpperCase();
  if (fiat !== "CNY" && fiat !== "USD") throw new EzfpError("Invalid fiat");
  const money = amount(required(params, "money"));
  const type = params.type?.trim() || "usdt";
  if (!requireReturnUrl && !params.type?.trim()) throw new EzfpError("Missing type");
  return createEzfpOrder(env, merchant, {
    fiat,
    money,
    name: required(params, "name"),
    notifyUrl: required(params, "notify_url"),
    outTradeNo: required(params, "out_trade_no"),
    param: params.param ?? "",
    returnUrl: requireReturnUrl ? required(params, "return_url") : params.return_url?.trim() || "",
    type,
  });
}

function required(params: Record<string, string>, key: string) {
  const value = params[key]?.trim();
  if (!value) throw new EzfpError(`Missing ${key}`);
  return value;
}

function amount(value: string) {
  try {
    const number = new Decimal(value);
    if (!number.isFinite() || !number.isPositive() || !Number.isFinite(number.toNumber()) || number.decimalPlaces() > 2) throw new Error();
    return number.toFixed(2);
  } catch {
    throw new EzfpError("Invalid money");
  }
}

async function requestParams(request: { header(name: string): string | undefined; method: string; query(): Record<string, string>; text(): Promise<string> }) {
  if (request.method === "GET") return request.query();
  if (!request.header("content-type")?.toLowerCase().includes("application/x-www-form-urlencoded")) {
    throw new EzfpError("Content-Type must be application/x-www-form-urlencoded");
  }
  return Object.fromEntries(new URLSearchParams(await request.text()));
}

function errorMessage(error: unknown) {
  if (error instanceof EzfpError) return error.message;
  if (error instanceof AppError) {
    if (error.key === "errors.merchant_not_found") return "Merchant not found";
    if (error.key === "errors.callback_url_invalid") return "notify_url or return_url must be a public HTTPS URL";
  }
  console.error(error);
  return "System error";
}

export default app;
