import { canAcknowledgeAmbientReply } from "../ambient/projection";
/** The single composer/runtime owner, kept mounted while the routed card changes. */
import { useEffect, useRef, useState, useMemo, type ReactNode } from "react";
import { useParams, useSearch, useNavigate } from "@tanstack/react-router";
import { InteractiveChat } from "../InteractiveChat";
import { useEmissionStoreInstance } from "../input-store";
import { isNativeShell, postNativeMessage } from "../native-post";
import { useFocusedConversationCard } from "./card-context";
import { useBoxConversation } from "./conversation-context";
import { useConversationRoute } from "./use-conversation-route";
import { readTrackedSessions, writeTrackedSessions } from "../ambient/tracked-sessions";
import { AmbientReplies, type AmbientSession } from "../ambient/AmbientReplies";
import { useViewNavigate } from "../../../hooks/useViewNavigate";
import { useViewOverlay, useViewOverlayVisible } from "../../ViewOverlay";
import { href, toSearch } from "../../../lib/routing";
import { Button } from "../../ui/Button";
import { Text } from "../../ui/Text";
import { usePageTitle } from "../../DocumentTitle";
import { invariant } from "@shared/invariant";
import type { ConversationSelection } from "@shared/chat-composer-binding";
import { z } from "zod";

const shellSearch = z.object({ companion: z.string().optional(), card: z.string().optional(), nativeComposer: z.coerce.string().optional(), capture: z.coerce.string().optional() });
export function BoxConversationShell({ children }: { children: ReactNode }) {
  const conversation = useBoxConversation();
  invariant(conversation, "BoxConversationShell requires BoxConversationProvider");
  return <ConversationRuntime conversation={conversation}>{children}</ConversationRuntime>;
}
function ConversationRuntime({ conversation, children }: { conversation: NonNullable<ReturnType<typeof useBoxConversation>>; children: ReactNode }) {
  const { storageScope } = conversation;
  const { boxSlug = "" } = useParams({ strict: false });
  const routeSearch = useSearch({ strict: false });
  const search = shellSearch.parse(routeSearch);
  const route = useConversationRoute(conversation);
  const focusedRef = useFocusedConversationCard();
  const viewOverlayVisible = useViewOverlayVisible();
  // Native publication is an imperative consumer: stable identity prevents redundant bridge messages.
  const attention = useMemo(() => ({ ...route.attention, ...(focusedRef ? { surface: "card" as const, focusedRef } : {}), ...(viewOverlayVisible ? { transcript: "hidden" as const } : {}) }), [focusedRef, route.attention, viewOverlayVisible]);
  const emissionStore = useEmissionStoreInstance(boxSlug);
  const target = conversation.rendered?.target;
  const usesNativeComposer = search.nativeComposer === "1" || isNativeShell();
  const sessionId = target?.kind === "session" ? target.sessionId : null;
  const sessionLabel = conversation.rendered?.label ?? "Conversation";
  const inspect = useViewNavigate();
  const navigate = useNavigate();
  const overlay = useViewOverlay();
  function handleOpenConversation(id: string) {
    overlay?.close();
    if (route.chatPage) {
      void navigate({ to: href(`/${boxSlug}/chat`), search: toSearch({ session: id }) });
      return;
    }
    void conversation.select({ kind: "session", sessionId: id, named: true });
    route.showConversation();
  }
  function handleNewConversation() {
    const contextDir = conversation.selection.kind === "ready" ? conversation.selection.target.contextDir : conversation.selection.contextDir;
    if (route.chatPage) {
      void navigate({ to: href(`/${boxSlug}/chat`), search: toSearch({ ...routeSearch, session: "new", contextDir }),
        state: (old) => ({ ...old, bbxConversation: undefined }) });
      return;
    }
    void conversation.select({ kind: "new", contextDir });
  }
  const [sessions, setSessions] = useState<AmbientSession[]>(() => readTrackedSessions(storageScope));
  const publicationRevision = useRef(0);
  usePageTitle(route.chatPage ? sessionLabel : null);
  useEffect(() => {
    if (!sessionId) return;
    setSessions((old) => [...old.filter((session) => session.sessionId !== sessionId), { sessionId, label: sessionLabel }]);
  }, [sessionId, sessionLabel]);
  useEffect(() => { writeTrackedSessions(storageScope, sessions); }, [storageScope, sessions]);
  useEffect(() => {
    const publication = { version: 1, kind: "selection", revision: ++publicationRevision.current, boxSlug, selection: conversation.selection, attention };
    postNativeMessage(window, { channel: "beeboxComposerBinding", payload: publication });
  }, [boxSlug, conversation.selection, attention]);
  const handleRetry = conversation.retry;
  const handleAssignment = conversation.assigned;
  const handleShowConversation = route.showConversation;
  const handleHideConversation = route.hideConversation;
  const notice = <ConversationNotice selection={conversation.selection} onRetry={handleRetry} onNewConversation={handleNewConversation} nativeComposer={usesNativeComposer} />;
  return <InteractiveChat
    sessionInput={sessionId ?? "new"}
    initial={conversation.initial}
    contextDir={target?.contextDir}
    startEngine={target?.kind === "start" ? target.engine : undefined}
    startModel={target?.kind === "start" ? target.model : undefined}
    conversationTarget={target}
    conversationSelection={conversation.selection}
    attention={attention}
    companion={route.chatPage ? search.companion : undefined}
    card={route.chatPage ? search.card : undefined}
    emissionStore={emissionStore}
    sessionLabel={sessionLabel}
    onSessionAssignment={handleAssignment}
    nativeComposer={usesNativeComposer}
    openCaptureOnMount={search.capture === "1"}
    transcriptVisible={route.transcriptVisible}
    routeContent={route.chatPage ? undefined : children}
    onShowConversation={handleShowConversation}
    onHideConversation={handleHideConversation}
    selectionNotice={notice}
    // Keep reply observation alive, but show its panels only away from the transcript.
    ambientRegion={<div hidden={route.transcriptVisible}><AmbientReplies storageScope={storageScope} boxSlug={boxSlug} sessions={sessions} selectedSessionId={sessionId}
      transcriptVisible={canAcknowledgeAmbientReply(route.transcriptVisible, conversation.selection.kind)} onInspectCard={inspect}
      onOpenConversation={handleOpenConversation} /></div>}
  />;
}

function ConversationNotice({ selection, onRetry, onNewConversation, nativeComposer }: { selection: ConversationSelection; onRetry: () => Promise<void>; onNewConversation: () => void; nativeComposer: boolean }) {
  if (selection.kind === "ready") {
    if (nativeComposer) return null;
    const place = selection.target.contextDir || "/ (box root)";
    return <Text as="div" size="xs" tone="muted" className="px-3 py-1">Send to: {place}</Text>;
  }
  return <div className="px-3 py-2" role="status">
    <Text size="sm" tone={selection.kind === "unavailable" ? "danger" : "muted"}>
      {selection.kind === "unavailable" ? selection.reason : "Choosing conversation…"}
    </Text>
    {selection.kind === "unavailable" ? <>
      <Button id="bbx-conversation-retry" size="sm" onClick={onRetry}>Retry</Button>
      <Button id="bbx-conversation-new" size="sm" onClick={onNewConversation}>Start new conversation</Button>
    </> : null}
  </div>;
}
