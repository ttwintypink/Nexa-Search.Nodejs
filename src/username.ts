import type { Telegram } from "telegraf";
import type { SearchMode, SearchSelection } from "./types.js";

const USERNAME_RE = /^[a-z][a-z0-9]{4,31}$/;
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
    maxTries: number;
    beautyTries: number;
    timeLimitMs: number;
    networkTimeoutMs: number;
    strict: boolean;
    useTme: boolean;
    useFragment: boolean;
  }
> = {
  turbo: {
    title: "⚡ Турбо",
    short: "быстрый режим без тяжёлой t.me-проверки",
    batch: 12,
    maxTries: 1500,
    beautyTries: 6,
    timeLimitMs: 12_000,
    networkTimeoutMs: 1_800,
    strict: false,
    useTme: false,
    useFragment: true
  },
  balance: {
    title: "✅ Баланс",
    short: "быстро + Fragment + Telegram Bot API",
    batch: 10,
    maxTries: 2500,
    beautyTries: 16,
    timeLimitMs: 18_000,
    networkTimeoutMs: 2_500,
    strict: true,
    useTme: false,
    useFragment: true
  },
  strict: {
    title: "🛡 Строгий",
    short: "осторожная проверка, но дольше",
    batch: 8,
    maxTries: 4000,
    beautyTries: 32,
    timeLimitMs: 25_000,
    networkTimeoutMs: 3_500,
    strict: true,
    useTme: true,
    useFragment: true
  },
  beauty: {
    title: "💎 Красивый",
    short: "красивые варианты + аккуратная проверка",
    batch: 8,
    maxTries: 3500,
    beautyTries: 80,
    timeLimitMs: 25_000,
    networkTimeoutMs: 3_000,
    strict: true,
    useTme: true,
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

    const settled = await Promise.allSettled(
      batch.map((candidate) => checkCandidate(telegram, candidate, selection))
    );
    tries += batch.length;

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

  // Сначала Fragment: так мы быстрее отсекаем collectible/продаваемые username
  // и меньше долбим Telegram Bot API.
  if (preset.useFragment) {
    const fragmentCheck = await checkFragment(normalized, preset.strict, preset.networkTimeoutMs);
    if (!fragmentCheck.available) {
      return fragmentCheck;
    }
  }

  const telegramCheck = await checkTelegramBotApi(telegram, normalized);
  if (!telegramCheck.available) {
    return telegramCheck;
  }

  // t.me оставлен только для строгих режимов: он самый медленный и часто тормозит BotHost.
  if (preset.useTme) {
    const tmeCheck = await checkTme(normalized, preset.strict, preset.networkTimeoutMs);
    if (!tmeCheck.available) {
      return tmeCheck;
    }
  }

  return verdict(normalized, true, "available_after_public_checks", "final");
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
  strict: boolean,
  timeoutMs: number
): Promise<CandidateCheck> => {
  try {
    const response = await fetchText(`https://fragment.com/username/${username}`, timeoutMs);
    const low = normalizeHtml(response.text);
    const finalUrl = response.finalUrl.toLowerCase();

    if (response.status === 404 || response.status === 410) {
      return verdict(username, true, "fragment_not_listed", "fragment");
    }

    const exactMarkers = [
      `/username/${username}`,
      `@${username}`,
      `${username}.t.me`,
      `>${username}<`,
      `username/${username}`,
      `${username}</h1`,
      `${username}</title`
    ];
    const belongsToUsername =
      exactMarkers.some((marker) => low.includes(marker)) ||
      finalUrl.includes(`/username/${username}`);

    const busyMarkers = [
      "for sale",
      "on sale",
      "listed for sale",
      "sale price",
      "buy now",
      "make an offer",
      "available",
      "available for purchase",
      "minimum bid",
      "place bid",
      "highest bid",
      "auction",
      "sold",
      "taken",
      "unavailable",
      "owned by",
      "collectible username",
      "ton web 3.0 address",
      "status"
    ];

    if (belongsToUsername && busyMarkers.some((marker) => low.includes(marker))) {
      return verdict(username, false, "fragment_card_exists", "fragment");
    }
    if (belongsToUsername && response.status === 200) {
      return verdict(username, false, "fragment_page_exists", "fragment");
    }
    if (response.status >= 200 && response.status < 500 && !belongsToUsername) {
      return verdict(username, true, `fragment_no_exact_card_http_${response.status}`, "fragment");
    }
    return verdict(username, !strict, "fragment_unverified", "fragment");
  } catch {
    return verdict(username, !strict, "fragment_network_error", "fragment");
  }
};

const checkTme = async (
  username: string,
  strict: boolean,
  timeoutMs: number
): Promise<CandidateCheck> => {
  try {
    const response = await fetchText(`https://t.me/${username}`, timeoutMs);
    const low = normalizeHtml(response.text);
    const occupiedMarkers = [
      "tgme_page_title",
      "tgme_page_extra",
      "tgme_page_description",
      "view in telegram",
      "open in telegram",
      "if you have telegram, you can contact"
    ];
    const freeMarkers = ["username not found", "not found"];

    if (response.status === 404 || freeMarkers.some((marker) => low.includes(marker))) {
      return verdict(username, true, "tme_not_found", "tme");
    }
    if (response.status === 200 && occupiedMarkers.some((marker) => low.includes(marker))) {
      return verdict(username, false, "tme_profile_exists", "tme");
    }
    if (response.status >= 200 && response.status < 500) {
      return verdict(username, !strict, `tme_unknown_http_${response.status}`, "tme");
    }
    return verdict(username, false, `tme_http_${response.status}`, "tme");
  } catch {
    return verdict(username, !strict, "tme_network_error", "tme");
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
  if (withDigits && length >= 5 && Math.random() < 0.45) {
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
  if (withDigits && length >= 5) {
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
