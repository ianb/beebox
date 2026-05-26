import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { createLoader } from "../../../cli/lib/loader.js";
import { parseCard, type ElementNode } from "cardworks";

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

/**
 * Navigate to a child element by a simple path like "section/ingredients/ing[2]".
 */
function navigateToChild(el: ElementNode, pathStr: string): ElementNode | null {
  const segments = pathStr.split("/").filter(Boolean);
  let current: ElementNode = el;
  for (const seg of segments) {
    const match = seg.match(/^(\w[\w-]*?)(?:\[(\d+)])?$/);
    if (!match) return null;
    const tagName = match[1]!;
    const idx = match[2] !== undefined ? parseInt(match[2], 10) : 0;
    const matches = current.children.filter((c) => c.tagName === tagName);
    if (idx >= matches.length) return null;
    current = matches[idx]!;
  }
  return current;
}

/**
 * Parse a simple XML fragment into an ElementNode.
 */
function parseXmlFragment(xml: string): ElementNode | null {
  const match = xml.match(/^<(\w[\w-]*)((?:\s+[\w-]+="[^"]*")*)(?:\s*\/>|>([\S\s]*?)<\/\1>)$/);
  if (!match) return null;
  const tagName = match[1]!;
  const attrStr = match[2] ?? "";
  const text = match[3]?.trim();

  const attrs: Record<string, string> = {};
  const attrRegex = /([\w-]+)="([^"]*)"/g;
  let attrMatch;
  while ((attrMatch = attrRegex.exec(attrStr))) {
    attrs[attrMatch[1]!] = attrMatch[2]!;
  }

  return {
    tagName,
    attrs,
    children: [],
    text: text || undefined,
    comments: {},
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    dirty: true,
  } as ElementNode;
}

const patchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set-attr"), path: z.string().optional(), attr: z.string(), value: z.string() }),
  z.object({ op: z.literal("remove-attr"), path: z.string().optional(), attr: z.string() }),
  z.object({ op: z.literal("set-text"), path: z.string(), value: z.string() }),
  z.object({ op: z.literal("append-child"), path: z.string().optional(), xml: z.string() }),
  z.object({ op: z.literal("remove-child"), path: z.string(), index: z.number() }),
]);

export const cardRouter = router({
  get: publicProcedure
    .input(z.object({ path: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const fullPath = path.join(ctx.boxRoot, input.path);
      const loader = await createLoader(ctx.boxRoot);

      try {
        const card = await loader.load(fullPath);
        const xml = loader.serialize(card.element);
        const element = sanitizeElement(card.element);

        return {
          path: input.path,
          tagName: card.element.tagName,
          status: card.element.attrs["status"] as string | undefined,
          version: card.version,
          xml,
          element,
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
        } catch {
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
        } catch {
          // XML itself is malformed — fall back to raw text only
        }

        return {
          path: input.path,
          tagName,
          status: undefined as string | undefined,
          version: undefined as string | undefined,
          xml: rawXml,
          element,
          validationError: msg,
        };
      }
    }),

  patch: publicProcedure
    .input(z.object({
      path: z.string().min(1),
      ops: z.array(patchOpSchema).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const fullPath = path.join(ctx.boxRoot, input.path);
      const loader = await createLoader(ctx.boxRoot);

      try {
        const card = await loader.load(fullPath);

        for (const op of input.ops) {
          const target = op.path ? navigateToChild(card.element, op.path) : card.element;
          if (!target) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Path not found: ${op.path}` });
          }

          switch (op.op) {
            case "set-attr":
              target.attrs[op.attr] = op.value;
              break;
            case "remove-attr":
              delete target.attrs[op.attr];
              break;
            case "set-text":
              target.text = op.value;
              break;
            case "append-child": {
              const fragment = parseXmlFragment(op.xml);
              if (fragment) target.children.push(fragment);
              break;
            }
            case "remove-child": {
              const idx = op.index;
              if (idx >= 0 && idx < target.children.length) {
                target.children.splice(idx, 1);
              }
              break;
            }
          }
        }

        await loader.save(card);

        const updated = await loader.load(fullPath);
        const xml = loader.serialize(updated.element);
        const element = sanitizeElement(updated.element);

        return {
          path: input.path,
          tagName: updated.element.tagName,
          status: updated.element.attrs["status"] as string | undefined,
          version: updated.version,
          xml,
          element,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Patch failed: ${(error as Error).message}`,
        });
      }
    }),
});
