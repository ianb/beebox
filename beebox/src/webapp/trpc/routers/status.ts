import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { getSystemState } from "../../../core/state.js";
import { generateContext } from "../../context.js";
import { loadCardFrontmatter } from "../../../core/frontmatter-field.js";
import { parseCardName } from "../../../lib/paths.js";
import { boxRelativePath } from "../../../shared/box-path.js";
import { getLog } from "../../../lib/git.js";
import { errnoCode } from "../../../lib/error-guards.js";
import { containWithinBox } from "../../../lib/box-containment.js";
import { isInBoxNamespace } from "../../../lib/box-namespace.js";
import { verifyBoxNamespaceOnDisk } from "../../../lib/box-namespace-resolve.js";
import { detectDisplayFormPath, displayFormPathMessage } from "../../../shared/display-path.js";
import { BOX_ROOT_VOCABULARY } from "../../../lib/box-root-vocabulary.js";
import { cardFields, parseCardText } from "../../../core/card-io.js";
import { createCardSchemaMap } from "../../../schemas/registry.js";
import { QuestionSchema, type QuestionFields } from "../../../schemas/question.js";
import { getNavCounts } from "../../../core/nav-counts.js";
import { naturalCompare } from "../../../lib/natural-sort.js";
import type { CardInfo } from "../../../core/state.js";
import type { DirectorySummary, ProminenceWalkContext } from "../../../core/landmark/prominence-index.js";
import {
  cardEffectiveProminence,
  directorySummary,
  subdirLandmarkIdentity,
  type BrowseDirLandmark,
} from "../../../core/landmark/browse-prominence.js";
import type { EffectiveLevel } from "../../../shared/prominence.js";
import type { CardSchema } from "../../../cards/schema.js";

/** A question card's answerable/archive-relevant fields, layered onto its `CardInfo`. */
export interface QuestionInfo extends CardInfo {
  prompt?: string | undefined;
  memo?: string | undefined;
  inputType?: QuestionFields["input"]["type"] | undefined;
  options?: string[] | undefined;
  learning?: QuestionFields["learning"] | undefined;
  answer?: QuestionFields["answer"] | undefined;
  /**
   * Set when the card failed to parse against `QuestionSchema` (bad
   * frontmatter, a superRefine violation, …). An invalid card carries only
   * its `CardInfo` fields — `status` is whatever `getSystemState` found (or
   * undefined) — so callers must still surface it rather than dropping it:
   * a card the boxholder needs to fix by hand is exactly the one that must
   * not silently vanish from the list.
   */
  invalid?: true | undefined;
}

export interface BrowseDir {
  name: string;
  fileCount: number;
  /** The pruned-subtree rollup (`docs/plans/card-prominence.md`, Track B): does anything under it lead? */
  summary: DirectorySummary;
  /** This subdirectory's OWN landmark identity, when it holds a landmark card directly. */
  landmark?: BrowseDirLandmark | undefined;
}

export interface BrowseCard {
  relativePath: string;
  name: string;
  type: string;
  status?: string | undefined;
  title?: string | undefined;
  /** True if this card has a `<basename>.attach/` directory (i.e. attachments). */
  hasAttachments?: boolean;
  /** The card's effective level: its own declared `prominence`, else its type's default. */
  prominence: EffectiveLevel;
}

export interface BrowseFile {
  relativePath: string;
  name: string;
}

/** The underscore area names — what the box root listing shows, and all it shows. */
const BOX_AREA_NAMES: ReadonlySet<string> = new Set(
  BOX_ROOT_VOCABULARY.filter((entry) => entry.kind === "area").map((entry): string => entry.name)
);

/**
 * Display-form leak (docs/plans/display-path-guard.subplan.md): unlike every
 * other namespace-fenced choke point, `status.browse` doesn't go through
 * `resolveBoxNamespacePathOnDisk` (it hand-rolls its own containment +
 * namespace check, which degrades to an empty listing BEFORE any existence
 * check), so the display-form detector must be called directly on the raw
 * input before that check runs. Split out to keep `browse`'s complexity
 * under the lint budget.
 */
function rejectDisplayFormBrowsePath(rawPath: string): void {
  const displayForm = detectDisplayFormPath(rawPath);
  if (displayForm !== null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: displayFormPathMessage(rawPath, displayForm) });
  }
}

/**
 * One subdirectory entry: the existing recursive `.card` count plus Track
 * C's pruned-subtree summary and own landmark identity. Split out to keep
 * `browse`'s complexity under the lint budget.
 */
async function buildBrowseDir(walk: ProminenceWalkContext, { resolved, entryName }: { resolved: string; entryName: string }): Promise<BrowseDir> {
  const { boxRoot } = walk;
  const dirFullPath = path.join(resolved, entryName);
  const dirRelPath = path.relative(boxRoot, dirFullPath);
  let fileCount = 0;
  try {
    const subEntries = await fs.readdir(dirFullPath, { recursive: true });
    fileCount = subEntries.filter((f) => typeof f === "string" && f.endsWith(".card")).length;
  } catch (e) {
    // Can't read subdirectory — leave fileCount at 0 rather than failing the whole listing.
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`browse: cannot count cards in ${dirFullPath}:`, e);
    }
  }
  const [summary, landmark] = await Promise.all([
    directorySummary(walk, dirRelPath),
    subdirLandmarkIdentity(boxRoot, dirRelPath),
  ]);
  return { name: entryName, fileCount, summary, ...(landmark !== undefined && { landmark }) };
}

/**
 * One `.card` entry: its frontmatter-derived fields plus Track C's
 * effective `prominence`. Split out for the same reason as `buildBrowseDir`.
 */
async function buildBrowseCard(
  { fullPath, relativePath, parsed, hasAttachments, cardSchemas }: {
    fullPath: string;
    relativePath: string;
    parsed: { name: string; type: string };
    hasAttachments: boolean;
    cardSchemas: Map<string, CardSchema>;
  },
): Promise<BrowseCard> {
  const fm = await loadCardFrontmatter(fullPath);
  const prominence = cardEffectiveProminence(fm, { type: parsed.type, cardSchemas });
  if (fm === null) {
    // Card failed to parse — still list it (as unknown) so the UI shows it.
    return { relativePath, name: parsed.name, type: parsed.type, hasAttachments, prominence };
  }
  const str = (key: string): string | undefined => {
    const value = fm[key];
    return typeof value === "string" ? value : undefined;
  };
  return {
    relativePath,
    name: parsed.name,
    type: parsed.type,
    ...(str("status") !== undefined && { status: str("status") }),
    ...(str("title") !== undefined && { title: str("title") }),
    hasAttachments,
    prominence,
  };
}

export const statusRouter = router({
  /**
   * The counts the app nav renders, and nothing else — the one query every
   * page mounts, so it computes only what it returns. `status.status` below
   * is the dashboard's fuller (and far more expensive) payload; the nav does
   * not use its git/version/inbox fields.
   */
  navStatus: publicProcedure.query(async ({ ctx }) => {
    return { counts: await getNavCounts(ctx.boxRoot) };
  }),

  status: publicProcedure.query(async ({ ctx }) => {
    // The two badge counts come from `getNavCounts`, not from `state`, so the
    // dashboard and the nav can never report different numbers for the same
    // thing (they differ on invalid cards — see `core/nav-counts.ts`).
    const [state, navCounts] = await Promise.all([
      getSystemState(ctx.boxRoot),
      getNavCounts(ctx.boxRoot),
    ]);
    return {
      boxRoot: state.boxRoot,
      boxVersion: state.boxVersion,
      created: state.created,
      git: state.git,
      counts: {
        inbox: state.inbox.length,
        questions: state.questions.length,
        pendingQuestions: navCounts.pendingQuestions,
        onPlateTodos: navCounts.onPlateTodos,
      },
    };
  }),

  inbox: publicProcedure.query(async ({ ctx }) => {
    const state = await getSystemState(ctx.boxRoot);
    return { items: state.inbox };
  }),

  questions: publicProcedure.query(async ({ ctx }) => {
    const state = await getSystemState(ctx.boxRoot);
    const schemas = await createCardSchemaMap(ctx.boxRoot);
    const items: QuestionInfo[] = await Promise.all(
      state.questions.map(async (q): Promise<QuestionInfo> => {
        try {
          const content = await fs.readFile(q.path, "utf-8");
          const card = parseCardText(content, { source: q.path, schemas });
          const fields = cardFields(card, QuestionSchema);
          return {
            ...q,
            prompt: fields.prompt,
            memo: fields.memo,
            inputType: fields.input.type,
            options: fields.input.options?.map((o) => o.label),
            learning: fields.learning,
            answer: fields.answer,
          };
        } catch (e) {
          console.warn(`Question card failed to parse, surfacing as invalid: ${q.path}:`, e);
          return { ...q, invalid: true };
        }
      }),
    );
    return { items };
  }),

  context: publicProcedure.query(async ({ ctx }) => {
    return generateContext(ctx.boxRoot);
  }),

  activity: publicProcedure
    .input(z.object({ count: z.number().int().positive().default(10) }))
    .query(async ({ input, ctx }) => {
      const entries = await getLog(ctx.boxRoot, input.count);
      return { entries };
    }),

  browse: publicProcedure
    .input(z.object({ path: z.string().default("") }))
    .query(async ({ input, ctx }) => {
      rejectDisplayFormBrowsePath(input.path);
      // Accept either ref form but normalize to the canonical box-relative path,
      // so the echoed `path` matches the form everything else uses (the listing's
      // `relativePath`s, file-change events). See src/shared/box-path.ts.
      const relPath = boxRelativePath(input.path);
      const targetDir = relPath
        ? path.join(ctx.boxRoot, relPath)
        : ctx.boxRoot;

      // Security: ensure we stay within boxRoot, then fence the RESOLVED
      // path (not the raw `relPath` string) against the box namespace — a
      // non-root path must land inside an underscore area (src/,
      // node_modules/, .git/, and any other root entry are not browsable
      // through this endpoint either), and a traversal form like
      // `_content/../src` can't hide behind its raw-string prefix
      // (`docs/implemented-plans/one-root-box-layout.md` Track B). The root listing
      // itself is filtered to areas only, below.
      const resolved = path.resolve(targetDir);
      const contained = containWithinBox(ctx.boxRoot, resolved);
      const empty: { dirs: BrowseDir[]; cards: BrowseCard[]; files: BrowseFile[]; background: boolean } =
        { dirs: [], cards: [], files: [], background: false };
      if (contained === null || (contained !== "" && !isInBoxNamespace(contained))) {
        return { path: relPath, ...empty };
      }
      // On-disk re-check for a non-root target: a symlinked directory or leaf
      // partway down the path could otherwise walk the fence into the
      // package internals even though the lexical check above passed
      // (one-root layout — `docs/implemented-plans/one-root-box-layout.md` Track B). The
      // root itself (`contained === ""`) has no walk to verify.
      if (
        contained !== "" &&
        !(await verifyBoxNamespaceOnDisk({
          boxRoot: ctx.boxRoot,
          ns: { resolved, relativePath: contained },
          mode: "read",
        }))
      ) {
        return { path: relPath, ...empty };
      }

      let entries: Array<{ name: string; isDirectory: () => boolean }>;
      try {
        entries = await fs.readdir(resolved, { withFileTypes: true });
      } catch (e) {
        if (errnoCode(e) !== "ENOENT") {
          console.warn(`browse: cannot read directory ${resolved}, returning empty listing:`, e);
        }
        return { path: relPath, ...empty };
      }

      const dirs: BrowseDir[] = [];
      const cards: BrowseCard[] = [];
      const files: BrowseFile[] = [];
      const cardSchemas = await createCardSchemaMap(ctx.boxRoot);

      // Build a set of card basenames so we can fold owned `<basename>.attach/`
      // directories into their owning card (cards-as-directories UI).
      const cardBasenames = new Set<string>();
      for (const e of entries) {
        if (e.isDirectory()) continue;
        if (!e.name.endsWith(".card")) continue;
        const parsed = parseCardName(e.name);
        if (parsed) cardBasenames.add(parsed.name);
      }

      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.isDirectory()) {
          // Hide `<basename>.attach/` when an owning card sits next to it.
          // Stray attach dirs (no owner) still show up so they can be cleaned.
          if (entry.name.endsWith(".attach")) {
            const owner = entry.name.slice(0, -".attach".length);
            if (cardBasenames.has(owner)) continue;
          }
          dirs.push(await buildBrowseDir({ boxRoot: ctx.boxRoot, cardSchemas }, { resolved, entryName: entry.name }));
          continue;
        }
        const fullPath = path.join(resolved, entry.name);
        const relativePath = path.relative(ctx.boxRoot, fullPath);

        if (entry.name.endsWith(".card")) {
          const parsed = parseCardName(entry.name);
          if (!parsed) continue;

          const attachDirName = `${parsed.name}.attach`;
          const hasAttachments = entries.some(
            (e) => e.isDirectory() && e.name === attachDirName,
          );

          cards.push(await buildBrowseCard({ fullPath, relativePath, parsed, hasAttachments, cardSchemas }));
          continue;
        }

        // Non-card file: list it as a generic file
        files.push({ relativePath, name: entry.name });
      }

      // At the box root, list ONLY the underscore areas — mirrors the
      // REST `/api/browse/*` route's root filtering.
      const filtered = filterRootListing({ relPath, dirs, cards, files });
      filtered.dirs.sort((a, b) => naturalCompare(a.name, b.name));
      filtered.cards.sort((a, b) => naturalCompare(a.name, b.name));
      filtered.files.sort((a, b) => naturalCompare(a.name, b.name));
      // The listed directory's own background cascade (its landmark, or an
      // ancestor's) — Track C's fold folds everything when this is true,
      // regardless of any individual card's own level.
      const background = (await directorySummary({ boxRoot: ctx.boxRoot, cardSchemas }, relPath)).background;
      return { path: relPath, background, ...filtered };
    }),
});

/**
 * At the box root, only the underscore areas are listed — there are no
 * ref-addressable or servable root files/cards, so `status.browse`'s root
 * listing (like `/api/browse/*`'s) shows just the area directories.
 */
function filterRootListing({
  relPath,
  dirs,
  cards,
  files,
}: {
  relPath: string;
  dirs: BrowseDir[];
  cards: BrowseCard[];
  files: BrowseFile[];
}): { dirs: BrowseDir[]; cards: BrowseCard[]; files: BrowseFile[] } {
  if (relPath !== "") return { dirs, cards, files };
  return { dirs: dirs.filter((d) => BOX_AREA_NAMES.has(d.name)), cards: [], files: [] };
}
