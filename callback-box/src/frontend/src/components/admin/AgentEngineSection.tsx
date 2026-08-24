/** Per-box native agent harness selection. */

import { trpc } from "../../lib/trpc";
import { Card } from "../ui/Card";
import { RadioGroup } from "../ui/fields";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";

const ENGINE_OPTIONS = [
  {
    value: "claude",
    label: "Claude Code",
    description: "Use Claude Code for new chats, wakeups, and procedures.",
  },
  {
    value: "codex",
    label: "Codex",
    description: "Use Codex for new chats, wakeups, and procedures.",
  },
];

export function AgentEngineSection() {
  const utils = trpc.useUtils();
  const config = trpc.admin.boxConfig.useQuery();
  const update = trpc.admin.updateBoxConfig.useMutation({
    onSuccess: async () => utils.admin.boxConfig.invalidate(),
  });

  if (config.isLoading) {
    return (
      <Card as="section" aria-label="Agent engine" shadow aria-busy>
        <Text size="sm" tone="muted">Loading agent engine…</Text>
      </Card>
    );
  }

  return (
    <Card as="section" aria-labelledby="agent-engine-heading" shadow>
      <Stack gap="md">
        <Stack gap="xs">
          <div id="agent-engine-heading">
            <Text as="h2" size="lg" weight="semibold">Agent Engine</Text>
          </div>
          <Text size="sm" tone="muted">
            Choose the native harness for new chats, wakeups, and procedures. Chats with a recorded engine
            keep using it; legacy chats default to Claude.
          </Text>
        </Stack>

        {config.data ? (
          <RadioGroup
            label="Use for new agent work"
            idPrefix="cb-admin-agent-engine"
            variant="cards"
            value={update.isPending
              ? update.variables.agentEngine ?? config.data.agentEngine
              : config.data.agentEngine}
            options={ENGINE_OPTIONS}
            disabled={update.isPending}
            onChange={(agentEngine) => {
              if (agentEngine !== "claude" && agentEngine !== "codex") return;
              update.mutate({ agentEngine });
            }}
          />
        ) : null}

        {update.isPending ? (
          <div role="status"><Text size="sm" tone="muted">Saving…</Text></div>
        ) : null}
        {update.isSuccess ? (
          <div role="status"><Text size="sm" tone="emphasis">Saved.</Text></div>
        ) : null}
        {config.error ? (
          <div role="alert"><Text size="sm" tone="danger">{config.error.message}</Text></div>
        ) : null}
        {update.error ? (
          <div role="alert"><Text size="sm" tone="danger">{update.error.message}</Text></div>
        ) : null}
      </Stack>
    </Card>
  );
}
