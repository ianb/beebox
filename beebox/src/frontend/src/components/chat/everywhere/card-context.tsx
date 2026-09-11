import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { createCardContextStore, visibleCardSelectionSink } from "./selection-context-store";
import type { AddSelectionInput } from "../../../lib/selection/position";

const CardVisibility = createContext(true);
export function useCardVisible(): boolean { return useContext(CardVisibility); }
export function CardVisibilityProvider({ visible, children }: { visible: boolean; children: ReactNode }) {
  return <CardVisibility.Provider value={visible}>{children}</CardVisibility.Provider>;
}

const CardContext = createContext<ReturnType<typeof createCardContextStore> | null>(null);
export function ConversationCardProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => createCardContextStore(), []);
  return <CardContext.Provider value={store}>{children}</CardContext.Provider>;
}
export function useConversationSelectionSink(sink: (selection: AddSelectionInput) => void): void {
  const store = useContext(CardContext);
  useEffect(() => store?.registerSelection(sink), [store, sink]);
}
/** The conversation's selection capture, for the chat transcript (never a hidden card). */
export function useConversationSelectionCapture() {
  return useContext(CardContext)?.capture;
}
/** Read the enclosing card's selection sink without claiming its attention. */
export function useVisibleCardSelectionSink() {
  const visible = useCardVisible();
  const store = useContext(CardContext);
  return visibleCardSelectionSink(visible, store);
}
export function selectionReceiver(supplied: ((selection: AddSelectionInput) => void) | undefined, shared: ((selection: AddSelectionInput) => void) | undefined) { return supplied ?? shared; }
