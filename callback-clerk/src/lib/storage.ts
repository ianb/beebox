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

export interface PendingAction {
  id: string;
  type: string;
  url: string;
  title: string;
  message: string;
  receivedAt: string;
}

export async function getPendingActions(): Promise<PendingAction[]> {
  const { pendingActions } = await chrome.storage.local.get("pendingActions");
  return pendingActions ?? [];
}

export async function savePendingActions(actions: PendingAction[]): Promise<void> {
  await chrome.storage.local.set({ pendingActions: actions });
}

export async function removePendingAction(id: string): Promise<void> {
  const actions = await getPendingActions();
  await savePendingActions(actions.filter((a) => a.id !== id));
}
