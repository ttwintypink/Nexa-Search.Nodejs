import { Markup } from "telegraf";
import { config } from "./config.js";
import { modePresets } from "./username.js";
import type { FoundUsernameRecord, SearchMode, UserRecord } from "./types.js";
import { now } from "./store.js";

type Keyboard = ReturnType<typeof Markup.inlineKeyboard>;

export const escapeHtml = (value: unknown): string => {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

export const premiumStatus = (user: UserRecord | undefined): string => {
  if (!user || user.premiumUntil <= now()) {
    return "Обычный доступ";
  }
  if (user.premiumUntil >= 4102444800) {
    return "Premium навсегда";
  }
  return `Premium до ${formatDate(user.premiumUntil)}`;
};

export const mainText = (user: UserRecord): string => {
  return [
    `🔷 <b>Приветствуем в ${escapeHtml(config.appName)}!</b>`,
    "",
    "<i>Наш бот — это профессиональный инструмент для поиска свободных юзернеймов в Telegram.</i>",
    "",
    `🧿 <b>Статус:</b> ${escapeHtml(premiumStatus(user))}`,
    `🔎 <b>Запросов:</b> <code>${user.attempts}</code>`,
    `⚙️ <b>Режим:</b> ${escapeHtml(modePresets[user.search.mode].title)}`,
    "",
    "Выберите нужное действие в меню ниже 💙"
  ].join("\n");
};

export const profileText = (user: UserRecord, referralLink: string): string => {
  return [
    "👤 <b>Профиль Nexa</b>",
    "",
    `<b>ID:</b> <code>${user.userId}</code>`,
    `<b>Username:</b> ${user.username ? `@${escapeHtml(user.username)}` : "не указан"}`,
    `<b>Статус:</b> ${escapeHtml(premiumStatus(user))}`,
    `<b>Запросов:</b> <code>${user.attempts}</code>`,
    `<b>Приглашено:</b> <code>${user.totalReferrals}</code>`,
    "",
    "🎁 <b>Реферальная ссылка</b>",
    `<code>${escapeHtml(referralLink)}</code>`
  ].join("\n");
};

export const searchMenuText = (user: UserRecord): string => {
  return [
    "🔷 <b>Выберите длину ника:</b>",
    "",
    "• <b>5 букв</b> — скоро (⚙️ техработы), пока только при активном Premium",
    "• <b>6–7 букв</b> — обычный поиск",
    "• режим с цифрами обычно находит варианты быстрее",
    "",
    `<b>Запросов:</b> <code>${user.attempts}</code>`,
    `<b>Статус:</b> ${escapeHtml(premiumStatus(user))}`
  ].join("\n");
};

export const digitText = (length: number): string => {
  return [
    "🔷 <b>Выберите формат ника:</b>",
    "",
    `<b>Длина:</b> <code>${length}</code>`,
    "",
    "Фильтр влияет на то, будут ли в username цифры."
  ].join("\n");
};

export const modeText = (length: number, withDigits: boolean): string => {
  return [
    "🌀 <b>Настройка фильтров</b>",
    "",
    "<i>Выберите режим поиска:</i>",
    `• ${withDigits ? "🔢 С цифрами" : "🔤 Без цифр"}`,
    `• длина: <code>${length}</code>`,
    "",
    "💙"
  ].join("\n");
};

export const readyText = (length: number, withDigits: boolean, mode: SearchMode): string => {
  const preset = modePresets[mode];
  return [
    "🔷 <b>Поиск готов к запуску</b>",
    "",
    `<b>Длина:</b> <code>${length}</code>`,
    `<b>Формат:</b> ${withDigits ? "буквы + цифры" : "только буквы"}`,
    `<b>Режим:</b> ${escapeHtml(preset.title)}`,
    `<b>Ожидание:</b> до <code>${Math.ceil(preset.timeLimitMs / 1000)} сек.</code>`,
    "",
    `<i>${escapeHtml(preset.short)}</i>`
  ].join("\n");
};

export const progressText = (
  length: number,
  withDigits: boolean,
  mode: SearchMode,
  tries: number
): string => {
  const preset = modePresets[mode];
  const frames = ["◌", "◎", "◉", "◎"];
  const frame = frames[Math.floor(Date.now() / 750) % frames.length];
  const checks =
    "Цепочка: Fragment → Telegram Bot API → t.me (два полных прохода на кандидата)";
  return [
    `${frame} <b>${escapeHtml(config.appName)} ищет свободный ник</b>`,
    "",
    `<b>Длина:</b> <code>${length}</code>`,
    `<b>Формат:</b> ${withDigits ? "буквы + цифры" : "только буквы"}`,
    `<b>Режим:</b> ${escapeHtml(preset.title)}`,
    `<b>Проверено:</b> <code>${tries}</code>`,
    "",
    checks
  ].join("\n");
};

export const resultText = (input: {
  username: string;
  length: number;
  withDigits: boolean;
  mode: SearchMode;
  tries: number;
  elapsedMs: number;
}): string => {
  return [
    `🌀 <b>${escapeHtml(config.appName)} завершила поиск</b>`,
    "",
    `<b>Telegram:</b> <code>@${escapeHtml(input.username)}</code>`,
    `<b>Ссылка Telegram:</b> https://t.me/${escapeHtml(input.username)}`,
    `<b>Ссылка Fragment:</b> https://fragment.com/username/${escapeHtml(input.username)}`,
    "",
    `Длина: <code>${input.length} символов</code>`,
    `Формат: <code>${input.withDigits ? "с цифрами" : "без цифр"}</code>`,
    `Режим: ${modePresets[input.mode].title}`,
    `Проверено: <code>${input.tries}</code>`,
    `Время: <code>${(input.elapsedMs / 1000).toFixed(1)} сек.</code>`,
    "",
    "Кандидат дважды прошёл все фильтры: не на Fragment, не занят по API и по публичной странице.",
    "",
    "<i>Смену @username сделай вручную в настройках Telegram — бот только подсказывает вариант.</i>"
  ].join("\n");
};

export const notFoundText = (): string => {
  return [
    "🔷 <b>Поиск завершён</b>",
    "",
    "За отведённое время не нашлось ника, который одновременно проходит Fragment, Telegram и t.me.",
    "",
    "Попробуй ещё раз, другой режим (например Строгий), длину или вариант с цифрами."
  ].join("\n");
};

export const historyText = (items: FoundUsernameRecord[]): string => {
  if (items.length === 0) {
    return "📌 <b>Мои ники</b>\n\nПока ничего не найдено.";
  }
  const rows = items.map((item, index) => {
    return `${index + 1}. <code>@${escapeHtml(item.username)}</code> · ${item.length} · ${modePresets[item.mode].title}`;
  });
  return ["📌 <b>Мои последние ники</b>", "", ...rows].join("\n");
};

export const refsText = (user: UserRecord, referralLink: string): string => {
  return [
    "🎁 <b>Реферальная система</b>",
    "",
    `За нового пользователя: <b>+${config.referralBonusAttempts} запроса</b>`,
    `Приглашено: <code>${user.totalReferrals}</code>`,
    "",
    `<code>${escapeHtml(referralLink)}</code>`
  ].join("\n");
};

export const rulesText = (): string => {
  return [
    "📄 <b>Как это работает</b>",
    "",
    "Для каждого кандидата выполняется цепочка: <b>Fragment</b> (нет лота на маркетплейсе) → <b>Telegram Bot API</b> (нет чата с таким @username) → <b>t.me</b> (нет публичной страницы профиля). Затем всё повторяется второй раз — чтобы отсечь гонки и кэш.",
    "",
    "При любом неясном ответе сервиса бот <b>не выдаёт</b> ник: лучше пропустить вариант, чем показать занятый.",
    "",
    "Перед сменой @username всё равно загляни в приложение вручную. Бот не просит код входа и не меняет ник сам."
  ].join("\n");
};

export const modeInfoText = (): string => {
  return [
    "🚀 <b>Режимы поиска</b>",
    "",
    `<b>${modePresets.turbo.title}</b> — ${modePresets.turbo.short}`,
    `<b>${modePresets.balance.title}</b> — ${modePresets.balance.short}`,
    `<b>${modePresets.strict.title}</b> — ${modePresets.strict.short}`,
    `<b>${modePresets.beauty.title}</b> — ${modePresets.beauty.short}`
  ].join("\n");
};

/** Экран раздела Premium: подписка временно отключена (без цен и счетов). */
export const premiumShopScreenText = (user: UserRecord): string => {
  const statusExtra =
    premiumStatus(user) !== "Обычный доступ"
      ? [`<b>Статус:</b> ${escapeHtml(premiumStatus(user))}`, ""]
      : [];
  return [
    "<b>⚙️ Coming Soon...</b>",
    "",
    "<i>(На тех.работах)</i>",
    "",
    ...statusExtra,
    `Подписка <b>${escapeHtml(config.premiumName)}</b> временно недоступна: оплата и тарифы скрыты.`,
    "",
    "Дополнительные запросы пока можно получить через реферальную программу."
  ].join("\n");
};

/** После успешной оплаты (редкий случай со старым счётом) или выдачи админом. */
export const premiumActivatedText = (user: UserRecord): string => {
  return [
    "<b>Premium активирован.</b>",
    "",
    `<b>Статус:</b> ${escapeHtml(premiumStatus(user))}`
  ].join("\n");
};

/** Нет Premium и выбраны 5 символов — пока магазин на паузе. */
export const fiveLetterRequiresPremiumText = (): string => {
  return [
    "<b>5 символов — только с Premium</b>",
    "",
    "Сейчас оформление Premium <b>⚙️ на тех.работах</b> (Coming Soon).",
    "",
    "Выбери длину <b>6–7</b> символов или дождись открытия подписки."
  ].join("\n");
};

export const attemptsExhaustedText = (): string => {
  return [
    "<b>Запросы закончились.</b>",
    "",
    "Пригласи друга по реферальной ссылке — получишь дополнительные попытки.",
    "",
    "<i>Premium временно на техработах: ⚙️ Coming Soon.</i>"
  ].join("\n");
};

export const adminText = (): string => "⚙️ <b>Админ панель</b>\n\nВыбери раздел.";

export const statsText = (stats: {
  users: number;
  premium: number;
  found: number;
  payments: number;
  stars: number;
  banned: number;
}): string => {
  return [
    "📊 <b>Статистика</b>",
    "",
    `Пользователи: <code>${stats.users}</code>`,
    `Premium: <code>${stats.premium}</code>`,
    `Найдено username: <code>${stats.found}</code>`,
    `Платежей: <code>${stats.payments}</code>`,
    `Stars: <code>${stats.stars}</code>`,
    `Бан: <code>${stats.banned}</code>`
  ].join("\n");
};

export const usersText = (users: UserRecord[]): string => {
  const rows = users.map((user) => {
    const name = user.username ? `@${user.username}` : user.firstName || "no name";
    return `• <code>${user.userId}</code> · ${escapeHtml(name)} · ${escapeHtml(premiumStatus(user))}`;
  });
  return ["👥 <b>Новые пользователи</b>", "", ...(rows.length ? rows : ["пусто"])].join("\n");
};

export const foundAdminText = (items: FoundUsernameRecord[]): string => {
  const rows = items.map((item) => {
    return `• <code>@${escapeHtml(item.username)}</code> · user <code>${item.userId}</code>`;
  });
  return ["📌 <b>Последние username</b>", "", ...(rows.length ? rows : ["пусто"])].join("\n");
};

export const mainKeyboard = (admin: boolean): Keyboard => {
  const rows = [
    [
      Markup.button.callback("🔍 Найти ник", "search_menu"),
      Markup.button.callback("🌀 Фильтры", "mode_info")
    ],
    [
      Markup.button.callback("👤 Профиль", "profile"),
      Markup.button.callback("💎 Premium ⚙️", "premium_menu")
    ],
    [
      Markup.button.callback("📌 Мои ники", "my_names"),
      Markup.button.callback("🎁 Рефералка", "refs")
    ],
    [
      Markup.button.callback("📄 Правила", "rules"),
      Markup.button.callback("📩 Поддержка", "support")
    ]
  ];
  if (admin) {
    rows.push([Markup.button.callback("⚙️ Админ панель", "admin")]);
  }
  return Markup.inlineKeyboard(rows);
};

export const backMainKeyboard = (): Keyboard => {
  return Markup.inlineKeyboard([[Markup.button.callback("◀️ Главное меню", "main")]]);
};

export const searchMenuKeyboard = (): Keyboard => {
  return Markup.inlineKeyboard([
    [Markup.button.callback("💎 5 букв", "len:5")],
    [
      Markup.button.callback("🔷 6 букв", "len:6"),
      Markup.button.callback("🔷 7 букв", "len:7")
    ],
    [Markup.button.callback("◀️ Главное меню", "main")]
  ]);
};

export const digitKeyboard = (length: number): Keyboard => {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔤 Без цифр", `digits:${length}:0`)],
    [Markup.button.callback("🔢 С цифрами", `digits:${length}:1`)],
    [Markup.button.callback("◀️ Назад", "search_menu")]
  ]);
};

export const modeKeyboard = (length: number, withDigits: boolean): Keyboard => {
  const digitFlag = Number(withDigits);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("⚡ Турбо", `mode:${length}:${digitFlag}:turbo`),
      Markup.button.callback("✅ Баланс", `mode:${length}:${digitFlag}:balance`)
    ],
    [
      Markup.button.callback("🛡 Строгий", `mode:${length}:${digitFlag}:strict`),
      Markup.button.callback("💎 Красивый", `mode:${length}:${digitFlag}:beauty`)
    ],
    [
      Markup.button.callback("◀️ Назад", `len:${length}`),
      Markup.button.callback("🏠 Главное меню", "main")
    ]
  ]);
};

export const startSearchKeyboard = (length: number, withDigits: boolean): Keyboard => {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🚀 Начать поиск", "do_search")],
    [Markup.button.callback("⚙️ Изменить настройки", `digits:${length}:${Number(withDigits)}`)],
    [Markup.button.callback("◀️ Главное меню", "main")]
  ]);
};

export const resultKeyboard = (username: string): Keyboard => {
  return Markup.inlineKeyboard([
    [
      Markup.button.url("🌐 Открыть Telegram", `https://t.me/${username}`),
      Markup.button.url("🧩 Fragment", `https://fragment.com/username/${username}`)
    ],
    [Markup.button.callback("🔁 Искать ещё", "do_search")],
    [
      Markup.button.callback("⚙️ Настройки", "search_menu"),
      Markup.button.callback("📌 Мои ники", "my_names")
    ],
    [Markup.button.callback("◀️ Главное меню", "main")]
  ]);
};

export const premiumShopKeyboard = (): Keyboard => {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🎁 Рефералка", "refs")],
    [Markup.button.callback("◀️ Главное меню", "main")]
  ]);
};

export const adminKeyboard = (): Keyboard => {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📊 Статистика", "adm_stats"),
      Markup.button.callback("👥 Пользователи", "adm_users")
    ],
    [Markup.button.callback("📌 Найденные username", "adm_found")],
    [Markup.button.callback("◀️ Главное меню", "main")]
  ]);
};

const formatDate = (timestamp: number): string => {
  return new Date(timestamp * 1000).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};
