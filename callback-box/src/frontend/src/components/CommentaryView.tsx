/**
 * CommentaryView — renderer for `commentary` cards (the in-box review surface).
 *
 * Renders the wrapped target(s) live alongside the card's commentary body.
 * Two target shapes:
 *   - external `defaultHref`/`targets` — fetched through the dev-only
 *     `/api/external` route;
 *   - in-box `defaultRef` — fetched through the production `/api/files`
 *     route (the web-page-commentary flow stores its readable rendering in
 *     the card's `.attach/` and points `defaultRef` at it).
 * Both render through the file-renderer registry. Multi-target compare and
 * `{% source %}` anchor-linking land later.
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getApiBase } from "../api";
import { Markdown } from "./Markdown";
import { Pre } from "./ui/Pre";
import { Text } from "./ui/Text";
import { getRenderers, type FileData, type RendererProps } from "../renderers";
import { resolveRelativePath, type NavigateHint, type ViewTarget } from "../lib/view-url";

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

/**
 * Render fetched external content through the file-renderer registry, keyed on
 * the target's own path — so an included `.md` renders as Markdown, source as
 * Plaintext, and any future type through its own renderer, recursively. Falls
 * back to preformatted text when nothing in the registry matches.
 */
function ExternalDocument({
  href,
  envelope,
  onNavigate,
}: {
  href: string;
  envelope: Envelope;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
}) {
  const filePath = decodeURIComponent(new URL(href).pathname);
  const fileData: FileData = { path: filePath, content: decodeBase64Utf8(envelope.contentBase64) };
  const [renderer] = getRenderers(filePath, fileData);
  if (renderer === undefined) {
    return <Pre boxed scroll="lg">{fileData.content}</Pre>;
  }
  const Component = renderer.Component;
  return <Component data={fileData} onNavigate={onNavigate} />;
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

/** Render one external target's live content through the file-renderer registry. */
function TargetPane({
  href,
  onNavigate,
}: {
  href: string;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
}) {
  const { data, isLoading, error } = useExternalTarget(href);

  // Label the column with its href so a {% source href=… %} anchor (which
  // carries `data-source-href`) can locate its target column, and so a
  // selection captured in this pane knows which target it's against. The
  // ref/href parity here is what chunk 5b's anchor-linking + capture build on.
  return (
    <div className="min-w-0 flex-1" data-card-section="body" data-target-href={href}>
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
        <ExternalDocument href={href} envelope={data} onNavigate={onNavigate} />
      ) : null}
    </div>
  );
}

class InboxFetchError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Failed to load in-box target");
    this.name = "InboxFetchError";
    this.status = status;
  }
}

function useInboxTarget(boxPath: string) {
  const apiBase = getApiBase();
  return useQuery({
    queryKey: ["inbox-target", boxPath],
    queryFn: async ({ signal }): Promise<string> => {
      const resp = await fetch(`${apiBase}/files/${boxPath}`, { signal });
      if (!resp.ok) {
        throw new InboxFetchError(resp.status);
      }
      return resp.text();
    },
  });
}

/**
 * Render one in-box target's content through the file-renderer registry,
 * keyed on its path — so `.md` renders as Markdown, source as Plaintext, etc.
 * Falls back to preformatted text when nothing in the registry matches.
 */
function InboxDocument({
  boxPath,
  content,
  onNavigate,
}: {
  boxPath: string;
  content: string;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
}) {
  const fileData: FileData = { path: boxPath, content };
  const [renderer] = getRenderers(boxPath, fileData);
  if (renderer === undefined) {
    return <Pre boxed scroll="lg">{content}</Pre>;
  }
  const Component = renderer.Component;
  return <Component data={fileData} onNavigate={onNavigate} />;
}

/** Render one in-box target (a `defaultRef`) live through `/api/files`. */
function InboxTargetPane({
  boxPath,
  onNavigate,
}: {
  boxPath: string;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
}) {
  const { data, isLoading, error } = useInboxTarget(boxPath);

  // Label the column with its box-relative path so a {% source ref=… %} anchor
  // can locate its target column (the in-box parity of the href panes below).
  return (
    <div className="min-w-0 flex-1" data-card-section="body" data-target-ref={boxPath}>
      <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-warm-200 pb-1">
        <Text as="div" size="xs" tone="subtle" className="truncate font-mono">{boxPath}</Text>
      </div>
      {isLoading ? (
        <Text as="div" tone="subtle" className="p-2 italic">Loading target…</Text>
      ) : error !== null ? (
        <Text as="div" tone="danger" className="p-2">
          Couldn’t load this target. It may be missing.
        </Text>
      ) : data !== undefined ? (
        <InboxDocument boxPath={boxPath} content={data} onNavigate={onNavigate} />
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
  const inboxPath =
    typeof defaultRef === "string" && defaultRef !== ""
      ? resolveRelativePath(data.path, defaultRef)
      : null;

  return (
    <div className="p-4">
      {typeof title === "string" && title !== "" ? (
        <Text as="h1" size="lg" weight="semibold" className="mb-3">{title}</Text>
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row">
        {hrefs.length > 0 ? (
          hrefs.map((href) => (
            <TargetPane key={href} href={href} onNavigate={onNavigate} />
          ))
        ) : inboxPath !== null ? (
          <InboxTargetPane boxPath={inboxPath} onNavigate={onNavigate} />
        ) : (
          <div className="min-w-0 flex-1">
            <Text as="div" tone="subtle" className="p-2 italic">
              No target set for this commentary.
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
