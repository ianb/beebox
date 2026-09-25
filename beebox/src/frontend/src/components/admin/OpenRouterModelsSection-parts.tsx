/** Presentational pieces of the OpenRouter models admin section: one model row, the key-usage line. */

import type { RouterOutput } from "../../lib/trpc";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Hint } from "../ui/Hint";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";

type OpenRouterModels = RouterOutput["admin"]["openrouterModels"];
type AddedModelView = OpenRouterModels["models"][number];

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function perMTok(price: number | null): string {
  return price === null ? "—" : `$${price}`;
}

function describeCatalog(catalog: AddedModelView["catalog"]): string {
  if (!catalog.ok) return `Price unavailable: ${catalog.error}`;
  if (!catalog.found) return "No longer in OpenRouter's catalog — turns on it will fail.";
  const { pricing, contextLength } = catalog.model;
  const context = contextLength === null ? "" : ` · ${Math.round(contextLength / 1000)}k context`;
  return `${perMTok(pricing.promptPerMTok)} in / ${perMTok(pricing.completionPerMTok)} out per million tokens${context}`;
}

export function OpenRouterModelRow(
  { model, isDefault, removing, onRemove }: { model: AddedModelView; isDefault: boolean; removing: boolean; onRemove: () => void },
) {
  return (
    <li>
      <Row justify="between" align="start" gap="md">
        <Stack gap="none" className="min-w-0">
          <Row gap="xs" wrap>
            <Text weight="semibold">{model.label}</Text>
            {isDefault ? <Badge tone="info" size="sm">Box default</Badge> : null}
          </Row>
          <Text size="xs" mono tone="muted" breakAll>{model.id}</Text>
          <Hint>{describeCatalog(model.catalog)}</Hint>
        </Stack>
        <Button
          size="sm"
          intent="secondary"
          loading={removing}
          disabled={isDefault}
          title={isDefault ? "Change the default model first" : undefined}
          onClick={onRemove}
        >
          Remove
        </Button>
      </Row>
    </li>
  );
}

/** What the key has spent — the key's whole figure, across every use of it, never a flat rate. */
export function OpenRouterUsageLine({ usage }: { usage: OpenRouterModels["usage"] }) {
  if (usage === null) return null;
  if (!usage.ok) return <Hint>Key usage unavailable: {usage.error}</Hint>;
  const { totalUsd, monthUsd, limitUsd, limitRemainingUsd } = usage.usage;
  const limit = limitUsd === null
    ? "No spending limit is set on this key."
    : `Spending limit ${usd.format(limitUsd)}${limitRemainingUsd === null ? "" : `, ${usd.format(limitRemainingUsd)} left`}.`;
  return (
    <Hint>
      This OpenRouter key has spent {usd.format(monthUsd)} this month ({usd.format(totalUsd)} in total), across every
      use of the key — chat, search, and transcription. {limit} OpenRouter updates this figure a minute or more after use.
    </Hint>
  );
}
