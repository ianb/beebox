import { Button } from "../../../components/ui/Button";
import { Row } from "../../../components/ui/Row";
import { Stack } from "../../../components/ui/Stack";
import { Text } from "../../../components/ui/Text";
import { ErrorText } from "../../../components/ui/ErrorText";

interface InventoryHeaderProps {
  refreshing: boolean;
  refresh: () => Promise<void>;
  refreshError: string | null;
}

export function InventoryHeader({ refreshing, refresh, refreshError }: InventoryHeaderProps) {
  return (
    <Stack gap="xs">
      <Row justify="between" align="start" wrap>
        <InventoryTitle />
        <Button id="bbx-inventory-refresh" intent="secondary" size="sm" onClick={refresh} loading={refreshing} loadingLabel="Scanning…">Refresh scan</Button>
      </Row>
      {refreshError === null ? null : <ErrorText>Refresh failed: {refreshError}</ErrorText>}
    </Stack>
  );
}

function InventoryTitle() {
  return (
    <Stack gap="xs">
      <Text as="p" tone="muted">Repository storage, file types, and linked versus unlinked content.</Text>
    </Stack>
  );
}
