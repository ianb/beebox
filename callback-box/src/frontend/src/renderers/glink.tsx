/**
 * Glink renderer — a Drive item the box points at but does not hold.
 *
 * The card has two halves with different owners, and the view says so: Drive's
 * metadata (name, kind, where it came from, the link) is stamped by the
 * connector and read-only here, while the body is the boxholder's or agent's
 * purpose notes — why the item matters, what to do with it. Those notes are the
 * only reason a pointer beats a bookmark, so they render as markdown rather
 * than as one more frontmatter row, and an empty body says it is empty instead
 * of rendering nothing.
 */

import { Markdown } from "../components/Markdown";
import { Badge } from "../components/ui/Badge";
import { ExternalLink } from "../components/ui/ExternalLink";
import { Row } from "../components/ui/Row";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { driveMimeLabel } from "../lib/drive-card-display";
import { registerFileType, type RendererProps } from "./index";

/** The frontmatter field, when it is a non-empty string. */
function field(fm: Record<string, unknown>, key: string): string | null {
  const value = fm[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** Where the pointer came from, spelled as what it means rather than as the enum. */
function OriginBadge({ origin }: { origin: string | null }) {
  if (origin === "mirror") {
    return <Badge tone="info" title="Emitted by a folder mirror for a child it cannot sync.">from a folder mirror</Badge>;
  }
  if (origin === "manual") {
    return <Badge tone="neutral" title="Created with cb drive link.">added by hand</Badge>;
  }
  return <Badge tone="warning" title="The card does not say where this pointer came from.">origin unknown</Badge>;
}

function GlinkView({ data, onNavigate }: RendererProps) {
  const frontmatter = data.frontmatter ?? {};
  const name = field(frontmatter, "name");
  const link = field(frontmatter, "link");
  const mime = field(frontmatter, "mime");
  const origin = field(frontmatter, "origin");
  const notes = (data.body ?? "").trim();

  return (
    <Stack gap="md" className="p-4">
      <Stack gap="xs">
        <Row gap="sm" align="center" wrap>
          <Text as="h2" size="lg" weight="semibold">{name ?? "Drive item"}</Text>
          <Badge tone="neutral">{driveMimeLabel(mime ?? "")}</Badge>
          <OriginBadge origin={origin} />
        </Row>
        <Text as="p" size="sm" tone="muted">
          Not copied into the box — the card records where this lives and what it is for.
        </Text>
        <Row gap="sm" align="center" wrap>
          {link === null ? (
            <Text size="sm" tone="danger">No Drive link on this card yet.</Text>
          ) : (
            <ExternalLink href={link} id="cb-glink-open-in-drive">Open in Drive</ExternalLink>
          )}
        </Row>
      </Stack>

      <Stack gap="xs">
        <Text size="sm" weight="semibold" uppercase tone="muted">Purpose notes</Text>
        {notes === "" ? (
          <Text size="sm" tone="subtle" italic>
            None yet — write what this item is for, and the box will know why it matters.
          </Text>
        ) : (
          <Markdown prose="block" onNavigate={onNavigate} basePath={data.path}>{notes}</Markdown>
        )}
      </Stack>
    </Stack>
  );
}

registerFileType({ type: "glink" }, {
  renderer: { name: "Drive pointer", Component: GlinkView, priority: 100 },
});
