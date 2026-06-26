import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { splitCardContent, type CardSchema } from "../../../cards/index.js";
import { parseCardText, typeFromFilename } from "../../../core/card-io.js";
import { createCardSchemaMap } from "../../../schemas/registry.js";
import { boxRelativePath } from "../../../shared/box-path.js";
import { parse as parseYaml } from "yaml";

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
    validationError = (e as Error).message;
    // Still surface what we can — split the file and parse YAML loosely.
    const split = splitCardContent(raw);
    body = split.body;
    try {
      const fm = parseYaml(split.frontmatterText);
      if (fm !== null && typeof fm === "object" && !Array.isArray(fm)) {
        frontmatter = fm as Record<string, unknown>;
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
      const relPath = boxRelativePath(input.path);
      const fullPath = path.join(ctx.boxRoot, relPath);

      // Security: `input.path` arrives from the client (and now from the chat
      // `?card=` deep-link a card-page click writes). Ensure the resolved path
      // stays inside the box before any read — `path.join` collapses `..`, so a
      // crafted `../../etc/...` would otherwise escape boxRoot. Compare against
      // `root + sep` (not a bare prefix) so a sibling dir like `<box>-secrets`
      // can't satisfy the check. Mirrors the `/api/files` boundary guard.
      const resolved = path.resolve(fullPath);
      const root = path.resolve(ctx.boxRoot);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid card path" });
      }

      let raw: string | null = null;
      try {
        raw = await fs.readFile(fullPath, "utf-8");
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("ENOENT") || msg.includes("no such file")) {
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
        frontmatter: undefined as Record<string, unknown> | undefined,
        body: split.hasFrontmatter ? split.body : raw,
        validationError: split.hasFrontmatter ? undefined : "Card has no frontmatter block",
      };
    }),
});
