import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import type { Context as GrammyContext } from "grammy";
import type { Context } from "hono";
import { getConfig, jsonParseObject, now } from "@/server/db";
import { AppError } from "@/server/http/api";
import { confirmLoginPin } from "@/server/services/auth/pin";
import { createTelegramOrder, deleteOrder } from "@/server/services/orders/create";
import { checkOrderPayment, checkoutData, confirmOrder, selectTelegramPayment } from "@/server/services/orders/checkout";
import { getOrder } from "@/server/services/orders/repository";
import { botToken } from "@/server/services/telegram/api";
import { bindSetupAdmin } from "@/server/services/telegram/setup";
import { timingSafeEqualString } from "@/server/utils/crypto";
import {
  assetName,
  networkLabel,
  key,
  paymentAssetTelegramEmojiId,
  paymentById,
  paymentNetworkTelegramEmojiId,
} from "@/shared/payments";
import { paymentExplorerUrl } from "@/server/payments/driver";
import { normalizeLocale, t, type Locale } from "@/shared/i18n";
import { ceilAmount } from "@/shared/amount";
import type { PaymentSnapshot } from "@/shared/types/domain";
import type { Order } from "@/server/services/orders/repository";
import type { AppEnv, HonoEnv } from "@/server/types/env";

type TelegramPaymentOption = {
  amount: number;
  asset: string;
  network: string;
};

export async function createBot(env: AppEnv) {
  const bot = new Bot(botToken(env));
  bot.catch((error) => {
    console.error("Telegram bot update failed", error.error);
  });

  bot.use(async (ctx, next) => {
    if (ctx.message && await bindSetupAdmin(env, ctx)) return;
    await next();
  });

  bot.command("start", async (ctx) => {
    const locale = telegramLocale(ctx);
    if (!await isAdmin(env, ctx.from?.id)) return;
    const url = await siteUrl(env, "/admin");
    if (!url) return;
    await ctx.reply(t(locale, "telegram.start"), {
      reply_markup: new InlineKeyboard().webApp(t(locale, "telegram.open_app"), url),
    });
  });

  bot.command("login", async (ctx) => {
    const locale = telegramLocale(ctx);
    const from = ctx.from;
    if (!from || !await isAdmin(env, from.id)) return;
    const pin = typeof ctx.match === "string" ? ctx.match.trim() : "";
    try {
      await confirmLoginPin(env, pin, {
        firstName: from.first_name || "",
        id: from.id,
        lastName: from.last_name || "",
      });
    } catch {
      await ctx.reply(t(locale, "telegram.login_invalid"));
      return;
    }
    await ctx.reply(t(locale, "telegram.login_confirmed", { time: telegramTime(Date.now() / 1000, locale) }));
  });

  bot.callbackQuery(/^check:(.+)$/, async (ctx) => {
    const locale = telegramLocale(ctx);
    const orderId = ctx.match[1];
    await answerCallback(ctx, t(locale, "telegram.checking"));
    try {
      const snapshot = await checkOrderPayment(env, orderId);
      await editMessage(ctx, paidText(orderId, snapshot, locale), new InlineKeyboard(), await siteUrl(env, "/banner.webp"), "telegram:paid_banner_edit_failed");
    } catch (error) {
      await refreshReviewKeyboardIfNeeded(ctx, env, orderId, locale);
      await answerCallback(ctx, { show_alert: true, text: t(locale, "telegram.not_confirmed") });
    }
  });

  bot.callbackQuery(/^review:(.+)$/, async (ctx) => {
    const locale = telegramLocale(ctx);
    await answerCallback(ctx, {
      show_alert: true,
      text: t(locale, "telegram.review_hint"),
    });
  });

  bot.callbackQuery(/^audit:(delete|confirm):(.+)$/, async (ctx) => {
    if (!await isAdmin(env, ctx.from?.id)) return;
    await paymentAction(ctx, async () => {
      const [, action, orderId] = ctx.match;
      if (action === "confirm") await confirmOrder(env, orderId);
      else {
        const order = await getOrder(env, orderId);
        if (order.status !== "pending" && order.status !== "expired") throw new AppError(400, "errors.order_unavailable");
        await deleteOrder(env, orderId);
      }
      await answerCallback(ctx);
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch((error) => {
        console.warn("telegram:audit_keyboard_edit_failed", error);
      });
    });
  });

  bot.callbackQuery(/^payways:(.+)$/, async (ctx) => {
    await paymentAction(ctx, async (locale) => {
      const orderId = ctx.match[1];
      const checkout = await checkoutData(env, orderId);
      if (checkout.options.length === 0) {
        await editText(ctx, t(locale, "telegram.no_channels"));
        await answerCallback(ctx);
        return;
      }
      await editMessage(ctx, payMenuText(checkout.order, locale), assetMenu(orderId, checkout.options), await siteUrl(env, "/banner.webp"));
      await answerCallback(ctx);
    });
  });

  bot.callbackQuery(/^payasset:([^:]+):([A-Za-z0-9_-]+)$/, async (ctx) => {
    await paymentAction(ctx, async (locale) => {
      const [, orderId, asset] = ctx.match;
      const checkout = await checkoutData(env, orderId);
      await editMessage(ctx, networkMenuText(checkout.order, checkout.options, asset, locale), networkMenu(orderId, checkout.options, asset, locale), await siteUrl(env, "/banner.webp"));
      await answerCallback(ctx);
    });
  });

  bot.callbackQuery(/^paynet:([^:]+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/, async (ctx) => {
    await paymentAction(ctx, async (locale) => {
      const [, orderId, asset, network] = ctx.match;
      const snapshot = await selectTelegramPayment(env, orderId, asset, network);
      const order = await getOrder(env, orderId);
      await editMessage(ctx, paymentText(order, snapshot, locale), await paymentKeyboard(env, order, locale), await qrUrl(env, orderId, snapshot), "telegram:qr_edit_failed");
      await answerCallback(ctx, t(locale, "telegram.network_selected"));
    });
  });

  bot.callbackQuery("noop", async (ctx) => {
    await answerCallback(ctx);
  });

  bot.on("inline_query", async (ctx) => {
    const from = ctx.inlineQuery.from;
    if (!await isAdmin(env, from.id)) return;
    const locale = normalizeLocale(from.language_code);
    const parsed = parseInlinePaymentQuery(ctx.inlineQuery.query);
    if (!parsed) {
      await ctx.answerInlineQuery([{
        description: t(locale, "telegram.inline_help_desc"),
        id: "help",
        input_message_content: { message_text: t(locale, "telegram.inline_help_text") },
        title: t(locale, "telegram.inline_help_title"),
        type: "article",
      }], { cache_time: 1, is_personal: true });
      return;
    }
    const resultId = `pay:${parsed.amount}:${parsed.currency}:${Date.now().toString(36)}`;
    const title = t(locale, "telegram.inline_title", { amount: telegramAmount(parsed.amount), asset: assetName(parsed.currency) });
    const pendingText = t(locale, "telegram.inline_pending", { amount: telegramAmount(parsed.amount), asset: assetName(parsed.currency) });
    await ctx.answerInlineQuery([{
      description: t(locale, "telegram.inline_desc"),
      id: resultId,
      input_message_content: { message_text: pendingText },
      reply_markup: new InlineKeyboard().text(t(locale, "telegram.creating"), "noop"),
      title,
      type: "article",
    }], { cache_time: 1, is_personal: true });
  });

  bot.on("chosen_inline_result", async (ctx) => {
    const result = ctx.chosenInlineResult;
    const locale = normalizeLocale(result?.from.language_code);
    if (!result?.inline_message_id || !await isAdmin(env, result.from.id)) return;
    const parsed = parseInlineResultId(result.result_id);
    if (!parsed) return;
    const { order } = await createTelegramOrder(env, {
      amount: parsed.amount,
      currency: parsed.currency,
      description: t(locale, "telegram.inline_order_desc"),
      timestamp: parsed.timestamp,
    });
    const checkout = await checkoutData(env, order.id);
    if (checkout.options.length === 0) {
      await editInline(ctx, result.inline_message_id, t(locale, "telegram.no_channels"), undefined, await siteUrl(env, "/banner.webp"));
      return;
    }
    await editInline(ctx, result.inline_message_id, payMenuText(order, locale), assetMenu(order.id, checkout.options), await siteUrl(env, "/banner.webp"));
  });

  bot.on("message:text", async (ctx) => {
    const locale = telegramLocale(ctx);
    await ctx.reply(t(locale, "telegram.message_help"));
  });

  return bot;
}

function parseInlinePaymentQuery(query: string) {
  const trimmed = query.trim();
  if (/^[0-9]+(?:\.[0-9]+)?\s*[uU]$/.test(trimmed)) {
    const amount = Number(trimmed.replace(/[uU]\s*$/, ""));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return { amount, currency: "USDT" };
  }
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]{0,12})$/.exec(trimmed);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: (match[2] || "USDT").toUpperCase() };
}

function parseInlineResultId(resultId: string) {
  const parts = resultId.split(":");
  if (parts.length < 4 || parts[0] !== "pay" || !parts[3]) return null;
  const amount = Number(parts[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: (parts[2] || "USDT").toUpperCase(), timestamp: parts[3] };
}

function telegramAmount(amount: number) {
  return ceilAmount(amount).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

async function isAdmin(env: AppEnv, userId?: number) {
  return Boolean(userId && Number(await getConfig(env, "admin_id")) === userId);
}

async function paymentAction(ctx: GrammyContext, action: (locale: Locale) => Promise<void>) {
  const locale = telegramLocale(ctx);
  try {
    await action(locale);
  } catch (error) {
    await answerCallback(ctx, { show_alert: true, text: payError(error, locale) });
  }
}

async function siteUrl(env: AppEnv, path: string) {
  const domain = await getConfig(env, "domain");
  return domain ? `${domain.replace(/\/$/, "")}${path}` : "";
}

function payMenuText(order: { amount: number; currency: string }, locale: Locale) {
  return t(locale, "telegram.payment_menu", { amount: telegramAmount(order.amount), asset: assetName(order.currency) });
}

function assetMenu(orderId: string, options: TelegramPaymentOption[]) {
  const keyboard = new InlineKeyboard();
  for (const asset of paymentAssets(options)) {
    keyboard.text(emojiButton(assetName(asset), paymentAssetTelegramEmojiId(asset)), `payasset:${orderId}:${asset}`).row();
  }
  return keyboard;
}

function networkMenuText(order: { amount: number; currency: string }, options: TelegramPaymentOption[], asset: string, locale: Locale) {
  const targetAsset = key(asset);
  const payAmount = options.find((option) => key(option.asset) === targetAsset)?.amount ?? order.amount;
  return t(locale, "telegram.network_menu", {
    amount: telegramAmount(order.amount),
    asset: assetName(order.currency),
    payAmount: telegramAmount(payAmount),
    payAsset: assetName(asset),
  });
}

function networkMenu(orderId: string, options: TelegramPaymentOption[], asset: string, locale: Locale) {
  const keyboard = new InlineKeyboard();
  const targetAsset = key(asset);
  const networks = [...new Set(
    options
      .filter((option) => key(option.asset) === targetAsset)
      .map((option) => option.network.trim().toLowerCase())
      .filter(Boolean),
  )].sort((a, b) => t(locale, networkLabel(a)).localeCompare(t(locale, networkLabel(b))));
  for (const network of networks) {
    const label = t(locale, networkLabel(network));
    keyboard.text(emojiButton(label, paymentNetworkTelegramEmojiId(network)), `paynet:${orderId}:${targetAsset}:${network}`).row();
  }
  keyboard.text(t(locale, "telegram.reselect_asset"), `payways:${orderId}`);
  return keyboard;
}

function emojiButton(text: string, emojiId: string) {
  return emojiId ? { icon_custom_emoji_id: emojiId, text } : text;
}

function paymentAssets(options: TelegramPaymentOption[]) {
  return [...new Set(options.map((option) => key(option.asset)).filter(Boolean))].sort();
}

async function paymentKeyboard(env: AppEnv, order: Pick<Order, "createdAt" | "expireAt" | "id">, locale: Locale) {
  const keyboard = new InlineKeyboard()
    .text(t(locale, "telegram.done_button"), `check:${order.id}`)
    .row();
  if (shouldShowReviewButton(order)) {
    keyboard.text(t(locale, "telegram.review_button"), `review:${order.id}`).row();
    const url = await siteUrl(env, `/pay/${encodeURIComponent(order.id)}`);
    if (url) keyboard.url(t(locale, "telegram.review_link"), url).row();
  }
  return keyboard.text(t(locale, "telegram.change_asset"), `payways:${order.id}`);
}

async function refreshReviewKeyboardIfNeeded(ctx: GrammyContext, env: AppEnv, orderId: string, locale: Locale) {
  try {
    const order = await getOrder(env, orderId);
    if (!shouldShowReviewButton(order)) return;
    const snapshot = jsonParseObject<PaymentSnapshot>(order.payment, {} as PaymentSnapshot);
    if (!snapshot.driver) return;
    await editText(ctx, paymentText(order, snapshot, locale), await paymentKeyboard(env, order, locale));
  } catch (error) {
    console.warn("telegram:review_keyboard_refresh_failed", error);
  }
}

function shouldShowReviewButton(order: Pick<Order, "createdAt" | "expireAt">) {
  const createdAt = Number(order.createdAt);
  const expireAt = Number(order.expireAt);
  if (!createdAt || !expireAt || expireAt <= createdAt) return false;
  return now() - createdAt >= (expireAt - createdAt) / 2;
}

function paidText(orderId: string, snapshot: PaymentSnapshot, locale: Locale) {
  const tx = snapshot.tx!;
  const lines = [
    t(locale, "telegram.paid"),
    "",
    t(locale, "telegram.order_id"),
    `<pre>${telegramHtml(orderId)}</pre>`,
  ];
  const url = paymentExplorerUrl(snapshot.driver, tx.txid);
  if (url) lines.push(`<a href="${telegramHtml(url)}">${telegramHtml(t(locale, "telegram.tx_link"))}</a>`);
  return lines.join("\n");
}

function paymentText(order: Pick<Order, "expireAt" | "id">, snapshot: PaymentSnapshot, locale: Locale) {
  const exchange = paymentById(snapshot.driver)?.kind === "exchange";
  const address = telegramHtml(snapshot.address ?? "");
  return [
    telegramHtml(t(locale, exchange ? "telegram.pay_exchange" : "telegram.pay_chain", { network: t(locale, networkLabel(snapshot.driver)), asset: assetName(snapshot.currency) })),
    telegramHtml(t(locale, exchange ? "telegram.exchange_wait" : "telegram.network_warning")),
    "",
    exchange ? `${telegramHtml(t(locale, "payment.exchange_address"))}\n<pre>${address}</pre>` : t(locale, "telegram.address", { address }),
    t(locale, "telegram.amount_due", { amount: telegramHtml(telegramAmount(snapshot.amount)) }),
    t(locale, "telegram.problem_order", { orderId: telegramHtml(order.id) }),
    t(locale, "telegram.deadline", { time: telegramHtml(telegramTime(order.expireAt, locale)) }),
  ].join("\n");
}

function telegramTime(timestamp: number, locale: Locale) {
  return new Date(timestamp * 1000).toLocaleString(locale, {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).replaceAll("/", "-");
}

function telegramHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('\"', "&quot;");
}

function payError(error: unknown, locale: Locale) {
  const errorKey = error instanceof AppError ? error.key : "";
  if (errorKey === "errors.order_paid") return t(locale, "telegram.error.order_paid");
  if (errorKey === "errors.order_not_found" || errorKey === "errors.order_unavailable") return t(locale, "telegram.error.order_unavailable");
  if (errorKey === "errors.payment_network_unavailable") return t(locale, "telegram.error.network_unavailable");
  if (errorKey === "errors.payment_disabled") return t(locale, "telegram.error.payment_disabled");
  return t(locale, "telegram.error.payment_unavailable");
}

function telegramLocale(ctx: GrammyContext) {
  return normalizeLocale(ctx.from?.language_code);
}

async function answerCallback(ctx: GrammyContext, options?: string | { show_alert?: boolean; text?: string }) {
  try {
    if (typeof options === "string") {
      await ctx.answerCallbackQuery(options);
      return;
    }
    await ctx.answerCallbackQuery(options);
  } catch (error) {
    console.warn("telegram:answer_callback_failed", error);
  }
}

async function editInline(ctx: GrammyContext, inlineMessageId: string, text: string, keyboard?: InlineKeyboard, mediaUrl = "") {
  if (mediaUrl) {
    try {
      await ctx.api.editMessageMediaInline(inlineMessageId, photoMedia(mediaUrl, text), mediaExtra(keyboard));
      return;
    } catch (error) {
      console.warn("telegram:inline_media_edit_failed", error);
    }
  }
  await ctx.api.editMessageTextInline(inlineMessageId, text, textExtra(keyboard));
}

async function editMessage(ctx: GrammyContext, text: string, keyboard?: InlineKeyboard, mediaUrl = "", logLabel = "telegram:media_edit_failed") {
  if (mediaUrl && await editMedia(ctx, mediaUrl, text, keyboard, logLabel)) return;
  await editText(ctx, text, keyboard);
}

async function editText(ctx: GrammyContext, text: string, keyboard?: InlineKeyboard) {
  const inlineMessageId = ctx.callbackQuery?.inline_message_id;
  const extra = textExtra(keyboard);
  if (inlineMessageId) {
    try {
      await ctx.api.editMessageCaptionInline(inlineMessageId, { caption: text, ...extra });
      return;
    } catch {
      await ctx.api.editMessageTextInline(inlineMessageId, text, extra);
      return;
    }
  }
  const message = ctx.callbackQuery?.message;
  if (!message) return;
  if ("photo" in message) {
    try {
      await ctx.api.editMessageCaption(message.chat.id, message.message_id, { caption: text, ...extra });
      return;
    } catch {
      // Continue to text edit for messages that were created before banner support.
    }
  }
  await ctx.api.editMessageText(message.chat.id, message.message_id, text, extra);
}

async function editMedia(ctx: GrammyContext, mediaUrl: string, text: string, keyboard: InlineKeyboard | undefined, logLabel: string) {
  const inlineMessageId = ctx.callbackQuery?.inline_message_id;
  if (inlineMessageId) {
    try {
      await ctx.api.editMessageMediaInline(inlineMessageId, photoMedia(mediaUrl, text), mediaExtra(keyboard));
      return true;
    } catch (error) {
      console.warn(`${logLabel}:inline`, error);
    }
  }
  const message = ctx.callbackQuery?.message;
  if (!message) return false;
  try {
    await ctx.api.editMessageMedia(message.chat.id, message.message_id, photoMedia(mediaUrl, text), mediaExtra(keyboard));
    return true;
  } catch (error) {
    console.warn(logLabel, error);
    return false;
  }
}

function photoMedia(media: string, caption: string) {
  return { caption, media, parse_mode: "HTML" as const, type: "photo" as const };
}

function textExtra(keyboard?: InlineKeyboard) {
  return { parse_mode: "HTML" as const, ...(keyboard ? { reply_markup: keyboard } : {}) };
}

function mediaExtra(keyboard?: InlineKeyboard) {
  return keyboard ? { reply_markup: keyboard } : undefined;
}

async function qrUrl(env: AppEnv, orderId: string, snapshot: PaymentSnapshot) {
  if (!snapshot.address?.trim()) return "";
  if (paymentById(snapshot.driver)?.kind === "exchange") return "";
  return siteUrl(env, `/order/${encodeURIComponent(orderId)}/qr.png`);
}

export async function handleTelegramWebhook(c: Context<HonoEnv>) {
  const secret = c.req.param("secret");
  const expected = await getConfig(c.env, "bot_secret");
  if (!expected || !timingSafeEqualString(expected, secret ?? "")) throw new AppError(404, "errors.webhook_not_found");
  const bot = await createBot(c.env);
  return webhookCallback(bot, "hono")(c);
}
