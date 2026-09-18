import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Stack } from "../../../components/ui/Stack";
import { ErrorText } from "../../../components/ui/ErrorText";
import { Heading } from "../../../components/ui/Heading";

export function InventoryError({ message, refresh }: { message: string; refresh: () => Promise<void> }) {
  return (
    <Card aria-label="Storage error">
      <Stack gap="sm">
        <Heading level={2}>Couldn’t scan this box</Heading>
        <ErrorText>{message}</ErrorText>
        <Button id="bbx-inventory-retry" className="self-start" intent="secondary" size="sm" onClick={refresh}>Try again</Button>
      </Stack>
    </Card>
  );
}
