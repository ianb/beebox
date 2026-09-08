import { createContext, useContext, type ReactNode } from "react";
import type { ConversationSelection } from "@shared/chat-composer-binding";
import type { ChatInitialLoad } from "../../../machines/chat-types";
import type { ReservationReceipt } from "./reservation-receipts";
import type { ConversationRequest } from "./resolve-conversation";
import { useConversationSelection } from "./use-conversation-selection";

export interface ConversationContextValue {
  storageScope: string;
  selection: ConversationSelection;
  rendered: Extract<ConversationSelection, { kind: "ready" }> | null;
  initial: ChatInitialLoad | undefined;
  select: (request: ConversationRequest) => Promise<void>;
  assigned: (...args: [sessionId: string, assignment?: { clientConversationId: string; contextDir: string }]) => void;
  retry: () => Promise<void>;
  ensureReservation: (sessionId: string) => Promise<ReservationReceipt | null>;
  forgetReservation: (sessionId: string) => void;
}
const ConversationContext = createContext<ConversationContextValue | null>(null);
export function BoxConversationProvider({ boxSlug, children }: { boxSlug: string; children: ReactNode }) {
  const value = useConversationSelection(boxSlug);
  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}
export function useBoxConversation(): ConversationContextValue | null { return useContext(ConversationContext); }
