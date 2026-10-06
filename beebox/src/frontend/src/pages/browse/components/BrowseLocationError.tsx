import { Stack } from "../../../components/ui/Stack";
import { ErrorText } from "../../../components/ui/ErrorText";
import { Button } from "../../../components/ui/Button";

export function BrowseLocationError({ error, onRoot, onRetry }: { error: string; onRoot: () => void; onRetry?: () => void }) {
  return <Stack gap="sm" className="p-4">
    <ErrorText>{error}</ErrorText>
    {onRetry ? <Button id="bbx-browse-location-retry" intent="secondary" onClick={onRetry}>Try again</Button> : null}
    <Button id="bbx-browse-return-root" intent="secondary" onClick={onRoot}>Browse box root</Button>
  </Stack>;
}
