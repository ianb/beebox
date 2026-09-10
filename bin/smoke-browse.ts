/** Smoke adapters for Browse's canonical card and content-excluded controls. */
import { isRecord } from "../beebox/src/shared/is-record.js";
import { parseRef } from "../beebox/src/shared/ref-path.js";
import { SYSTEM_CARD_PATHS } from "../beebox/src/shared/system-card-paths.js";
import { refFor } from "./smoke-snapshot.js";

export function isBrowseCardUrl(url: string): boolean {
  const card = new URL(url).searchParams.get("card");
  return card !== null && parseRef(card).path === SYSTEM_CARD_PATHS.browse;
}

/** Content controls have real DOM ids, but the privacy scan intentionally omits them. */
export function browseListingModeRef(snapshot: string): string | null {
  return refFor(snapshot, { role: "switch", name: "Showing compact listing — switch to raw" });
}

/** The instrument identity alone cannot prove the clicked file became its detail. */
export function browseDetailMatches(url: string, expectedPath: string): boolean {
  if (!isBrowseCardUrl(url)) return false;
  const card = new URL(url).searchParams.get("card");
  const state = new URLSearchParams(parseRef(card ?? "").query).get("viewState");
  if (state === null) return false;
  // Malformed JSON is a hard smoke failure, not a fallback to an older detail.
  const parsed: unknown = JSON.parse(state);
  return isRecord(parsed) && isRecord(parsed["detail"]) && parsed["detail"]["path"] === expectedPath;
}
