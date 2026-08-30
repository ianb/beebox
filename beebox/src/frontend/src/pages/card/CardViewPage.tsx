/**
 * Full-page scrollable viewer for a single card file. Mounted at
 * `/:boxSlug/card/<splat>`. Reads the splat param directly and hands
 * off to FileView inside a Card shell.
 */

import { useNavigate, useParams } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";
import { useUrlView } from "../../hooks/useUrlView";
import { useViewNavigate } from "../../hooks/useViewNavigate";
import { FileView } from "../../components/FileView";
import { Card } from "../../components/ui/Card";
import { Column } from "../../components/ui/Column";
import { Row } from "../../components/ui/Row";
import { Stack } from "../../components/ui/Stack";
import { Text } from "../../components/ui/Text";
import { TextLink } from "../../components/ui/TextLink";
import { OpenChatControl } from "./components/OpenChatControl";

export function CardViewPage() {
  const { boxSlug, _splat: cardPath } = useParams({ strict: false });
  const handleNavigate = useViewNavigate();
  const navigate = useNavigate();
  // The URL's query is the renderer's, exactly as it is in browse: `?view=`
  // picks the renderer and everything else is forwarded to it. Without this,
  // `/card/...?page=2` — a link the page strip and the box agent both hand out
  // — silently did nothing here while working in `/browse/...`.
  const { viewer, params } = useUrlView();
  const selectRenderer = (name: string) => {
    // Looking at the same card a different way is not a new place: replace, so
    // back leaves the card rather than undoing a toggle (as browse does).
    void navigate({
      to: href(`/${boxSlug}/card/${cardPath ?? ""}`),
      search: toSearch({ ...params, view: name }),
      replace: true,
    });
  };

  if (!cardPath) {
    return <Text as="div" tone="subtle" className="p-8">No card path specified</Text>;
  }

  return (
    <Column overflow="auto" focusable className="h-full">
      <Stack gap="md" className="max-w-4xl mx-auto py-8 px-4 w-full">
        <Row gap="md" align="center" justify="between">
          <TextLink id="bbx-card-back-dashboard" to={href(`/${boxSlug}/dashboard`)} underline={false}>
            {"\u2190 Back to Dashboard"}
          </TextLink>
          {boxSlug !== undefined ? (
            <OpenChatControl boxSlug={boxSlug} cardPath={cardPath} />
          ) : null}
        </Row>
        <Card padding="none" shadow>
          <FileView
            path={cardPath}
            params={params}
            rendererName={viewer}
            onSelectRenderer={selectRenderer}
            onNavigate={handleNavigate}
            onClose={() => void navigate({ to: href(`/${boxSlug}/dashboard`), replace: true })}
          />
        </Card>
      </Stack>
    </Column>
  );
}
