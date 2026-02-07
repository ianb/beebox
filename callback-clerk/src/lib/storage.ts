export interface StoredCredentials {
  workerUrl: string;
  apiKey: string;
  channelKey: string; // base64-encoded AES key
  channelId: string;
}

export interface SyncState {
  lastSyncAt: string | null;
  tabCount: number | null;
  lastMessageId: string | null;
}

export async function getCredentials(): Promise<StoredCredentials | null> {
  const { credentials } = await chrome.storage.local.get("credentials");
  return credentials ?? null;
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  await chrome.storage.local.set({ credentials: creds });
}

export async function clearCredentials(): Promise<void> {
  await chrome.storage.local.remove(["credentials", "syncState"]);
}

export async function getSyncState(): Promise<SyncState | null> {
  const { syncState } = await chrome.storage.local.get("syncState");
  return syncState ?? null;
}

export async function saveSyncState(state: SyncState): Promise<void> {
  await chrome.storage.local.set({ syncState: state });
}
