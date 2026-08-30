/**
 * What the issue index indexes: one flat `IndexDocument` per markdown file,
 * from either corpus (the issue queue, or `beebox/docs` as prior art).
 *
 * The two hashes each document carries are the whole reason this is a
 * separate step from indexing: `indexHash` decides whether the persisted
 * Orama index is stale, `embedHash` decides whether a stored vector is. They
 * are deliberately different, because a frontmatter-only edit must rebuild
 * the index (a `where:` filter would otherwise keep matching the old value)
 * while costing nothing in embeddings.
 */

import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

import type { IssueEntry } from "./issue-search-model.js";

/** Documents come from two corpora: the issue queue, and (opt-in) design docs. */
export type IndexKind = "issue" | "doc";

/** One indexable file, issue or doc, reduced to what the index and embedder need. */
export interface IndexDocument {
  path: string;
  kind: IndexKind;
  title: string;
  body: string;
  category: string;
  area: string;
  labels: string[];
  workstream: string;
  discoveredInWorkstream: string;
  needs: string[];
  priority: string;
  nextAction: string;
  research: string;
  status: "open" | "closed";
  visibility: string;
  date: string;
  /** Hash of every indexed field above. Changes here mean the index is stale. */
  indexHash: string;
  /** Hash of {@link IndexDocument.embedText}. Changes here mean the vector is stale. */
  embedHash: string;
  /** Title + facets + body, truncated — exactly what gets embedded. */
  embedText: string;
}

/** An {@link IndexDocument} before its hashes are computed. */
type IndexFields = Omit<IndexDocument, "indexHash" | "embedHash" | "embedText">;

/**
 * Attach both hashes. They are deliberately separate: the frontmatter fields the
 * `where:` clauses filter on (workstream, needs, priority, next-action,
 * research, visibility) and the body past the embed truncation are all indexed
 * but NOT embedded, so a frontmatter-only edit must rebuild the index while
 * costing nothing in embeddings.
 */
function withHashes(fields: IndexFields, embedText: string): IndexDocument {
  return {
    ...fields,
    indexHash: hash(JSON.stringify(Object.entries(fields).toSorted())),
    embedHash: hash(embedText),
    embedText,
  };
}

const EMBED_TEXT_LIMIT = 8000;

function embedTextFor(options: { title: string; labels: string[]; area: string; body: string }): string {
  const facets = [
    options.title,
    options.area ? `area: ${options.area}` : "",
    options.labels.length > 0 ? `labels: ${options.labels.join(", ")}` : "",
  ].filter((line) => line !== "").join("\n");
  return `${facets}\n\n${options.body}`.slice(0, EMBED_TEXT_LIMIT);
}

function hash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function issueDocument(entry: IssueEntry): IndexDocument {
  const embedText = embedTextFor({
    title: entry.title, labels: entry.labels, area: entry.area ?? "", body: entry.body,
  });
  return withHashes({
    path: entry.path,
    kind: "issue",
    title: entry.title,
    body: entry.body,
    category: entry.category,
    area: entry.area ?? "",
    labels: entry.labels,
    workstream: entry.workstream,
    discoveredInWorkstream: entry.discoveredInWorkstream ?? "",
    needs: entry.needs,
    priority: entry.priority,
    nextAction: entry.nextAction ?? "",
    research: entry.research,
    status: entry.closed ? "closed" : "open",
    visibility: entry.visibility,
    date: entry.date ?? "",
  }, embedText);
}

function docDocument(options: { relPath: string; source: string }): IndexDocument {
  const { relPath, source } = options;
  const title = /^#\s+(?<heading>.+)$/mu.exec(source)?.groups?.["heading"]?.trim()
    ?? path.basename(relPath, ".md");
  const embedText = embedTextFor({ title, labels: [], area: "", body: source });
  return withHashes({
    path: relPath,
    kind: "doc",
    title,
    body: source,
    category: "",
    area: "",
    labels: [],
    workstream: "",
    discoveredInWorkstream: "",
    needs: [],
    priority: "",
    nextAction: "",
    research: "",
    status: "open",
    visibility: "public",
    date: "",
  }, embedText);
}

async function walkMarkdown(root: string, relative: string): Promise<string[]> {
  let dirents;
  try {
    dirents = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  } catch (_error) {
    return [];
  }
  const found: string[] = [];
  for (const dirent of dirents) {
    const next = relative === "" ? dirent.name : `${relative}/${dirent.name}`;
    if (dirent.isDirectory()) found.push(...(await walkMarkdown(root, next)));
    else if (dirent.isFile() && dirent.name.endsWith(".md")) found.push(next);
  }
  return found;
}

export const DOCS_SUBDIR = "beebox/docs";

export async function loadDocDocuments(repoRoot: string): Promise<IndexDocument[]> {
  const root = path.join(repoRoot, DOCS_SUBDIR);
  const relatives = await walkMarkdown(root, "");
  return Promise.all(relatives.toSorted().map(async (relative) => docDocument({
    relPath: `${DOCS_SUBDIR}/${relative}`,
    source: await fs.readFile(path.join(root, relative), "utf8"),
  })));
}
