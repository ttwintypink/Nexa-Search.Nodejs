import { Markup, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config, isAdmin } from "./config.js";
import { JsonStore, now } from "./store.js";
import type { UserRecord } from "./types.js";
import { findAvailableUsername, normalizeMode } from "./username.js";
import {
  adminKeyboard,
  adminText,
  backMainKeyboard,
  digitKeyboard,
  digitText,
  escapeHtml,
  foundAdminText,
  historyText,
  mainKeyboard,
  mainText,
  modeInfoText,
  modeKeyboard,
  modeText,
  notFoundText,
  attemptsExhaustedText,
  fiveLetterRequiresPremiumText,
  premiumActivatedText,
  premiumShopKeyboard,
  premiumShopScreenText,
  profileText,
  progressText,
  readyText,
  refsText,
  resultKeyboard,
  resultText,
  rulesText,
  searchMenuKeyboard,
  searchMenuText,
  startSearchKeyboard,
  statsText,
  usersText
} from "./ui.js";

type BotRuntime = {
  bot: Telegraf;
  store: JsonStore;
  setBotUsername: (username: string) => void;
};

type InlineKeyboard = ReturnType<typeof Markup.inlineKeyboard>;

export const createBot = (token: string): BotRuntime => {
  const bot = new Telegraf(token);
  const store = new JsonStore();
  let botUsername = "";

  const referralLink = (user: UserRecord): string => {
    return botUsername ? `https://t.me/${botUsername}?start=ref_${user.userId}` : "бот запускается";
  };

  const register = async (ctx: any): Promise<UserRecord | null> => {
    const from = ctx.from;
    if (!from) {
      return null;
    }
    const refBy = parseReferral(messageText(ctx).split(/\s+/)[1], from.id);
    const { user, created } = store.ensureUser({
      userId: from.id,
      firstName: from.first_name ?? "",
      username: from.username ?? "",
      refBy
    });
    if (created && refBy && store.getUser(refBy)) {
      store.recordReferral(refBy);
      await ctx.telegram
        .sendMessage(
          refBy,
          `✦ По твоей ссылке пришёл новый пользователь. +${config.referralBonusAttempts} запроса.`
        )
        .catch(() => undefined);
    }
    if (config.premiumIds.has(from.id) && !store.isPremium(user)) {
      store.setPremiumSeconds(from.id, null, false);
    }
    store.restoreAttemptsIfNeeded(from.id);
    const fresh = store.getUser(from.id);
    if (!fresh) {
      return null;
    }
    if (fresh.isBanned) {
      await showScreen(store, ctx, "<b>Доступ ограничен.</b>", backMainKeyboard());
      return null;
    }
    return fresh;
  };

  bot.start(async (ctx) => {
    const user = await register(ctx);
    if (!user) {
      return;
    }
    await deleteIncoming(ctx);
    await showScreen(store, ctx, mainText(user), mainKeyboard(isAdmin(ctx.from.id)));
  });

  bot.command("id", async (ctx) => {
    await register(ctx);
    await ctx.replyWithHTML(`<b>ID:</b> <code>${ctx.from.id}</code>`);
  });

  bot.command("admin", async (ctx) => {
    const user = await register(ctx);
    if (!user) {
      return;
    }
    if (!isAdmin(ctx.from.id)) {
      await showScreen(store, ctx, "<b>Access denied.</b>", backMainKeyboard());
      return;
    }
    await deleteIncoming(ctx);
    await showScreen(store, ctx, adminText(), adminKeyboard());
  });

  bot.command("premium", async (ctx) => {
    await register(ctx);
    if (!isAdmin(ctx.from.id)) {
      return;
    }
    const [, targetRaw, durationRaw] = messageText(ctx).split(/\s+/);
    const target = Number.parseInt(targetRaw ?? "", 10);
    if (!Number.isFinite(target)) {
      await ctx.replyWithHTML(
        "<b>Команда:</b> <code>/premium ID 30d</code>\nБез срока: <code>/premium ID</code>"
      );
      return;
    }
    store.ensureUser({ userId: target });
    const duration = parsePremiumDuration(durationRaw);
    const until = store.setPremiumSeconds(target, duration.seconds, true);
    await ctx.replyWithHTML(
      `<b>Premium выдан.</b>\nID: <code>${target}</code>\nСрок: <code>${escapeHtml(duration.label)}</code>\nUntil: <code>${until}</code>`
    );
  });

  bot.command("unpremium", async (ctx) => {
    await register(ctx);
    if (!isAdmin(ctx.from.id)) {
      return;
    }
    const [, targetRaw] = messageText(ctx).split(/\s+/);
    const target = Number.parseInt(targetRaw ?? "", 10);
    if (!Number.isFinite(target)) {
      await ctx.replyWithHTML("<b>Команда:</b> <code>/unpremium ID</code>");
      return;
    }
    store.removePremium(target);
    await ctx.replyWithHTML(`<b>Premium снят.</b>\nID: <code>${target}</code>`);
  });

  bot.command("ban", async (ctx) => {
    await register(ctx);
    if (!isAdmin(ctx.from.id)) {
      return;
    }
    const [, targetRaw] = messageText(ctx).split(/\s+/);
    const target = Number.parseInt(targetRaw ?? "", 10);
    if (!Number.isFinite(target)) {
      await ctx.replyWithHTML("<b>Команда:</b> <code>/ban ID</code>");
      return;
    }
    store.ensureUser({ userId: target });
    store.updateUser(target, { isBanned: true });
    await ctx.replyWithHTML(`<b>Пользователь забанен.</b>\nID: <code>${target}</code>`);
  });

  bot.command("unban", async (ctx) => {
    await register(ctx);
    if (!isAdmin(ctx.from.id)) {
      return;
    }
    const [, targetRaw] = messageText(ctx).split(/\s+/);
    const target = Number.parseInt(targetRaw ?? "", 10);
    if (!Number.isFinite(target)) {
      await ctx.replyWithHTML("<b>Команда:</b> <code>/unban ID</code>");
      return;
    }
    store.ensureUser({ userId: target });
    store.updateUser(target, { isBanned: false });
    await ctx.replyWithHTML(`<b>Пользователь разбанен.</b>\nID: <code>${target}</code>`);
  });

  bot.command("broadcast", async (ctx) => {
    await register(ctx);
    if (!isAdmin(ctx.from.id)) {
      return;
    }
    const text = messageText(ctx).replace(/^\/broadcast(@\w+)?\s*/i, "").trim();
    if (!text) {
      await ctx.replyWithHTML("<b>Команда:</b> <code>/broadcast текст</code>");
      return;
    }
    let sent = 0;
    for (const userId of store.allActiveUserIds()) {
      await ctx.telegram.sendMessage(userId, text, { parse_mode: "HTML" }).then(
        () => {
          sent += 1;
        },
        () => undefined
      );
    }
    await ctx.replyWithHTML(`<b>Рассылка завершена.</b>\nОтправлено: <code>${sent}</code>`);
  });

  bot.action("main", async (ctx) => {
    await answer(ctx);
    const user = await register(ctx);
    if (!user) {
      return;
    }
    await showScreen(store, ctx, mainText(user), mainKeyboard(isAdmin(ctx.from.id)));
  });

  bot.action("profile", async (ctx) => {
    await answer(ctx);
    const user = await register(ctx);
    if (!user) {
      return;
    }
    await showScreen(store, ctx, profileText(user, referralLink(user)), backMainKeyboard());
  });

  bot.action("search_menu", async (ctx) => {
    await answer(ctx);
    const user = await register(ctx);
    if (!user) {
      return;
    }
    await showScreen(store, ctx, searchMenuText(user), searchMenuKeyboard());
  });

  bot.action(/^len:\d+$/, async (ctx) => {
    await answer(ctx);
    const user = await register(ctx);
    if (!user) {
      return;
    }
    const length = Number.parseInt(callbackData(ctx).split(":")[1] ?? "6", 10);
    if (length === 5 && !store.isPremium(user)) {
      await showScreen(store, ctx, fiveLetterRequiresPremiumText(), premiumShopKeyboard());
      return;
    }
    await showScreen(store, ctx, digitText(length), digitKeyboard(length));
  });

  bot.action(/^digits:\d+:[01]$/, async (ctx) => {
    await answer(ctx);
    const user = await register(ctx);
    if (!user) {
      return;
    }
    const [, lengthRaw, digitRaw] = callbackData(ctx).split(":");
    const length = Number.parseInt(lengthRaw ?? "6", 10);
    const withDigits = digitRaw === "1";
    store.updateSearch(ctx.from.id, { length, withDigits, mode: "turbo" });
    await showScreen(store, ctx, modeText(length, withDigits), modeKeyboard(length, withDigits));
  });

  bot.action(/^mode:\d+:[01]:(turbo|balance|strict|beauty)$/, async (ctx) => {
    await answer(ctx);
    const user = await register(ctx);
    if (!user) {
      return;
    }
    const [, lengthRaw, digitRaw, modeRaw] = callbackData(ctx).split(":");
    const length = Number.parseInt(lengthRaw ?? "6", 10);
    const withDigits = digitRaw === "1";
    const mode = normalizeMode(modeRaw);
    store.updateSearch(ctx.from.id, { length, withDigits, mode });
    await showScreen(store, ctx, readyText(length, withDigits, mode), startSearchKeyboard(length, withDigits));
  });

  bot.action("do_search", async (ctx) => {
    await answer(ctx);
    const user = await register(ctx);
    if (!user) {
      return;
    }
    const fresh = store.getUser(ctx.from.id) ?? user;
    const selection = fresh.search;
    if (selection.length === 5 && !store.isPremium(fresh)) {
      await showScreen(store, ctx, fiveLetterRequiresPremiumText(), premiumShopKeyboard());
      return;
    }
    const cooldownLeft = config.searchCooldownSeconds - (now() - fresh.lastSearchAt);
    if (!store.isPremium(fresh) && cooldownLeft > 0) {
      await showScreen(
        store,
        ctx,
        `<b>Не так быстро.</b>\n\nСледующий поиск через <code>${cooldownLeft}</code> сек.`,
        Markup.inlineKeyboard([
          [Markup.button.callback("Обновить", "do_search")],
          [Markup.button.callback("◀️ Главное меню", "main")]
        ])
      );
      return;
    }
    if (!store.isPremium(fresh) && fresh.attempts <= 0) {
      await showScreen(
        store,
        ctx,
        attemptsExhaustedText(),
        Markup.inlineKeyboard([
          [Markup.button.callback("Рефералка", "refs")],
          [Markup.button.callback("💎 Premium · Coming Soon", "premium_menu")],
          [Markup.button.callback("◀️ Главное меню", "main")]
        ])
      );
      return;
    }
    if (store.isPremium(fresh)) {
      store.updateUser(ctx.from.id, { lastSearchAt: now() });
    } else if (!store.useAttempt(ctx.from.id)) {
      await showScreen(store, ctx, attemptsExhaustedText(), premiumShopKeyboard());
      return;
    }

    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }
    
    try {
      await deleteLastScreen(ctx, fresh);
      const status = await ctx.telegram.sendMessage(
        chatId,
        progressText(selection.length, selection.withDigits, selection.mode, 0),
        htmlExtra()
      );
      store.saveLastMessage(ctx.from.id, status.message_id);

      let lastEditAt = 0;
      let result;
      
      try {
        result = await Promise.race([
          findAvailableUsername(ctx.telegram, selection, async (progress) => {
            if (Date.now() - lastEditAt < 900) {
              return;
            }
            lastEditAt = Date.now();
            await editScreen(
              ctx,
              status.message_id,
              progressText(selection.length, selection.withDigits, selection.mode, progress.tries)
            ).catch(() => undefined);
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Search timeout")), 35000)
          ) as Promise<any>
        ]);
      } catch (searchError) {
        console.error("[search:timeout]", searchError);
        await editScreen(
          ctx,
          status.message_id,
          "<b>⏱️ Поиск занял слишком долго.</b>\n\nПопробуй ещё раз или смени режим.",
          Markup.inlineKeyboard([
            [Markup.button.callback("Искать ещё", "do_search")],
            [Markup.button.callback("Настройки", "search_menu")],
            [Markup.button.callback("◀️ Главное меню", "main")]
          ])
        ).catch(() => undefined);
        return;
      }

      if (!result.username) {
        await editScreen(
          ctx,
          status.message_id,
          notFoundText(),
          Markup.inlineKeyboard([
            [Markup.button.callback("Искать ещё", "do_search")],
            [Markup.button.callback("Настройки", "search_menu")],
            [Markup.button.callback("◀️ Главное меню", "main")]
          ])
        ).catch(() => undefined);
        return;
      }

      store.addFound({
        userId: ctx.from.id,
        username: result.username,
        length: selection.length,
        withDigits: selection.withDigits,
        mode: selection.mode
      });
      
      await editScreen(
        ctx,
        status.message_id,
        resultText({
          username: result.username,
          length: selection.length,
          withDigits: selection.withDigits,
          mode: selection.mode,
          tries: result.tries,
          elapsedMs: result.elapsedMs
        }),
        resultKeyboard(result.username)
      ).catch(() => undefined);
    } catch (error) {
      console.error("[search:error]", error);
      await showScreen(
        store,
        ctx,
        "<b>❌ Ошибка при поиске.</b>\n\nПопробуй ещё раз.",
        Markup.inlineKeyboard([
          [Markup.button.callback("Искать ещё", "do_search")],
          [Markup.button.callback("◀️ Главное меню", "main")]
        ])
      ).catch(() => undefined);
    }
  });

  bot.action("my_names", async (ctx) => {
    await answer(ctx);
    const user = await register(ctx);
    if (!user) {
      return;
    }
    await showScreen(store, ctx, historyText(store.recentFound(ctx.from.id)), backMainKeyboard());
  });

  bot.action("refs", async (ctx) => {
    await answer(ctx);
    const user = await register(ctx);
    if (!user) {
      return;
    }
    await showScreen(store, ctx, refsText(user, referralLink(user)), backMainKeyboard());
  });

  bot.action("rules", async (ctx) => {
    await answer(ctx);
    await register(ctx);
    await showScreen(store, ctx, rulesText(), backMainKeyboard());
  });

  bot.action("support", async (ctx) => {
    await answer(ctx);
    await register(ctx);
    const support = config.supportUsername
      ? `@${escapeHtml(config.supportUsername)}`
      : "укажи SUPPORT_USERNAME в .env";
    await showScreen(store, ctx, `<b>📩 Поддержка</b>\n\n${support}`, backMainKeyboard());
  });

  bot.action("mode_info", async (ctx) => {
    await answer(ctx);
    await register(ctx);
    await showScreen(store, ctx, modeInfoText(), Markup.inlineKeyboard([
      [Markup.button.callback("Перейти к поиску", "search_menu")],
      [Markup.button.callback("◀️ Главное меню", "main")]
    ]));
  });

  bot.action("premium_menu", async (ctx) => {
    await answer(ctx);
    const user = await register(ctx);
    if (!user) {
      return;
    }
    await showScreen(store, ctx, premiumShopScreenText(user), premiumShopKeyboard());
  });

  /** Старые сообщения могли содержать кнопки buy:* — оплата отключена. */
  bot.action(/^buy:\d+$/, async (ctx) => {
    await register(ctx);
    await answer(ctx, "⚙️ Premium на техработах — оплата отключена.", true);
  });

  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(
      false,
      "Premium временно недоступен (техработы)."
    );
  });

  bot.on(message("successful_payment"), async (ctx) => {
    const user = await register(ctx);
    if (!user) {
      return;
    }
    const payment = ctx.message.successful_payment;
    const [kind, daysRaw] = payment.invoice_payload.split(":");
    if (kind !== "premium") {
      return;
    }
    const days = Number.parseInt(daysRaw ?? "31", 10);
    store.setPremiumSeconds(ctx.from.id, days * 86400, false);
    store.addPayment({
      userId: ctx.from.id,
      stars: payment.total_amount,
      days,
      chargeId: payment.telegram_payment_charge_id
    });
    const fresh = store.getUser(ctx.from.id) ?? user;
    await showScreen(
      store,
      ctx,
      premiumActivatedText(fresh),
      mainKeyboard(isAdmin(ctx.from.id))
    );
  });

  bot.action("admin", async (ctx) => {
    await answer(ctx);
    await register(ctx);
    if (!isAdmin(ctx.from.id)) {
      await showScreen(store, ctx, "<b>Access denied.</b>", backMainKeyboard());
      return;
    }
    await showScreen(store, ctx, adminText(), adminKeyboard());
  });

  bot.action("adm_stats", async (ctx) => {
    await answer(ctx);
    await register(ctx);
    if (!isAdmin(ctx.from.id)) {
      return;
    }
    await showScreen(store, ctx, statsText(store.stats()), adminKeyboard());
  });

  bot.action("adm_users", async (ctx) => {
    await answer(ctx);
    await register(ctx);
    if (!isAdmin(ctx.from.id)) {
      return;
    }
    await showScreen(store, ctx, usersText(store.recentUsers(10)), adminKeyboard());
  });

  bot.action("adm_found", async (ctx) => {
    await answer(ctx);
    await register(ctx);
    if (!isAdmin(ctx.from.id)) {
      return;
    }
    await showScreen(store, ctx, foundAdminText(store.recentFoundGlobal(10)), adminKeyboard());
  });

  bot.on("message", async (ctx) => {
    const user = await register(ctx);
    if (!user) {
      return;
    }
    await deleteIncoming(ctx);
    await showScreen(store, ctx, mainText(user), mainKeyboard(isAdmin(ctx.from.id)));
  });

  bot.catch((error) => {
    console.error("[bot:error]", error);
  });

  return {
    bot,
    store,
    setBotUsername(username: string) {
      botUsername = username;
    }
  };
};

const showScreen = async (
  store: JsonStore,
  ctx: any,
  text: string,
  keyboard: InlineKeyboard = Markup.inlineKeyboard([])
): Promise<void> => {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId) {
    return;
  }
  const user = store.getUser(userId);
  await deleteLastScreen(ctx, user);
  const message = await ctx.telegram.sendMessage(chatId, text, {
    ...htmlExtra(),
    reply_markup: keyboard.reply_markup
  });
  store.saveLastMessage(userId, message.message_id);
};

const editScreen = async (
  ctx: any,
  messageId: number,
  text: string,
  keyboard: InlineKeyboard = Markup.inlineKeyboard([])
): Promise<void> => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return;
  }
  await ctx.telegram
    .editMessageText(chatId, messageId, undefined, text, {
      ...htmlExtra(),
      reply_markup: keyboard.reply_markup
    })
    .catch(() => undefined);
};

const htmlExtra = () => ({
  parse_mode: "HTML" as const,
  link_preview_options: { is_disabled: true }
});

const deleteLastScreen = async (ctx: any, user: UserRecord | undefined): Promise<void> => {
  const chatId = ctx.chat?.id;
  if (!chatId || !user?.lastMessageId) {
    return;
  }
  await ctx.telegram.deleteMessage(chatId, user.lastMessageId).catch(() => undefined);
};

const deleteIncoming = async (ctx: any): Promise<void> => {
  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;
  if (!chatId || !messageId) {
    return;
  }
  await ctx.telegram.deleteMessage(chatId, messageId).catch(() => undefined);
};

const answer = async (ctx: any, text = "", alert = false): Promise<void> => {
  if (!ctx.callbackQuery) {
    return;
  }
  await ctx.answerCbQuery(text, { show_alert: alert }).catch(() => undefined);
};

const messageText = (ctx: any): string => {
  return typeof ctx.message?.text === "string" ? ctx.message.text : "";
};

const callbackData = (ctx: any): string => {
  return typeof ctx.callbackQuery?.data === "string" ? ctx.callbackQuery.data : "";
};

const parseReferral = (payload: string | undefined, currentUserId: number): number | null => {
  if (!payload) {
    return null;
  }
  const id = Number.parseInt(payload.replace(/^ref_/, ""), 10);
  return Number.isFinite(id) && id !== currentUserId ? id : null;
};

const parsePremiumDuration = (raw: string | undefined): { seconds: number | null; label: string } => {
  if (!raw) {
    return { seconds: null, label: "forever" };
  }
  const match = raw.trim().toLowerCase().match(/^(\d+)(h|d|w|m|y)?$/);
  if (!match) {
    throw new Error("bad_duration");
  }
  const amount = Number.parseInt(match[1] ?? "0", 10);
  const unit = match[2] ?? "d";
  const multipliers: Record<string, number> = {
    h: 3600,
    d: 86400,
    w: 7 * 86400,
    m: 31 * 86400,
    y: 365 * 86400
  };
  return { seconds: amount * multipliers[unit], label: `${amount}${unit}` };
};
