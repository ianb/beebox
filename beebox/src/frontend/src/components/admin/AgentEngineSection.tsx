/** Per-box native agent harness and model policy. */

import { trpc } from "../../lib/trpc";
import { Card } from "../ui/Card";
import { CheckboxField, RadioGroup, SelectField } from "../ui/fields";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { chatModelOptions, parseChatAgentEngine } from "@shared/chat-models.js";
import { AGENT_ENGINES } from "@shared/agent-models.js";

const ENGINE_LABELS: Record<string, string> = { claude: "Claude Code", codex: "Codex" };

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

/** The select's rows: "no default", then every model this engine offers. */
function modelOptions(engine: string, current: string | null) {
  const parsed = parseChatAgentEngine(engine);
  const known = parsed === null
    ? []
    : chatModelOptions(parsed).flatMap((o) => (o.model === null ? [] : [{ value: o.model, label: o.label }]));
  // A stored value this engine does not offer still has to be selectable, or
  // the select would silently show something the box is not set to.
  const unknown = current !== null && !known.some((o) => o.value === current)
    ? [{ value: current, label: `${current} (not available for this engine)` }]
    : [];
  return [{ value: "", label: "No default — use the harness default" }, ...known, ...unknown];
}

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

  const engine = config.data === undefined
    ? "claude"
    : update.isPending
      ? update.variables.agentEngine ?? config.data.agentEngine
      : config.data.agentEngine;
  const model = config.data?.agentModel ?? null;

  return (
    <Card as="section" aria-labelledby="agent-engine-heading" shadow>
      <Stack gap="md">
        <Stack gap="xs">
          <div id="agent-engine-heading">
            <Text as="h2" size="lg" weight="semibold">Agent engine and model</Text>
          </div>
          <Text size="sm" tone="muted">
            Choose the native harness for new chats, wakeups, and procedures. Chats with a recorded engine
            keep using it; legacy chats default to Claude.
          </Text>
        </Stack>

        {config.data ? (
          <>
            <RadioGroup
              label="Use for new agent work"
              idPrefix="bbx-admin-agent-engine"
              variant="cards"
              value={engine}
              options={ENGINE_OPTIONS}
              disabled={update.isPending}
              onChange={(agentEngine) => {
                if (agentEngine !== "claude" && agentEngine !== "codex") return;
                update.mutate({ agentEngine });
              }}
            />
            <Stack gap="xs">
              <Text size="sm" weight="semibold">Available engines</Text>
              <Text size="sm" tone="muted">
                Which harnesses a new chat may choose. Turn off an engine this box has no
                account for, so nobody starts a chat that cannot run.
              </Text>
              {AGENT_ENGINES.map((candidate) => (
                <CheckboxField
                  key={candidate}
                  id={`bbx-admin-engine-enabled-${candidate}`}
                  label={ENGINE_LABELS[candidate] ?? candidate}
                  checked={candidate === engine || config.data.engines[candidate] === true}
                  // The default engine cannot be turned off — a box whose default
                  // engine is unavailable cannot run at all.
                  disabled={candidate === engine || update.isPending}
                  helper={candidate === engine ? "The default engine is always available." : undefined}
                  onChange={(checked) => {
                    update.mutate({ engines: { ...config.data.engines, [candidate]: checked } });
                  }}
                />
              ))}
            </Stack>
            <SelectField
              id="bbx-admin-agent-model"
              label="Default model"
              helper="New chats and unpinned agent work — wakeups, procedures without an explicit model — use this model. A chat can still pick its own."
              value={model ?? ""}
              options={modelOptions(engine, model)}
              disabled={update.isPending}
              onChange={(agentModel) => { update.mutate({ agentModel: agentModel === "" ? null : agentModel }); }}
            />
          </>
        ) : null}

        {update.isPending ? (
          <div role="status"><Text size="sm" tone="muted">Saving…</Text></div>
        ) : null}
        {update.isSuccess ? (
          <div role="status"><Text size="sm" tone="emphasis">Saved.</Text></div>
        ) : null}
        {/* The server saves the config and commits it separately; a failed
            commit was previously reported and then dropped on the floor here. */}
        {update.data?.commitWarning ? (
          <div role="alert"><Text size="sm" tone="danger">{update.data.commitWarning}</Text></div>
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
