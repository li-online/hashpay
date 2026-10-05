import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { errorBody } from "@/server/http/api";
import { getConfig } from "@/server/db";
import routes from "@/server/http/routes";
import { migrateD1 } from "@/server/db/migrations";
import type { Context } from "hono";
import type { HonoEnv } from "@/server/types/env";

export function createApp() {
  const app = new Hono<HonoEnv>();

  app.onError((error, c) => {
    const { body, status } = errorBody(error);
    if (status >= 500) console.error(error);
    return c.json(body, status as never);
  });
  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    await next();
  });
  app.use("/api/*", secureHeaders());
  app.use("/api/*", cors({ credentials: true, origin: apiCorsOrigin }));
  app.use("/api/*", async (c, next) => {
    if (!c.req.path.startsWith("/api/state")) await migrateD1(c.env);
    await next();
  });

  app.route("/", routes);

  app.all("*", async (c) => {
    if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
    return new Response("HashPay client is not built yet.", { status: 503 });
  });

  return app;
}

async function apiCorsOrigin(origin: string, c: Context<HonoEnv>) {
  const value = originUrl(origin);
  if (!value) return null;
  if (value === new URL(c.req.url).origin) return value;
  const domain = await getConfig(c.env, "domain").catch(() => null);
  return domain && value === originUrl(domain) ? value : null;
}

function originUrl(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
