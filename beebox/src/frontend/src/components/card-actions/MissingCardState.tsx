import { useParams } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { href } from "../../lib/routing";
import { Button } from "../ui/Button";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextLink } from "../ui/TextLink";

export function MissingCardState({ path, onClose }: { path: string; onClose?: (() => void) | undefined }) {
  const { boxSlug } = useParams({ strict: false });
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
        {existed ? <TextLink to={`${href(`/${boxSlug}/history`)}?path=${encodeURIComponent(path)}`}>See history for this path</TextLink> : null}
        {onClose ? <Button intent="secondary" onClick={onClose}>Close this view</Button> : null}
      </div>
    </Stack>
  );
}
