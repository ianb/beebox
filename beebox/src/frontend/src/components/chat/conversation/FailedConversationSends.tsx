import { useState, useSyncExternalStore } from "react";
import type { SendBinding } from "@shared/chat-composer-binding";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Stack } from "../../../components/ui/Stack";
import { Text } from "../../../components/ui/Text";
import { bbxSource } from "../../../lib/source-tag";
import type { PendingConversationSend, PendingSendsStore } from "./pending-sends";

interface Props {
  store: PendingSendsStore;
  onRetry(row: PendingConversationSend): unknown | Promise<unknown>;
  /** Explicit restore planner; must reject if it did not restore the content. */
  onRestore(row: PendingConversationSend): void | Promise<void>;
  targetLabel?(binding: SendBinding): string;
}

function defaultTargetLabel(binding: SendBinding): string {
  const place = binding.target.contextDir || "Box conversation";
  return binding.target.kind === "start" ? `${place} · new conversation` : place;
}

/** Durable recovery entries never silently merge into the current draft. */
export function FailedConversationSends({ store, onRetry, onRestore, targetLabel }: Props) {
  const rows = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(row: PendingConversationSend, kind: "retry" | "restore"): Promise<void> {
    setError(null);
    setActing(true);
    try {
      if (kind === "retry") await onRetry(row);
      else { await onRestore(row); store.restored(row.emission.id); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The saved message could not be recovered");
    } finally { setActing(false); }
  }
  if (rows.length === 0) return null;
  return <section aria-label="Saved messages awaiting delivery">
    <Stack gap="sm">
      {rows.map((row) => <div key={row.emission.id} {...bbxSource("session",
        row.binding.target.kind === "session" ? row.binding.target.sessionId : row.binding.target.clientConversationId)}>
        <Card padding="sm" background="warm">
          <Stack gap="xs">
            <Text as="div" size="sm" weight="semibold">{(targetLabel ?? defaultTargetLabel)(row.binding)}</Text>
            <Text as="div" size="sm">{row.status === "preparing" ? "Preparing message…" : row.status === "pending" ? "Waiting to send…" : row.reason ?? "Message needs review"}</Text>
            <p className="line-clamp-3 whitespace-pre-wrap text-sm text-warm-700">{row.emission.text || "Attachments"}</p>
            <Text as="div" size="xs" tone="muted">{row.emission.images.length} images · {row.emission.files.length} files · {row.emission.selections.length} selections</Text>
            {(row.status === "rejected" || row.status === "recovered") && <div className="flex gap-2">
              <Button size="sm" disabled={acting} intent="secondary" onClick={() => act(row, "retry")}>Retry original conversation</Button>
              <Button size="sm" disabled={acting} intent="ghost" onClick={() => act(row, "restore")}>Restore to draft</Button>
            </div>}
          </Stack>
        </Card>
      </div>)}
      {error !== null && <p role="alert" className="text-sm text-danger">{error}</p>}
    </Stack>
  </section>;
}
