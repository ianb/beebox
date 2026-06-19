import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { createLoader } from "../../../cli/lib/loader.js";
import { parseCard, type ElementNode } from "cardworks";
import { splitCardContent, type CardSchema } from "../../../cards/index.js";
import { parseCardText } from "../../../core/card-io.js";
import { createCardSchemaMap } from "../../../schemas/registry.js";
import { parse as parseYaml } from "yaml";

/**
 * JSON-safe element node for the frontend.
 */
export interface JsonElement {
  tagName: string;
  attrs: Record<string, string>;
  text?: string;
  children?: JsonElement[];
}

function sanitizeElement(el: ElementNode): JsonElement {
  const result: JsonElement = { tagName: el.tagName, attrs: {} };
  for (const [key, value] of Object.entries(el.attrs)) {
    if (typeof value === "string") result.attrs[key] = value;
  }
  if (el.text !== undefined && el.text !== null) {
    result.text = String(el.text).trim();
  }
  if (el.children && Array.isArray(el.children) && el.children.length > 0) {
    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
  }
  return result;
}

function typeFromFilename(source: string): string | undefined {
  const base = source.split("/").pop();
  if (base === undefined) return undefined;
  const match = base.match(/^.+\.([^.]+)\.card$/);
  return match ? match[1] : undefined;
}

export interface FrontmatterCardResponse {
  path: string;
  kind: "frontmatter";
  tagName: string;
  status: string | undefined;
  version: string | undefined;
  xml: string;
  element: JsonElement | undefined;
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
  let status: string | undefined;

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
    const statusField = fields["status"];
    if (typeof statusField === "string") status = statusField;
  } catch (e) {
    validationError = (e as Error).message;
    // Still surface what we can — split the file and parse YAML loosely.
    const split = splitCardContent(raw);
    body = split.body;
    try {
      const fm = parseYaml(split.frontmatterText);
      if (fm !== null && typeof fm === "object" && !Array.isArray(fm)) {
        frontmatter = fm as Record<string, unknown>;
        const statusField = (fm as Record<string, unknown>)["status"];
        if (typeof statusField === "string") status = statusField;
      }
    } catch (_e) {
      // YAML itself is malformed — leave frontmatter undefined.
    }
  }

  return {
    path: source,
    kind: "frontmatter",
    tagName: type,
    status,
    version: undefined,
    xml: raw,
    element: undefined,
    frontmatter,
    body,
    validationError,
  };
}

export const cardRouter = router({
  get: publicProcedure
    .input(z.object({ path: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const fullPath = path.join(ctx.boxRoot, input.path);

      // Security: `input.path` arrives from the client (and now from the chat
      // `?card=` deep-link a card-page click writes). Ensure the resolved path
      // stays inside the box before any read — `path.join` collapses `..`, so a
      // crafted `../../etc/...` would otherwise escape boxRoot. Mirrors the
      // `/api/files` boundary guard (routes/api-files.ts); card.get had none.
      const resolved = path.resolve(fullPath);
      if (!resolved.startsWith(path.resolve(ctx.boxRoot))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid card path" });
      }

      // Dispatch on file shape: frontmatter cards parse via parseCardText;
      // legacy XML cards fall through to the cardworks loader.
      let raw: string | null = null;
      try {
        raw = await fs.readFile(fullPath, "utf-8");
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("ENOENT") || msg.includes("no such file")) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Card not found: ${input.path}` });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: msg });
      }

      const split = splitCardContent(raw);
      const fileType = typeFromFilename(input.path);
      const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
      if (split.hasFrontmatter && fileType !== undefined && cardSchemas.has(fileType)) {
        return loadFrontmatterCard({ raw, source: input.path, type: fileType, cardSchemas });
      }

      const loader = await createLoader(ctx.boxRoot);

      try {
        const card = await loader.load(fullPath);
        const xml = loader.serialize(card.element);
        const element = sanitizeElement(card.element);

        return {
          path: input.path,
          kind: "xml" as const,
          tagName: card.element.tagName,
          status: card.element.attrs["status"] as string | undefined,
          version: card.version,
          xml,
          element,
          frontmatter: undefined as Record<string, unknown> | undefined,
          body: undefined as string | undefined,
          validationError: undefined as string | undefined,
        };
      } catch (error) {
        const msg = (error as Error).message;
        const isNotFound = msg.includes("ENOENT") || msg.includes("no such file");
        if (isNotFound) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Card not found: ${input.path}`,
          });
        }

        // Validation failed — parse XML without validation so we can still show the tree
        let rawXml: string;
        try {
          rawXml = await fs.readFile(fullPath, "utf-8");
        } catch (e) {
          console.warn(`Could not re-read ${input.path} after validation failure:`, e);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Card validation failed: ${msg}`,
          });
        }

        // Try to parse the raw XML into a tree (no schema validation)
        let element: JsonElement | undefined;
        let tagName: string | undefined;
        try {
          const parsed = await parseCard(rawXml, { source: input.path });
          element = sanitizeElement(parsed);
          tagName = parsed.tagName;
        } catch (e) {
          // XML itself is malformed — fall back to raw text only.
          console.warn(`Could not parse raw XML for ${input.path}, showing raw text only:`, e);
        }

        return {
          path: input.path,
          kind: "xml" as const,
          tagName,
          status: undefined as string | undefined,
          version: undefined as string | undefined,
          xml: rawXml,
          element,
          frontmatter: undefined as Record<string, unknown> | undefined,
          body: undefined as string | undefined,
          validationError: msg,
        };
      }
    }),
});
