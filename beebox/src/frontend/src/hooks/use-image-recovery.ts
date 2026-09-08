/**
 * Recover an in-box image that failed to load because its file did not exist
 * yet.
 *
 * The chat renders an agent's message the moment it arrives, and the image the
 * message points at is often still being written — so the first load 404s (or
 * decodes a half-written file), the URL lands in `Image`'s failed set, and
 * every later `<img>` with that URL is shown as the placeholder without a
 * request. The `file-change` refresh (`lib/file-version.ts`) is the intended
 * recovery, but it needs the box file watcher to see the write, and a box past
 * the watcher's directory ceiling gets no events for most of its content
 * (`issues/bugs/2026-09-07-box-watcher-ceiling-leaves-attach-scopes-unwatched.md`).
 *
 * This is the safety net: while an in-box image is errored, ask the server
 * whether the file exists now — a `HEAD` on a bounded, lengthening schedule —
 * and only when it answers OK hand back a stamp that the caller appends to the
 * URL. The `<img>` itself is never re-loaded on a timer, which is what the
 * chat-scroll work removed (`7e68eadd5`): the page reflows once, when the
 * image is real, exactly as a `file-change` bust would reflow it.
 */

import { useEffect } from "react";

/** In-box file URLs only: an external image that fails has no file to wait for. */
const IN_BOX_MARKERS = ["/api/files/", "/api/image/", "/api/images/"] as const;

/**
 * Probe schedule, in ms after the failure: quick at first (the file usually
 * lands within seconds of the message), then every minute for a few minutes,
 * then give up — a file that is not there after five minutes is a broken
 * reference, not a slow write.
 */
export const RECOVERY_DELAYS_MS: readonly number[] = [2000, 5000, 10000, 20000, 30000, 60000, 60000, 60000, 60000];

/** Whether a failed image URL is one this recovery applies to. */
export function isRecoverableImageUrl(url: string): boolean {
  if (/^(?:[a-z][\d+.a-z-]*:|\/\/)/iu.test(url)) return false; // has an authority: external
  return IN_BOX_MARKERS.some((marker) => url.includes(marker));
}

/**
 * `src` with its `v=` cache-buster set to `stamp`, replacing one already
 * there. `v=` is the one query key the file and image routes accept beyond
 * their own options (`lib/file-version.ts` uses it for `file-change` busts);
 * the image-transform route answers 400 to any other, so the recovery stamp
 * has to ride in it too.
 */
export function withVersionStamp(src: string, stamp: string): string {
  const [pathAndQuery = "", hash] = src.split("#", 2);
  const [pathname = "", query = ""] = pathAndQuery.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("v", stamp);
  return `${pathname}?${params.toString()}${hash === undefined ? "" : `#${hash}`}`;
}

/** The one question a probe asks: does the file exist and serve now? */
export type ImageProbe = (url: string) => Promise<boolean>;

async function headProbe(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch (_e) {
    return false;
  }
}

/**
 * Drive the probe schedule for one URL. Resolves with `true` the first time the
 * probe succeeds, `false` when the schedule is exhausted or `signal` aborts.
 * Exported for tests; the hook below is the React wiring.
 */
export async function waitForImage(opts: {
  url: string;
  probe: ImageProbe;
  delays: readonly number[];
  signal: AbortSignal;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<boolean> {
  for (const delay of opts.delays) {
    await opts.sleep(delay, opts.signal);
    if (opts.signal.aborted) return false;
    if (await opts.probe(opts.url)) return !opts.signal.aborted;
  }
  return false;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/**
 * While `errored` holds for a recoverable in-box `src`, probe for the file and
 * call `onRecovered` with a fresh stamp once it serves. Unmount, a changed
 * `src`, or the error clearing all cancel the schedule.
 */
export function useImageRecovery(opts: { src: string; errored: boolean; onRecovered: (stamp: string) => void }): void {
  const { src, errored, onRecovered } = opts;
  useEffect(() => {
    if (!errored || !isRecoverableImageUrl(src)) return;
    const controller = new AbortController();
    void waitForImage({ url: src, probe: headProbe, delays: RECOVERY_DELAYS_MS, signal: controller.signal, sleep })
      .then((recovered) => {
        if (recovered) onRecovered(String(Date.now()));
      });
    return () => controller.abort();
    // `onRecovered` is redefined every render; the schedule belongs to (src, errored).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [src, errored]);
}
