import { Column } from "../../../components/ui/Column";
import { Text } from "../../../components/ui/Text";
import { Button } from "../../../components/ui/Button";

export function BrowseLocationError({ error, onRoot, onRetry }: { error: string; onRoot: () => void; onRetry?: () => void }) {
  return <Column gap="sm" className="p-4">
    <Text as="div" tone="danger">{error}</Text>
    {onRetry ? <Button id="bbx-browse-location-retry" intent="secondary" onClick={onRetry}>Try again</Button> : null}
    <Button id="bbx-browse-return-root" intent="secondary" onClick={onRoot}>Browse box root</Button>
  </Column>;
}
