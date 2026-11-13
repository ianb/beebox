/**
 * The intention strip: the place's intention across the top of the cards
 * beside a chat in that place, or above the chat on the phone
 * (docs/implemented-plans/place-intention.md, Track B). Arrival with a prime card opens
 * that card instead of the place page, so the chat's workspace is where the
 * line is seen on every arrival.
 *
 * It runs its own `landmarks.forDir` for the chat's place: the arrival query
 * runs only for a desktop arrival and the workspace exposes no landmark. The
 * input matches arrival's, so the two share one cached request. It refetches
 * when the landmark card changes, so a line the agent rewrites shows here.
 *
 * It shows for a chat bound to a place whose landmark has an intention the
 * person has not hidden. On the desktop it sits across the top of the cards
 * (both columns when both panes hold cards, the full width when no card is
 * open); on the phone it shows only above the chat. It hides while the place
 * page itself is visible, so the line never shows twice.
 */

import { useContext } from "react";
import { trpc } from "../../lib/trpc/client";
import { useBoxSlug } from "../../lib/box-slug";
import { bbxSource } from "../../lib/source-tag";
import { fileChangeAt } from "../../lib/live-refresh";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { PlaceChatContext } from "../openers/place-chat";
import { useWorkspace } from "../chat/workspace/WorkspaceProvider/provider";
import { IntentionLine } from "./IntentionLine/view";
import { intentionDismissKey, useDismissedIntention } from "./use-dismissed-intention";
import type { PaneId } from "../chat/workspace/state-types.js";
import type { PlacePayload } from "../PlaceView/sections";

export interface StripInput {
  /** The chat's place, from `landmarks.forDir`; null when the chat has none or it is not loaded. */
  landmark: Pick<PlacePayload, "path" | "intention"> | null;
  dismissed: boolean;
  /** The workspace has restored its layout, so the visible cards are known. */
  displayReady: boolean;
  mobile: boolean;
  /** The grid has two columns: the desktop split with the chat in one of them or two card panes. */
  split: boolean;
  transcript: PaneId | "full" | null;
  visiblePaths: readonly string[];
}

/** The strip's CSS `grid-column`, or null to hide it. */
export function intentionStripColumn(input: StripInput): string | null {
  const { landmark, transcript } = input;
  if (landmark === null || landmark.intention === null || input.dismissed || !input.displayReady) return null;
  if (input.visiblePaths.includes(landmark.path)) return null;
  if (input.mobile) return transcript === "full" ? "1 / -1" : null;
  if (!input.split) return "1 / -1";
  // The chat holds one column; the strip tops the other, where the cards are.
  if (transcript === "left") return "2";
  if (transcript === "right") return "1";
  return "1 / -1";
}

/** `split`: the workspace grid has two columns (`WorkspaceCanvas`). Renders a grid item on the grid's first row. */
export function IntentionStrip({ split }: { split: boolean }) {
  const contextDir = useContext(PlaceChatContext)?.contextDir ?? null;
  const workspace = useWorkspace();
  const boxSlug = useBoxSlug() ?? "";
  const query = trpc.landmarks.forDir.useQuery({ dir: contextDir ?? "" }, { enabled: contextDir !== null });
  const landmark = contextDir === null ? null : query.data?.landmark ?? null;
  const landmarkPath = landmark?.path ?? null;
  useLiveRefresh({
    when: (event) => landmarkPath !== null && fileChangeAt(landmarkPath)(event),
    refresh: () => { void query.refetch(); },
    burstMs: 500,
  });
  const text = landmark?.intention?.text ?? "";
  const { dismissed, dismiss } = useDismissedIntention({ key: intentionDismissKey({ boxSlug, landmarkPath: landmarkPath ?? "" }), text });
  if (workspace === null || landmark === null || landmark.intention === null) return null;
  const column = intentionStripColumn({
    landmark,
    dismissed,
    displayReady: workspace.displayReady === true,
    mobile: workspace.mobile,
    split,
    transcript: workspace.projection.transcript,
    visiblePaths: Object.values(workspace.projection.visiblePaths),
  });
  if (column === null) return null;
  return (
    <section aria-label={`Next in ${landmark.label}`} style={{ gridRow: 1, gridColumn: column }}
      className="bbx-intention-strip min-w-0 px-4 py-2 border-b border-warm-200 bg-warm-50 text-sm" {...bbxSource("card", landmark.path)}>
      <IntentionLine intention={landmark.intention} landmarkPath={landmark.path} idPrefix="bbx-intention-strip"
        onNavigate={(target) => workspace.open(target, { label: target.path })} onDismiss={dismiss} />
    </section>
  );
}
