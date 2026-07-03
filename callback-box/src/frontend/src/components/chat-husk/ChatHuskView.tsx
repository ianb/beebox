/**
 * Chat husk card surface — the `chat` card (a web session's durable face,
 * docs/plans/chat-husks.md). Shows the card's editorial identity and
 * opens the live session; the full inversion (chat rendered *at* the
 * husk's path) is future frame work.
 */

import { Link, useParams } from "@tanstack/react-router";
import { href } from "../../lib/routing";
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import type { RendererProps } from "../../renderers/index";

export function ChatHuskView({ data }: RendererProps) {
  const { boxSlug } = useParams({ strict: false });
  const fm = data.frontmatter ?? {};
  const session = typeof fm["session"] === "string" ? fm["session"] : "";
  const contextDir = typeof fm["context-dir"] === "string" ? fm["context-dir"] : "";
  const title = typeof fm["title"] === "string" && fm["title"] !== "" ? fm["title"] : null;

  if (session === "") {
    return (
      <Card padding="md" border="subtle" muted>
        <Text as="div" size="sm" tone="muted">
          {data.path} has no session field — not a usable chat husk.
        </Text>
      </Card>
    );
  }

  return (
    <Card padding="md" border="subtle">
      <Stack gap="sm">
        <Text as="div" size="lg" weight="bold">
          {title ?? `Chat ${session.slice(0, 8)}`}
        </Text>
        <Stack gap="xs">
          {contextDir !== "" ? (
            <Text as="div" size="xs" tone="muted">bound to {contextDir}/</Text>
          ) : null}
          <Text as="div" size="xs" tone="muted">session {session}</Text>
        </Stack>
        {data.body && data.body.trim() !== "" ? (
          <Text as="div" size="sm" tone="subtle">{data.body.trim()}</Text>
        ) : null}
        <Link
          to={href(`/${boxSlug}/chat`)}
          search={{ session } as never}
          className="self-start px-3 py-1 rounded text-sm font-medium bg-info-50 text-info-dark border border-info-200 hover:bg-info-100 transition-colors"
        >
          Open chat →
        </Link>
      </Stack>
    </Card>
  );
}
