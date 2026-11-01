/**
 * Capture-provenance header shared by `webpage` and `commentary` cards:
 * "Original page · Frozen snapshot ↗ · captured <date>", plus the helper that
 * turns a card's `frozen` ref into the snapshot's raw-file URL.
 */

import { isRecord } from "@shared/is-record";
import { apiRawFileUrl, getApiBase } from "../api";
import { resolveRelativePath } from "../lib/view-url";
import { Text } from "./ui/Text";
import { FriendlyDate } from "./ui/FriendlyDate";

/**
 * URL of the frozen snapshot named by a card's `frozen` frontmatter, or null.
 * `frozen` is a card ref stored as `{ ref: <path> }`. A ref that escapes the
 * box root resolves to null and is treated as absent — no snapshot link,
 * rather than a link to a clamped-to-root file. The broken ref itself is
 * reported where refs are checked (`bbx validate`), not re-reported on every
 * render.
 */
export function frozenSnapshotUrl(cardPath: string, frozen: unknown): string | null {
  const frozenPath =
    typeof frozen === "object" && frozen !== null && "ref" in frozen && typeof frozen.ref === "string"
      ? frozen.ref
      : null;
  const frozenRelative =
    frozenPath !== null && frozenPath !== "" ? resolveRelativePath(cardPath, frozenPath) : null;
  return frozenRelative === null ? null : apiRawFileUrl(getApiBase(), frozenRelative);
}

/** How `bbx webpage` got the page: the card's `capture` field, or null for a Clerk or share card. */
export interface PageCapture {
  via: string | null;
  redirectedFrom: string | null;
  isHtmlOnly: boolean;
  note: string | null;
}

/** Read a card's `capture` field; anything unexpected in it is left out. */
export function pageCapture(raw: unknown): PageCapture | null {
  if (!isRecord(raw)) return null;
  const { via, snapshot, redirectedFrom, note } = raw;
  const first = Array.isArray(redirectedFrom) ? redirectedFrom[0] : undefined;
  return {
    via: typeof via === "string" ? via : null,
    redirectedFrom: typeof first === "string" ? first : null,
    isHtmlOnly: snapshot === "html-only",
    note: typeof note === "string" ? note : null,
  };
}

export function CapturedPageMeta({ sourceUrl, frozenUrl, capturedAt, capture }: {
  sourceUrl: string | null;
  frozenUrl: string | null;
  capturedAt: string | null;
  capture?: PageCapture | null;
}) {
  if (sourceUrl === null && frozenUrl === null) return null;
  return (
    <Text as="div" size="sm" tone="subtle" className="mb-3">
      {sourceUrl !== null ? (
        <a href={sourceUrl} target="_blank" rel="noreferrer" className="underline">Original page</a>
      ) : null}
      {frozenUrl !== null ? (
        <>
          {sourceUrl !== null ? " · " : ""}
          <a href={frozenUrl} target="_blank" rel="noreferrer" className="underline" title={capture?.isHtmlOnly === true ? "The page's HTML. Its images and styles still load from the site." : undefined}>{capture?.isHtmlOnly === true ? "Saved HTML" : "Frozen snapshot"} ↗</a>
        </>
      ) : null}
      {capturedAt !== null ? <> · captured <FriendlyDate iso={capturedAt} /></> : null}
      {capture?.via === "browser" ? <> · from the box browser</> : null}
      {capture?.redirectedFrom !== null && capture?.redirectedFrom !== undefined ? <div>Redirected from {capture.redirectedFrom}</div> : null}
      {capture?.note !== null && capture?.note !== undefined ? <div>{capture.note}</div> : null}
    </Text>
  );
}
