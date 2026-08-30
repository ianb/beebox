/**
 * The current box's display name.
 *
 * Two places need it — the nav's place chip and the dashboard header — and the
 * derivation is not obvious enough to retype: a box's directory basename is
 * NOT its name. Since the box layout moved the operational root to
 * `<box>/content`, the last path segment is the literal word "content" for
 * every box, so anything deriving a name from `boxRoot` shows the same wrong
 * word everywhere. The name lives in the box list.
 *
 * Falls back to the slug (which at least identifies the box) and then to an
 * empty string while the list is still loading.
 */

import { useParams } from "@tanstack/react-router";

import { useBoxes } from "./useBoxes";

export function useBoxName(): { boxSlug: string, boxName: string } {
  const { boxSlug } = useParams({ strict: false });
  const { boxes } = useBoxes();
  const slug = boxSlug ?? "";
  const known = boxes.find((b) => b.slug === slug);
  if (known !== undefined) return { boxSlug: slug, boxName: known.name };
  return { boxSlug: slug, boxName: slug };
}
