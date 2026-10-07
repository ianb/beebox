/**
 * The directory listing: shared infrastructure between the `directory` and
 * `gfolder` renderers (rule 3 — reachable from two set members, so it left
 * `renderers/` for the set's parent). The `gfolder` mirror view shows exactly
 * what browsing the directory shows, with one column added, rather than a
 * second listing that could disagree with it.
 */

import { attachDirFor } from "@shared/attach-path";
import { trpc, type RouterOutput } from "./lib/trpc/client";
import { href } from "./lib/routing";
import { Accordion } from "./components/ui/Accordion";
import { Text } from "./components/ui/Text";
import { Row } from "./components/ui/Row";
import { Stack } from "./components/ui/Stack";
import { Badge } from "./components/ui/Badge";
import { TextLink } from "./components/ui/TextLink";
import { getRenderers, type FileData, type RendererProps } from "./file-type-registry";
import type { ReactNode } from "react";

/** One `.card` entry in a `status.browse` listing. */
export type BrowseCardEntry = RouterOutput["status"]["browse"]["cards"][number];

/**
 * The listing behind the directory view. Exported so a renderer that shows a
 * directory *with something added* — the `gfolder` mirror view and its Drive
 * state column — reads the same query rather than fetching the tree twice
 * under a second cache key.
 */
export function useDirectoryListing(dirPath: string) {
  return trpc.status.browse.useQuery({ path: dirPath });
}

function CardAccordion({
  cardPath,
  name,
  type,
  conflict,
  hasAttachments,
  boxSlug,
  onNavigate,
  annotation,
}: {
  cardPath: string;
  name: string;
  type: string;
  conflict?: boolean;
  hasAttachments?: boolean;
  boxSlug: string | undefined;
  onNavigate: RendererProps["onNavigate"];
  /**
   * Replaces the card's own conflict badge — the Drive state column, today. A
   * column that says "conflict" beside a badge saying "conflict" is one badge
   * too many, and the column is the more specific of the two.
   */
  annotation?: ReactNode;
}) {
  // Card-as-directory: when a card has its own attach scope, expose a link to
  // browse INTO it. The scope dir is `<basename>.attach` (basename only, no
  // type) — we surface it as "contents" rather than the .attach detail.
  const attachPath = hasAttachments ? attachDirFor(cardPath) : null;
  const title = (
    <Row gap="sm">
      <Text size="sm" weight="medium" tone="emphasis">{name}</Text>
      <Text size="xs" tone="muted">.{type}.card</Text>
      {annotation ?? (conflict === true ? <Badge size="sm" tone="danger">conflict</Badge> : null)}
      {attachPath && boxSlug ? (
        <TextLink to={href(`/${boxSlug}/browse/${attachPath}`)}>
          <Text size="xs" tone="muted">contents →</Text>
        </TextLink>
      ) : null}
    </Row>
  );
  return (
    <Accordion title={title}>
      <CardAccordionBody cardPath={cardPath} onNavigate={onNavigate} />
    </Accordion>
  );
}

function CardAccordionBody({
  cardPath,
  onNavigate,
}: {
  cardPath: string;
  onNavigate: RendererProps["onNavigate"];
}) {
  const { data: card, isLoading, error } = trpc.card.get.useQuery({ path: cardPath });

  if (isLoading) return <Text size="sm" tone="muted">Loading...</Text>;
  if (error || !card) return <Text size="sm" tone="danger">Failed to load card</Text>;

  const fileData: FileData = {
    path: card.path,
    kind: card.kind,
    type: card.type,
    frontmatter: card.frontmatter,
    body: card.body,
    bodyLineOffset: card.bodyLineOffset,
    schema: card.schema,
  };

  // A frontmatter card always matches at least the Source/Card renderers.
  const renderers = getRenderers(cardPath, fileData);
  const [firstRenderer] = renderers;
  if (firstRenderer === undefined) return null;
  const Renderer = firstRenderer.Component;
  return <Renderer data={fileData} onNavigate={onNavigate} />;
}

export interface DirectoryListingProps {
  /** The `status.browse` result to render. */
  browse: RouterOutput["status"]["browse"];
  /** Box-relative directory the listing describes ("" at the box root). */
  dirPath: string;
  boxSlug: string | undefined;
  onNavigate: RendererProps["onNavigate"];
  /**
   * Per card row, a badge shown INSTEAD of the card's own conflict badge —
   * the `gfolder` view's Drive state column.
   */
  annotate?: (card: BrowseCardEntry) => ReactNode;
  /**
   * A card to leave out. The `gfolder` view omits the mount card itself: it
   * IS the surrounding view, and an accordion for it would render this same
   * renderer inside itself, forever.
   */
  omitCardPath?: string;
}

/**
 * The directory's three lists — subdirectories, cards, other files.
 *
 * Split out of `DirectoryRenderer` so the `gfolder` mirror view shows exactly
 * what browsing the directory shows, with one column added, rather than a
 * second listing that could disagree with it.
 */
export function DirectoryListing(props: DirectoryListingProps) {
  const { browse, dirPath, boxSlug, onNavigate, annotate, omitCardPath } = props;
  const cards = browse.cards.filter((card) => card.relativePath !== omitCardPath);
  const isEmpty = browse.dirs.length === 0 && cards.length === 0 && browse.files.length === 0;
  return (
    <>
      {isEmpty ? <Text size="sm" tone="muted">Empty directory</Text> : null}
      {browse.dirs.length > 0 ? (
        <Stack as="ul" gap="xs" className="mb-2">
          {browse.dirs.map((dir) => (
            <li key={dir.name}>
              <TextLink
                to={href(`/${boxSlug}/browse/${dirPath ? `${dirPath}/${dir.name}` : dir.name}`)}
              >
                <Text size="sm" mono>
                  <Text size="sm" tone="muted" className="mr-1">/</Text>{dir.name}
                </Text>
              </TextLink>
            </li>
          ))}
        </Stack>
      ) : null}
      {cards.length > 0 ? (
        <Stack gap="xs" className="mb-2">
          {cards.map((card) => (
            <CardAccordion
              key={card.relativePath}
              cardPath={card.relativePath}
              name={card.name}
              type={card.type}
              conflict={card.conflict}
              hasAttachments={card.hasAttachments}
              boxSlug={boxSlug}
              onNavigate={onNavigate}
              annotation={annotate === undefined ? null : annotate(card)}
            />
          ))}
        </Stack>
      ) : null}
      {browse.files.length > 0 ? (
        <Stack as="ul" gap="xs">
          {browse.files.map((file) => (
            <li key={file.relativePath}>
              <TextLink to={href(`/${boxSlug}/browse/${file.relativePath}`)}>
                <Text size="sm" mono>{file.name}</Text>
              </TextLink>
            </li>
          ))}
        </Stack>
      ) : null}
    </>
  );
}
