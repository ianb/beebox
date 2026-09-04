import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
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
import { BOX_ROOT_VOCABULARY } from "../../../lib/box-root-vocabulary.js";
import { cardFields, parseCardText } from "../../../core/card-io.js";
import { createCardSchemaMap } from "../../../schemas/registry.js";
import { QuestionSchema, type QuestionFields } from "../../../schemas/question.js";
import { getNavCounts } from "../../../core/nav-counts.js";
import { naturalCompare } from "../../../lib/natural-sort.js";
import type { CardInfo } from "../../../core/state.js";

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
}

export interface BrowseCard {
  relativePath: string;
  name: string;
  type: string;
  status?: string | undefined;
  title?: string | undefined;
  /** True if this card has a `<basename>.attach/` directory (i.e. attachments). */
  hasAttachments?: boolean;
}

export interface BrowseFile {
  relativePath: string;
  name: string;
}

/** The underscore area names — what the box root listing shows, and all it shows. */
const BOX_AREA_NAMES: ReadonlySet<string> = new Set(
  BOX_ROOT_VOCABULARY.filter((entry) => entry.kind === "area").map((entry): string => entry.name)
);

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
      // Accept either ref form but normalize to the canonical box-relative path,
      // so the echoed `path` matches the form everything else uses (the listing's
      // `relativePath`s, file-change events). See src/shared/box-path.ts.
      const relPath = boxRelativePath(input.path);
      const targetDir = relPath
        ? path.join(ctx.boxRoot, relPath)
        : ctx.boxRoot;

      // Security: ensure we stay within boxRoot
      const resolved = path.resolve(targetDir);
      if (containWithinBox(ctx.boxRoot, resolved) === null) {
        const empty: { dirs: BrowseDir[]; cards: BrowseCard[]; files: BrowseFile[] } = { dirs: [], cards: [], files: [] };
        return { path: relPath, ...empty };
      }

      // Box namespace fence: a non-root path must land inside an underscore
      // area — src/, node_modules/, .git/, and any other root entry are not
      // browsable through this endpoint either (`docs/plans/one-root-box-layout.md`
      // Track B). The root listing itself is filtered to areas only, below.
      if (relPath !== "" && !isInBoxNamespace(relPath)) {
        const empty: { dirs: BrowseDir[]; cards: BrowseCard[]; files: BrowseFile[] } = { dirs: [], cards: [], files: [] };
        return { path: relPath, ...empty };
      }

      let entries: Array<{ name: string; isDirectory: () => boolean }>;
      try {
        entries = await fs.readdir(resolved, { withFileTypes: true });
      } catch (e) {
        if (errnoCode(e) !== "ENOENT") {
          console.warn(`browse: cannot read directory ${resolved}, returning empty listing:`, e);
        }
        const empty: { dirs: BrowseDir[]; cards: BrowseCard[]; files: BrowseFile[] } = { dirs: [], cards: [], files: [] };
        return { path: relPath, ...empty };
      }

      const dirs: BrowseDir[] = [];
      const cards: BrowseCard[] = [];
      const files: BrowseFile[] = [];

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
          const dirFullPath = path.join(resolved, entry.name);
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
          dirs.push({ name: entry.name, fileCount });
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

          const fm = await loadCardFrontmatter(fullPath);
          if (fm === null) {
            // Card failed to parse — still list it (as unknown) so the UI shows it.
            cards.push({ relativePath, name: parsed.name, type: parsed.type, hasAttachments });
            continue;
          }
          const str = (key: string): string | undefined => {
            const value = fm[key];
            return typeof value === "string" ? value : undefined;
          };
          cards.push({
            relativePath,
            name: parsed.name,
            type: parsed.type,
            ...(str("status") !== undefined && { status: str("status") }),
            ...(str("title") !== undefined && { title: str("title") }),
            hasAttachments,
          });
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
      return { path: relPath, ...filtered };
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
