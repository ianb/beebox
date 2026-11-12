// # `bbx pdf reanalyze` on a card from `bbx pdf save`
//
// docs/plans/knowledge-base-tools.md, Track B. Re-extraction replaces the body,
// and the body is third-party text, so it is neutralized the way `writePdfCard`
// neutralizes it. The card's `sources` and `capture` are the save's record of
// where the file came from; they stay.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createCollectorContext } from "../../../src/core/command-runner.js";
import { runPdfReanalyze } from "../../../src/core/commands/pdf-reanalyze.js";
import { createFakeDocling } from "../../../src/services/docling/core.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { textPdf } from "../../helpers/pdf-fixtures.js";

const CARD = `---
format: pdf
filename:
  ref: attach/source.pdf
  via:
    channel: bbx-pdf-save
    at: 2026-10-29T10:00:00Z
sources:
  - href: https://agency.example/guide.pdf
    retrieved: 2026-10-29T10:00:00Z
capture:
  via: http
  sha256: abc123
  meta:
    method: curl
description: kept
---
old text
`;

void test("Reanalyze neutralizes the new body and keeps sources and capture", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await fs.mkdir(path.join(box.root, "_content/knowledge/guide.attach"), { recursive: true });
  await fs.writeFile(path.join(box.root, "_content/knowledge/guide.pdf.card"), CARD);
  await fs.writeFile(path.join(box.root, "_content/knowledge/guide.attach/source.pdf"), textPdf());
  const { ctx } = createCollectorContext(box.root);
  const docling = createFakeDocling({ markdown: "New {% x %} <b>text</b>\n", pageCount: 1, figureCount: 0 });
  const result = await runPdfReanalyze(ctx, { args: { card: "_content/knowledge/guide.pdf.card" }, docling });
  t.check(result.success, true);
  const text = await fs.readFile(path.join(box.root, "_content/knowledge/guide.pdf.card"), "utf8");
  t.check(text.split("\n"), [
    "---",
    "format: pdf",
    "filename:",
    "  ref: attach/source.pdf",
    "  via:",
    "    channel: bbx-pdf-save",
    "    at: 2026-10-29T10:00:00Z",
    "sources:",
    "  - href: https://agency.example/guide.pdf",
    "    retrieved: 2026-10-29T10:00:00Z",
    "capture:",
    "  via: http",
    "  sha256: abc123",
    "  meta:",
    "    method: curl",
    "description: kept",
    "docling:",
    "  ref: attach/docling.json.gz",
    "  version: 2.117.0-fake",
    "metadata:",
    "  pages: 1",
    "---",
    "New \\{% x %} \\<b>text\\</b>",
    "",
  ]);
});
