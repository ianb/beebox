import type { StoredTabTransfer } from "../domain/tab-arrangement.js";
import { isRecord } from "../domain/is-record.js";

const STORAGE_KEY = "latestTabTransfer";
const SESSION_KEY = "tabTransferBrowserSession";

export async function browserSessionId(): Promise<string> {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  const existing: unknown = stored[SESSION_KEY];
  if (typeof existing === "string") return existing;
  const created = crypto.randomUUID();
  await chrome.storage.session.set({ [SESSION_KEY]: created });
  return created;
}

export async function loadTabTransfer(): Promise<StoredTabTransfer | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const value: unknown = stored[STORAGE_KEY];
  if (!isRecord(value) || value["version"] !== 1 || typeof value["browserSessionId"] !== "string") return null;
  // eslint-disable-next-line no-restricted-syntax -- chrome.storage is an untyped persistence boundary; writes are centralized below and the version is checked by consumers.
  const transfer = value as unknown as StoredTabTransfer;
  if (transfer.browserSessionId !== await browserSessionId()) {
    await clearTabTransfer();
    return null;
  }
  return transfer;
}

export async function saveTabTransfer(transfer: StoredTabTransfer): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: transfer });
}

export async function clearTabTransfer(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}
