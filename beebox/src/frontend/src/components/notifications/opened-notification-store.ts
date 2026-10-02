/**
 * The notification a `chat:new` tap opened, waiting to ride along with the
 * first message of the new conversation (docs/implemented-plans/notifications.md, Track A).
 *
 * The chat's banner (`ChatNotificationBanner`) sets it once the intent loads
 * and clears it when it unmounts; the send funnel reads it into the message's
 * witness and clears it after the first send. Module-level because the
 * composer is the app's single conversation runtime. Framework-free, bound to
 * React with `useSyncExternalStore`.
 */

export interface OpenedNotification {
  id: string;
  title: string;
  body: string;
  /** When the notification was sent (the intent's log timestamp). */
  at: string;
}

let current: OpenedNotification | null = null;
const listeners = new Set<() => void>();

function publish(next: OpenedNotification | null): void {
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeOpenedNotification(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOpenedNotification(): OpenedNotification | null {
  return current;
}

export function setOpenedNotification(notification: OpenedNotification): void {
  publish(notification);
}

/** Clear it, or only when it is still this notification (a later one is left alone). */
export function clearOpenedNotification(opts?: { id: string }): void {
  if (current === null || (opts !== undefined && current.id !== opts.id)) return;
  publish(null);
}
