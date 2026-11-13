import type { ReactNode } from "react";
import { WorkspacePaneContext } from "../use-open-beside/hook";
import { PaneCardProvider } from "../../../../lib/activity/scope";
import type { PaneId } from "../state-types.js";

/** What a card's content learns about where it sits: its pane, and its own path for activity. */
export function PaneScope({ pane, card, children }: { pane: PaneId; card: string; children: ReactNode }) {
  return <WorkspacePaneContext.Provider value={pane}><PaneCardProvider card={card}>{children}</PaneCardProvider></WorkspacePaneContext.Provider>;
}
