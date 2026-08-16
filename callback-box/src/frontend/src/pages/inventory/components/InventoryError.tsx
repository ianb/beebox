import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Stack } from "../../../components/ui/Stack";
import { Text } from "../../../components/ui/Text";

export function InventoryError({ message, refresh }: { message: string; refresh: () => Promise<void> }) {
  return (
    <Card aria-label="File inventory error">
      <Stack gap="sm">
        <Text as="h2" size="lg" weight="semibold">Couldn’t scan this box</Text>
        <Text as="p" tone="danger">{message}</Text>
        <Button intent="secondary" size="sm" onClick={refresh}>Try again</Button>
      </Stack>
    </Card>
  );
}
