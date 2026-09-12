import { useState } from "react";
import { errorMessage } from "@shared/error-guards";
import { trpc, trpcClient } from "../../lib/trpc";
import { DEFAULT_INVENTORY_CARD_STATE, inventoryCardViewState, parseInventoryCardState, type InventoryCardState } from "../../lib/inventory-card-state";
import type { ViewState } from "@shared/view-state";
import { Column } from "../../components/ui/Column";
import { Stack } from "../../components/ui/Stack";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { InventoryContent } from "./components/InventoryContent";
import { InventoryError } from "./components/InventoryError";
import { InventoryHeader } from "./components/InventoryHeader";
import { InventoryLoading } from "./components/InventoryLoading";

export function InventoryCardBody({ viewState, onViewStateChange }: { viewState: ViewState | null; onViewStateChange: (state: ViewState, mode?: "push" | "replace") => void }) {
  const parsed = parseInventoryCardState(viewState);
  const state = parsed.ok ? parsed.state : DEFAULT_INVENTORY_CARD_STATE;
  const inventory = trpc.inventory.summary.useQuery(undefined, { staleTime: 15 * 60 * 1000 });
  const utils = trpc.useUtils();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const result = await trpcClient.inventory.summary.query({ refresh: true });
      utils.inventory.summary.setData(undefined, result);
    } catch (error) {
      setRefreshError(errorMessage(error));
    } finally {
      setRefreshing(false);
    }
  }

  const data = inventory.data;
  return (
    <Column overflow="auto" className="h-full">
      <Stack gap="lg" className="w-full max-w-5xl mx-auto py-6 px-4">
        <InventoryHeader refreshing={refreshing} refresh={refresh} refreshError={refreshError} />
        {parsed.ok ? null : <Stack gap="xs"><Text as="p" tone="danger">{parsed.error}</Text><Button intent="secondary" size="sm" onClick={() => onViewStateChange(inventoryCardViewState(DEFAULT_INVENTORY_CARD_STATE), "replace")}>Reset controls</Button></Stack>}
        {inventory.isLoading ? (
          <InventoryLoading />
        ) : inventory.error !== null ? (
          <InventoryError message={inventory.error.message} refresh={refresh} />
        ) : data === undefined ? (
          <Text as="p" tone="danger">The inventory query completed without data.</Text>
        ) : (
          <InventoryContent
            data={data}
            metric={state.metric}
            linkStatus={state.linkStatus}
            projection={state.projection}
            setMetric={(metric) => updateState({ ...state, metric })}
            setLinkStatus={(linkStatus) => updateState({ ...state, linkStatus })}
            setProjection={(projection) => updateState({ ...state, projection })}
          />
        )}
      </Stack>
    </Column>
  );

  function updateState(next: InventoryCardState): void {
    onViewStateChange(inventoryCardViewState(next), "replace");
  }
}
