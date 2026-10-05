import { getConfig, setConfig } from "@/server/db";
import { AppError } from "@/server/http/api";
import { fetchText, reason } from "@/server/utils/http";
import type { AppEnv } from "@/server/types/env";

export function botToken(env: AppEnv) {
  if (!env.TGBOT_TOKEN) throw new AppError(500, "errors.bot_token_missing");
  return env.TGBOT_TOKEN;
}

export async function sendTelegramMessage(env: AppEnv, chatId: number, text: string, replyMarkup?: Record<string, unknown>) {
  await call(env, "sendMessage", {
    chat_id: chatId,
    link_preview_options: { is_disabled: true },
    parse_mode: "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    text,
  });
}

export async function sendTelegramPhoto(env: AppEnv, chatId: number, image: ArrayBuffer) {
  const body = new FormData();
  body.set("chat_id", String(chatId));
  body.set("photo", new Blob([image], { type: "image/webp" }), "review.webp");
  await call(env, "sendPhoto", body);
}

export async function getBotInfo(env: AppEnv) {
  try {
    const bot = await call<{ username?: string }>(env, "getMe");
    if (!bot.username) throw new Error("Telegram bot username is missing");
    return { ...bot, username: bot.username };
  } catch {
    throw new AppError(500, "errors.bot_token_invalid");
  }
}

export async function refreshBotInfo(env: AppEnv) {
  const bot = await getBotInfo(env);
  await setConfig(env, "bot_username", bot.username);
  return bot;
}

export async function setupWebhook(env: AppEnv, domain: string, secret: string) {
  const url = `${domain.replace(/\/$/, "")}/telegram/webhook/${secret}`;
  try {
    await call(env, "setWebhook", { allowed_updates: ["message", "callback_query", "inline_query", "chosen_inline_result"], url });
  } catch {
    throw new AppError(400, "errors.webhook_setup_failed");
  }
  return url;
}

export async function configureBotMiniApp(env: AppEnv) {
  const domain = await getConfig(env, "domain");
  if (!domain) throw new AppError(400, "errors.domain_missing");
  const secret = await getConfig(env, "bot_secret");
  const url = `${domain.replace(/\/$/, "")}/admin`;
  try {
    await call(env, "setChatMenuButton", {
      menu_button: {
        text: "HashPay",
        type: "web_app",
        web_app: { url },
      },
    });
  } catch {
    throw new AppError(400, "errors.miniapp_setup_failed");
  }
  if (secret) await setupWebhook(env, domain, secret);
}

async function call<T = unknown>(env: AppEnv, method: string, body: Record<string, unknown> | FormData = {}) {
  const url = `https://api.telegram.org/bot${botToken(env)}/${method}`;
  const { res, text } = await fetchText(url, {
    body: body instanceof FormData ? body : JSON.stringify(body),
    headers: body instanceof FormData ? undefined : { "content-type": "application/json" },
    method: "POST",
  });
  let payload: { description?: string; ok?: boolean; result?: T };
  try {
    payload = JSON.parse(text || "{}") as typeof payload;
  } catch {
    throw new Error(`Telegram ${method} returned invalid JSON: ${reason(text)}`);
  }
  if (!res.ok || !payload.ok) throw new Error(payload.description || `Telegram ${method} failed: HTTP ${res.status}`);
  return payload.result as T;
}
