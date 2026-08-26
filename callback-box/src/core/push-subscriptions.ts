/**
 * Server-level Web Push subscription store.
 *
 * A browser PushSubscription is bound to its service-worker registration, not
 * to a box — and one SW registration controls every box under the origin (see
 * docs/plans/web-push-notifications.md). So subscriptions are stored ONCE,
 * server-wide, keyed by endpoint, with each record carrying the set of box
 * slugs that endpoint opted into. This lives outside any box (never committed,
 * never in box history): `~/.local/share/cb/push-subscriptions.json`, the same
 * server-state level as the scheduler log dir.
 *
 * The API server (subscribe) and the finalize/scheduler process (prune on
 * send) both mutate it from different processes, so every read-modify-write
 * goes through the shared file-lock primitive.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../lib/atomic-write.js";
import { CB_STATE_DIR } from "../lib/state-dir.js";
import { acquireLock, releaseLock, requestScopedLock, LockHeldError } from "../lib/file-lock.js";
import type { StoredPushSubscription, PushSubscriptionKeys } from "../services/push.js";
import { errnoCode } from "../lib/error-guards.js";

interface SubscriptionRecord {
  keys: PushSubscriptionKeys;
  /** Box slugs this endpoint wants notifications for. */
  boxes: string[];
  createdAt: string;
  ua?: string | undefined;
}

/** Endpoint → record. */
type SubscriptionStore = Record<string, SubscriptionRecord>;

const subscriptionRecordSchema = z.object({
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
  boxes: z.array(z.string()),
  createdAt: z.string(),
  ua: z.string().optional(),
});

const subscriptionStoreSchema = z.record(z.string(), subscriptionRecordSchema);

/**
 * Thrown when the on-disk store fails to parse or validate. Distinct from
 * "no store yet" (ENOENT, treated as an empty store): a corrupt store must
 * ABORT the caller's read-modify-write rather than let it silently overwrite
 * the corruption with a freshly-empty store, destroying every subscription
 * (Track D.3).
 */
export class PushStoreCorruptError extends Error {
  readonly storePath: string;
  constructor(filePath: string, opts: { cause: unknown }) {
    const reason = opts.cause instanceof Error ? opts.cause.message : String(opts.cause);
    super(
      `Push subscription store at ${filePath} is corrupt: ${reason}. ` +
        "Refusing to load — fix or remove the file by hand; a stale write is not applied over it.",
      { cause: opts.cause }
    );
    this.name = "PushStoreCorruptError";
    this.storePath = filePath;
  }
}

/**
 * Server-state dir. Overridable via CALLBACK_PUSH_STORE_DIR so tests (and the
 * isolated router) don't touch the real home directory.
 */
function storeDir(): string {
  return process.env.CALLBACK_PUSH_STORE_DIR ?? CB_STATE_DIR;
}

function storePath(): string {
  return path.join(storeDir(), "push-subscriptions.json");
}

async function loadStore(): Promise<SubscriptionStore> {
  let raw: string;
  try {
    raw = await fs.readFile(storePath(), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") {
      return {};
    }
    // Not "missing" — some other read failure (permissions, I/O error). Treat
    // the same as corruption: loud and load-aborting, not a silent empty store.
    throw new PushStoreCorruptError(storePath(), { cause: e });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new PushStoreCorruptError(storePath(), { cause: e });
  }

  const result = subscriptionStoreSchema.safeParse(json);
  if (!result.success) {
    throw new PushStoreCorruptError(storePath(), { cause: result.error });
  }
  return result.data;
}

/**
 * Replace the store crash-safely (temp file + fsync + atomic rename). `loadStore`
 * already refuses to read a corrupt file rather than overwrite it, which turns a
 * torn write into a wedged store — so the write half must never be able to
 * produce one. A plain `writeFile` truncates before it streams; a kill in that
 * window would leave a half-file where every subscription used to be.
 */
async function saveStore(store: SubscriptionStore): Promise<void> {
  await writeFileAtomic(storePath(), { content: `${JSON.stringify(store, null, 2)}\n` });
}

const LOCK_RETRIES = 50;
const LOCK_RETRY_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a read-modify-write under the cross-process lock, retrying briefly while
 * another process holds it (contention is rare and each critical section is a
 * single small file write).
 */
async function withStoreLock<T>(fn: (store: SubscriptionStore) => Promise<T> | T): Promise<T> {
  await fs.mkdir(storeDir(), { recursive: true });
  const lockPath = `${storePath()}.lock`;
  // Request-scoped: a short critical section whose callers fail fast (~5 s
  // retry budget), so a crashed holder must clear in seconds, not minutes.
  const lock = requestScopedLock(lockPath);
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      await acquireLock(lock, { purpose: "push-subscriptions" });
    } catch (e) {
      if (e instanceof LockHeldError) {
        await delay(LOCK_RETRY_MS);
        continue;
      }
      throw e;
    }
    try {
      const store = await loadStore();
      const result = await fn(store);
      return result;
    } finally {
      await releaseLock(lock);
    }
  }
  throw new PushStoreLockError(lockPath);
}

/** Thrown when the subscription store stays locked past the retry budget. */
class PushStoreLockError extends Error {
  readonly lockPath: string;
  constructor(lockPath: string) {
    super("push-subscriptions store lock could not be acquired");
    this.name = "PushStoreLockError";
    this.lockPath = lockPath;
  }
}

/**
 * Record (or refresh) a subscription and opt its endpoint into `boxSlug`.
 * Idempotent on the endpoint: re-subscribing the same browser updates the keys
 * and adds the box rather than duplicating.
 */
export async function addSubscription(opts: {
  boxSlug: string;
  subscription: StoredPushSubscription;
  ua?: string | undefined;
  now: Date;
}): Promise<void> {
  const { boxSlug, subscription, ua, now } = opts;
  await withStoreLock(async (store) => {
    const existing = store[subscription.endpoint];
    if (existing) {
      existing.keys = subscription.keys;
      if (!existing.boxes.includes(boxSlug)) existing.boxes.push(boxSlug);
      if (ua) existing.ua = ua;
    } else {
      store[subscription.endpoint] = {
        keys: subscription.keys,
        boxes: [boxSlug],
        createdAt: now.toISOString(),
        ...(ua ? { ua } : {}),
      };
    }
    await saveStore(store);
  });
}

/** Drop an endpoint entirely (gone on send, or an explicit server-side disable). */
export async function removeEndpoint(endpoint: string): Promise<void> {
  await withStoreLock(async (store) => {
    if (endpoint in store) {
      delete store[endpoint];
      await saveStore(store);
    }
  });
}

/** Remove an endpoint from one box's opt-in list; drop the record if no boxes remain. */
export async function removeEndpointFromBox(opts: { boxSlug: string; endpoint: string }): Promise<void> {
  const { boxSlug, endpoint } = opts;
  await withStoreLock(async (store) => {
    const record = store[endpoint];
    if (!record) return;
    record.boxes = record.boxes.filter((b) => b !== boxSlug);
    if (record.boxes.length === 0) delete store[endpoint];
    await saveStore(store);
  });
}

/**
 * Transfer an endpoint's box opt-ins to a rotated subscription
 * (pushsubscriptionchange). If the old endpoint is unknown, the new one is
 * recorded with no boxes — harmless; the next page visit re-subscribes it.
 */
export async function transferEndpoint(opts: {
  oldEndpoint: string | null;
  subscription: StoredPushSubscription;
  now: Date;
}): Promise<void> {
  const { oldEndpoint, subscription, now } = opts;
  await withStoreLock(async (store) => {
    const old = oldEndpoint ? store[oldEndpoint] : undefined;
    const boxes = old ? old.boxes : [];
    if (oldEndpoint && oldEndpoint !== subscription.endpoint) delete store[oldEndpoint];
    store[subscription.endpoint] = {
      keys: subscription.keys,
      boxes,
      createdAt: old?.createdAt ?? now.toISOString(),
      ...(old?.ua ? { ua: old.ua } : {}),
    };
    await saveStore(store);
  });
}

/** All subscriptions opted into a given box. Read-only; no lock needed. */
export async function endpointsForBox(boxSlug: string): Promise<StoredPushSubscription[]> {
  const store = await loadStore();
  const result: StoredPushSubscription[] = [];
  for (const [endpoint, record] of Object.entries(store)) {
    if (record.boxes.includes(boxSlug)) {
      result.push({ endpoint, keys: record.keys });
    }
  }
  return result;
}
