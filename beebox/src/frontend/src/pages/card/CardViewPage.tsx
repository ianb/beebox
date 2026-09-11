/**
 * Full-page scrollable viewer for a single card file. Mounted at
 * `/:boxSlug/card/<splat>`. Reads the splat param directly and hands
 * off to FileView inside a Card shell.
 */

import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import { href, toSearch } from "../../lib/routing";
import { useUrlView } from "../../hooks/useUrlView";
import { useViewNavigate } from "../../hooks/useViewNavigate";
import { FileView } from "../../components/FileView";
import { Column } from "../../components/ui/Column";
import { Row } from "../../components/ui/Row";
import { Stack } from "../../components/ui/Stack";
import { Text } from "../../components/ui/Text";
import { TextLink } from "../../components/ui/TextLink";
import { OpenChatControl } from "./components/OpenChatControl";
import { viewStateSearchValue, type ViewState } from "../../lib/view-url";

export function CardViewPage() {
  const { boxSlug, _splat: cardPath } = useParams({ strict: false });
  const handleNavigate = useViewNavigate();
  const navigate = useNavigate();
  const location = useLocation();
  // The URL's query is the renderer's, exactly as it is in browse: `?view=`
  // picks the renderer and everything else is forwarded to it. Without this,
  // `/card/...?page=2` — a link the page strip and the box agent both hand out
  // — silently did nothing here while working in `/browse/...`.
  const { viewer, params, viewState } = useUrlView();
  const followMovedCard = useCallback((path: string) => {
    void navigate({
      to: href(`/${boxSlug}/card/${path}`),
      search: toSearch(location.search),
      replace: true,
    });
  }, [boxSlug, location.search, navigate]);
  const selectRenderer = (name: string | null) => {
    // Looking at the same card a different way is not a new place: replace, so
    // back leaves the card rather than undoing a toggle (as browse does).
    void navigate({
      to: href(`/${boxSlug}/card/${cardPath ?? ""}`),
      search: toSearch(
        name === null
          ? params
          : {
              ...params,
              view: name,
              viewState: viewStateSearchValue(viewState),
            },
      ),
      replace: true,
    });
  };
  const updateViewState = useCallback(
    (next: ViewState, method: "push" | "replace") => {
      void navigate({
        to: href(`/${boxSlug}/card/${cardPath ?? ""}`),
        search: toSearch({
          ...params,
          ...(viewer ? { view: viewer } : {}),
          viewState: viewStateSearchValue(next),
        }),
        replace: method === "replace",
      });
    },
    [boxSlug, cardPath, navigate, params, viewer],
  );

  if (!cardPath) {
    return (
      <Text as="div" tone="subtle" className="p-8">
        No card path specified
      </Text>
    );
  }

  return (
    <Column overflow="auto" focusable className="h-full">
      <Stack gap="md" className="max-w-4xl mx-auto py-8 px-4 w-full">
        <div data-card-page-actions>
          <Row gap="md" align="center" justify="between">
            <TextLink
              id="bbx-card-back-dashboard"
              to={href(`/${boxSlug}/dashboard`)}
              underline={false}
            >
              {"\u2190 Back to Dashboard"}
            </TextLink>
            {boxSlug !== undefined ? (
              <OpenChatControl boxSlug={boxSlug} cardPath={cardPath} />
            ) : null}
          </Row>
        </div>
        <FileView
          path={cardPath}
          params={params}
          rendererName={viewer}
          viewState={viewState}
          canPushViewState
          onViewStateChange={updateViewState}
          onSelectRenderer={selectRenderer}
          onNavigate={handleNavigate}
          onMoved={followMovedCard}
          onClose={() =>
            void navigate({ to: href(`/${boxSlug}/dashboard`), replace: true })
          }
        />
      </Stack>
    </Column>
  );
}
