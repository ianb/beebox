import { normalizeConfig, type ClerkConfig } from "../domain/config.js";

const CONFIG_KEY = "clerkConfig";
// Dropbox-relay era storage; cleared the first time the new config loads.
const LEGACY_KEYS = ["credentials", "syncState", "pendingActions"];

export async function loadConfig(): Promise<ClerkConfig> {
  const legacy = await chrome.storage.local.get(LEGACY_KEYS);
  if (Object.keys(legacy).length > 0) {
    await chrome.storage.local.remove(LEGACY_KEYS);
  }
  const result = await chrome.storage.local.get(CONFIG_KEY);
  return normalizeConfig(result[CONFIG_KEY]);
}

export async function saveConfig(config: ClerkConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}
