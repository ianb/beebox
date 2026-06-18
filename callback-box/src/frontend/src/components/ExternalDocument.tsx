/**
 * Fetch and render a live external file (a `file:` href) through the dev-only
 * `/api/external` route, deferring to whatever file-renderer the registry picks
 * for the file's type. Shared by the extfile card view and the commentary view.
 *
 * The route returns a JSON envelope (base64 bytes + content-type + current
 * version markers); we decode the bytes as UTF-8 and hand `{ path, content }` to
 * the registry renderer. That means only text-renderable types (markdown,
 * plaintext/source) display here — image/PDF/binary renderers re-fetch via the
 * in-box `/api/files` route, which can't serve an external path (see ExtfileView,
 * which gates on this). Falls back to preformatted text when nothing matches.
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getApiBase } from "../api";
import { Pre } from "./ui/Pre";
import { getRenderers, type FileData } from "../renderers";
import { type NavigateHint, type ViewTarget } from "../lib/view-url";

export class ExternalFetchError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Failed to load external target");
    this.name = "ExternalFetchError";
    this.status = status;
  }
}

export const EnvelopeSchema = z.object({
  contentBase64: z.string(),
  contentType: z.string(),
  markers: z.string(),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

function decodeBase64Utf8(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.codePointAt(0) ?? 0);
  return new TextDecoder().decode(bytes);
}

/** Fetch one external target's live content + current version markers. */
export function useExternalTarget(href: string) {
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

/**
 * Render fetched external content through the file-renderer registry, keyed on
 * the target's own path — so an included `.md` renders as Markdown, source as
 * Plaintext, and any future text type through its own renderer. Falls back to
 * preformatted text when nothing in the registry matches.
 */
export function ExternalDocument({
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
