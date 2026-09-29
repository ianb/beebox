/**
 * The status row of a browser-task card: open/closed badge, the derived
 * lifecycle state (never scanned, current, due), inbox counts, the subject
 * link, and the owner's open/closed control.
 */

import { Badge } from "../ui/Badge";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { ErrorText } from "../ui/ErrorText";
import { Toggle } from "../ui/Toggle";
import { InlineAction } from "../ui/InlineAction";
import { FriendlyDate } from "../ui/FriendlyDate";
import { trpc } from "../../lib/trpc/client";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { browserTaskState, describeBrowserTaskState } from "@shared/browser-task-state";
import type { RendererProps } from "../../file-type-registry";
import type { BatchSummary } from "./data";

export interface TaskStatusProps {
  cardPath: string;
  closed: boolean;
  lastUpload: string | null;
  rescanAfter: string | null;
  subjectRef: string | null;
  inbox: BatchSummary[];
  processedCount: number;
  /** When the attach data was fetched; ages are computed against it, not render time. */
  loadedAt: number | null;
  error: string | null;
  onNavigate: RendererProps["onNavigate"];
}

export function TaskStatus(props: TaskStatusProps) {
  const { cardPath, closed, lastUpload, rescanAfter, subjectRef, inbox, processedCount, loadedAt, error, onNavigate } = props;
  const state = loadedAt === null ? null : browserTaskState({ closed, lastUpload, rescanAfter }, loadedAt);
  const draining = inbox.filter((b) => b.filed.length > 0 && b.records !== null && b.filed.length < b.records).length;
  return (
    <Stack gap="xs">
      <Row gap="sm" align="center" wrap>
        <Badge tone={closed ? "neutral" : "success"}>{closed ? "closed" : "open"}</Badge>
        {state !== null && state.kind !== "closed" ? (
          <Badge tone={state.kind === "due" ? "warning" : state.kind === "never-scanned" ? "info" : "neutral"}>{describeBrowserTaskState(state)}</Badge>
        ) : null}
        <ClosedToggle closed={closed} cardPath={cardPath} />
      </Row>
      <Row gap="sm" align="center" wrap>
        {loadedAt !== null ? (
          <Text as="span" size="sm">
            {String(inbox.length)} in inbox, {String(processedCount)} processed
            {draining > 0 ? `, ${String(draining)} being drained` : ""}
          </Text>
        ) : null}
        {lastUpload !== null ? (
          <Text as="span" size="sm" tone="subtle">last upload <FriendlyDate iso={lastUpload} /></Text>
        ) : null}
        {subjectRef !== null ? (
          <Text as="span" size="sm" tone="subtle">
            about <InlineAction intent="emphatic" onClick={() => onNavigate({ path: subjectRef, viewer: null, params: {}, viewState: null })}>{subjectRef.split("/").at(-1) ?? subjectRef}</InlineAction>
          </Text>
        ) : null}
      </Row>
      {error !== null ? <ErrorText>{error}</ErrorText> : null}
    </Stack>
  );
}

/** The boxholder's open/closed control. Owner only; an executor never sees it. */
function ClosedToggle({ closed, cardPath }: { closed: boolean; cardPath: string }) {
  const user = useCurrentUser();
  const utils = trpc.useUtils();
  const mutation = trpc.browserTask.setClosed.useMutation({
    onSuccess: async () => {
      await utils.card.get.invalidate({ path: cardPath });
      await utils.browserTask.list.invalidate();
    },
  });
  if (user === null || !user.isOwner) return null;
  return (
    <Toggle
      checked={!closed}
      disabled={mutation.isPending}
      label={closed ? "Closed" : "Accepting batches"}
      onChange={(open) => mutation.mutate({ path: cardPath, closed: !open })}
    />
  );
}
