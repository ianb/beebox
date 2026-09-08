import { useEffect, useState } from "react";
import { trpc } from "../../../lib/trpc";
import { bbxSource } from "../../../lib/source-tag";
import { Button } from "../../ui/Button";
import { Text } from "../../ui/Text";
import { Accordion } from "../../ui/Accordion";
import { CalloutStack } from "../CalloutBlock";
import { AckBadgeCluster } from "../ack-badge";
import { projectAmbientReply, observeAmbientReply, recordAmbientCompletion } from "./projection";
import { readAttention, writeAttention } from "./attention-store";
import type { AmbientRepliesProps, AmbientSession } from "./AmbientReplies";

type Props = AmbientRepliesProps & { session: AmbientSession; completion: string | null; onActivity: (sessionId: string, needed: boolean) => void };
function useAmbientSessionReply(props: Props) {
  const { session, completion } = props;
  const key = `bbx-ambient:${props.storageScope}:${session.sessionId}`;
  const [attention, setAttention] = useState(() => readAttention(key));
  const history = trpc.chat.history.useQuery({ session: session.sessionId, slice: { mode: "tail", tail: 100 } });
  const status = trpc.chat.status.useQuery({ session: session.sessionId });
  const reply = projectAmbientReply(session.sessionId, { entries: history.data?.entries ?? [], total: history.data?.total ?? 0, running: status.data?.busy ?? true });
  useEffect(() => {
    if (completion) setAttention((old) => recordAmbientCompletion(old, completion));
  }, [completion]);
  useEffect(() => {
    if (history.data && status.data) setAttention((old) => observeAmbientReply(old, reply.identity));
  }, [history.data, status.data, reply.identity]);
  useEffect(() => { writeAttention(key, attention); }, [key, attention]);
  function acknowledge() {
    setAttention((old) => ({ ...old, attention: false, dismissedReply: old.lastReply }));
  }
  async function retry() { await Promise.all([history.refetch(), status.refetch()]); }
  const selected = props.selectedSessionId === session.sessionId;
  const { transcriptVisible } = props;
  useEffect(() => {
    if (selected && transcriptVisible) setAttention((old) => ({ ...old, attention: false, dismissedReply: old.lastReply }));
  }, [selected, transcriptVisible]);
  const error = history.error ?? status.error;
  const { onActivity } = props;
  useEffect(() => {
    if (completion !== null && completion !== attention.lastCompletion) return;
    if (status.data && history.data) onActivity(session.sessionId, status.data.busy || attention.attention);
  }, [status.data, history.data, attention.attention, attention.lastCompletion, completion, session.sessionId, onActivity]);
  const hidden = (selected && props.transcriptVisible) || (!attention.attention && !status.data?.busy && !error);
  const label = status.data?.busy ? "Working" : reply.complete ? "Reply ready" : "Activity available";
  const loading = history.isLoading || status.isLoading;
  return { session, reply, selected, error, label, loading, history, acknowledge, retry, hidden };
}

export function AmbientSessionReply(props: Props) {
  const { session, reply, error, label, loading, history, acknowledge, retry, hidden } = useAmbientSessionReply(props);
  if (hidden) return null;
  return (
    <section aria-label={`${session.label} conversation activity`} {...bbxSource("session", session.sessionId)} className="p-2">
      <Accordion title={<Text size="sm">{session.label} · {label}</Text>}>
        <div aria-busy={loading}>
          {Boolean(loading) && <Text tone="muted" size="sm">Loading conversation activity…</Text>}
          {Boolean(error) && <Text tone="danger" size="sm">Could not refresh conversation: {error?.message}</Text>}
          {!loading && !error && !history.data?.entries.length && <Text tone="muted" size="sm">Conversation history is unavailable.</Text>}
          {Boolean(reply.earlier) && <Text tone="muted" size="sm">Earlier responses in conversation</Text>}
          {<CalloutStack callouts={reply.callouts} onZoomView={({ target }) => props.onInspectCard(target)} />}
          {<AckBadgeCluster acks={reply.acks} onZoomView={({ target }) => props.onInspectCard(target)} />}
          <div className="flex gap-2 flex-wrap mt-2">
            <Button id={`bbx-ambient-open-${session.sessionId}`} size="sm" onClick={() => { acknowledge(); props.onOpenConversation(session.sessionId); }}>Open conversation</Button>
            <Button id={`bbx-ambient-dismiss-${session.sessionId}`} size="sm" intent="ghost" onClick={acknowledge}>Dismiss</Button>
            {Boolean(error) && <Button id={`bbx-ambient-retry-${session.sessionId}`} size="sm" intent="secondary" onClick={retry}>Retry</Button>}
          </div>
        </div>
      </Accordion>
    </section>
  );
}
