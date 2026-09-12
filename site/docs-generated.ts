// Generated docs (plan: "Sources", Generated row): the engine's reference doc
// set, exported by `beebox/scripts/export-box-docs.ts` as JSON with no
// filesystem side effect. `card-<type>.md` becomes `reference/cards/<type>.md`;
// every other file becomes `reference/<filename>`. Every doc still passes the
// scrub gate — a pure function of the engine source can still quote a real
// box in an example (the plan notes `scheduler.md` and `box-docs/` already do).

import { execFileSync } from "node:child_process";
import { z } from "zod";
import { scrubText } from "./docs-scrub.js";
import type { PublishedDoc } from "./docs-types.js";

export class DocsGeneratedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocsGeneratedError";
  }
}

const generatedOutputSchema = z.object({
  fingerprint: z.string().min(1),
  docs: z.array(
    z.object({
      filename: z.string().min(1),
      readWhen: z.string().min(1),
      content: z.string(),
    }),
  ),
});

export interface GeneratedCorpus {
  fingerprint: string;
  docs: PublishedDoc[];
}

const CARD_DOC_RE = /^card-(.+)\.md$/;

function publishPathFor(filename: string): string {
  const match = CARD_DOC_RE.exec(filename);
  return match ? `reference/cards/${match[1]}.md` : `reference/${filename}`;
}

/** Run the export script and turn its output into scrub-gated published docs. */
export function loadGeneratedDocs(params: { beeboxDir: string; repoRoot: string }): GeneratedCorpus {
  const { beeboxDir, repoRoot } = params;
  let raw: string;
  try {
    raw = execFileSync("pnpm", ["--dir", beeboxDir, "exec", "tsx", "scripts/export-box-docs.ts"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new DocsGeneratedError(`export-box-docs.ts failed: ${detail}`);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new DocsGeneratedError(`export-box-docs.ts did not print JSON: ${detail}`);
  }
  const parsed = generatedOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new DocsGeneratedError(`export-box-docs.ts produced unexpected output: ${parsed.error.message}`);
  }
  const docs: PublishedDoc[] = parsed.data.docs.map((d) => {
    const sourceLabel = `beebox/box-docs/${d.filename}`;
    scrubText(d.content, { sourceLabel, repoRoot, blocklist: false });
    return { publishPath: publishPathFor(d.filename), kind: "generated", description: d.readWhen, body: d.content, sourceLabel };
  });
  return { fingerprint: parsed.data.fingerprint, docs };
}
