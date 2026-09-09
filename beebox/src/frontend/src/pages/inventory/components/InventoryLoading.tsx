import { Card } from "../../../components/ui/Card";
import { Stack } from "../../../components/ui/Stack";

export function InventoryLoading() {
  return (
    <Card aria-label="Loading storage" aria-busy>
      <Stack gap="md">
        <div className="h-5 w-48 animate-pulse rounded bg-warm-200" />
        <div className="h-80 animate-pulse rounded bg-warm-100" />
      </Stack>
    </Card>
  );
}
