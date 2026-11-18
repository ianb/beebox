import { useEffect, useRef, useState } from "react";
import { trpc, trpcClient } from "../../../../lib/trpc/client";
import { useQuery } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { bbxSource } from "../../../../lib/source-tag";
import { CalloutStack } from "../../CalloutBlock";
import { projectAmbientReply, observeAmbientReply, recordAmbientCompletion, ambientCalloutsHidden } from "../projection";
import { readAttention, writeAttention } from "./attention-store";
import { useBoxConversation } from "../../everywhere/conversation-context/context";
import { useSelectedTranscript } from "../selected-transcript";
import type { AmbientRepliesProps, AmbientSession } from "./view";

type Props = Omit<AmbientRepliesProps, "sessions"> & {
  session: AmbientSession;
  completion: string | null;
  /** Bumped by the stack's dismiss control; each change acknowledges the current reply. */
  dismissal: number;
  onActivity: (sessionId: string, needed: boolean) => void;
  onShowing: (sessionId: string, showing: boolean) => void;
};

function useSessionCallouts(props: Props) {
  const { session, completion } = props;
  const conversation = useBoxConversation();
  const ensureReservation = conversation?.ensureReservation;
  const forgetReservation = conversation?.forgetReservation;
  const key = `bbx-ambient:${props.storageScope}:${session.sessionId}`;
  const [attention, setAttention] = useState(() => readAttention(key));
  // The selected conversation's transcript comes from the open chat (selected-transcript.ts).
  const fromChat = useSelectedTranscript(session.sessionId);
  const historyInput = { session: session.sessionId, slice: { mode: "tail" as const, tail: 100 } };
  const history = useQuery({
    queryKey: getQueryKey(trpc.chat.history, historyInput, "query"),
    queryFn: async ({ signal }) => {
      await ensureReservation?.(session.sessionId);
      return trpcClient.chat.history.query(historyInput, { signal });
    },
    enabled: fromChat === null,
  });
  const status = trpc.chat.status.useQuery({ session: session.sessionId }, { enabled: fromChat === null });
  const transcript = fromChat ?? (history.data && status.data ? { entries: history.data.entries, total: history.data.total, busy: status.data.busy } : null);
  // Effects key on these primitives, not on `transcript`, which is a new object each render.
  const loaded = transcript !== null;
  const total = transcript?.total ?? 0;
  const busy = transcript?.busy === true;
  useEffect(() => {
    if (total > 0) forgetReservation?.(session.sessionId);
  }, [total, forgetReservation, session.sessionId]);
  const reply = projectAmbientReply(session.sessionId, { entries: transcript?.entries ?? [], total, running: transcript?.busy ?? true });
  useEffect(() => {
    if (completion) setAttention((old) => recordAmbientCompletion(old, completion));
  }, [completion]);
  useEffect(() => {
    if (loaded) setAttention((old) => observeAmbientReply(old, reply.identity));
  }, [loaded, reply.identity]);
  useEffect(() => { writeAttention(key, attention); }, [key, attention]);
  const selected = props.selectedSessionId === session.sessionId;
  const { transcriptVisible, dismissal } = props;
  // A reply that arrives while its transcript is on screen is read there, so it never shows here later.
  useEffect(() => {
    if (selected && transcriptVisible && attention.attention) setAttention((old) => ({ ...old, attention: false, dismissedReply: old.lastReply }));
  }, [selected, transcriptVisible, attention.attention]);
  // Nothing about a failed refresh shows here; the next bus event or reconnect refetches.
  const error = history.error ?? status.error;
  useEffect(() => {
    if (error) console.warn(`Ambient callouts: could not refresh conversation ${session.sessionId}`, error);
  }, [error, session.sessionId]);
  const { onActivity, onShowing } = props;
  useEffect(() => {
    if (completion !== null && completion !== attention.lastCompletion) return;
    if (loaded) onActivity(session.sessionId, busy || attention.attention);
  }, [loaded, busy, attention.attention, attention.lastCompletion, completion, session.sessionId, onActivity]);
  // A completion can set attention while the cached transcript still holds the dismissed reply.
  const showing = !ambientCalloutsHidden({ selected, transcriptVisible, attention: attention.attention, dismissed: reply.identity === attention.dismissedReply })
    && reply.callouts.length > 0;
  // The stack's × acknowledges only what it showed: a session still loading keeps its unseen reply.
  const seenDismissal = useRef(dismissal);
  useEffect(() => {
    if (dismissal === seenDismissal.current) return;
    seenDismissal.current = dismissal;
    if (showing) setAttention((old) => ({ ...old, attention: false, dismissedReply: old.lastReply }));
  }, [dismissal, showing]);
  useEffect(() => {
    onShowing(session.sessionId, showing);
    return () => onShowing(session.sessionId, false);
  }, [showing, session.sessionId, onShowing]);
  return { callouts: showing ? reply.callouts : [] };
}

/**
 * A conversation's new callouts, as its transcript renders them, and nothing else.
 * The selected conversation shows here only while its transcript is off screen
 * (focus layout, or cards in both panes).
 */
export function SessionCallouts(props: Props) {
  const { callouts } = useSessionCallouts(props);
  if (callouts.length === 0) return null;
  return <div {...bbxSource("session", props.session.sessionId)}>
    <CalloutStack callouts={callouts} onZoomView={({ target }) => props.onInspectCard(target)} />
  </div>;
}
