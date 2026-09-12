import { systemCardAttentionRef } from "../../../lib/system-card-navigation";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { explicitConversationHistoryState } from "../workspace/workspace-history";
import { canAcknowledgeAmbientReply } from "../ambient/projection";
/** The single composer/runtime owner, kept mounted while the routed card changes. */
import { useEffect, useRef, useState, useMemo } from "react";
import { useParams, useSearch, useNavigate, useRouterState } from "@tanstack/react-router";
import { InteractiveChat } from "../InteractiveChat";
import { useEmissionStoreInstance } from "../input-store";
import { isNativeShell, postNativeMessage } from "../native-post";
import { useBoxConversation } from "./conversation-context";
import { useConversationRoute } from "./use-conversation-route";
import { readTrackedSessions, writeTrackedSessions } from "../ambient/tracked-sessions";
import { AmbientReplies, type AmbientSession } from "../ambient/AmbientReplies";
import { useViewNavigate } from "../../../hooks/useViewNavigate";
import { href, toSearch } from "../../../lib/routing";
import { Button } from "../../ui/Button";
import { Text } from "../../ui/Text";
import { usePageTitle } from "../../DocumentTitle";
import { invariant } from "@shared/invariant";
import type { ConversationSelection } from "@shared/chat-composer-binding";
import { z } from "zod";

const shellSearch = z.object({ nativeComposer: z.coerce.string().optional(), capture: z.coerce.string().optional() });
export function BoxConversationShell() {
  const conversation = useBoxConversation();
  invariant(conversation, "BoxConversationShell requires BoxConversationProvider");
  return <ConversationRuntime conversation={conversation} />;
}
function ConversationRuntime({ conversation }: { conversation: NonNullable<ReturnType<typeof useBoxConversation>> }) {
  const { storageScope } = conversation;
  const { boxSlug = "" } = useParams({ strict: false });
  const routeSearch = useSearch({ strict: false });
  const routeReady = useRouterState({ select: state => !state.isLoading && state.resolvedLocation?.href === state.location.href });
  const search = shellSearch.parse(routeSearch);
  const route = useConversationRoute(conversation);
  const workspace = useWorkspace();
  invariant(workspace, "ConversationRuntime requires workspace");
  const focusedRef = workspace.activeView ? systemCardAttentionRef(workspace.activeView.target) : null;
  const transcriptVisible = workspace.transcriptVisible;
  // Native publication is an imperative consumer: stable identity prevents redundant bridge messages.
  const attention = useMemo(() => ({ ...route.attention, transcript: transcriptVisible ? "visible" as const : "hidden" as const, ...(!focusedRef ? { surface: "chat" as const, focusedRef: undefined } : { surface: "card" as const, focusedRef }) }), [focusedRef, route.attention, transcriptVisible]);
  const emissionStore = useEmissionStoreInstance(boxSlug);
  const target = conversation.rendered?.target;
  const usesNativeComposer = search.nativeComposer === "1" || isNativeShell();
  const sessionId = target?.kind === "session" ? target.sessionId : null;
  const sessionLabel = conversation.rendered?.label ?? "Conversation";
  const inspect = useViewNavigate();
  const navigate = useNavigate();
  function handleOpenConversation(id: string) {
    if (route.chatPage) {
      void navigate({ to: href(`/${boxSlug}/chat`), search: toSearch({ session: id }), state: explicitConversationHistoryState({}) });
      return;
    }
    void conversation.select({ kind: "session", sessionId: id, named: true });
    if (workspace) workspace.dispatch({ type: "showChat", pane: workspace.state.lastCardPane, viewport: workspace.mobile ? "mobile" : "desktop" });
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
    if (!routeReady || (!workspace.ready && conversation.selection.kind === "ready")) return;
    const publication = { version: 1, kind: "selection", revision: ++publicationRevision.current, boxSlug, selection: conversation.selection, attention };
    postNativeMessage(window, { channel: "beeboxComposerBinding", payload: publication });
  }, [routeReady, boxSlug, conversation.selection, attention, workspace.ready]);
  const handleRetry = conversation.retry;
  const handleAssignment: typeof conversation.assigned = (id, assignment) => { workspace.adopt(id); conversation.assigned(id, assignment); };
  const notice = <ConversationNotice selection={conversation.selection} onRetry={handleRetry} onNewConversation={handleNewConversation} />;
  return <InteractiveChat
    sessionInput={sessionId ?? "new"}
    initial={conversation.initial}
    contextDir={target?.contextDir}
    startEngine={target?.kind === "start" ? target.engine : undefined}
    startModel={target?.kind === "start" ? target.model : undefined}
    conversationTarget={target}
    conversationSelection={conversation.selection}
    attention={attention}
    emissionStore={emissionStore}
    sessionLabel={sessionLabel}
    onSessionAssignment={handleAssignment}
    nativeComposer={usesNativeComposer}
    openCaptureOnMount={search.capture === "1" && !usesNativeComposer}
    transcriptVisible={transcriptVisible}
    selectionNotice={<>{notice}{workspace.notice ? <Text as="div" size="sm" tone="muted">{workspace.notice}</Text> : null}</>}
    // Keep reply observation alive, but show its panels only away from the transcript.
    ambientRegion={<div hidden={transcriptVisible}><AmbientReplies storageScope={storageScope} boxSlug={boxSlug} sessions={sessions} selectedSessionId={sessionId}
      transcriptVisible={canAcknowledgeAmbientReply(transcriptVisible, conversation.selection.kind)} onInspectCard={inspect}
      onOpenConversation={handleOpenConversation} /></div>}
  />;
}

function ConversationNotice({ selection, onRetry, onNewConversation }: { selection: ConversationSelection; onRetry: () => Promise<void>; onNewConversation: () => void }) {
  if (selection.kind === "ready") return null;
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
