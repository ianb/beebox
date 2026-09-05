/**
 * The engine docs — reference documentation about beebox itself, written into
 * the installed package (`<PACKAGE_ROOT>/box-docs/`), not into each box.
 *
 * Every file here is a pure function of the engine source: the static
 * reference docs, one `card-<type>.md` per built-in schema with
 * `instructions`, and a `README.md` index. Nothing depends on a box, so the
 * docs cannot lag the engine that reads them, and no box carries a copy.
 * Docs compiled from a box's own content stay in the box (`DOCS_DIR`).
 *
 * `ensurePackageDocs` runs on every `generateDocs` call: it computes the docs,
 * compares a content fingerprint with the one on disk, and rewrites the directory
 * atomically when they differ. A checkout (dev or deploy) is writable, so this
 * is the whole mechanism there; a release tarball gets the directory from
 * `scripts/build-box-docs.ts`, which calls the same writer before `pnpm pack`.
 * An unwritable package with no docs is reported (`unwritable`) so the caller
 * can make it visible — the agent guide points here on every turn.
 *
 * Design: `docs/plans/box-docs-in-package.md`.
 */

import { join } from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { contentHash } from "../../lib/content-hash.js";
import { errnoCode } from "../../lib/error-guards.js";
import { cardSchemas } from "../../schemas/registry.js";
import { getBuiltinTemplates } from "../../schemas/templates.js";
import { generateViewsDoc } from "../views/doc.js";
import { generateChatVoiceDoc } from "../chat/voice-doc.js";
import { generateNarrationModeDoc } from "../narration-mode-doc.js";
import { generateReducingClaudeMdDoc } from "../reducing-claude-md-doc.js";
import { generatePythonToolsDoc } from "../python-tools-doc.js";
import { CONTAINS_DOC_APPENDIX } from "../agent-guide/search.js";
import { generateBbxCommands } from "./bbx-commands.js";
import { generateCardDoc, generateConnectorsDocs } from "./content.js";
import { generateProcedureGuide } from "./procedure-guide.js";
import { generateTriageGuide } from "./triage.js";
import { BOX_PACKAGE_DOCS, PACKAGE_DOCS_DIR_NAME } from "./shared.js";

export interface EngineDoc {
  filename: string;
  content: string;
}

interface StaticDoc {
  filename: string;
  /** One line for the index: when an agent should open this doc. */
  readWhen: string;
  generate: () => string;
}

const STATIC_DOCS: readonly StaticDoc[] = [
  { filename: "bbx-commands.md", readWhen: "Running a `bbx` command beyond the everyday ones, or creating a card from a template.", generate: generateBbxCommands },
  { filename: "connectors.md", readWhen: "Anything about Gmail, Google Drive, Telegram, or calendar sync, or a credential a connector needs.", generate: generateConnectorsDocs },
  { filename: "views.md", readWhen: "Writing or changing a view (a React component that renders a card type).", generate: generateViewsDoc },
  { filename: "procedures.md", readWhen: "Writing or modifying a procedure card, or debugging a procedure run.", generate: generateProcedureGuide },
  { filename: "triage.md", readWhen: "Working the intake → triage → handle pipeline, or deciding where an inbox item belongs.", generate: generateTriageGuide },
  { filename: "chat-voice.md", readWhen: "Adjusting how a spoken chat reply is delivered (voice, pacing, emphasis).", generate: generateChatVoiceDoc },
  { filename: "narration-mode.md", readWhen: "The chat snapshot reports narration=\"on\" — the user is dictating, not chatting.", generate: generateNarrationModeDoc },
  { filename: "reducing-claude-md.md", readWhen: "The box's CLAUDE.md is flagged as too large.", generate: generateReducingClaudeMdDoc },
  { filename: "python-tools.md", readWhen: "Reaching for a box-specific Python CLI.", generate: generatePythonToolsDoc },
];

const FINGERPRINT_FILE = ".hash";
const INDEX_FILE = "README.md";

/** Card-doc filename for a type — shared by the package and the box writers. */
export function cardDocFilename(type: string): string {
  return `card-${type}.md`;
}

/** A schema's doc text: its `instructions`, plus the `contains:` rule for searchable types. */
export function cardDocInstructions(schema: { instructions?: string | undefined; searchable?: boolean | undefined }): string | undefined {
  if (schema.instructions === undefined) return undefined;
  return schema.searchable ? `${schema.instructions}\n\n${CONTAINS_DOC_APPENDIX}` : schema.instructions;
}

function builtinCardDocs(): { doc: EngineDoc; readWhen: string }[] {
  const templates = getBuiltinTemplates();
  const out: { doc: EngineDoc; readWhen: string }[] = [];
  for (const schema of cardSchemas) {
    const instructions = cardDocInstructions(schema);
    if (instructions === undefined) continue;
    out.push({
      doc: {
        filename: cardDocFilename(schema.type),
        content: generateCardDoc({
          name: schema.type,
          instructions,
          templates: templates.filter((t) => t.cardTypes.includes(schema.type)),
        }),
      },
      readWhen: schema.description === undefined ?
        `Reading, creating, or editing a \`*.${schema.type}.card\`.` :
        `Reading, creating, or editing a \`*.${schema.type}.card\` — ${schema.description}.`,
    });
  }
  return out;
}

function indexDoc(entries: { filename: string; readWhen: string }[]): string {
  const lines = [
    "# beebox reference docs",
    "",
    "Reference documentation about beebox itself, shipped with the installed package.",
    `From a box these files are at \`${BOX_PACKAGE_DOCS}/\`. Read the doc before answering`,
    "a question about how something works or before working with a card type you",
    "don't know — don't reconstruct a mechanism from memory. Docs compiled from a box's",
    "own content (its guides, personality, box-local card types) are in that box's",
    "`_content/docs/generated/` instead.",
    "",
    "| Doc | Read it when |",
    "|---|---|",
  ];
  for (const e of entries) lines.push(`| \`${e.filename}\` | ${e.readWhen} |`);
  lines.push("");
  return lines.join("\n");
}

/** Every engine doc, computed from the running source. Pure. */
export function engineDocs(): EngineDoc[] {
  const statics = STATIC_DOCS.map((d) => ({ doc: { filename: d.filename, content: d.generate() }, readWhen: d.readWhen }));
  const cards = builtinCardDocs();
  const all = [...statics, ...cards];
  const index: EngineDoc = {
    filename: INDEX_FILE,
    content: indexDoc(all.map((e) => ({ filename: e.doc.filename, readWhen: e.readWhen }))),
  };
  return [index, ...all.map((e) => e.doc)];
}

/**
 * Filenames the package holds. `generateDocs` unlinks these from a box's
 * `DOCS_DIR`, so a box upgraded from the engine that used to write them there
 * doesn't keep a stale copy beside the live one.
 */
export function engineDocFilenames(): string[] {
  return engineDocs().map((d) => d.filename);
}

function docsFingerprint(docs: EngineDoc[]): string {
  return contentHash(docs.map((d) => `${d.filename}\n${d.content}`).join("\0"));
}

export type EnsurePackageDocsResult =
  /** The directory already holds these exact docs. The common case. */
  | { readonly status: "current" }
  /** The directory was (re)written. */
  | { readonly status: "written"; readonly dir: string }
  /** The package location cannot be written and holds no current docs. */
  | { readonly status: "unwritable"; readonly dir: string; readonly reason: string };

function isPermissionError(e: unknown): boolean {
  const code = errnoCode(e);
  return code === "EACCES" || code === "EPERM" || code === "EROFS";
}

/**
 * Write the engine docs into `<packageRoot>/box-docs/` when the ones on disk
 * differ (by content hash). Atomic: a temp sibling is filled, then swapped in
 * by rename, so a reader never sees a half-written directory. Two processes
 * racing here write identical content; whoever loses the swap re-reads the
 * hash and reports `current`.
 */
export async function ensurePackageDocs(options?: { packageRoot?: string }): Promise<EnsurePackageDocsResult> {
  const packageRoot = options?.packageRoot ?? PACKAGE_ROOT;
  const dir = join(packageRoot, PACKAGE_DOCS_DIR_NAME);
  const docs = engineDocs();
  const want = docsFingerprint(docs);
  if (await storedFingerprint(dir) === want) return { status: "current" };

  const tmp = join(packageRoot, `.${PACKAGE_DOCS_DIR_NAME}-${String(process.pid)}`);
  const old = join(packageRoot, `.${PACKAGE_DOCS_DIR_NAME}-old-${String(process.pid)}`);
  try {
    await rm(tmp, { recursive: true, force: true });
    await mkdir(tmp, { recursive: true });
    for (const d of docs) await writeFile(join(tmp, d.filename), d.content);
    await writeFile(join(tmp, FINGERPRINT_FILE), `${want}\n`);
    await swapIn({ tmp, dir, old });
    return { status: "written", dir };
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    if (isPermissionError(e)) {
      return { status: "unwritable", dir, reason: `${errnoCode(e) ?? "error"} writing ${dir}` };
    }
    // A concurrent writer won the swap: if what landed is what we wanted, that's current.
    if (await storedFingerprint(dir) === want) return { status: "current" };
    throw e;
  }
}

async function swapIn({ tmp, dir, old }: { tmp: string; dir: string; old: string }): Promise<void> {
  try {
    await rename(dir, old);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e; // nothing to move aside on first write
  }
  await rename(tmp, dir);
  await rm(old, { recursive: true, force: true });
}

async function storedFingerprint(dir: string): Promise<string | null> {
  try {
    return (await readFile(join(dir, FINGERPRINT_FILE), "utf-8")).trim();
  } catch (e) {
    if (errnoCode(e) === "ENOENT" || errnoCode(e) === "ENOTDIR") return null;
    throw e;
  }
}
