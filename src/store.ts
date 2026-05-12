import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type {
  FoundUsernameRecord,
  PaymentRecord,
  SearchMode,
  SearchSelection,
  StatsSnapshot,
  StoreData,
  UserRecord
} from "./types.js";

export const now = (): number => Math.floor(Date.now() / 1000);

const defaultSearch: SearchSelection = {
  length: 6,
  withDigits: false,
  mode: "turbo"
};

const emptyStore = (): StoreData => ({
  users: {},
  found: [],
  payments: []
});

export class JsonStore {
  private data: StoreData;

  constructor(private readonly filePath = config.dataPath) {
    this.data = this.load();
  }

  ensureUser(input: {
    userId: number;
    firstName?: string;
    username?: string;
    refBy?: number | null;
  }): { user: UserRecord; created: boolean } {
    const key = String(input.userId);
    const existing = this.data.users[key];
    if (existing) {
      existing.firstName = input.firstName ?? existing.firstName;
      existing.username = input.username ?? existing.username;
      existing.search = { ...defaultSearch, ...existing.search };
      this.save();
      return { user: existing, created: false };
    }

    const ts = now();
    const user: UserRecord = {
      userId: input.userId,
      firstName: input.firstName ?? "",
      username: input.username ?? "",
      refBy: input.refBy ?? null,
      attempts: config.freeAttempts,
      totalReferrals: 0,
      premiumUntil: 0,
      isBanned: false,
      lastMessageId: null,
      lastSearchAt: 0,
      registeredAt: ts,
      lastRestoreAt: ts,
      search: { ...defaultSearch }
    };
    this.data.users[key] = user;
    this.save();
    return { user, created: true };
  }

  getUser(userId: number): UserRecord | undefined {
    return this.data.users[String(userId)];
  }

  updateUser(userId: number, patch: Partial<UserRecord>): UserRecord | undefined {
    const user = this.getUser(userId);
    if (!user) {
      return undefined;
    }
    Object.assign(user, patch);
    this.save();
    return user;
  }

  updateSearch(userId: number, search: Partial<SearchSelection>): UserRecord | undefined {
    const user = this.getUser(userId);
    if (!user) {
      return undefined;
    }
    user.search = { ...defaultSearch, ...user.search, ...search };
    this.save();
    return user;
  }

  saveLastMessage(userId: number, messageId: number | null): void {
    this.updateUser(userId, { lastMessageId: messageId });
  }

  restoreAttemptsIfNeeded(userId: number): number {
    const user = this.getUser(userId);
    if (!user) {
      return 0;
    }
    const ts = now();
    const elapsed = ts - (user.lastRestoreAt || user.registeredAt || ts);
    if (elapsed < 86400) {
      return 0;
    }
    const days = Math.max(1, Math.floor(elapsed / 86400));
    const amount = days * config.dailyRestoreAttempts;
    user.attempts += amount;
    user.lastRestoreAt = ts;
    this.save();
    return amount;
  }

  addAttempts(userId: number, amount: number): void {
    const user = this.getUser(userId);
    if (!user) {
      return;
    }
    user.attempts += amount;
    this.save();
  }

  useAttempt(userId: number): boolean {
    const user = this.getUser(userId);
    if (!user || user.attempts <= 0) {
      return false;
    }
    user.attempts -= 1;
    user.lastSearchAt = now();
    this.save();
    return true;
  }

  recordReferral(referrerId: number): void {
    const referrer = this.getUser(referrerId);
    if (!referrer) {
      return;
    }
    referrer.totalReferrals += 1;
    referrer.attempts += config.referralBonusAttempts;
    this.save();
  }

  isPremium(user: UserRecord | undefined): boolean {
    return Boolean(user && user.premiumUntil > now());
  }

  setPremiumSeconds(userId: number, seconds: number | null, replace = false): number {
    const user = this.getUser(userId);
    if (!user) {
      return 0;
    }
    const ts = now();
    const premiumUntil =
      seconds === null || seconds <= 0
        ? 4102444800
        : (replace ? ts : Math.max(ts, user.premiumUntil)) + seconds;
    user.premiumUntil = premiumUntil;
    this.save();
    return premiumUntil;
  }

  removePremium(userId: number): void {
    const user = this.getUser(userId);
    if (!user) {
      return;
    }
    user.premiumUntil = 0;
    this.save();
  }

  addFound(input: {
    userId: number;
    username: string;
    length: number;
    withDigits: boolean;
    mode: SearchMode;
  }): FoundUsernameRecord {
    const record: FoundUsernameRecord = {
      id: this.nextId(this.data.found),
      userId: input.userId,
      username: input.username,
      length: input.length,
      withDigits: input.withDigits,
      mode: input.mode,
      createdAt: now()
    };
    this.data.found.push(record);
    this.save();
    return record;
  }

  recentFound(userId: number, limit = 10): FoundUsernameRecord[] {
    return this.data.found
      .filter((item) => item.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  recentUsers(limit = 10): UserRecord[] {
    return Object.values(this.data.users)
      .sort((a, b) => b.registeredAt - a.registeredAt)
      .slice(0, limit);
  }

  recentFoundGlobal(limit = 10): FoundUsernameRecord[] {
    return [...this.data.found].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  addPayment(input: {
    userId: number;
    stars: number;
    days: number;
    chargeId: string;
  }): PaymentRecord {
    const record: PaymentRecord = {
      id: this.nextId(this.data.payments),
      userId: input.userId,
      stars: input.stars,
      days: input.days,
      chargeId: input.chargeId,
      createdAt: now()
    };
    this.data.payments.push(record);
    this.save();
    return record;
  }

  stats(): StatsSnapshot {
    const users = Object.values(this.data.users);
    return {
      users: users.length,
      premium: users.filter((user) => this.isPremium(user)).length,
      found: this.data.found.length,
      payments: this.data.payments.length,
      stars: this.data.payments.reduce((sum, payment) => sum + payment.stars, 0),
      banned: users.filter((user) => user.isBanned).length
    };
  }

  allActiveUserIds(): number[] {
    return Object.values(this.data.users)
      .filter((user) => !user.isBanned)
      .map((user) => user.userId);
  }

  private load(): StoreData {
    try {
      if (!fs.existsSync(this.filePath)) {
        return emptyStore();
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<StoreData>;
      return {
        users: parsed.users ?? {},
        found: parsed.found ?? [],
        payments: parsed.payments ?? []
      };
    } catch {
      return emptyStore();
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }

  private nextId(items: Array<{ id: number }>): number {
    return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  }
}
