/**
 * Things relevant when responding to chat messages and the user-facing
 * surfaces around them: external converters, file attachments, selections,
 * and custom views.
 */

import { SECTION, xref } from "./sections.js";

export function externalToolsSection(): string[] {
  return [
    "## External Tools",
    "",
    "Always available on the box host, reach for them directly: `pandoc` (document conversion — .doc/.docx/.rtf/.odt → text or markdown), `imagemagick` (`magick`), and `poppler-utils` (`pdftotext`, `pdfimages`). Box-specific Python CLIs: `docs/generated/python-tools.md`.",
    "",
  ];
}

export function chatAttachmentsSection(): string[] {
  return [
    "## Chat Attachments",
    "",
    "Files the user attaches arrive as `[fileN]` tokens with a sibling `<attachments>` block mapping each token to a path under `tmp/`:",
    "",
    "```",
    "<attachments>",
    "[file1]: tmp/2026-04-27T15-30-12-987Z_report.pdf",
    "</attachments>",
    "```",
    "",
    "Read them with the right tool (Read for text/images/PDFs; `pandoc <path> -t plain` for Office docs). **`tmp/` is not storage** — it's gitignored and swept after 7 days. Once you've used a file, decide: a keeper goes *into* the box (a card that attaches it, or a spot under `box/inbox/` / `store/`) — don't leave it in `tmp/`; otherwise `rm` it or let the sweep take it.",
    "",
  ];
}

export function selectionsSection(): string[] {
  return [
    "## Selections",
    "",
    "The user can select text in a document they have open and attach it to a message. It arrives as a `<user-selection>` element:",
    "",
    "```",
    "<user-selection ref=\"/store/notes/Bread.doc.card\" pos=\"body; heading: Proofing the dough (#proofing-the-dough); ~line 42\">let it rise until doubled in size</user-selection>",
    "```",
    "",
    "The wrapped text is **what the user saw** — rendered, verbatim. Treat it as a quote; don't re-derive it.",
    "",
    `\`ref\`, \`pos\`, and (when present) \`placement\` mean exactly what they do on a \`{% source %}\` anchor — see ${xref(SECTION.PROVENANCE)}. A \`placement="estimated, ~N% through the message"\` says only the selection's *spot in this message* is a guess (positioned by rough timing when transcription reworded the phrase it anchored to); \`ref\`/\`pos\` still point at the real source. Whether it appears inline inside \`<typed>\` or appended after a \`<speech>\` body, treat it the same — a best effort to place it where the user made it, falling back to the end.`,
    "",
  ];
}

export function viewsSection(): string[] {
  return [
    "## Views",
    "",
    "Views are React (`.tsx`) components that render box data in the browser. **Read `docs/generated/views.md` before creating or modifying one.**",
    "",
    "A view gives a **card type** a custom interface: a view exporting `rendersCardTypes = [\"<type>\"]` becomes that type's UI on card pages, peeks, and chat embeds, and is selected on a card's path with `?view=name`. Every view is attached to a card type this way — there is no card-less standalone view.",
    "",
  ];
}
