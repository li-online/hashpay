import { jwtVerify, SignJWT } from "jose";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { AppError } from "@/server/http/api";
import { getConfig } from "@/server/db";
import type { AppEnv, HonoEnv, TelegramUser } from "@/server/types/env";

const encoder = new TextEncoder();
const adminCookieName = "hashpay_session";

function secret(env: AppEnv) {
  if (!env.APP_SECRET) throw new AppError(500, "errors.app_secret_missing");
  return encoder.encode(env.APP_SECRET);
}

export async function signSession(env: AppEnv, user: TelegramUser) {
  return new SignJWT({
    firstName: user.firstName,
    lastName: user.lastName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret(env));
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, adminCookieName, token, {
    httpOnly: true,
    maxAge: 7 * 86400,
    path: "/",
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, adminCookieName, { path: "/" });
}

export async function verifySession(env: AppEnv, token: string): Promise<TelegramUser> {
  const result = await jwtVerify(token, secret(env));
  const id = Number(result.payload.sub);
  if (!Number.isFinite(id)) throw new AppError(401, "errors.session_invalid");
  return {
    firstName: typeof result.payload.firstName === "string" ? result.payload.firstName : "",
    id,
    lastName: typeof result.payload.lastName === "string" ? result.payload.lastName : "",
  };
}

export async function requireAdmin(c: Context<HonoEnv>) {
  const token = getCookie(c, adminCookieName);
  if (!token) throw new AppError(401, "errors.session_missing");
  const user = await verifySession(c.env, token);
  const adminId = Number(await getConfig(c.env, "admin_id"));
  if (!adminId || user.id !== adminId) throw new AppError(403, "errors.admin_forbidden");
  c.set("tgUser", user);
  return user;
}
