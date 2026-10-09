/**
 * PlaceView — the front of a landmark card: the place page.
 *
 * A person who opens a landmark card is visiting the place, so the front shows
 * what the place holds instead of its configuration: its openers ("Start something", where they can be sent), then its
 * resolved links in tiers and each `expand` as a group labeled in plain words.
 * The card header already shows the place's mark and label; an embed, which
 * has no header, draws them here. The fields stay under Properties
 * (`CardFacts`). See
 * docs/plans/landmark-arrival.md, Track C.
 *
 * `PlaceView` fetches `landmarks.forDir` for the card's folder and owns the
 * loading and error states; `PlacePage` renders a loaded payload.
 */

import { useContext, type ReactNode } from "react";
import { trpc } from "../../lib/trpc/client";
import { useBoxSlug } from "../../lib/box-slug";
import { browseCardTarget } from "../../lib/browse-card-state";
import { useOpenLandmarkChat } from "../../hooks/useOpenLandmarkChat";
import { toDisplayPath } from "@shared/display-path";
import { Text } from "../ui/Text";
import { Heading } from "../ui/Heading";
import { Button } from "../ui/Button";
import { InlineAction } from "../ui/InlineAction";
import { ErrorText } from "../ui/ErrorText";
import { StatusMessage } from "../ui/StatusMessage";
import { LandmarkGroup, LandmarkLinks, LandmarkSymbol } from "../landmarks/LandmarkSection";
import { ChatOpeners } from "../openers/ChatOpeners";
import { bbxSource } from "../../lib/source-tag";
import { useRefetchOnFileChange } from "../../hooks/useRefetchOnFileChange";
import { placeSections, type PlacePayload, type PlaceTier } from "./sections";
import { PlaceChatContext, startSomething } from "../openers/place-chat";
import type { RendererProps } from "../../file-type-registry";
import type { ViewTarget } from "../../lib/view-url";

const TIER_HEADINGS: Record<PlaceTier, string> = {
  "entry-point": "Start here",
  primary: "Main cards",
  places: "Places inside",
  pinned: "Pinned",
};

/** The folder a card sits in, box-relative ("" at the box root). */
function parentDir(cardPath: string): string {
  const slash = cardPath.lastIndexOf("/");
  return slash === -1 ? "" : cardPath.slice(0, slash);
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <Text as="h3" size="xs" weight="medium" tone="muted" uppercase>{children}</Text>;
}

/** No links and no groups: say so, and name the folder the place is. */
function EmptyPlace({ folder, onNavigate }: { folder: string; onNavigate: (target: ViewTarget) => void }) {
  return (
    <div className="flex flex-col gap-1" data-place-section="empty">
      <Text as="p">Nothing here yet.</Text>
      <Text as="p" size="sm" tone="subtle">
        This place is the folder{" "}
        <InlineAction onClick={() => onNavigate(browseCardTarget({ directory: folder }))}>{`${toDisplayPath(folder)}/`}</InlineAction>
        . Ask in the chat to add the first card.
      </Text>
    </div>
  );
}

/**
 * The place page for a loaded payload. `cardPath` is the card being shown; when
 * the folder's landmark is a different card (two landmarks in one folder), the
 * page names both rather than show the other card's links as this one's.
 */
export function PlacePage({ cardPath, payload, onNavigate, onGoToPlace, heading }: {
  cardPath: string;
  payload: PlacePayload;
  /** Draw the place's mark and label: an embed has no card header that shows them. */
  heading?: boolean;
  onNavigate: (target: ViewTarget) => void;
  /** Open this place's own chat; absent where no chat can be opened. */
  onGoToPlace?: () => void;
}) {
  const chat = useContext(PlaceChatContext);
  const boxSlug = useBoxSlug() ?? "";
  if (payload.path !== cardPath) {
    return (
      <ErrorText>
        {`This folder has two landmark cards, ${cardPath} and ${payload.path}. The place uses ${payload.path}; keep one landmark card per folder.`}
      </ErrorText>
    );
  }
  const sections = placeSections(payload);
  const start = startSomething({ payloadDir: payload.dir, openers: payload.openers, chat });
  const handleSendOpener = chat?.sendOpener;
  return (
    <div className="flex flex-col gap-6" {...bbxSource(["card", payload.path], ["dir", parentDir(cardPath)])}>
      {heading === true ? (
        <div className="flex items-center gap-3">
          <LandmarkSymbol landmark={payload} boxSlug={boxSlug} />
          <Heading level={2}>{payload.label}</Heading>
        </div>
      ) : null}

      {start.openers.length > 0 && handleSendOpener !== undefined ? (
        <div className="flex flex-col gap-2" data-place-section="start-something">
          <SectionHeading>Start something</SectionHeading>
          <ChatOpeners openers={start.openers} onSendOpener={handleSendOpener} />
        </div>
      ) : null}

      {start.goToPlace && onGoToPlace !== undefined ? (
        <div className="flex flex-col gap-1" data-place-section="go-to">
          <Text as="p" size="sm" tone="subtle">The open chat is in another place.</Text>
          <Button id="bbx-place-go-to" intent="secondary" size="sm" className="self-start" onClick={onGoToPlace}>
            {`Go to ${payload.label}`}
          </Button>
        </div>
      ) : null}

      {sections.kind === "empty" ? <EmptyPlace folder={parentDir(cardPath)} onNavigate={onNavigate} /> : sections.sections.map((section) =>
        section.kind === "links" ? (
          <div key={section.tier} className="flex flex-col gap-2" data-place-section={section.tier}>
            <SectionHeading>{TIER_HEADINGS[section.tier]}</SectionHeading>
            <LandmarkLinks links={section.links} boxSlug={boxSlug} onNavigate={onNavigate} compact hidePath />
          </div>
        ) : (
          <div key={`group:${section.group.label}`} data-place-section="group">
            <LandmarkGroup group={section.group} boxSlug={boxSlug} onNavigate={onNavigate} compact defaultOpen hidePath />
          </div>
        ),
      )}
    </div>
  );
}

export function PlaceView({ data, onNavigate, mode }: RendererProps) {
  const cardPath = data.path.replace(/^\//, "");
  const query = trpc.landmarks.forDir.useQuery({ dir: parentDir(cardPath), expandsAsGroups: true });
  useRefetchOnFileChange(query.refetch);
  const boxSlug = useBoxSlug();
  const openLandmarkChat = useOpenLandmarkChat(boxSlug ?? "");
  const landmark = query.data?.landmark;

  let content: ReactNode;
  if (query.isError) {
    content = (
      <ErrorText>
        {`Could not load this place: ${query.error.message}. `}
        <InlineAction onClick={() => { void query.refetch(); }}>Retry</InlineAction>
      </ErrorText>
    );
  } else if (landmark === undefined) {
    content = <StatusMessage>Loading place…</StatusMessage>;
  } else if (landmark === null) {
    content = <ErrorText>This landmark card could not be read as a place. Its Source view shows the problem.</ErrorText>;
  } else {
    content = (
      <PlacePage
        cardPath={cardPath}
        payload={landmark}
        heading={mode === "embed"}
        onNavigate={(target) => onNavigate(target)}
        {...(boxSlug === undefined ? {} : { onGoToPlace: () => { void openLandmarkChat(landmark.dir); } })}
      />
    );
  }
  return <div className="bbx-card-content">{content}</div>;
}
