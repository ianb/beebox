import { useState } from "react";
import { errorMessage } from "@shared/error-guards";
import { useParams } from "@tanstack/react-router";
import { trpc, trpcClient } from "../../lib/trpc";
import { Column } from "../../components/ui/Column";
import { Stack } from "../../components/ui/Stack";
import { Text } from "../../components/ui/Text";
import { InventoryContent } from "./components/InventoryContent";
import { InventoryError } from "./components/InventoryError";
import { InventoryHeader } from "./components/InventoryHeader";
import { InventoryLoading } from "./components/InventoryLoading";

type Projection = "grouped" | "direct";
type Metric = "count" | "bytes";

export function InventoryPage() {
  const { boxSlug } = useParams({ strict: false });
  const [projection, setProjection] = useState<Projection>("grouped");
  const [metric, setMetric] = useState<Metric>("count");
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
        <InventoryHeader boxSlug={boxSlug} refreshing={refreshing} refresh={refresh} refreshError={refreshError} />
        {inventory.isLoading ? (
          <InventoryLoading />
        ) : inventory.error !== null ? (
          <InventoryError message={inventory.error.message} refresh={refresh} />
        ) : data === undefined ? (
          <Text as="p" tone="danger">The inventory query completed without data.</Text>
        ) : (
          <InventoryContent
            data={data}
            metric={metric}
            projection={projection}
            setMetric={setMetric}
            setProjection={setProjection}
          />
        )}
      </Stack>
    </Column>
  );
}
