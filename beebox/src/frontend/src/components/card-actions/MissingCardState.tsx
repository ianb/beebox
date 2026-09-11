import { trpc } from "../../lib/trpc";
import { Button } from "../ui/Button";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { useViewNavigate } from "../../hooks/useViewNavigate";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import { legacyHistoryState } from "../history/history-card-state";

export function MissingCardState({ path, onClose }: { path: string; onClose?: (() => void) | undefined }) {
  const openView = useViewNavigate();
  const history = trpc.history.list.useQuery({ count: 1, filter: { path } });
  const existed = (history.data?.commits.length ?? 0) > 0;
  return (
    <Stack gap="sm" className="p-6">
      <Text as="h1" size="lg" weight="semibold">{existed ? "This card is no longer here" : "Card not found"}</Text>
      <Text as="p" tone="subtle">
        {history.isLoading
          ? "Checking this path’s history…"
          : existed
            ? "It may have been moved or sent to Trash. Its history can show what happened."
            : "No card or git history exists at this path. Check the path or close this view."}
      </Text>
      <Text as="p" size="sm" mono breakAll tone="muted">{path}</Text>
      {history.error ? <Text as="p" size="sm" tone="danger">History could not be checked: {history.error.message}</Text> : null}
      <div className="flex flex-wrap items-center gap-3 mt-2">
        {existed ? <Button intent="secondary" onClick={() => openView({ path: SYSTEM_CARD_PATHS.history, viewer: null, params: {}, viewState: legacyHistoryState({ path }) }, { label: "History" })}>See history for this path</Button> : null}
        {onClose ? <Button intent="secondary" onClick={onClose}>Close this view</Button> : null}
      </div>
    </Stack>
  );
}
