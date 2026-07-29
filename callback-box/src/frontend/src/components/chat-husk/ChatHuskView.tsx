/**
 * Chat husk card surface — the `chat` card (a web session's durable face,
 * docs/plans/chat-husks.md). Shows the card's editorial identity and
 * opens the live session; the full inversion (chat rendered *at* the
 * husk's path) is future frame work.
 */

import { Link, useParams } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";
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
  // What the nightly chat review wrote. Surfaced here because this is the only
  // place the boxholder can notice it going wrong — a hallucinated decision or
  // an indiscreet summary is otherwise invisible outside the raw file.
  const contains = typeof fm["contains"] === "string" && fm["contains"] !== "" ? fm["contains"] : null;
  const account =
    typeof fm["contains-evidence"] === "string" && fm["contains-evidence"] !== ""
      ? fm["contains-evidence"]
      : null;

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
        {contains !== null ? (
          <Text as="div" size="sm">{contains}</Text>
        ) : null}
        {data.body && data.body.trim() !== "" ? (
          <Text as="div" size="sm" tone="subtle">{data.body.trim()}</Text>
        ) : null}
        {account !== null ? (
          <details>
            <summary className="cursor-pointer text-sm text-warm-600">
              What came of this conversation
            </summary>
            <Text as="div" size="sm" tone="subtle">
              <pre className="whitespace-pre-wrap font-sans mt-2">{account}</pre>
            </Text>
          </details>
        ) : null}
        <Link
          to={href(`/${boxSlug}/chat`)}
          search={toSearch({ session })}
          className="self-start px-3 py-1 rounded text-sm font-medium bg-info-50 text-info-dark border border-info-200 hover:bg-info-100 transition-colors"
        >
          Open chat →
        </Link>
      </Stack>
    </Card>
  );
}
