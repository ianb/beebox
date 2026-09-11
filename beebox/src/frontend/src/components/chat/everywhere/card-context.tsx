import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { createCardContextStore, visibleCardSelectionSink } from "./card-context-store";
import { serializeViewUrl, type ViewState } from "../../../lib/view-url";
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
const subscribeEmpty = () => () => {};
const getEmpty = () => null;
export function useFocusedConversationCard(): string | null {
  const store = useContext(CardContext);
  return useSyncExternalStore(store?.subscribe ?? subscribeEmpty, store?.get ?? getEmpty, getEmpty);
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
/** Embedded/inline cards do not claim attention merely by being rendered. */
export function useConversationCard({ path, mode, rendererName, params, viewState }: { path: string; mode: string; rendererName?: string | null; params?: Record<string, string>; viewState?: ViewState | null }) {
  const visible = useContext(CardVisibility);
  const enabled = visible && (mode === "page" || mode === "companion");
  const store = useContext(CardContext);
  const owner = useMemo(() => ({}), []);
  const target = { path: path.startsWith("/") ? path : `/${path}`, viewer: rendererName ?? null, params: params ?? {}, viewState: viewState ?? null };
  const ref = serializeViewUrl(target);
  useEffect(() => {
    if (!enabled || !store) return;
    store.focus(owner, ref);
    return () => store.release(owner);
  }, [enabled, store, owner, ref]);
  function handleFocus() { if (enabled) store?.focus(owner, ref); }
  function handleRendererFocus(viewer: string | null) { if (enabled) store?.focus(owner, serializeViewUrl({ ...target, viewer })); }
  return { handleFocus, handleRendererFocus, capture: enabled ? store?.capture : undefined };
}

export function selectionReceiver(supplied: ((selection: AddSelectionInput) => void) | undefined, shared: ((selection: AddSelectionInput) => void) | undefined) { return supplied ?? shared; }
