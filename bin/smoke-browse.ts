/** Smoke adapters for Browse's canonical card and content-excluded controls. */
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
