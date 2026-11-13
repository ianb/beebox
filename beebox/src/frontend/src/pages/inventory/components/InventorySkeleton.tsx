import { Card } from "../../../components/ui/Card";
import { Skeleton } from "../../../components/ui/Skeleton";
import { Stack } from "../../../components/ui/Stack";

export function InventorySkeleton() {
  return (
    <Card aria-label="Loading storage" aria-busy>
      <Stack gap="md">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-80" />
      </Stack>
    </Card>
  );
}
