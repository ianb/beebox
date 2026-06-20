/**
 * REST routes for agent-generated views.
 *
 * - GET /api/views — list all views
 * - GET /api/views/:slug/module.js — compiled JS module
 * - GET /api/views/:slug/cards — cards matching view dependencies
 */

import type { FastifyInstance } from "fastify";
import * as path from "node:path";
import { glob } from "glob";
import { promises as fs } from "node:fs";
import { compileView, listViews, buildErrorModule } from "../views/compiler.js";
import { loadCardFile } from "../../core/card-io.js";
import { buildLoadContext } from "../../core/load-context.js";
import { getStatus, isRepo } from "../../cli/lib/git.js";
import { fileEtag } from "../file-etag.js";
import { attachDirFor } from "../../shared/attach-path.js";
import type { ViewCard, ViewFile } from "../../types/views.js";

interface RegisterViewRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
}

export async function registerViewRoutes(options: RegisterViewRoutesOptions): Promise<void> {
  const { server, boxRoot } = options;

  // GET /api/views — list all views
  server.get("/api/views", async () => {
    return listViews(boxRoot);
  });

  // GET /api/views/:slug/module.js — compiled JS module
  server.get<{ Params: { slug: string } }>(
    "/api/views/:slug/module.js",
    async (request, reply) => {
      const { slug } = request.params;
      const viewPath = path.join(boxRoot, "views", `${slug}.tsx`);

      try {
        const { output } = await compileView(viewPath);
        return reply
          .header("Content-Type", "application/javascript")
          .header("Cache-Control", "no-cache")
          .send(output);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return reply
          .header("Content-Type", "application/javascript")
          .header("Cache-Control", "no-cache")
          .send(buildErrorModule(message));
      }
    }
  );

  // GET /api/views/:slug/cards — cards + non-card files matching view dependencies
  server.get<{ Params: { slug: string } }>(
    "/api/views/:slug/cards",
    async (request, reply) => {
      const { slug } = request.params;
      const viewPath = path.join(boxRoot, "views", `${slug}.tsx`);

      let dependencies: string[];
      try {
        const { meta } = await compileView(viewPath);
        dependencies = meta.dependencies;
      } catch (_e) {
        return reply.status(404).send({ error: "View not found" });
      }

      if (dependencies.length === 0) {
        return { cards: [], files: [] };
      }

      // Collect matching files from all dependency globs: cards parse into
      // ViewCard; everything else (attachments, .md, .jsonl, ...) arrives
      // as raw text in `files`.
      const cardPaths = new Set<string>();
      const filePaths = new Set<string>();
      for (const pattern of dependencies) {
        const matches = await glob(pattern, { cwd: boxRoot, nodir: true });
        for (const m of matches) {
          if (m.endsWith(".card")) cardPaths.add(m);
          else filePaths.add(m);
        }
      }

      const ctx = await buildLoadContext(boxRoot);
      const cards: ViewCard[] = [];

      for (const relPath of cardPaths) {
        try {
          const absPath = path.join(boxRoot, relPath);
          const loaded = await loadCardFile(absPath, ctx);
          const viewCard = frontmatterViewCard(relPath, loaded.fields);
          const attachments = await listAttachments(boxRoot, relPath);
          if (attachments.length > 0) {
            viewCard.attachments = attachments;
          }
          cards.push(viewCard);
        } catch (_e) {
          // Skip cards that fail to load (validation errors, etc.)
        }
      }

      const files: ViewFile[] = [];
      for (const relPath of [...filePaths].toSorted()) {
        const meta = await statViewFile(boxRoot, relPath);
        if (meta !== null) files.push(meta);
      }

      // Annotate git working-tree state so views can show unsaved/uncommitted
      // indicators and decide when to offer a commit affordance.
      const gitStatusOf = await buildGitStatusLookup(boxRoot);
      if (gitStatusOf !== null) {
        for (const file of files) annotateGitStatus(file, gitStatusOf);
        for (const card of cards) {
          for (const att of card.attachments ?? []) annotateGitStatus(att, gitStatusOf);
        }
      }

      return { cards, files };
    }
  );
}

/** Phase-2 card → ViewCard: parsed fields in `frontmatter`, body split out. */
function frontmatterViewCard(relPath: string, fields: Record<string, unknown>): ViewCard {
  const frontmatter: Record<string, unknown> = {};
  let body: string | undefined;
  for (const [key, value] of Object.entries(fields)) {
    if (key === "type") continue;
    if (key === "body") {
      // The body field is always named `body` — enforced by cardSchema().
      if (typeof value === "string") body = value;
      continue;
    }
    frontmatter[key] = value;
  }
  const type = fields["type"];
  const viewCard: ViewCard = {
    path: relPath,
    tagName: typeof type === "string" ? type : "",
    attrs: {},
    frontmatter,
  };
  if (body !== undefined) viewCard.body = body;
  if (typeof frontmatter["status"] === "string") viewCard.status = frontmatter["status"];
  return viewCard;
}

type GitStatusLookup = (relPath: string) => "dirty" | "untracked" | null;

/**
 * One repo-wide status call mapped to a per-path lookup. Untracked entries
 * from porcelain can be whole directories ("?? new-dir/"), so untracked
 * matching is prefix-aware; dirty (modified/staged) entries are exact.
 */
async function buildGitStatusLookup(boxRoot: string): Promise<GitStatusLookup | null> {
  if (!(await isRepo(boxRoot))) return null;
  const status = await getStatus(boxRoot);
  const dirty = new Set([...status.modified, ...status.staged]);
  const untracked = status.untracked;
  return (relPath: string) => {
    if (dirty.has(relPath)) return "dirty";
    for (const entry of untracked) {
      if (entry === relPath || (entry.endsWith("/") && relPath.startsWith(entry))) {
        return "untracked";
      }
    }
    return null;
  };
}

function annotateGitStatus(file: ViewFile, lookup: GitStatusLookup): void {
  const status = lookup(file.path);
  if (status !== null) file.gitStatus = status;
}

/** Stat one file into ViewFile metadata; null when it vanished mid-request. */
async function statViewFile(boxRoot: string, relPath: string): Promise<ViewFile | null> {
  try {
    const st = await fs.stat(path.join(boxRoot, relPath));
    if (!st.isFile()) return null;
    return { path: relPath, size: st.size, mtimeMs: st.mtimeMs, etag: fileEtag(st) };
  } catch (_e) {
    return null;
  }
}

/**
 * Deep metadata listing of a card's attach scope (box-relative paths with
 * size/mtime) — so a view can discover e.g. ".../sessions/history.jsonl"
 * next to its card and fetch it via readFile()/fileUrl(). Metadata only:
 * attachments can be huge or binary, so content is never inlined here.
 */
async function listAttachments(boxRoot: string, cardRelPath: string): Promise<ViewFile[]> {
  const scopeRel = attachDirFor(cardRelPath);
  const scopeAbs = path.join(boxRoot, scopeRel);
  const out: ViewFile[] = [];
  async function walk(absDir: string, relPrefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch (_e) {
      return; // no attach scope — the common case
    }
    for (const entry of entries) {
      const rel = relPrefix === "" ? entry.name : `${relPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path.join(absDir, entry.name), rel);
      } else if (entry.isFile()) {
        const meta = await statViewFile(boxRoot, `${scopeRel}/${rel}`);
        if (meta !== null) out.push(meta);
      }
    }
  }
  await walk(scopeAbs, "");
  return out.toSorted((a, b) => a.path.localeCompare(b.path));
}
