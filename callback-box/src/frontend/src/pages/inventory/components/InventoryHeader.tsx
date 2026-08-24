import { href } from "../../../lib/routing";
import { Button } from "../../../components/ui/Button";
import { Row } from "../../../components/ui/Row";
import { Stack } from "../../../components/ui/Stack";
import { Text } from "../../../components/ui/Text";
import { TextLink } from "../../../components/ui/TextLink";

interface InventoryHeaderProps {
  boxSlug: string | undefined;
  refreshing: boolean;
  refresh: () => Promise<void>;
  refreshError: string | null;
}

export function InventoryHeader({ boxSlug, refreshing, refresh, refreshError }: InventoryHeaderProps) {
  return (
    <Stack gap="xs">
      <TextLink id="cb-inventory-back" to={href(`/${boxSlug}/dashboard`)} underline={false}>&larr; Dashboard</TextLink>
      <Row justify="between" align="start" wrap>
        <InventoryTitle />
        <Button id="cb-inventory-refresh" intent="secondary" size="sm" onClick={refresh} loading={refreshing} loadingLabel="Scanning…">Refresh scan</Button>
      </Row>
      {refreshError === null ? null : <Text as="p" tone="danger" size="sm">Refresh failed: {refreshError}</Text>}
    </Stack>
  );
}

function InventoryTitle() {
  return (
    <Stack gap="xs">
      <Text as="h1" size="2xl" weight="bold">Inventory summary</Text>
      <Text as="p" tone="muted">Repository storage, file types, and linked versus unlinked content.</Text>
    </Stack>
  );
}
