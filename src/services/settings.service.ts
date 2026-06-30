import { redis } from "../config/redis.js";

interface UserSettings {
  theme: "light" | "dark" | "system";
  language: string;
  currency: string;
  emailNotifications: boolean;
  smsNotifications: boolean;
  pushNotifications: boolean;
}

const defaultSettings: UserSettings = {
  theme: "system",
  language: "en",
  currency: "KES",
  emailNotifications: true,
  smsNotifications: true,
  pushNotifications: true,
};

function settingsKey(userId: string) {
  return `settings:${userId}`;
}

export async function get(userId: string): Promise<UserSettings> {
  const stored = await redis.get(settingsKey(userId));
  if (stored) return { ...defaultSettings, ...JSON.parse(stored) };
  return defaultSettings;
}

export async function update(
  userId: string,
  patch: Partial<UserSettings>
): Promise<UserSettings> {
  const current = await get(userId);
  const updated = { ...current, ...patch };
  await redis.set(settingsKey(userId), JSON.stringify(updated));
  return updated;
}
