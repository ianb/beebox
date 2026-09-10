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
import { Row } from "../../../components/ui/Row";
import { Text } from "../../../components/ui/Text";
import { Toggle } from "../../../components/ui/Toggle";
import { BrowseSidebarList } from "./BrowseSidebarList";
import { BrowseLandmarkHeader } from "./BrowseLandmarkHeader";
import { useBrowseListingMode } from "../useBrowseListingMode";
import type { RouterOutput } from "../../../lib/trpc";
import type { ViewTarget } from "../../../lib/view-url";
import type { BrowseMissingKind } from "../../../lib/browse-card-state";

type BrowseData = Parameters<typeof BrowseSidebarList>[0]["data"];

interface Props {
  data: BrowseData | undefined;
  loading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  dirPath: string;
  selectedFilePath: string | null;
  onNavigate: (path: string, kind: BrowseMissingKind) => void;
  onFileContextMenu: Parameters<typeof BrowseSidebarList>[0]["onFileContextMenu"];
  landmark: RouterOutput["landmarks"]["forDir"]["landmark"];
  boxSlug: string;
  onLinkNavigate: (target: ViewTarget) => void;
  landmarkError: unknown;
  onLandmarkRetry: () => void;
}

export function BrowseSidebarBody(props: Props) {
  const { data, loading, isError, error, onRetry, dirPath, selectedFilePath, onNavigate, onFileContextMenu, landmark, boxSlug, onLinkNavigate, landmarkError, onLandmarkRetry } = props;
  const [listingMode, setListingMode] = useBrowseListingMode();

  if (data) {
    return (
      <>
        {landmark ? (
          <BrowseLandmarkHeader landmark={landmark} boxSlug={boxSlug} onNavigate={onLinkNavigate} />
        ) : landmarkError ? (
          <Column gap="xs" className="border-b border-warm-200 p-4">
            <Text as="div" size="sm" tone="danger">Could not load this folder&rsquo;s landmark.</Text>
            <Button size="sm" intent="secondary" onClick={onLandmarkRetry}>Try again</Button>
          </Column>
        ) : null}
        <Row gap="xs" align="center" justify="end" className="px-4 py-1.5 border-b border-warm-200">
          <Text as="span" size="xs" tone="muted">Compact</Text>
          <Toggle
            id="bbx-browse-listing-mode"
            checked={listingMode === "raw"}
            onChange={(raw) => setListingMode(raw ? "raw" : "compact")}
            label={listingMode === "raw" ? "Showing raw listing — switch to compact" : "Showing compact listing — switch to raw"}
          />
          <Text as="span" size="xs" tone="muted">Raw</Text>
        </Row>
        <BrowseSidebarList
          data={data}
          dirPath={dirPath}
          loading={loading}
          onNavigate={onNavigate}
          selectedFilePath={selectedFilePath}
          onFileContextMenu={onFileContextMenu}
          omitCardPath={landmark?.path}
          mode={listingMode}
        />
      </>
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
