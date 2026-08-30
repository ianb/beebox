/**
 * The browse sidebar's three states: the tree, still loading, and could not load.
 *
 * The third one did not exist. The tree is the only navigation on this page, so a
 * failed listing left nothing to click and nothing to read — the query's retries
 * keep `isLoading` true, and when they run out the pane renders empty. Someone on
 * a cold profile sat at "Loading..." indefinitely with no way forward.
 */
import { Button } from "../../../components/ui/Button";
import { Column } from "../../../components/ui/Column";
import { Text } from "../../../components/ui/Text";
import { BrowseSidebarList } from "./BrowseSidebarList";

type BrowseData = Parameters<typeof BrowseSidebarList>[0]["data"];

interface Props {
  data: BrowseData | undefined;
  loading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  dirPath: string;
  selectedFilePath: string | null;
  onNavigate: (path: string) => void;
  onFileContextMenu: Parameters<typeof BrowseSidebarList>[0]["onFileContextMenu"];
}

export function BrowseSidebarBody(props: Props) {
  const { data, loading, isError, error, onRetry, dirPath, selectedFilePath, onNavigate, onFileContextMenu } = props;

  if (data) {
    return (
      <BrowseSidebarList
        data={data}
        dirPath={dirPath}
        loading={loading}
        onNavigate={onNavigate}
        selectedFilePath={selectedFilePath}
        onFileContextMenu={onFileContextMenu}
      />
    );
  }
  if (loading) return <Text as="div" size="sm" tone="subtle" className="p-4">Loading...</Text>;
  if (!isError) return null;

  return (
    <Column gap="sm" className="p-4">
      <Text as="div" size="sm" tone="danger">Could not load this folder.</Text>
      <Text as="div" size="xs" tone="subtle">
        {error instanceof Error ? error.message : "The server did not answer."}
      </Text>
      <Button id="bbx-browse-retry" size="sm" intent="secondary" onClick={onRetry}>Try again</Button>
    </Column>
  );
}
