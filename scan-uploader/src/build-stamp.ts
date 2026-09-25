/**
 * What this uploader *is* — the revision it was built from and when.
 *
 * WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 *
 * Separate from `contract-version.ts`, and answering a different question. The
 * contract version says whether this client still speaks the box's protocol;
 * this says how old the client is. A bundle can be current on the protocol and
 * still be missing features — it obeys the contract but not well — and only a
 * date can show that. The box records what it receives and can then report that
 * an uploader is old; see the contract doc's "Client identity" section.
 *
 * There are two run modes and the honest answer differs between them
 * (`schedule.ts`'s `detectRunMode` draws the same line):
 *
 * - **bundle** — the copied `dist/scan-uploader.mjs`. This is the only mode
 *   that can drift: nothing fetches and nothing self-updates, so the file sits
 *   at whatever revision it was built from until someone copies a new one.
 *   `build.ts` bakes the revision and the build time in through esbuild
 *   `define`.
 * - **source** — `bin/scan-uploader` running `src/cli.ts` through tsx on a
 *   checkout. It *cannot* drift: every sweep runs current source, and `git pull`
 *   is the update. Reporting a build date here would be a lie (there is no
 *   build), so it reports the mode instead, which is the more useful fact.
 *
 * The `typeof` guard is what makes one module serve both: esbuild replaces the
 * identifier in the bundle, and in source mode it is never declared at all —
 * `typeof` on an undeclared identifier is the one way to ask without throwing
 * a `ReferenceError`.
 */

import { isRecord } from "./is-record.js";

/** Replaced at bundle time by `build.ts`'s esbuild `define`. Undeclared in
 * source mode — only ever reached through `typeof`. */
declare const __UPLOADER_BUILD__: string;

export type BuildStamp =
  | { readonly mode: "bundle"; readonly revision: string; readonly builtAt: string }
  | { readonly mode: "source" };

/** Sent when the revision is unavailable at build time — a build from an
 * exported tarball or a tree with no git. The build time is still real, so the
 * box can still tell the uploader is old; only the "which commit" half is
 * missing. */
export const UNKNOWN_REVISION = "unknown";

/**
 * This uploader's identity. Never throws: a malformed or absent stamp degrades
 * to `source`, because failing a sweep over its own version label would be
 * worse than not knowing it.
 */
export function buildStamp(): BuildStamp {
  if (typeof __UPLOADER_BUILD__ !== "string") return { mode: "source" };
  const parsed: unknown = tryParse(__UPLOADER_BUILD__);
  if (!isRecord(parsed)) return { mode: "source" };
  const { revision, builtAt } = parsed;
  if (typeof revision !== "string" || typeof builtAt !== "string") return { mode: "source" };
  return { mode: "bundle", revision, builtAt };
}

function tryParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (e) {
    // A stamp this module itself wrote at build time cannot normally be
    // unparseable; if it is, the sweep still matters more than the label.
    console.error(`build-stamp: ignoring an unparseable build stamp: ${String(e)}`);
    return undefined;
  }
}

/** One line for `--version` and for the sweep's stdout. */
export function describeBuild(stamp: BuildStamp): string {
  if (stamp.mode === "source") return "running from source (a checkout — tracks current source)";
  const revision = stamp.revision === UNKNOWN_REVISION ? "unknown revision" : stamp.revision;
  return `bundle ${revision}, built ${stamp.builtAt}`;
}
