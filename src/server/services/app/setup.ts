import { getConfig } from "@/server/db";
import { AppError } from "@/server/http/api";
import { startTelegramSetup } from "@/server/services/telegram/setup";
import { toHttpsSiteUrl } from "@/shared/domain";
import type { Context } from "hono";
import type { HonoEnv } from "@/server/types/env";

export async function startSetup(c: Context<HonoEnv>, input: Record<string, unknown>) {
  if (!c.env.TGBOT_TOKEN) throw new AppError(500, "errors.bot_token_missing");
  if (await getConfig(c.env, "admin_id")) throw new AppError(409, "errors.setup_initialized");
  const domain = normalizeDomain(input.domain);
  const setup = await startTelegramSetup(c.env, domain);
  return { domain, ...setup };
}

function normalizeDomain(value: unknown) {
  try {
    return toHttpsSiteUrl(value);
  } catch {
    throw new AppError(400, "errors.domain_invalid");
  }
}
