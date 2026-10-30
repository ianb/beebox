/** Per-box native agent harness and model policy. */

import { trpc } from "../../../lib/trpc/client";
import { CheckboxField, RadioGroup, SelectField } from "../../ui/fields/field";
import { Stack } from "../../ui/Stack";
import { Text } from "../../ui/Text";
import { ErrorText } from "../../ui/ErrorText";
import { Hint } from "../../ui/Hint";
import { chatModelOptions, parseChatAgentEngine, type AddedModel } from "@shared/chat-models.js";
import { AGENT_ENGINES, providerOf, type AgentEngine } from "@shared/agent-models.js";
import { AdminSectionCard } from "../AdminSectionCard";
import { piDefaultFor, piMissing } from "./pi";

const DESCRIPTION =
  "Choose the native harness for new chats, wakeups, and procedures. Chats with a recorded engine keep using it; legacy chats default to Claude.";

const TELEMETRY_HELPER =
  "Claude Code reports which tools and skills ran, the model, timings, and your account and device ids. " +
  "Anthropic says this never includes prompts, code, or file paths. On Pro and Max logins it also sends redacted " +
  "error reports. Applies to Claude models only; runs on other models never send it. A chat already running keeps " +
  "its setting until its agent restarts.";

const CODEX_TELEMETRY_HELPER =
  "Codex reports turns, tool calls, the model, and your login type. It also sends hashes of the lines each change " +
  "adds, which OpenAI's documentation does not mention, so this is off unless you turn it on. Takes effect when " +
  "a Codex run next starts.";

/**
 * What an OpenRouter default does to background work, and what still needs a
 * Claude login (issues/closed/bugs/2026-10-15-background-runs-ignore-box-openrouter-default.md).
 */
const OPENROUTER_BACKGROUND_HINT =
  "Background work follows this model too: wakeups, procedures, and chat titles and reviews run on OpenRouter " +
  "and need no Claude login. Still on Claude: a chat someone switches to a Claude model, quick passes when the " +
  "box's smallModel is set to a Claude model, and reading photos during scan import (unless the server sets " +
  "BBX_SCAN_VISION=gemini).";

const ENGINE_LABELS: Record<AgentEngine, string> = { claude: "Claude Code", codex: "Codex", pi: "pi" };

function engineOptions(piBlocked: string | null) {
  return [...ENGINE_OPTIONS, {
    value: "pi",
    label: "pi",
    description: piBlocked ?? "Use pi, an open-source harness, with a model added under OpenRouter models.",
    disabled: piBlocked !== null,
  }];
}

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
function modelOptions(engine: string, { current, added }: { current: string | null; added: readonly AddedModel[] }) {
  const parsed = parseChatAgentEngine(engine);
  const known = parsed === null
    ? []
    : chatModelOptions(parsed, added).flatMap((o) => (o.model === null ? [] : [{ value: o.model, label: o.label }]));
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
      <AdminSectionCard id="agent-engine" description={DESCRIPTION} busy>
        <Hint>Loading agent engine…</Hint>
      </AdminSectionCard>
    );
  }

  const engine = config.data === undefined
    ? "claude"
    : update.isPending
      ? update.variables.agentEngine ?? config.data.agentEngine
      : config.data.agentEngine;
  const model = config.data?.agentModel ?? null;
  const added = config.data?.openrouterModels ?? [];
  const keyGranted = config.data?.openrouterKeyGranted === true;
  // Choosing pi saves a default from the added list with it, so only the list and key can block the choice.
  const piBlocked = engine === "pi" ? null : piMissing({ added, keyGranted });
  const piHelper = piMissing({ added, keyGranted, ...(engine === "pi" ? { piDefault: model } : {}) });

  return (
    <AdminSectionCard id="agent-engine" description={DESCRIPTION}>
      {config.data ? (
        <>
          <RadioGroup
            label="Use for new agent work"
            idPrefix="bbx-admin-agent-engine"
            variant="cards"
            value={engine}
            options={engineOptions(piBlocked)}
            disabled={update.isPending}
            onChange={(agentEngine) => {
              const parsed = parseChatAgentEngine(agentEngine);
              if (parsed === null) return;
              update.mutate(parsed === "pi" ? { agentEngine: parsed, agentModel: piDefaultFor(model, added) } : { agentEngine: parsed });
            }}
          />
          <Stack gap="xs">
            <Text size="sm" weight="semibold">Available engines</Text>
            <Hint>
              Which harnesses a new chat may choose. Turn off an engine this box has no
              account for, so nobody starts a chat that cannot run.
            </Hint>
            {AGENT_ENGINES.map((candidate) => (
              <CheckboxField
                key={candidate}
                id={`bbx-admin-engine-enabled-${candidate}`}
                label={ENGINE_LABELS[candidate]}
                checked={candidate === engine || config.data.engines[candidate] === true}
                // The default engine cannot be turned off — a box whose default
                // engine is unavailable cannot run at all.
                // pi can still be turned off while it lacks something, never on.
                disabled={candidate === engine || update.isPending
                  || (candidate === "pi" && piBlocked !== null && config.data.engines.pi !== true)}
                helper={candidate === "pi" && piHelper !== null
                  ? piHelper
                  : candidate === engine ? "The default engine is always available." : undefined}
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
            options={modelOptions(engine, { current: model, added: config.data.openrouterModels })}
            disabled={update.isPending}
            onChange={(agentModel) => { update.mutate({ agentModel: agentModel === "" ? null : agentModel }); }}
          />
          {engine === "claude" && model !== null && providerOf(model) === "openrouter"
            ? <Hint>{OPENROUTER_BACKGROUND_HINT}</Hint>
            : null}
          <CheckboxField
            id="bbx-admin-claude-code-telemetry"
            label="Let Claude Code send usage data to Anthropic"
            checked={config.data.claudeCodeTelemetry === "on"}
            disabled={update.isPending}
            helper={TELEMETRY_HELPER}
            onChange={(checked) => { update.mutate({ claudeCodeTelemetry: checked ? "on" : "off" }); }}
          />
          <CheckboxField
            id="bbx-admin-codex-telemetry"
            label="Let Codex send usage data to OpenAI"
            checked={config.data.codexTelemetry === "on"}
            disabled={update.isPending}
            helper={CODEX_TELEMETRY_HELPER}
            onChange={(checked) => { update.mutate({ codexTelemetry: checked ? "on" : "off" }); }}
          />
        </>
      ) : null}

      {update.isPending ? (
        <div role="status"><Hint>Saving…</Hint></div>
      ) : null}
      {update.isSuccess ? (
        <div role="status"><Text size="sm" tone="emphasis">Saved.</Text></div>
      ) : null}
      {/* The server saves the config and commits it separately; a failed
          commit was previously reported and then dropped on the floor here. */}
      {update.data?.commitWarning ? (
        <div role="alert"><ErrorText>{update.data.commitWarning}</ErrorText></div>
      ) : null}
      {config.error ? (
        <div role="alert"><ErrorText>{config.error.message}</ErrorText></div>
      ) : null}
      {update.error ? (
        <div role="alert"><ErrorText>{update.error.message}</ErrorText></div>
      ) : null}
    </AdminSectionCard>
  );
}
