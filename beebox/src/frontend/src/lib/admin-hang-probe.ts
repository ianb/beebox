/** Temporary, content-free breadcrumbs for the intermittent admin/settings freeze.
 * Remove this module and its three call sites after field diagnosis.
 */
import { z } from "zod";
import { getApiBase } from "../api-core";
import { trpcClient } from "./trpc";

const KEY = "bbx-admin-hang-probe-v1";
const PENDING_KEY = "bbx-admin-hang-probe-pending-v1";
const STALE_MS = 4_000;
const MAX_AGE_MS = 60 * 60_000;
const MAX_EVENTS = 8;
const SAMPLE_AFTER_ENTRIES = 200;

type Page = "admin" | "settings";
interface Breadcrumb { kind: "enter" | "query"; name: string; ms: number }
interface Record {
  apiBase: string;
  page: Page;
  startedAt: number;
  heartbeatAt: number;
  entries: number;
  mounted: boolean;
  events: Breadcrumb[];
  attempts: number;
}

const active = new Map<Page, Record>();
const mounts = new Map<Page, number>();
const pages = ["admin", "settings"] as const;
const keyFor = (page: Page, base: string) => `${KEY}:${encodeURIComponent(base)}:${page}`;
const pendingKeyFor = (page: Page, base: string) => `${PENDING_KEY}:${encodeURIComponent(base)}:${page}`;

const recordSchema = z.object({
  apiBase: z.string(),
  page: z.enum(["admin", "settings"]),
  startedAt: z.number(),
  heartbeatAt: z.number(),
  entries: z.number(),
  mounted: z.boolean(),
  attempts: z.number(),
  events: z.array(z.object({ kind: z.enum(["enter", "query"]), name: z.string(), ms: z.number() })).max(MAX_EVENTS),
});

function read(key: string): Record | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    const result = recordSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch (_error) {
    return null;
  }
}

function save(row: Record, key: string): void {
  try { localStorage.setItem(key, JSON.stringify(row)); } catch (_error) { /* storage may be disabled */ }
}

function discard(key: string): void {
  try { localStorage.removeItem(key); } catch (_error) { /* storage may be disabled */ }
}

/** Called once at app startup. A successful send is the only destructive ack. */
export function reportPreviousAdminHang(): void {
  for (const page of pages) reportPrevious(page);
}

function reportPrevious(page: Page): void {
  const base = getApiBase();
  const key = keyFor(page, base);
  const pendingKey = pendingKeyFor(page, base);
  const pending = read(pendingKey);
  const row = pending ?? read(key);
  if (!row) return;
  if (row.page !== page || row.apiBase !== getApiBase()) return;
  if (!pending) discard(key);
  const age = Date.now() - row.heartbeatAt;
  if (age < STALE_MS || age > MAX_AGE_MS || row.attempts >= 2) {
    discard(pendingKey);
    return;
  }
  row.attempts++;
  save(row, pendingKey);
  // Reconstruct from fixed names only; never transmit stored strings verbatim.
  const events = row.events.slice(-MAX_EVENTS).filter(event =>
    /^[A-Za-z][\d.A-Za-z]{0,60}$/.test(event.name) && Number.isFinite(event.ms),
  ).map(event => `${event.kind}:${event.name}@${Math.max(0, Math.round(event.ms))}`).join(",");
  const message = `[admin-hang-probe] possible freeze page=${row.page} staleMs=${Math.round(age)} entries=${Math.min(100_000, Math.max(0, row.entries))} mounted=${row.mounted ? 1 : 0} events=${events}`;
  void trpcClient.debugLog.submit.mutate({ entries: [{ level: "error", message }] })
    .then(() => discard(pendingKey))
    .catch(() => { /* retry on the next load, at most twice */ });
}

/** Persist a page marker before descendant render can synchronously lock up. */
export function prepareAdminHangProbe(page: Page): void {
  if (active.has(page)) return;
  const now = Date.now();
  const row: Record = { apiBase: getApiBase(), page, startedAt: now, heartbeatAt: now, entries: 0, mounted: false, events: [], attempts: 0 };
  active.set(page, row);
  save(row, keyFor(page, row.apiBase));
}

export function startAdminHangProbe(page: Page): () => void {
  prepareAdminHangProbe(page);
  const current = active.get(page);
  if (current) { current.mounted = true; save(current, keyFor(page, current.apiBase)); }
  const count = mounts.get(page) ?? 0;
  mounts.set(page, count + 1);

  const timer = setInterval(() => {
    const row = active.get(page);
    if (!row || document.visibilityState !== "visible") return;
    row.heartbeatAt = Date.now();
    save(row, keyFor(page, row.apiBase));
  }, 1000);
  const pause = () => {
    const row = active.get(page);
    if (!row) return;
    active.delete(page);
    if (Date.now() - row.heartbeatAt >= STALE_MS) {
      if (row.apiBase === getApiBase()) reportPrevious(page);
    } else discard(keyFor(page, row.apiBase));
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") pause();
    else { prepareAdminHangProbe(page); const resumed = active.get(page); if (resumed) { resumed.mounted = true; save(resumed, keyFor(page, resumed.apiBase)); } }
  };
  const onPageShow = () => { prepareAdminHangProbe(page); const resumed = active.get(page); if (resumed) { resumed.mounted = true; save(resumed, keyFor(page, resumed.apiBase)); } };
  window.addEventListener("pagehide", pause);
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("visibilitychange", onVisibility);

  const release = (releasedPage: Page) => {
    const left = (mounts.get(releasedPage) ?? 1) - 1;
    clearInterval(timer);
    window.removeEventListener("pagehide", pause);
    window.removeEventListener("pageshow", onPageShow);
    document.removeEventListener("visibilitychange", onVisibility);
    if (left > 0) { mounts.set(releasedPage, left); return; }
    mounts.delete(releasedPage);
    pause();
  };
  return () => release(page);
}

export function recordAdminProbeEnter(page: Page, name: string): void {
  const row = active.get(page);
  if (!row) return;
  row.entries++;
  if (row.entries > SAMPLE_AFTER_ENTRIES && row.entries % 100 !== 0) return;
  row.events.push({ kind: "enter", name, ms: Date.now() - row.startedAt });
  row.events = row.events.slice(-MAX_EVENTS);
  save(row, keyFor(page, row.apiBase));
}

export function recordAdminProbeQuery(page: Page, name: string): void {
  const row = active.get(page);
  if (!row) return;
  const last = row.events.at(-1);
  if (last?.kind === "query" && last.name === name && Date.now() - row.startedAt - last.ms < 20) return;
  row.events.push({ kind: "query", name, ms: Date.now() - row.startedAt });
  row.events = row.events.slice(-MAX_EVENTS);
  save(row, keyFor(page, row.apiBase));
}
