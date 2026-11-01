/**
 * Webpage card schema — a captured external web page, stored in-box.
 *
 * The card *is* the page: its markdown body is the readable rendering (Defuddle
 * extraction), and a frozen HTML snapshot, self-contained when Clerk made it, rides alongside in
 * the card's `.attach/` scope. Frontmatter carries capture provenance — the
 * original URL and when it was retrieved (the card's one `sources` entry), and
 * a ref to the frozen snapshot.
 *
 * Produced by the clerk browser extension ("Comment on this page" and "Save
 * page") and by `bbx webpage`, and rendered by `WebpageView`. Commentary *about* a captured page is
 * a separate `.commentary.card` living inside this card's attach scope; the
 * webpage view surfaces it inline. A webpage card is a snapshot of an external
 * page at capture time — edit it sparingly.
 */

import { stringify as stringifyYaml } from "../lib/yaml-package.js";
import { z } from "zod";
import { body, cardSchema, type InferCardFields } from "../exports/cards.js";
import { SourcesEntrySchema } from "../cards/sources-entry.js";

/**
 * The captured page: exactly one `sources` entry, an external `href`.
 * `retrieved` is the full ISO instant of capture (the renderer formats it in
 * the viewer's local zone), absent for a page imported without capture
 * metadata.
 */
const WebpageSources = z
  .array(SourcesEntrySchema)
  .length(1, "a webpage card has exactly one `sources` entry: the page it captured")
  .superRefine((entries, ctx) => {
    if (entries.some((entry) => entry.href === undefined || entry.href === "")) {
      ctx.addIssue({ code: "custom", message: "a webpage's `sources` entry is the captured page's URL, an `href`" });
    }
  });

/**
 * `via`: over plain HTTP, from the box browser, or from HTML already on disk. `snapshot: html-only`: the
 * saved HTML is the page's own, so its images and styles still load from the
 * site. `redirectedFrom`: every earlier address, oldest first. `function: box`:
 * the box's `webpage.ts` made this card. `note`: anything else worth knowing.
 * `sha256`: of the bytes as received; the saved HTML adds a `<base>` tag.
 * `requestHeaders`: the name of the header set sent. `meta`: what the box or the
 * caller kept, such as the original fetch's provenance or dates the page states.
 */
const WebpageCapture = z.object({
  via: z.enum(["http", "browser", "file"]),
  snapshot: z.literal("html-only").optional(),
  redirectedFrom: z.array(z.string()).optional(),
  function: z.literal("box").optional(),
  note: z.string().optional(),
  sha256: z.string().optional(),
  requestHeaders: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type WebpageCaptureFields = z.infer<typeof WebpageCapture>;

export const WebpageSchema = cardSchema("webpage", {
  brief: "A captured web page",
  description: "A captured external web page — readable markdown body plus a frozen HTML snapshot in the attach scope",
  category: "synced",
  fields: {
    // The original page URL and when it was captured.
    sources: WebpageSources,
    siteName: z.string().optional(),
    byline: z.string().optional(),
    excerpt: z.string().optional(),
    // In-box ref to the frozen snapshot (attach/page.frozen),
    // stored under a `ref` key like every other card reference.
    frozen: z.object({ ref: z.string() }).optional(),
    // How `bbx webpage` got the page. Absent on a Clerk or share card.
    capture: WebpageCapture.optional(),
    /** Stable id supplied by an external share operation for retry deduplication. */
    "share-id": z.string().uuid().optional(),
    /** Stable id supplied by a Clerk capture for retry deduplication. */
    "capture-id": z.string().uuid().optional(),
    // The readable markdown rendering of the page. The card IS the document.
    body: body(z.string()),
  },
  instructions: `# Webpage Cards

A webpage card is a **captured external web page**, stored in the box. The
card's body is the readable markdown rendering of the page; a frozen HTML
snapshot lives beside it in the card's attach scope, self-contained unless
\`capture.snapshot\` is \`html-only\`. It is
a snapshot taken at capture time — treat the body as a record of what the page
said, and edit it only to fix capture artifacts, not to rewrite the page.

## Frontmatter

- \`sources:\` — required, exactly one entry: \`[{ href, retrieved? }]\`.
  \`href\` is the original page URL; \`retrieved\` is the full ISO instant
  of capture, rendered in the viewer's local timezone.
- \`siteName:\` / \`byline:\` / \`excerpt:\` — optional capture metadata.
- \`capture:\` — written by \`bbx webpage\`: how the page was got, any redirect,
  and whether the box's \`webpage.ts\` made the card. Its \`snapshot: html-only\`
  means the saved HTML still loads its images and styles from the site.
  \`capture.meta\` holds kept provenance; when it is present, trust it over the
  \`retrieved\` time only if \`retrieved\` is missing.
- \`frozen:\` — optional in-box ref (\`attach/page.frozen\`) to the frozen
  snapshot of the page, served sandboxed.
- \`title:\` — optional human label; defaults to the captured page title.
- \`capture-id:\` / \`share-id:\` — retry dedupe keys written by Clerk / the
  iOS share extension; leave them unchanged.

## Body

The readable rendering lives **inline in the .webpage.card body**, after the
frontmatter — plain markdown, like a \`doc\` card. Don't store it in a separate
\`attach/readable.md\` file; the card *is* the page.

## Commentary

The boxholder's remarks about the page are **not** in this card. They live in a
separate \`.commentary.card\` inside this card's attach scope
(\`<basename>.attach/\`), and the webpage view surfaces them inline. A
commentary anchor (\`{% source %}\`) with no \`ref\`/\`href\` points at *this*
page — the containing document is the default target.

## How it arrives

The Clerk browser extension's "Comment on this page" captures a web page as a
\`*.webpage.card\`, with the user's remarks in a commentary card in its attach
scope. "Save page" produces the same \`*.webpage.card\` without the commentary. It lands in the chosen \`[commentary]\` destination landmark dir, or \`_content/inbox/\` by default.

## Layout on disk

\`\`\`
_content/inbox/My_Page.webpage.card          # readable body + provenance
_content/inbox/My_Page.attach/page.frozen    # frozen snapshot
_content/inbox/My_Page.attach/My_Page.commentary.card   # remarks (optional)
\`\`\``,
});

export type WebpageFields = InferCardFields<typeof WebpageSchema>;

export function createWebpageTemplate(options: {
  title: string;
  url: string;
  capturedAt?: string | undefined;
  content: string;
  siteName?: string | undefined;
  byline?: string | undefined;
  excerpt?: string | undefined;
  frozenRef?: string | undefined;
  shareId?: string | undefined;
  captureId?: string | undefined;
  capture?: WebpageCaptureFields | undefined;
}): string {
  const fields: Record<string, unknown> = {
    title: options.title,
    sources: [
      options.capturedAt !== undefined && options.capturedAt !== ""
        ? { href: options.url, retrieved: options.capturedAt }
        : { href: options.url },
    ],
  };
  if (options.siteName !== undefined && options.siteName !== "") {
    fields["siteName"] = options.siteName;
  }
  if (options.byline !== undefined && options.byline !== "") {
    fields["byline"] = options.byline;
  }
  if (options.excerpt !== undefined && options.excerpt !== "") {
    fields["excerpt"] = options.excerpt;
  }
  if (options.frozenRef !== undefined && options.frozenRef !== "") {
    fields["frozen"] = { ref: options.frozenRef };
  }
  if (options.shareId !== undefined && options.shareId !== "") {
    fields["share-id"] = options.shareId;
  }
  if (options.captureId !== undefined && options.captureId !== "") {
    fields["capture-id"] = options.captureId;
  }
  if (options.capture !== undefined) {
    fields["capture"] = options.capture;
  }
  const yamlText = stringifyYaml(fields);
  const bodyText = options.content;
  const bodyTail = bodyText === "" ? "" : `${bodyText}${bodyText.endsWith("\n") ? "" : "\n"}`;
  return `---\n${yamlText}---\n${bodyTail}`;
}
