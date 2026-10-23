/**
 * Capture-provenance header shared by `webpage` and `commentary` cards:
 * "Original page · Frozen snapshot ↗ · captured <date>", plus the helper that
 * turns a card's `frozen` ref into the snapshot's raw-file URL.
 */

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

export function CapturedPageMeta({ sourceUrl, frozenUrl, capturedAt }: {
  sourceUrl: string | null;
  frozenUrl: string | null;
  capturedAt: string | null;
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
          <a href={frozenUrl} target="_blank" rel="noreferrer" className="underline">Frozen snapshot ↗</a>
        </>
      ) : null}
      {capturedAt !== null ? <> · captured <FriendlyDate iso={capturedAt} /></> : null}
    </Text>
  );
}
