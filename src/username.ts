import type { Telegram } from "telegraf";
import type { SearchMode, SearchSelection } from "./types.js";

const USERNAME_RE = /^[a-z][a-z0-9]{4,31}$/;
/** Пауза между двумя полными проходами проверок — снижает ложные «свободно» из‑за гонки CDN/API. */
const FINAL_VERIFY_GAP_MS = 280;
const RESERVED_PARTS = ["telegram", "support", "admin", "helpdesk", "security"];
const VOWELS = "aeiouy";
const CONSONANTS = "bcdfghjklmnpqrstvwxz";
const ROOTS = [
  "aura",
  "luna",
  "mira",
  "kira",
  "nexa",
  "nova",
  "sora",
  "lumi",
  "miko",
  "yuki",
  "soft",
  "moon",
  "star",
  "pure",
  "glow",
  "flow",
  "runa",
  "miya",
  "navi",
  "faye",
  "ruby",
  "koko",
  "riko",
  "mina",
  "lira",
  "vivi",
  "toki",
  "angel",
  "dream",
  "velvet",
  "pixel",
  "honey",
  "pearl",
  "milky",
  "charm",
  "night",
  "light"
];
const TAILS_BY_LENGTH: Record<number, string[]> = {
  1: ["x", "z", "q", "v"],
  2: ["ly", "io", "ix", "ex", "is", "on", "me", "go", "xo", "ka", "ya"],
  3: ["way", "hub", "lab", "sky", "sun", "max", "one", "ish", "ary"],
  4: ["core", "side", "land", "wave", "zone", "mode"],
  5: ["space", "field", "pilot", "verse", "world"]
};

export const modePresets: Record<
  SearchMode,
  {
    title: string;
    short: string;
    batch: number;
    /** Сколько кандидатов проверять параллельно (остальное — очередь внутри batch). */
    parallelChecks: number;
    maxTries: number;
    beautyTries: number;
    timeLimitMs: number;
    networkTimeoutMs: number;
    useFragment: boolean;
  }
> = {
  turbo: {
    title: "⚡ Турбо",
    short: "двойная проверка Fragment + Telegram + t.me",
    batch: 18,
    parallelChecks: 9,
    maxTries: 2200,
    beautyTries: 6,
    timeLimitMs: 18_000,
    networkTimeoutMs: 2_400,
    useFragment: true
  },
  balance: {
    title: "✅ Баланс",
    short: "двойной проход: Fragment → Telegram → t.me",
    batch: 14,
    parallelChecks: 7,
    maxTries: 3200,
    beautyTries: 16,
    timeLimitMs: 22_000,
    networkTimeoutMs: 2_400,
    useFragment: true
  },
  strict: {
    title: "🛡 Строгий",
    short: "больше попыток и запас по времени",
    batch: 12,
    parallelChecks: 6,
    maxTries: 5200,
    beautyTries: 32,
    timeLimitMs: 28_000,
    networkTimeoutMs: 3_200,
    useFragment: true
  },
  beauty: {
    title: "💎 Красивый",
    short: "красивые варианты + те же проверки",
    batch: 12,
    parallelChecks: 6,
    maxTries: 4200,
    beautyTries: 80,
    timeLimitMs: 28_000,
    networkTimeoutMs: 2_800,
    useFragment: true
  }
};

export interface CandidateCheck {
  username: string;
  available: boolean;
  reason: string;
  source: string;
}

export interface SearchProgress {
  tries: number;
  elapsedMs: number;
  mode: SearchMode;
  lastReason: string;
}

export interface SearchResult {
  username: string | null;
  tries: number;
  elapsedMs: number;
  reason: string;
}

export const normalizeMode = (mode: unknown): SearchMode => {
  return mode === "balance" || mode === "strict" || mode === "beauty" ? mode : "turbo";
};

export const cleanUsername = (value: string): string => {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
};

export const isValidProfileUsername = (
  candidate: string,
  length: number,
  withDigits: boolean
): boolean => {
  const username = cleanUsername(candidate);
  if (username.length !== length) {
    return false;
  }
  if (!USERNAME_RE.test(username)) {
    return false;
  }
  if (withDigits && !/\d/.test(username)) {
    return false;
  }
  if (!withDigits && /\d/.test(username)) {
    return false;
  }
  if (RESERVED_PARTS.some((part) => username.includes(part))) {
    return false;
  }
  const compact = username.replace(/\d/g, "");
  if (compact.length >= 3 && /(.)\1\1/.test(compact)) {
    return false;
  }
  if (compact.length >= 4 && new Set(compact).size <= 2) {
    return false;
  }
  return true;
};

export const smartCandidate = (
  length: number,
  withDigits: boolean,
  beautyFirst = false
): string => {
  for (let i = 0; i < 500; i += 1) {
    const base = cleanUsername(randomItem(beautyFirst ? beautyRoots() : ROOTS));
    const candidate = fitExactLength(base, length, withDigits);
    if (candidate) {
      return candidate;
    }
  }
  return pronounceableCandidate(length, withDigits);
};

export const findAvailableUsername = async (
  telegram: Telegram,
  selection: SearchSelection,
  onProgress?: (progress: SearchProgress) => Promise<void> | void
): Promise<SearchResult> => {
  const mode = normalizeMode(selection.mode);
  const preset = modePresets[mode];
  const startedAt = Date.now();
  const deadline = startedAt + preset.timeLimitMs;
  const seen = new Set<string>();
  let tries = 0;
  let lastReason = "init";

  while (tries < preset.maxTries && Date.now() < deadline) {
    const batch: string[] = [];
    while (batch.length < preset.batch && tries + batch.length < preset.maxTries) {
      const candidate = smartCandidate(
        selection.length,
        selection.withDigits,
        mode === "beauty" || tries < preset.beautyTries
      );
      if (!seen.has(candidate)) {
        seen.add(candidate);
        batch.push(candidate);
      }
    }

    const parallel = preset.parallelChecks;
    for (let offset = 0; offset < batch.length; offset += parallel) {
      const slice = batch.slice(offset, offset + parallel);
      const settled = await Promise.allSettled(
        slice.map((candidate) => checkCandidate(telegram, candidate, selection))
      );
      tries += slice.length;

      for (const item of settled) {
        if (item.status === "fulfilled") {
          lastReason = item.value.reason;
          if (item.value.available) {
            return {
              username: item.value.username,
              tries,
              elapsedMs: Date.now() - startedAt,
              reason: item.value.reason
            };
          }
        } else {
          lastReason = "check_failed";
        }
      }
    }

    await onProgress?.({
      tries,
      elapsedMs: Date.now() - startedAt,
      mode,
      lastReason
    });
  }

  return {
    username: null,
    tries,
    elapsedMs: Date.now() - startedAt,
    reason: lastReason || "not_found"
  };
};

export const checkCandidate = async (
  telegram: Telegram,
  username: string,
  selection: SearchSelection
): Promise<CandidateCheck> => {
  const mode = normalizeMode(selection.mode);
  const preset = modePresets[mode];
  const normalized = cleanUsername(username);

  if (!isValidProfileUsername(normalized, selection.length, selection.withDigits)) {
    return verdict(normalized, false, "local_invalid", "local");
  }

  const timeoutMs = preset.networkTimeoutMs;
  const useFragment = preset.useFragment;

  const first = await runPublicAvailabilityChecks(telegram, normalized, timeoutMs, useFragment);
  if (!first.available) {
    return first;
  }

  await delay(FINAL_VERIFY_GAP_MS);

  const second = await runPublicAvailabilityChecks(telegram, normalized, timeoutMs, useFragment);
  if (!second.available) {
    return verdict(normalized, false, `confirm_failed:${second.reason}`, second.source);
  }

  return verdict(normalized, true, "available_double_verified", "final");
};

/** Один полный проход: Fragment → Bot API → t.me (при неоднозначности — не считаем свободным). */
const runPublicAvailabilityChecks = async (
  telegram: Telegram,
  username: string,
  timeoutMs: number,
  useFragment: boolean
): Promise<CandidateCheck> => {
  if (useFragment) {
    const fragmentCheck = await checkFragment(username, timeoutMs);
    if (!fragmentCheck.available) {
      return fragmentCheck;
    }
  }

  const telegramCheck = await checkTelegramBotApi(telegram, username);
  if (!telegramCheck.available) {
    return telegramCheck;
  }

  const tmeCheck = await checkTme(username, timeoutMs);
  if (!tmeCheck.available) {
    return tmeCheck;
  }

  return verdict(username, true, "pipeline_ok", "pipeline");
};

const checkTelegramBotApi = async (
  telegram: Telegram,
  username: string
): Promise<CandidateCheck> => {
  try {
    await telegram.getChat(`@${username}`);
    return verdict(username, false, "telegram_chat_exists", "telegram");
  } catch (error) {
    const message = errorMessage(error);
    if (message.includes("chat not found") || message.includes("username not found")) {
      return verdict(username, true, "telegram_not_found", "telegram");
    }
    if (
      message.includes("too many requests") ||
      message.includes("retry after") ||
      message.includes("429") ||
      message.includes("flood")
    ) {
      return verdict(username, false, "telegram_rate_limited", "telegram");
    }
    if (
      message.includes("username_invalid") ||
      message.includes("wrong username") ||
      message.includes("invalid username")
    ) {
      return verdict(username, false, "telegram_invalid", "telegram");
    }
    return verdict(username, false, "telegram_unverified", "telegram");
  }
};

const checkFragment = async (
  username: string,
  timeoutMs: number
): Promise<CandidateCheck> => {
  try {
    const response = await fetchText(`https://fragment.com/username/${username}`, timeoutMs);
    const low = normalizeHtml(response.text);
    const finalUrlLower = response.finalUrl.toLowerCase();

    // 404/410 = дефинитивно свободен на Fragment
    if (response.status === 404 || response.status === 410) {
      return verdict(username, true, "fragment_not_listed", "fragment");
    }

    // Проверяем, что это именно страница лота /username/{username}
    if (!isFragmentUsernameListingUrl(response.finalUrl, username)) {
      // Если редирект пошёл куда-то в другое место — тоже свободен
      if (response.status >= 300 && response.status < 400) {
        return verdict(username, true, "fragment_redirect_away", "fragment");
      }
      // Не 404 и не страница username — неоднозначно, не берём
      return verdict(
        username,
        false,
        "fragment_not_username_page",
        "fragment"
      );
    }

    // Явные признаки ЧТО-ТО там есть (лот, контакт, канал и т.п.)
    const occupiedMarkers = [
      "for sale",
      "on sale",
      "listed for sale",
      "sale price",
      "buy now",
      "make an offer",
      "available for purchase",
      "minimum bid",
      "place bid",
      "auction",
      "sold",
      "already taken",
      "this link is already taken",
      "unavailable",
      "owned by",
      "collectible username",
      "ton web 3.0 address",
      "subscribe to updates",
      "fragment collects",
      "service fee",
      "highest bid",
      "current bid",
      "place bid and start auction",
      "you will receive username",
      "receive username",
      "contact @",
      "channel @",
      "bot @",
      "private"
    ];

    if (occupiedMarkers.some((marker) => low.includes(marker))) {
      return verdict(username, false, "fragment_occupied_marker_found", "fragment");
    }

    // Маркеры, указывающие на НАСТОЯЩУЮ свободность (редко, но бывает)
    const freeMarkers = [
      "available",
      "not available",
      "username not found",
      "no results",
      "error"
    ];

    // Если есть явные маркеры "недоступно" + NOT занято чем-то — можно считать свободным
    const hasUnderstandableState = occupiedMarkers.some((m) => low.includes(m)) ||
                                   freeMarkers.some((m) => low.includes(m));

    if (!hasUnderstandableState) {
      // Неопределённое состояние — fail-closed, не даём ник
      return verdict(
        username,
        false,
        "fragment_ambiguous_state",
        "fragment"
      );
    }

    // Если дошли сюда — значит нет явных маркеров занятости
    return verdict(username, true, "fragment_appears_free", "fragment");

  } catch (error) {
    // При ошибке сети — не берём, слишком рискованно
    return verdict(username, false, "fragment_network_error", "fragment");
  }
};

/** true, если URL — именно страница /username/{username} на fragment.com. */
const isFragmentUsernameListingUrl = (finalUrl: string, username: string): boolean => {
  try {
    const u = new URL(finalUrl);
    if (!u.hostname.toLowerCase().endsWith("fragment.com")) {
      return false;
    }
    const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    
    // Проверяем точную структуру: /username/{ник}
    if (parts.length !== 2 || parts[0] !== "username") {
      return false;
    }
    
    // Убеждаемся, что это именно наш username
    return cleanUsername(parts[1] ?? "") === cleanUsername(username);
  } catch {
    return false;
  }
};

const checkTme = async (username: string, timeoutMs: number): Promise<CandidateCheck> => {
  try {
    const response = await fetchText(`https://t.me/${username}`, timeoutMs);
    const low = normalizeHtml(response.text);
    
    // Маркеры, что профиль СУЩЕСТВУЕТ
    const occupiedMarkers = [
      "tgme_page_title",
      "tgme_page_extra",
      "tgme_page_description",
      "tgme_page_photo",
      "tgme_page_action",
      "tgme_username_link",
      "tgme_widget_message_user",
      "peer_photo",
      "tgme_widget_message_bubble",
      "view in telegram",
      "open in telegram",
      "if you have telegram, you can contact",
      "joined",
      "subscribers",
      "online"
    ];
    
    // Маркеры, что его НЕ существует
    const freeMarkers = [
      "username not found",
      "sorry, this username doesn't exist",
      "sorry, this username doesn&#039;t exist",
      "this username doesn't exist"
    ];

    // Если чётко сказано, что не существует
    if (response.status === 404 || freeMarkers.some((marker) => low.includes(marker))) {
      return verdict(username, true, "tme_not_found", "tme");
    }

    // Если есть явные маркеры существования профиля
    if (response.status === 200 && occupiedMarkers.some((marker) => low.includes(marker))) {
      return verdict(username, false, "tme_profile_exists", "tme");
    }

    // Статус 200, но без четких маркеров — может быть ботом или чем-то ещё
    // Fail-closed: не берём
    if (response.status === 200) {
      return verdict(username, false, "tme_uncertain_200", "tme");
    }

    // Остальные коды ошибок — не берём
    if (response.status >= 200 && response.status < 500) {
      return verdict(username, false, `tme_unknown_http_${response.status}`, "tme");
    }
    
    return verdict(username, false, `tme_http_${response.status}`, "tme");
  } catch {
    return verdict(username, false, "tme_network_error", "tme");
  }
};

const fitExactLength = (
  candidate: string,
  length: number,
  withDigits: boolean
): string | null => {
  let username = candidate;
  if (username.length < length) {
    const needed = length - username.length;
    const tails = TAILS_BY_LENGTH[needed] ?? [];
    username += tails.length > 0 ? randomItem(tails) : pronounceableSuffix(needed, withDigits);
  }
  if (username.length > length) {
    username = username.slice(0, length);
  }
  if (withDigits && length >= 5 && !/\d/.test(username)) {
    username = `${username.slice(0, -1)}${randomItem("23456789".split(""))}`;
  }
  username = cleanUsername(username);
  return isValidProfileUsername(username, length, withDigits) ? username : null;
};

const pronounceableCandidate = (length: number, withDigits: boolean): string => {
  let value = randomItem(CONSONANTS.split(""));
  while (value.length < length) {
    const alphabet = VOWELS.includes(value.at(-1) ?? "") ? CONSONANTS : VOWELS;
    value += randomItem(alphabet.split(""));
  }
  if (withDigits && length >= 5 && !/\d/.test(value)) {
    value = `${value.slice(0, -1)}${randomItem("23456789".split(""))}`;
  }
  return value.slice(0, length);
};

const pronounceableSuffix = (length: number, withDigits: boolean): string => {
  return pronounceableCandidate(length, withDigits).slice(0, length);
};

const beautyRoots = (): string[] => [
  "aura",
  "luna",
  "miko",
  "yuki",
  "sora",
  "lumi",
  "nova",
  "mira",
  "soft",
  "moon",
  "star",
  "dream",
  "honey",
  "pearl",
  "milky",
  "velvet",
  ...ROOTS
];

const randomItem = <T>(items: T[]): T => {
  return items[Math.floor(Math.random() * items.length)] as T;
};

const verdict = (
  username: string,
  available: boolean,
  reason: string,
  source: string
): CandidateCheck => ({
  username,
  available,
  reason,
  source
});

const fetchText = async (
  url: string,
  timeoutMs: number
): Promise<{ status: number; finalUrl: string; text: string }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 NexaSearchNode/1.0",
        "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Cache-Control": "no-cache"
      }
    });
    return {
      status: response.status,
      finalUrl: response.url,
      text: await response.text()
    };
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeHtml = (text: string): string => {
  return text.replace(/\s+/g, " ").toLowerCase();
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  return String(error).toLowerCase();
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
