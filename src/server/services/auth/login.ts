import type { Context } from "hono";
import { AppError } from "@/server/http/api";
import { getConfig } from "@/server/db";
import { createLoginChallenge, consumeLoginPin, requireInstalledAdmin } from "@/server/services/auth/pin";
import { clearSessionCookie, setSessionCookie, signSession } from "@/server/services/auth/session";
import { validateWebAppInitData } from "@/server/services/auth/telegram";
import type { HonoEnv } from "@/server/types/env";

export async function telegramLogin(c: Context<HonoEnv>, body: Record<string, unknown>) {
  if (!c.env.TGBOT_TOKEN) throw new AppError(500, "errors.bot_token_missing");
  if (typeof body.initData !== "string") throw new AppError(400, "errors.telegram_init_data_missing");

  const user = await validateWebAppInitData(body.initData, c.env.TGBOT_TOKEN);
  const adminId = Number(await getConfig(c.env, "admin_id"));
  if (!adminId) return { ...user, setupRequired: true };
  if (user.id !== adminId) throw new AppError(403, "errors.admin_forbidden");

  setSessionCookie(c, await signSession(c.env, user));
  return { ...user, setupRequired: false };
}

export function createPin(c: Context<HonoEnv>, body: Record<string, unknown>) {
  if (typeof body.pin !== "string") throw new AppError(400, "errors.login_pin_missing");
  return createLoginChallenge(c.env, body.pin);
}

export async function consumePin(c: Context<HonoEnv>, pin: string, challenge?: string) {
  if (!pin || !challenge) throw new AppError(400, "errors.login_pin_missing");
  const user = await consumeLoginPin(c.env, pin, challenge);
  if (!user) return { authenticated: false };

  const adminId = await requireInstalledAdmin(c.env);
  if (user.id !== adminId) throw new AppError(403, "errors.admin_forbidden");

  setSessionCookie(c, await signSession(c.env, user));
  return { authenticated: true, user };
}

export function endSession(c: Context) {
  clearSessionCookie(c);
  return { ok: true };
}
