/**
 * Page-local chat appearance pieces for ActivityChatPage — headers,
 * error bars, streaming turn, composer. These own Tailwind appearance
 * classes so the page file stays within the page-level layout-only
 * convention (see CONVENTIONS.md).
 */

import { useState } from "react";
import { Grid } from "ldrs/react";
import "ldrs/react/Grid.css";
import { Link, useParams } from "@tanstack/react-router";
import { MarkdownContent, ToolList } from "../../../components/ChatMessages";
import type { SessionContentBlock } from "../../../api";
import { Button } from "../../../components/ui/Button";
import { Row } from "../../../components/ui/Row";
import { Stack } from "../../../components/ui/Stack";
import { Text } from "../../../components/ui/Text";
import { SelectField } from "../../../components/ui/fields";

export function ActivityHeader({
  type,
  instance,
  modes,
  mode,
  onModeChange,
}: {
  type: string;
  instance: string;
  modes: Array<{ name: string; isDefault: boolean }>;
  mode: string;
  onModeChange: (mode: string) => void;
}) {
  const { boxSlug } = useParams({ strict: false });
  return (
    <div className="border-b border-warm-200 px-4 py-3">
      <Row justify="between" align="center" wrap>
        <Stack gap="none">
          <Text as="div" size="lg" weight="bold">{instance}</Text>
          <Text as="div" tone="subtle" size="sm">
            <Link
              to="/$boxSlug/activities"
              params={{ boxSlug: boxSlug !== undefined ? boxSlug : "" }}
              className="text-primary hover:text-primary-dark hover:underline"
            >
              {type}
            </Link>
          </Text>
        </Stack>
        {modes.length > 1 ? (
          <SelectField
            label="Mode"
            hideLabel
            value={mode}
            onChange={onModeChange}
            options={modes.map((m) => ({ value: m.name, label: m.name }))}
          />
        ) : null}
      </Row>
    </div>
  );
}

export function StreamingTurn({
  streamText,
  streamTools,
}: {
  streamText: string;
  streamTools: SessionContentBlock[];
}) {
  return (
    <div className="pr-4 sm:pr-24 pl-3 sm:pl-6 py-2">
      {streamText !== "" ? <MarkdownContent text={streamText} /> : null}
      {streamTools.length > 0 ? (
        <div className="pt-2">
          <ToolList blocks={streamTools} />
        </div>
      ) : null}
      <div className="flex justify-center mt-6">
        <Grid size={40} color="#D4845A" speed={1.5} />
      </div>
    </div>
  );
}

export function ErrorBar({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="px-4 py-2 border-t border-danger/30 bg-danger-50">
      <Row justify="between" align="center" gap="sm">
        <Text tone="danger" size="sm">{message}</Text>
        <Button intent="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
      </Row>
    </div>
  );
}

export function ChatComposer({
  busy,
  resetting,
  onSend,
  onReset,
}: {
  busy: boolean;
  resetting: boolean;
  onSend: (text: string) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") return;
    onSend(trimmed);
    setDraft("");
  };

  return (
    <div className="border-t border-warm-200 px-3 py-2">
      <Row gap="sm" align="end">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Type a message…"
          rows={2}
          className="flex-1 resize-none rounded border border-warm-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <Stack gap="xs">
          <Button intent="primary" onClick={submit} disabled={draft.trim() === ""} loading={busy}>
            Send
          </Button>
          <Button intent="ghost" size="sm" onClick={onReset} loading={resetting}>
            Reset
          </Button>
        </Stack>
      </Row>
    </div>
  );
}
