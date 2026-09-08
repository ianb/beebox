import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import type { ConversationSelection } from "@shared/chat-composer-binding";
import { getApiBase } from "../../../api-core";
import { conversationStorageScope } from "../conversation/storage-scope";
import { useBusSubscription } from "../../../hooks/useBusSubscription";
import { busEventData } from "../../../lib/bus-events";
import { trpc } from "../../../lib/trpc";
import { readConversation, saveConversation } from "./conversation-state";
import { resolveConversation, type ConversationRequest, type ResolvedConversation } from "./resolve-conversation";
import { createResolutionGate } from "./conversation-intent";
import { postNativeMessage } from "../native-post";
import { ReservationReceipts } from "./reservation-receipts";
import { createReservationRecovery } from "./reservation-recovery";

export function useConversationSelection(boxSlug: string) {
  const storageScope = conversationStorageScope(getApiBase());
  const utils = trpc.useUtils();
  const { mutateAsync: reserve } = trpc.chat.reserveSession.useMutation();
  const receipts = useMemo(() => {
    try { return new ReservationReceipts(sessionStorage, storageScope); }
    catch (error) {
      console.warn("Conversation reservation receipts could not be restored", error);
      return null;
    }
  }, [storageScope]);
  const ensureReservation = useMemo(() => createReservationRecovery(receipts, reserve), [receipts, reserve]);
  const forgetReservation = useCallback((sessionId: string) => { receipts?.remove(sessionId); }, [receipts]);
  useBusSubscription({ onEvent(event) {
    const message = busEventData(event, "chat-user-message");
    if (message?.sessionId) forgetReservation(message.sessionId);
  } });
  const restored = useMemo(() => readConversation(storageScope), [storageScope]);
  const [state, setState] = useState<ResolvedConversation>(() => ({ selection: restored?.kind === "ready" && restored.target.kind === "start" ? restored : { kind: "resolving", requestId: "initial", contextDir: "" } }));
  // A stored session is only a pointer: recover/validate it before mounting its history controller.
  const [rendered, setRendered] = useState(() => restored?.kind === "ready" && restored.target.kind === "start" ? restored : null);
  const gate = useMemo(() => createResolutionGate(), []);
  const lastRequest = useRef<ConversationRequest>({ kind: "default" });
  const select = useCallback(async (request: ConversationRequest) => {
    lastRequest.current = request;
    const requestId = gate.claim();
    setState((old) => ({ ...old, selection: { kind: "resolving", requestId: String(requestId), contextDir: request.contextDir ?? "" } }));
    try {
      const next = await resolveConversation({ utils, reserve, receipts, ensureReservation, request });
      if (!gate.accepts(requestId)) return;
      setState(next);
      if (next.selection.kind === "ready") setRendered(next.selection);
    } catch (error) {
      if (!gate.accepts(requestId)) return;
      setState((old) => ({ ...old, selection: { kind: "unavailable", contextDir: request.contextDir ?? "", reason: error instanceof Error ? error.message : "Could not resolve conversation" } }));
    }
  }, [utils, reserve, receipts, ensureReservation, gate]);
  useEffect(() => () => gate.cancel(), [gate]);
  useEffect(() => { saveConversation(storageScope, state.selection); }, [storageScope, state.selection]);
  const assigned = useCallback((sessionId: string, assignment?: { clientConversationId: string; contextDir: string }) => {
    const { clientConversationId, contextDir } = assignment ?? {};
    if (clientConversationId !== undefined && contextDir !== undefined) postNativeMessage(window, { channel: "beeboxComposerBinding", payload: { version: 1, kind: "assigned", boxSlug, clientConversationId, sessionId, contextDir } });
    function replace(selection: ConversationSelection): ConversationSelection {
      if (selection.kind !== "ready" || selection.target.kind !== "start" || selection.target.clientConversationId !== clientConversationId) return selection;
      return { ...selection, target: { kind: "session", sessionId, contextDir: selection.target.contextDir } };
    }
    setState((old) => ({ ...old, selection: replace(old.selection) }));
    setRendered((old) => { if (!old) return old; const next = replace(old); return next.kind === "ready" ? next : old; });
  }, [boxSlug]);
  return { storageScope, forgetReservation, ensureReservation, restored, ...state, initial: state.initial, rendered, select, assigned, retry: () => select(lastRequest.current) };
}
