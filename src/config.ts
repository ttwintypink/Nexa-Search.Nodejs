import "dotenv/config";
import path from "node:path";

const numberFromEnv = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const idSetFromEnv = (key: string, fallback: number[] = []): Set<number> => {
  const ids = new Set<number>(fallback);
  for (const part of (process.env[key] ?? "").split(",")) {
    const id = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(id)) {
      ids.add(id);
    }
  }
  return ids;
};

export const premiumPrices: Record<number, number> = {
  1: numberFromEnv("PRICE_PREMIUM_1_DAY", 99),
  7: numberFromEnv("PRICE_PREMIUM_7_DAYS", 349),
  14: numberFromEnv("PRICE_PREMIUM_14_DAYS", 599),
  31: numberFromEnv("PRICE_PREMIUM_31_DAYS", 999),
  60: numberFromEnv("PRICE_PREMIUM_60_DAYS", 1699),
  180: numberFromEnv("PRICE_PREMIUM_180_DAYS", 3499),
  365: numberFromEnv("PRICE_PREMIUM_365_DAYS", 5999)
};

export const config = {
  botToken: (process.env.BOT_TOKEN ?? "").trim(),
  appName: (process.env.APP_NAME ?? "Nexa Search").trim(),
  premiumName: (process.env.PREMIUM_NAME ?? "Nexa Premium").trim(),
  supportUsername: (process.env.SUPPORT_USERNAME ?? "").trim().replace(/^@/, ""),
  adminIds: idSetFromEnv("ADMIN_IDS"),
  premiumIds: idSetFromEnv("PREMIUM_IDS"),
  freeAttempts: numberFromEnv("FREE_ATTEMPTS", 3),
  dailyRestoreAttempts: numberFromEnv("DAILY_RESTORE_ATTEMPTS", 4),
  referralBonusAttempts: numberFromEnv("REFERRAL_BONUS_ATTEMPTS", 2),
  searchCooldownSeconds: numberFromEnv("SEARCH_COOLDOWN_SECONDS", 3),
  dataPath: path.resolve(process.env.DATA_PATH ?? "./data/store.json")
};

export const requireBotToken = (): string => {
  if (!config.botToken || config.botToken === "PASTE_YOUR_BOT_TOKEN_HERE") {
    throw new Error("Set BOT_TOKEN as a hosting environment variable before starting the bot.");
  }
  return config.botToken;
};

export const isAdmin = (userId: number | undefined): boolean => {
  return typeof userId === "number" && config.adminIds.has(userId);
};

export const premiumPriceForDays = (days: number): number => {
  return premiumPrices[days] ?? premiumPrices[31];
};
