/**
 * Admin → OpenRouter models: the owner's act that lets this box run a model
 * OpenRouter carries, billed per use. A key alone runs nothing; each model is
 * added here, validated server-side against OpenRouter's catalog
 * (`docs/plans/openrouter-chat-models.md`). Shown only when Claude Code is an
 * enabled engine — these models ride its transport.
 */

import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Button } from "../ui/Button";
import { ErrorText } from "../ui/ErrorText";
import { Hint } from "../ui/Hint";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextField } from "../ui/fields";
import { OpenRouterModelRow, OpenRouterUsageLine } from "./OpenRouterModelsSection-parts";
import { AdminSectionCard } from "./AdminSectionCard";

const DESCRIPTION =
  "Models added here appear in the chat model picker and can be the box default. Each one is billed " +
  "per use to your OpenRouter account at the prices shown — there is no flat rate. Consider a spending " +
  "limit on the key at openrouter.ai. Models other than Claude may fail agent turns that need tools. " +
  "OpenRouter picks the host for each request according to your account’s privacy settings.";

/** Models that passed a real agent turn through OpenRouter (plan, Track 1 results). */
const SUGGESTIONS = [
  { id: "moonshotai/kimi-k2-0905:exacto", label: "Kimi K2" },
  { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2" },
  { id: "qwen/qwen3-coder", label: "Qwen3 Coder" },
];

export function OpenRouterModelsSection() {
  const config = trpc.admin.boxConfig.useQuery();
  const claudeEnabled = config.data !== undefined
    && (config.data.agentEngine === "claude" || config.data.engines.claude === true);
  if (config.data === undefined) return <AdminSectionCard id="openrouter-models" description={DESCRIPTION} busy><Hint>Loading…</Hint></AdminSectionCard>;
  // The section keeps its address when it does not apply, so the overview and an agent can still point at it.
  if (!claudeEnabled) return <AdminSectionCard id="openrouter-models" description={DESCRIPTION}><Hint>Not available: Claude Code is off for this box. Turn it on under Agent engine and model.</Hint></AdminSectionCard>;
  return <OpenRouterModelsCard defaultModel={config.data.agentModel} />;
}

/** `defaultModel` comes from the box-config query the default-model select also writes, so the two never disagree. */
function OpenRouterModelsCard({ defaultModel }: { defaultModel: string | null }) {
  const utils = trpc.useUtils();
  const list = trpc.admin.openrouterModels.useQuery();
  const invalidate = async () => {
    await Promise.all([utils.admin.openrouterModels.invalidate(), utils.admin.boxConfig.invalidate()]);
  };
  const add = trpc.admin.addOpenrouterModel.useMutation({ onSuccess: invalidate });
  const remove = trpc.admin.removeOpenrouterModel.useMutation({ onSuccess: invalidate });
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");

  const addedIds = new Set(list.data?.models.map((m) => m.id));
  const suggestions = SUGGESTIONS.filter((s) => !addedIds.has(s.id));
  const commitWarning = add.data?.commitWarning ?? remove.data?.commitWarning ?? null;

  return (
    <AdminSectionCard id="openrouter-models" description={DESCRIPTION} busy={list.isLoading}>
      {list.isLoading ? <Hint>Loading OpenRouter models…</Hint> : null}
      {list.error ? (
        <div role="alert">
          <ErrorText>{list.error.message}</ErrorText>
          <Button className="self-start mt-1" size="sm" onClick={() => { void list.refetch(); }}>Retry</Button>
        </div>
      ) : null}

      {list.data ? (
        <>
          {list.data.keyGranted
            ? <OpenRouterUsageLine usage={list.data.usage} />
            : <Text size="sm" tone="emphasis">This box has no OpenRouter key yet. Added models will refuse to run until an <code>openrouter</code> key is set and granted under Secrets below.</Text>}
          {list.data.models.length === 0
            ? <Hint>No OpenRouter models added. Nothing on this box can bill OpenRouter for chat until you add one.</Hint>
            : (
              <ul className="list-none p-0 m-0 flex flex-col gap-3" aria-label="Added OpenRouter models">
                {list.data.models.map((model) => (
                  <OpenRouterModelRow
                    key={model.id}
                    model={model}
                    isDefault={model.id === defaultModel}
                    removing={remove.isPending ? remove.variables.id === model.id : false}
                    onRemove={() => { remove.mutate({ id: model.id }); }}
                  />
                ))}
              </ul>
            )}
        </>
      ) : null}

      <form
        aria-label="Add an OpenRouter model"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate({ id, label }, { onSuccess: () => { setId(""); setLabel(""); } });
        }}
      >
        <Stack gap="sm">
          <Text size="sm" weight="semibold">Add a model</Text>
          {suggestions.length > 0 ? (
            <Row gap="xs" wrap>
              <Text size="xs" tone="muted">Tested:</Text>
              {suggestions.map((s) => (
                <Button key={s.id} size="sm" intent="ghost" onClick={() => { setId(s.id); setLabel(s.label); }}>
                  {s.label}
                </Button>
              ))}
            </Row>
          ) : null}
          <TextField
            id="bbx-admin-openrouter-id"
            label="Model id"
            helper="As written on openrouter.ai/models, e.g. deepseek/deepseek-v3.2. A :exacto suffix routes to hosts with the best measured tool calling."
            value={id}
            onChange={setId}
            required
            spellCheck={false}
            autoCapitalize="none"
          />
          <TextField id="bbx-admin-openrouter-label" label="Label" helper="What the chat picker shows." value={label} onChange={setLabel} required maxLength={60} />
          <Button id="bbx-admin-openrouter-add" type="submit" intent="primary" className="self-start" loading={add.isPending} disabled={id.trim() === "" || label.trim() === ""}>
            Add model
          </Button>
          {add.error ? <div role="alert"><ErrorText>{add.error.message}</ErrorText></div> : null}
        </Stack>
      </form>

      {remove.error ? <div role="alert"><ErrorText>{remove.error.message}</ErrorText></div> : null}
      {commitWarning ? <div role="alert"><ErrorText>{commitWarning}</ErrorText></div> : null}
    </AdminSectionCard>
  );
}
