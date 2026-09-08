import { z } from "zod";
import * as fs from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, ownerProcedure } from "../trpc.js";
import { splitCardContent, type CardSchema } from "../../../cards/index.js";
import { isRecord } from "../../../lib/is-record.js";
import { parseCardText, typeFromFilename } from "../../../core/card-io.js";
import { createCardSchemaMap } from "../../../schemas/registry.js";
import { boxRelativePath } from "../../../shared/box-path.js";
import { resolveBoxNamespacePathOnDisk, type BoxNamespaceAccessMode } from "../../../lib/box-namespace-resolve.js";
import { Document, isMap, parse as parseYaml, parseDocument } from "yaml";
import { errorMessage } from "../../../lib/error-guards.js";
import { findInboundCardRefs } from "../../../core/find-inbound-card-refs.js";
import { commitTrashReceipt, moveCardsToTrash } from "../../../core/commands/trash.js";
import { rollbackTrashReceipt } from "../../../core/commands/trash-recovery.js";
import { createCollectorContext } from "../../../core/commands/index.js";
import * as path from "node:path";
import { ThemeChoiceSchema, validateThemeChoice } from "../../../shared/card-theme.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { writeFileAtomic } from "../../../lib/atomic-write.js";
import { stageAndCommitPaths } from "../../../lib/git.js";

/**
 * Box containment + namespace fence, checked on the RESOLVED path (both
 * lexically and on disk — the one-root layout means a symlinked directory or
 * leaf could otherwise walk the fence into the package internals). `card.get`
 * and its siblings (`inboundRefs`, `trash`) all resolve through here, and a
 * traversal form like `_content/../package.json` must not read
 * `package.json` just because the raw string starts with an underscore area
 * (`docs/implemented-plans/one-root-box-layout.md` Track B).
 */
async function resolveCardPath({
  boxRoot,
  inputPath,
  mode,
}: {
  boxRoot: string;
  inputPath: string;
  mode: BoxNamespaceAccessMode;
}): Promise<{ relPath: string; fullPath: string }> {
  const ns = await resolveBoxNamespacePathOnDisk({
    boxRoot,
    rawPath: boxRelativePath(inputPath),
    mode,
  });
  if (!ns.ok) {
    if (ns.reason === "display-form") {
      // Display-form leak (docs/plans/display-path-guard.subplan.md): a
      // caller-visible message naming the canonical form.
      throw new TRPCError({ code: "BAD_REQUEST", message: ns.message });
    }
    // "Did you mean `/_content/<path>`?" — suggestion-on-failure for the
    // boxholder's BARE display vocabulary. A bare content path
    // (`recipes/Soup.recipe.card`) reads to a boxholder as "the box's
    // content", but `card.get`'s `path` input is canonical — a bare path
    // with no area prefix is refused here as an escape (it names nothing
    // inside any underscore area) even though `/_content/<path>` exists.
    // This is already the diagnostic boundary that has `boxRoot` in hand
    // and is about to refuse anyway, so the one extra probe is cheap.
    const bare = boxRelativePath(inputPath);
    const suggestion = bare.startsWith("_") ? null : await suggestContentFormCardPath(boxRoot, bare);
    const suffix = suggestion === null ? "" : ` — did you mean \`${suggestion}\`?`;
    throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid card path${suffix}` });
  }
  return { relPath: ns.relativePath, fullPath: ns.resolved };
}

/**
 * Whether `_content/<relPath>` exists, for {@link resolveCardPath}'s
 * suggestion — the returned path is the canonical leading-`/` ref form, not
 * the bare box-relative form used for the filesystem check.
 */
async function suggestContentFormCardPath(boxRoot: string, relPath: string): Promise<string | null> {
  const candidate = `_content/${relPath}`;
  try {
    await fs.access(path.join(boxRoot, candidate));
    return `/${candidate}`;
  } catch (_e) {
    return null;
  }
}

export interface FrontmatterCardResponse {
  path: string;
  kind: "frontmatter";
  type: string;
  frontmatter: Record<string, unknown> | undefined;
  body: string | undefined;
  validationError: string | undefined;
}

function loadFrontmatterCard(input: {
  raw: string;
  source: string;
  type: string;
  cardSchemas: Map<string, CardSchema>;
}): FrontmatterCardResponse {
  const { raw, source, type, cardSchemas } = input;
  let frontmatter: Record<string, unknown> | undefined;
  let body: string | undefined;
  let validationError: string | undefined;

  try {
    const parsed = parseCardText(raw, { source, schemas: cardSchemas, type });
    const fields = { ...parsed.fields };
    if (parsed.schema.bodyFieldName !== null) {
      const bodyValue = fields[parsed.schema.bodyFieldName];
      body = typeof bodyValue === "string" ? bodyValue : parsed.rawBody;
      delete fields[parsed.schema.bodyFieldName];
    } else {
      body = parsed.rawBody;
    }
    delete fields["type"];
    frontmatter = fields;
  } catch (e) {
    validationError = errorMessage(e);
    // Still surface what we can — split the file and parse YAML loosely.
    const split = splitCardContent(raw);
    body = split.body;
    try {
      const fm: unknown = parseYaml(split.frontmatterText);
      if (isRecord(fm)) {
        frontmatter = fm;
      }
    } catch (_e) {
      // YAML itself is malformed — leave frontmatter undefined.
    }
  }

  return {
    path: source,
    kind: "frontmatter",
    type,
    frontmatter,
    body,
    validationError,
  };
}

export const cardRouter = router({
  get: publicProcedure
    .input(z.object({ path: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      // Accept either ref form (a leading-slash ref or the canonical box-relative
      // path) but normalize to canonical so the security check, the read, and the
      // returned `path` are all consistent. See src/shared/box-path.ts.
      const { relPath, fullPath } = await resolveCardPath({ boxRoot: ctx.boxRoot, inputPath: input.path, mode: "read" });

      // Security: `input.path` arrives from the client (and now from the chat
      // `?card=` deep-link a card-page click writes). `resolveCardPath` above
      // already confirmed the resolved path stays inside the box AND inside
      // the box namespace (Track B, `docs/implemented-plans/one-root-box-layout.md`) —
      // mirrors the `/api/files` boundary guard.
      let raw: string | null = null;
      try {
        raw = await fs.readFile(fullPath, "utf-8");
      } catch (e) {
        const msg = errorMessage(e);
        if (msg.includes("ENOENT") || msg.includes("no such file")) {
          // `relPath` here is already canonical (area-prefixed) — a bare
          // display-form path never reaches this point at all; it's refused
          // earlier by `resolveCardPath` (with the "did you mean" suggestion
          // attached there instead — see its doc comment).
          throw new TRPCError({ code: "NOT_FOUND", message: `Card not found: ${relPath}` });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: msg });
      }

      const split = splitCardContent(raw);
      const fileType = typeFromFilename(relPath);
      if (split.hasFrontmatter && fileType !== undefined) {
        // loadFrontmatterCard is robust to an unregistered/invalid schema: it
        // surfaces what it can (loose YAML + body) with a validationError, so a
        // box-local-typed or drifted card still renders.
        const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
        return loadFrontmatterCard({ raw, source: relPath, type: fileType, cardSchemas });
      }

      // Not a typed frontmatter card. Every real `.card` is frontmatter now, so
      // this is a malformed or partially-written file — surface its raw text
      // rather than failing, so the viewer can still show something.
      return {
        path: relPath,
        kind: "frontmatter" as const,
        type: fileType ?? "",
        frontmatter: undefined,
        body: split.hasFrontmatter ? split.body : raw,
        validationError: split.hasFrontmatter ? undefined : "Card has no frontmatter block",
      };
    }),

  inboundRefs: publicProcedure
    .input(z.object({ path: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const { relPath } = await resolveCardPath({ boxRoot: ctx.boxRoot, inputPath: input.path, mode: "read" });
      return findInboundCardRefs({ boxRoot: ctx.boxRoot, cardPath: relPath });
    }),

  setTheme: ownerProcedure
    .input(z.object({
      path: z.string().min(1),
      theme: ThemeChoiceSchema.nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.theme !== null) {
        const checked = validateThemeChoice(input.theme, "theme");
        if (checked.problem !== null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: checked.problem.message });
        }
      }
      const { relPath, fullPath } = await resolveCardPath({
        boxRoot: ctx.boxRoot,
        inputPath: input.path,
        mode: "write",
      });
      if (typeFromFilename(relPath) === undefined) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Theme selection applies only to card files" });
      }
      const saved = await withCardLock(fullPath, async () => {
        let raw: string;
        try {
          raw = await fs.readFile(fullPath, "utf-8");
        } catch (error) {
          if (errorMessage(error).includes("ENOENT")) {
            throw new TRPCError({ code: "NOT_FOUND", message: `Card not found: ${relPath}` });
          }
          throw error;
        }
        const split = splitCardContent(raw);
        if (!split.hasFrontmatter) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Card has no frontmatter block" });
        }
        const document = split.frontmatterText.trim() === ""
          ? new Document({})
          : parseDocument(split.frontmatterText);
        if (document.errors.length > 0 || !isMap(document.contents)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Card frontmatter is not a valid YAML mapping" });
        }
        if (input.theme === null) document.delete("theme");
        else document.set("theme", input.theme);
        const yaml = String(document);
        const content = `---\n${yaml.endsWith("\n") ? yaml : `${yaml}\n`}---\n${split.body}`;
        await writeFileAtomic(fullPath, { content });
        try {
          const commit = await stageAndCommitPaths(ctx.boxRoot, {
            paths: [relPath],
            message: input.theme === null ? `Clear card theme: ${relPath}` : `Set card theme: ${relPath}`,
            trailers: { "Source": "webapp", "Endpoint": "card.setTheme" },
          });
          return { commit, commitWarning: null };
        } catch (_error) {
          return { commit: null, commitWarning: "Saved, but the Git commit failed." };
        }
      });
      ctx.eventBus.emitTransient("file-change", {
        event: "change",
        path: relPath,
        timestamp: new Date().toISOString(),
      });
      return { theme: input.theme, ...saved };
    }),

  trash: publicProcedure
    .input(z.object({ path: z.string().min(1), allowDanglingRefs: z.boolean().default(false) }))
    .mutation(async ({ input, ctx }) => {
      const { relPath } = await resolveCardPath({ boxRoot: ctx.boxRoot, inputPath: input.path, mode: "write" });
      const { referrers } = await findInboundCardRefs({ boxRoot: ctx.boxRoot, cardPath: relPath });
      if (referrers.length > 0 && !input.allowDanglingRefs) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${String(referrers.length)} file${referrers.length === 1 ? "" : "s"} link to this card`,
          cause: referrers,
        });
      }
      const { ctx: commandContext } = createCollectorContext(ctx.boxRoot);
      const receipt = await moveCardsToTrash(commandContext, [relPath]);
      let commit: string | null;
      try {
        commit = await commitTrashReceipt(ctx.boxRoot, {
          receipt,
          reason: "trashed from card view",
        });
      } catch (error) {
        await rollbackTrashReceipt(ctx.boxRoot, receipt);
        throw error;
      }
      const move = receipt.moves.at(0);
      if (move === undefined) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Card was not trashed" });
      ctx.eventBus.emitTransient("file-change", {
        event: "unlink",
        path: relPath,
        timestamp: new Date().toISOString(),
      });
      return { move, commit, referrers };
    }),
});
