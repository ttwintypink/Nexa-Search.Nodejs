export type SearchMode = "turbo" | "balance" | "strict" | "beauty";

export interface SearchSelection {
  length: number;
  withDigits: boolean;
  mode: SearchMode;
}

export interface UserRecord {
  userId: number;
  firstName: string;
  username: string;
  refBy: number | null;
  attempts: number;
  totalReferrals: number;
  premiumUntil: number;
  isBanned: boolean;
  lastMessageId: number | null;
  lastSearchAt: number;
  registeredAt: number;
  lastRestoreAt: number;
  search: SearchSelection;
}

export interface FoundUsernameRecord {
  id: number;
  userId: number;
  username: string;
  length: number;
  withDigits: boolean;
  mode: SearchMode;
  createdAt: number;
}

export interface PaymentRecord {
  id: number;
  userId: number;
  stars: number;
  days: number;
  chargeId: string;
  createdAt: number;
}

export interface StoreData {
  users: Record<string, UserRecord>;
  found: FoundUsernameRecord[];
  payments: PaymentRecord[];
}

export interface StatsSnapshot {
  users: number;
  premium: number;
  found: number;
  payments: number;
  stars: number;
  banned: number;
}
