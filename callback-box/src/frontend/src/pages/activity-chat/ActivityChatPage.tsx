/**
 * Chat UI for a single activity instance. URL picks `(type, instance)`;
 * mode comes from a dropdown (default-mode selected on first load). Reuses
 * the message bubble primitives from ChatMessages — the state lives in
 * `activityChatMachine`, fed by tRPC + the global SSE event bus
 * (`activity-chat-*` events).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useMachine } from "@xstate/react";
import { trpc } from "../../lib/trpc";
import { getEventSourceBase } from "../../api";
import { useSSE } from "../../hooks/useSSE";
import { activityChatMachine } from "../../machines/activityChatMachine";
import {
  UserMessage,
  AssistantMessage,
  CompactionMessage,
  groupMessages,
} from "../../components/ChatMessages";
import { Column } from "../../components/ui/Column";
import { Stack } from "../../components/ui/Stack";
import { Text } from "../../components/ui/Text";
import {
  ActivityHeader,
  StreamingTurn,
  ErrorBar,
  ChatComposer,
} from "./components/chat-pieces";

export function ActivityChatPage() {
  const { type, instance } = useParams({ from: "/$boxSlug/activities/$type/$instance" });
  const modesQuery = trpc.activities.getModes.useQuery({ type, instance });

  if (modesQuery.isLoading) {
    return <Text as="div" tone="subtle" className="p-8">Loading…</Text>;
  }
  if (modesQuery.error !== null) {
    return (
      <Text as="div" tone="danger" className="p-8">
        Couldn't load activity: {modesQuery.error.message}
      </Text>
    );
  }
  const data = modesQuery.data;
  if (data === undefined || data.modes.length === 0) {
    return <Text as="div" tone="subtle" className="p-8">No modes available for this instance.</Text>;
  }

  return <ActivityChatInner type={type} instance={instance} modes={data.modes} defaultMode={data.defaultMode} />;
}

function ActivityChatInner({
  type,
  instance,
  modes,
  defaultMode,
}: {
  type: string;
  instance: string;
  modes: Array<{ name: string; isDefault: boolean }>;
  defaultMode: string | null;
}) {
  const initialMode = defaultMode !== null ? defaultMode : modes[0].name;
  const [mode, setMode] = useState(initialMode);

  return (
    <Column className="h-full">
      <ActivityHeader type={type} instance={instance} modes={modes} mode={mode} onModeChange={setMode} />
      <ActivityChatSession key={`${type}/${instance}/${mode}`} type={type} instance={instance} mode={mode} />
    </Column>
  );
}

function ActivityChatSession({
  type,
  instance,
  mode,
}: {
  type: string;
  instance: string;
  mode: string;
}) {
  const chatKey = useMemo(() => ({ type, instance, mode }), [type, instance, mode]);
  const [snapshot, send] = useMachine(activityChatMachine, { input: chatKey });

  const { messages, streamText, streamTools, error, totalEntries } = snapshot.context;
  const isStreaming = snapshot.matches("streaming");
  const isBusy = isStreaming || snapshot.matches("refreshing") || snapshot.matches("resetting");

  const groups = useMemo(() => groupMessages(messages), [messages]);

  useSSE(`${getEventSourceBase()}/events`, {
    onEvent: (event) => {
      const data = event.data as
        | { activityType?: string; instanceName?: string; modeName?: string; msg?: unknown; text?: string }
        | undefined;
      if (data === undefined) return;
      if (
        data.activityType !== type ||
        data.instanceName !== instance ||
        data.modeName !== mode
      ) {
        return;
      }
      if (event.event === "activity-chat-message") {
        const msg = data.msg as
          | { type?: string; message?: { content?: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown> }> } }
          | undefined;
        if (msg === undefined) return;
        if (msg.type === "assistant" && msg.message !== undefined && Array.isArray(msg.message.content)) {
          for (const block of msg.message.content) {
            if (block.type === "text" && typeof block.text === "string") {
              send({ type: "STREAM_TEXT", text: block.text });
            } else if (block.type === "tool_use") {
              send({
                type: "STREAM_TOOL",
                tool: {
                  type: "tool_use",
                  toolName: block.name,
                  toolId: block.id,
                  input: block.input,
                  inputSummary: block.name !== undefined ? block.name : "",
                },
              });
            }
          }
        } else if (msg.type === "result") {
          send({ type: "STREAM_RESULT" });
        } else if (msg.type === "error") {
          const errMsg = (msg as { error?: string }).error;
          send({ type: "STREAM_ERROR", error: errMsg !== undefined ? errMsg : "Unknown error" });
        }
      } else if (event.event === "activity-chat-done") {
        send({ type: "REFRESH" });
      }
    },
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, streamText, isStreaming]);

  return (
    <>
      <Column overflow="auto" className="flex-1">
        <div ref={scrollRef} className="flex-1">
          <Stack gap="none" className="max-w-3xl mx-auto py-4">
            {totalEntries > messages.length ? (
              <Text as="div" tone="subtle" size="sm" center>
                {totalEntries - messages.length} earlier messages not shown
              </Text>
            ) : null}
            {groups.map((group, i) => {
              if (group.type === "compaction") {
                return <CompactionMessage key={i} entries={group.entries} />;
              }
              if (group.type === "user") {
                return <UserMessage key={i} entries={group.entries} />;
              }
              if (group.type === "assistant") {
                return <AssistantMessage key={i} entries={group.entries} />;
              }
              return null;
            })}
            {isStreaming ? <StreamingTurn streamText={streamText} streamTools={streamTools} /> : null}
          </Stack>
        </div>
      </Column>
      {error !== null ? (
        <ErrorBar message={error} onDismiss={() => send({ type: "DISMISS_ERROR" })} />
      ) : null}
      <ChatComposer
        busy={isBusy}
        resetting={snapshot.matches("resetting")}
        onSend={(text) => send({ type: "SEND", message: text })}
        onReset={() => send({ type: "NEW_SESSION" })}
      />
    </>
  );
}
