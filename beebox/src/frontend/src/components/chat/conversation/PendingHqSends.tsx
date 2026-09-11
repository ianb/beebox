import { useState, useSyncExternalStore } from "react";
import type { SendBinding } from "@shared/chat-composer-binding";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Stack } from "../../../components/ui/Stack";
import { Text } from "../../../components/ui/Text";
import { bbxSource } from "../../../lib/source-tag";
import { trpc } from "../../../lib/trpc";
import { hqStatusLine } from "../../../lib/audio/hq-wait";
import { recordLateFallBack, voiceHandoffCalls } from "../../../lib/audio/await-hq";
import { resolveAwaitingHq, type AwaitingHqChoice } from "./awaiting-hq";
import type { EmissionDispatch } from "./use-bound-emission";
import type { PendingConversationSend, PendingSendsStore } from "./pending-sends";

/** How often a waiting item re-reads its HQ status. */
const STATUS_REFRESH_MS = 15_000;

interface Props {
  store: PendingSendsStore;
  /** Capture the row's original destination for the send. */
  capture: (binding: SendBinding) => EmissionDispatch;
}

/**
 * Voice messages a reload interrupted while they waited for their HQ
 * transcript (docs/plans/resilient-voice-recording.md, Track 4). Each shows
 * the box's HQ status and offers the two sends; nothing is ever sent on its
 * own (boxholder decision 1). Dismissing leaves the recording on the box.
 */
export function PendingHqSends({ store, capture }: Props) {
  const saved = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const rows = saved.filter((row) => row.status === "awaitingHq");
  if (rows.length === 0) return null;
  return (
    <section aria-label="Voice messages waiting for their HQ transcript">
      <Stack gap="sm">
        {rows.map((row) => row.recordingId === undefined ? null : (
          <PendingHqRow key={row.emission.id} row={row} recordingId={row.recordingId} store={store} capture={capture} />
        ))}
      </Stack>
    </section>
  );
}

function PendingHqRow({ row, recordingId, store, capture }: {
  row: PendingConversationSend;
  recordingId: string;
  store: PendingSendsStore;
  capture: (binding: SendBinding) => EmissionDispatch;
}) {
  const status = trpc.voiceRecording.status.useQuery({ recordingId }, { refetchInterval: STATUS_REFRESH_MS });
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hq = status.data?.hq;
  const line = status.isError
    ? "Box unreachable — the recording is kept on the box"
    // A retry countdown is measured from when this status was read.
    : hq === undefined ? "Checking the HQ transcript…" : hqStatusLine({ kind: "status", hq }, { uploading: false, now: status.dataUpdatedAt });

  async function act(choice: AwaitingHqChoice): Promise<void> {
    setError(null);
    setActing(true);
    try {
      const resolution = await resolveAwaitingHq({ row, recordingId, choice, box: voiceHandoffCalls });
      if (resolution.kind === "not-ready") {
        setError("The HQ transcript is not ready yet");
        void status.refetch();
        return;
      }
      const dispatch = capture(row.binding);
      const receipt = dispatch(resolution.emission);
      if (resolution.recordLate) {
        recordLateFallBack({ recordingId, emissionId: resolution.emission.id, sessionId: dispatch.assignedSessionId() })
          .catch((cause: unknown) => console.error(`[voice-send] ${recordingId}: the HQ fallback was never recorded:`, cause));
      }
      await receipt;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The voice message could not be sent");
    } finally {
      setActing(false);
    }
  }

  const target = row.binding.target;
  return (
    <div {...bbxSource("session", target.kind === "session" ? target.sessionId : target.clientConversationId)}>
      <Card padding="sm" background="warm">
        <Stack gap="xs">
          <Text as="div" size="sm" weight="semibold">Voice message waiting for its HQ transcript</Text>
          <div role="status"><Text as="span" size="sm">{line}</Text></div>
          <p className="line-clamp-3 whitespace-pre-wrap text-sm text-warm-700">{row.emission.text || "Recording without live text"}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={acting || hq?.state !== "ready"} intent="secondary" onClick={() => act("hq")}>Send HQ transcript</Button>
            <Button size="sm" disabled={acting} intent="secondary" onClick={() => act("live")}>Send live text</Button>
            <Button size="sm" disabled={acting} intent="ghost" onClick={() => store.dismissed(row.emission.id)}>Dismiss</Button>
          </div>
          {error !== null && <p role="alert" className="text-sm text-danger">{error}</p>}
        </Stack>
      </Card>
    </div>
  );
}
