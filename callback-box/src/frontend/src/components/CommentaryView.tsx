/**
 * CommentaryView — renderer for `commentary` cards (the in-box review surface).
 *
 * Renders the wrapped external target(s) live (fetched through the dev-only
 * `/api/external` route) alongside the card's commentary body. This is the
 * single-target version (Track C, chunk 4b); multi-target compare and
 * `{% source %}` anchor-linking land in chunk 5.
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getApiBase } from "../api";
import { Markdown } from "./Markdown";
import { Pre } from "./ui/Pre";
import { Text } from "./ui/Text";
import type { RendererProps } from "../renderers";
import type { NavigateHint, ViewTarget } from "../lib/view-url";

class ExternalFetchError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Failed to load external target");
    this.name = "ExternalFetchError";
    this.status = status;
  }
}

const EnvelopeSchema = z.object({
  contentBase64: z.string(),
  contentType: z.string(),
  markers: z.string(),
});
type Envelope = z.infer<typeof EnvelopeSchema>;

function decodeBase64Utf8(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.codePointAt(0) ?? 0);
  return new TextDecoder().decode(bytes);
}

function useExternalTarget(href: string) {
  const apiBase = getApiBase();
  return useQuery({
    queryKey: ["external-target", href],
    queryFn: async ({ signal }): Promise<Envelope> => {
      const resp = await fetch(`${apiBase}/external?href=${encodeURIComponent(href)}`, { signal });
      if (!resp.ok) {
        throw new ExternalFetchError(resp.status);
      }
      return EnvelopeSchema.parse(await resp.json());
    },
  });
}

/** Render one external target's live content (markdown rendered, else preformatted). */
function TargetPane({
  href,
  onNavigate,
  basePath,
}: {
  href: string;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  basePath: string;
}) {
  const { data, isLoading, error } = useExternalTarget(href);

  return (
    <div className="min-w-0 flex-1" data-card-section="body">
      <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-warm-200 pb-1">
        <Text as="div" size="xs" tone="subtle" className="truncate font-mono">{href}</Text>
        {data !== undefined ? (
          <Text as="div" size="xs" tone="subtle" className="shrink-0 font-mono">{data.markers}</Text>
        ) : null}
      </div>
      {isLoading ? (
        <Text as="div" tone="subtle" className="p-2 italic">Loading target…</Text>
      ) : error !== null ? (
        <Text as="div" tone="danger" className="p-2">
          Couldn’t load this target. It may be missing or outside the allowed roots.
        </Text>
      ) : data !== undefined ? (
        data.contentType.includes("markdown") ? (
          <Markdown prose="block" onNavigate={onNavigate} basePath={basePath}>
            {decodeBase64Utf8(data.contentBase64)}
          </Markdown>
        ) : (
          <Pre boxed scroll="lg">{decodeBase64Utf8(data.contentBase64)}</Pre>
        )
      ) : null}
    </div>
  );
}

/** The external hrefs to render as panes: the default target plus any `targets`. */
function targetHrefs(frontmatter: Record<string, unknown>): string[] {
  const hrefs: string[] = [];
  const defaultHref = frontmatter["defaultHref"];
  if (typeof defaultHref === "string" && defaultHref !== "") hrefs.push(defaultHref);
  const targets = frontmatter["targets"];
  if (Array.isArray(targets)) {
    for (const entry of targets) {
      if (typeof entry === "string" && entry !== "") hrefs.push(entry);
    }
  }
  return hrefs;
}

export function CommentaryView({ data, onNavigate }: RendererProps) {
  const frontmatter = data.frontmatter ?? {};
  const defaultRef = frontmatter["defaultRef"];
  const title = frontmatter["title"];
  const body = data.body;
  const hrefs = targetHrefs(frontmatter);

  return (
    <div className="p-4">
      {typeof title === "string" && title !== "" ? (
        <Text as="h1" size="lg" weight="semibold" className="mb-3">{title}</Text>
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row">
        {hrefs.length > 0 ? (
          hrefs.map((href) => (
            <TargetPane key={href} href={href} onNavigate={onNavigate} basePath={data.path} />
          ))
        ) : (
          <div className="min-w-0 flex-1">
            <Text as="div" tone="subtle" className="p-2 italic">
              In-box target{typeof defaultRef === "string" ? ` (${defaultRef})` : ""} — live rendering of in-box
              defaults is not wired yet.
            </Text>
          </div>
        )}

        <div className="min-w-0 flex-1" data-card-section="body">
          {body !== undefined && body.trim() !== "" ? (
            <Markdown prose="block" onNavigate={onNavigate} basePath={data.path}>{body}</Markdown>
          ) : (
            <Text as="div" tone="subtle" className="italic">No commentary yet.</Text>
          )}
        </div>
      </div>
    </div>
  );
}
