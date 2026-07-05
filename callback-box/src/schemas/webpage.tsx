/**
 * Webpage card schema — a captured external web page, stored in-box.
 *
 * The card *is* the page: its markdown body is the readable rendering (Defuddle
 * extraction), and a frozen, self-contained HTML snapshot rides alongside in
 * the card's `.attach/` scope. Frontmatter carries capture provenance — the
 * original URL, when it was captured, and a ref to the frozen snapshot.
 *
 * Produced by the clerk browser extension ("Comment on this page" and "Save
 * page") and rendered by `WebpageView`. Commentary *about* a captured page is
 * a separate `.commentary.card` living inside this card's attach scope; the
 * webpage view surfaces it inline. A webpage card is a snapshot of an external
 * page at capture time — edit it sparingly.
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { body, cardSchema, type CardSchema } from "../cards/index.js";

export const WebpageSchema: CardSchema = cardSchema("webpage", {
  description: "A captured external web page — readable markdown body plus a frozen HTML snapshot in the attach scope",
  category: "synced",
  fields: {
    title: z.string().optional(),
    // The original page URL the capture came from.
    source: z.string(),
    // Full ISO instant of capture; the renderer formats it in the viewer's
    // local zone. Optional — a page imported without capture metadata omits it.
    captured: z.string().optional(),
    siteName: z.string().optional(),
    byline: z.string().optional(),
    excerpt: z.string().optional(),
    // In-box ref to the frozen, self-contained snapshot (attach/page.frozen),
    // stored under a `ref` key like every other card reference.
    frozen: z.object({ ref: z.string() }).optional(),
    // The readable markdown rendering of the page. The card IS the document.
    body: body(z.string()),
  },
  instructions: `# Webpage Cards

A webpage card is a **captured external web page**, stored in the box. The
card's body is the readable markdown rendering of the page; a frozen,
self-contained HTML snapshot lives beside it in the card's attach scope. It is
a snapshot taken at capture time — treat the body as a record of what the page
said, and edit it only to fix capture artifacts, not to rewrite the page.

## Frontmatter

- \`source:\` — required. The original page URL.
- \`captured:\` — optional. Full ISO instant of capture; rendered in the
  viewer's local timezone.
- \`siteName:\` / \`byline:\` / \`excerpt:\` — optional capture metadata.
- \`frozen:\` — optional in-box ref (\`attach/page.frozen\`) to the frozen
  snapshot of the page, served sandboxed.
- \`title:\` — optional human label; defaults to the captured page title.

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

## Layout on disk

\`\`\`
box/inbox/My_Page.webpage.card          # readable body + provenance
box/inbox/My_Page.attach/page.frozen    # frozen snapshot
box/inbox/My_Page.attach/My_Page.commentary.card   # remarks (optional)
\`\`\``,
});

export interface WebpageFields {
  type: "webpage";
  title?: string;
  source: string;
  captured?: string;
  siteName?: string;
  byline?: string;
  excerpt?: string;
  frozen?: { ref: string };
  body: string;
}

export function createWebpageTemplate(options: {
  title: string;
  source: string;
  capturedAt?: string | undefined;
  content: string;
  siteName?: string | undefined;
  byline?: string | undefined;
  excerpt?: string | undefined;
  frozenRef?: string | undefined;
}): string {
  const fields: Record<string, unknown> = {
    title: options.title,
    source: options.source,
  };
  if (options.capturedAt !== undefined && options.capturedAt !== "") {
    fields["captured"] = options.capturedAt;
  }
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
  const yamlText = stringifyYaml(fields);
  const bodyText = options.content;
  const bodyTail = bodyText === "" ? "" : `${bodyText}${bodyText.endsWith("\n") ? "" : "\n"}`;
  return `---\n${yamlText}---\n${bodyTail}`;
}
