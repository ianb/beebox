/**
 * PlaceView — the front of a landmark card: the place page.
 *
 * A person who opens a landmark card is visiting the place, so the front shows
 * what the place holds instead of its configuration: the place summary (the
 * card's body), its openers ("Start something", where they can be sent), then
 * its resolved links in tiers and each `expand` as a group labeled in plain words.
 * The card header already shows the place's mark and label; an embed, which
 * has no header, draws them here. The fields stay under Properties
 * (`CardFacts`). See
 * docs/implemented-plans/landmark-arrival.md, Track C, and
 * docs/implemented-plans/place-shows-cards.md, Track C.
 *
 * `PlaceView` fetches `landmarks.forDir` for the card's folder and owns the
 * loading and error states; `PlacePage` renders a loaded payload. On the root
 * place it also reads `status.navStatus`, the nav badge's query, for the count
 * line under the summary (docs/implemented-plans/front-door.md, Track C).
 */

import { useContext, type ReactNode } from "react";
import { trpc } from "../../lib/trpc/client";
import { useBoxSlug } from "../../lib/box-slug";
import { browseCardTarget } from "../../lib/browse-card-state";
import { useOpenLandmarkChat } from "../../hooks/useOpenLandmarkChat";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import { PLATE_CARD_PATH } from "@shared/todo-model";
import type { NavCounts } from "@core/nav-counts";
import { Text } from "../ui/Text";
import { Heading } from "../ui/Heading";
import { Hint } from "../ui/Hint";
import { Button } from "../ui/Button";
import { InlineAction } from "../ui/InlineAction";
import { ErrorText } from "../ui/ErrorText";
import { StatusMessage } from "../ui/StatusMessage";
import { LandmarkGroup, LandmarkLinks, LandmarkSymbol } from "../landmarks/LandmarkSection";
import { ChatOpeners } from "../openers/ChatOpeners";
import { Markdown } from "../Markdown/body";
import { bbxSource } from "../../lib/source-tag";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { anyFileChange } from "../../lib/live-refresh";
import { placeSections, type PlacePayload, type PlaceTier } from "./sections";
import { PlaceChatContext, startSomething } from "../openers/place-chat";
import { cardTarget, useOpenBeside } from "../chat/workspace/use-open-beside/hook";
import { CountsLine } from "../todo/TodoSummaryLine";
import { rootLineParts } from "../todo/summary";
import type { RendererProps } from "../../file-type-registry";
import type { ViewState } from "@shared/view-state";
import type { ViewTarget } from "../../lib/view-url";
import { parentDir } from "../../lib/parent-dir";

const TIER_HEADINGS: Record<PlaceTier, string> = {
  "entry-point": "Start here",
  primary: "Main cards",
  places: "Places inside",
  pinned: "Pinned",
};

function SectionHeading({ children }: { children: ReactNode }) {
  return <Text as="h3" size="xs" weight="medium" tone="muted" uppercase>{children}</Text>;
}

/**
 * No links and no groups: say so, and offer the folder in Browse. It does not
 * claim the folder is empty: the walk skips background cards and unknown
 * types, so the folder may still hold files (docs/implemented-plans/front-door.md, Track E).
 */
function EmptyPlace({ folder, label, onNavigate }: { folder: string; label: string; onNavigate: (target: ViewTarget) => void }) {
  return (
    <div className="flex flex-col gap-1" data-place-section="empty">
      <Text as="p">Nothing to show here yet. Tell me about something in the chat and I&apos;ll keep it here.</Text>
      <Text as="p" size="sm" tone="subtle">
        <InlineAction intent="subtle" onClick={() => onNavigate(browseCardTarget({ directory: folder }))}>{`Open ${label} in Browse`}</InlineAction>
      </Text>
    </div>
  );
}

/**
 * The root page's count line: "3 to do · 1 overdue · 2 questions waiting".
 * Each count opens its surface beside the chat. Zero renders nothing; a failed
 * query says so, with a retry, so the two look different.
 */
function RootCounts({ counts, onRetry }: { counts: NavCounts | "unavailable"; onRetry: (() => void) | undefined }) {
  const openBeside = useOpenBeside();
  if (counts === "unavailable") {
    return (
      <div data-place-section="counts">
        <Text as="p" size="sm" tone="subtle">
          {"Counts unavailable. "}
          {onRetry === undefined ? null : <InlineAction intent="subtle" onClick={onRetry}>Retry</InlineAction>}
        </Text>
      </div>
    );
  }
  const parts = rootLineParts(counts);
  if (parts === null) return null;
  const open = (path: string, { title, viewState }: { title: string; viewState: ViewState | null }) =>
    (openBeside === null ? null : { onClick: () => openBeside({ ...cardTarget(path), viewState }), title });
  return (
    <div data-place-section="counts">
      <Text as="p" size="sm" tone="subtle">
        <CountsLine
          parts={parts}
          actions={{
            open: open(PLATE_CARD_PATH, { title: "Open your todo list", viewState: null }),
            // Date order puts the oldest deadlines, the overdue ones, first.
            overdue: open(PLATE_CARD_PATH, { title: "Open your todo list by date", viewState: { group: "date" } }),
            later: open(PLATE_CARD_PATH, { title: "Open your todo list", viewState: null }),
            questions: open(SYSTEM_CARD_PATHS.questions, { title: "Open the questions waiting for you", viewState: null }),
          }}
        />
      </Text>
    </div>
  );
}

/**
 * The place page for a loaded payload. `cardPath` is the card being shown; when
 * the folder's landmark is a different card (two landmarks in one folder), the
 * page names both rather than show the other card's links as this one's.
 */
export function PlacePage({ cardPath, payload, body, rootCounts, onRetryCounts, onNavigate, onGoToPlace, heading }: {
  cardPath: string;
  payload: PlacePayload;
  /** The landmark card's body, the place summary; blank shows nothing. */
  body?: string;
  /** The root place's todo and question counts; absent on a nested place or while loading. */
  rootCounts?: NavCounts | "unavailable";
  /** Retry a failed count query. */
  onRetryCounts?: () => void;
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
  const folder = parentDir(cardPath);
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

      {body !== undefined && body.trim() !== "" ? (
        <div data-place-section="summary">
          <Markdown prose="block" onNavigate={onNavigate} basePath={cardPath}>{body}</Markdown>
        </div>
      ) : null}

      {rootCounts === undefined ? null : <RootCounts counts={rootCounts} onRetry={onRetryCounts} />}

      {start.openers.length > 0 && chat !== null && handleSendOpener !== undefined ? (
        <div className="flex flex-col gap-2" data-place-section="start-something">
          <SectionHeading>Start something</SectionHeading>
          <ChatOpeners openers={start.openers} onSendOpener={handleSendOpener} standing={{ busy: chat.busy }} />
        </div>
      ) : null}

      {start.goToPlace && onGoToPlace !== undefined ? (
        <div className="flex flex-col gap-1" data-place-section="go-to">
          <Button id="bbx-place-go-to" intent="secondary" size="sm" className="self-start" onClick={onGoToPlace}>
            {`Open the ${payload.label} chat`}
          </Button>
          <Hint>Your current chat stays in Recent chats.</Hint>
        </div>
      ) : null}

      {sections.kind === "empty" ? <EmptyPlace folder={folder} label={payload.label} onNavigate={onNavigate} /> : sections.sections.map((section) =>
        section.kind === "links" ? (
          <div key={section.tier} className="flex flex-col gap-2" data-place-section={section.tier}>
            <SectionHeading>{TIER_HEADINGS[section.tier]}</SectionHeading>
            <LandmarkLinks links={section.links} boxSlug={boxSlug} onNavigate={onNavigate} compact hidePath />
          </div>
        ) : (
          <div key={`group:${section.group.alsoHere === true ? "also-here" : "expand"}:${section.group.label}`} data-place-section="group">
            <LandmarkGroup
              group={section.group}
              boxSlug={boxSlug}
              onNavigate={onNavigate}
              compact
              defaultOpen
              hidePath
              // "Also here" lists the folder's cards, so its overflow opens the folder.
              {...(section.group.alsoHere === true ? { onMore: () => onNavigate(browseCardTarget({ directory: folder })) } : {})}
            />
          </div>
        ),
      )}
    </div>
  );
}

export function PlaceView({ data, onNavigate, mode }: RendererProps) {
  const cardPath = data.path.replace(/^\//, "");
  // Mounted only while shown, so a change made while closed was never seen:
  // fetch on every open rather than trust the cache.
  const query = trpc.landmarks.forDir.useQuery({ dir: parentDir(cardPath), expandsAsGroups: true }, { refetchOnMount: "always" });
  useLiveRefresh({ when: anyFileChange, refresh: () => { void query.refetch(); }, burstMs: 500 });
  const boxSlug = useBoxSlug();
  const openLandmarkChat = useOpenLandmarkChat(boxSlug ?? "");
  const landmark = query.data?.landmark;
  // Same query and cache entry as the nav badge, which invalidates it on card
  // and question events, so the page and the badge cannot disagree.
  const isRoot = landmark !== undefined && landmark !== null && landmark.dir === "";
  const counts = trpc.status.navStatus.useQuery(undefined, { enabled: isRoot });
  let rootCounts: NavCounts | "unavailable" | undefined;
  if (isRoot) rootCounts = counts.isError ? "unavailable" : counts.data?.counts;

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
        {...(data.body === undefined ? {} : { body: data.body })}
        {...(rootCounts === undefined ? {} : { rootCounts, onRetryCounts: () => { void counts.refetch(); } })}
        heading={mode === "embed"}
        onNavigate={(target) => onNavigate(target)}
        {...(boxSlug === undefined ? {} : { onGoToPlace: () => { void openLandmarkChat(landmark.dir); } })}
      />
    );
  }
  return <div className="bbx-card-content">{content}</div>;
}
