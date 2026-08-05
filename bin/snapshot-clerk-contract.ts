#!/usr/bin/env node --import tsx
/**
 * Clerk contract snapshot generator (`pnpm snapshot:clerk-contract`).
 *
 * Reads the SINGLE leaf schema module
 * (`callback-box/src/webapp/trpc/routers/clerk-contract.ts`) — and imports
 * nothing else from callback-box — and emits the TypeScript types the extension
 * consumes into `callback-clerk/src/contract/clerk-contract.generated.ts`. This
 * closes the enforcement gap where a callback-box-only change to the wire shape
 * never exercised the clerk side: the pre-commit staleness gate regenerates and
 * fails if the checked-in snapshot is stale.
 *
 * Emission mechanism: each schema → `z.toJSONSchema` (zod v4 built-in) → a tiny
 * JSON-Schema→TS printer that supports EXACTLY the constructs the leaf uses
 * (object, string, array, nullable via anyOf) and THROWS on anything else. A
 * future schema reaching for an unsupported construct fails generation loudly
 * rather than silently emitting a wrong type. Output is deterministic (property
 * order follows the zod schema definition order).
 *
 * NEVER hand-edit the generated file — change the leaf module and regenerate.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import {
  commentaryInput,
  commentaryOutput,
  commentaryDestination,
  tabArrangementPayload,
  tabArrangementOutput,
} from "../callback-box/src/webapp/trpc/routers/clerk-contract.js";

/** A construct outside the printer's whitelist — fail generation loudly. */
export class UnsupportedSchemaError extends Error {
  constructor(detail: string) {
    super(`snapshot-clerk-contract: unsupported schema construct — ${detail}`);
    this.name = "UnsupportedSchemaError";
  }
}

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
export const OUT_PATH = path.join(REPO_ROOT, "callback-clerk", "src", "contract", "clerk-contract.generated.ts");
const GENERATOR_REL = "bin/snapshot-clerk-contract.ts";
const PNPM_SCRIPT = "pnpm snapshot:clerk-contract";
const LEAF_REL = "callback-box/src/webapp/trpc/routers/clerk-contract.ts";

/**
 * The types to emit: a schema, its io side (input types come from the input
 * side; output types from the output side), and the exported type name. Scoped
 * to the clerk router deliberately — no generalization until a second consumer
 * exists.
 */
const CONTRACT: { schema: z.ZodType; io: "input" | "output"; name: string; doc: string }[] = [
  { schema: commentaryInput, io: "input", name: "CommentaryPayload", doc: "Request body for `clerk.commentary`." },
  { schema: commentaryOutput, io: "output", name: "CommentaryResult", doc: "Result of a successful `clerk.commentary` capture." },
  { schema: commentaryDestination, io: "output", name: "CommentaryDestination", doc: "A single landmark commentary destination." },
  { schema: tabArrangementPayload, io: "input", name: "TabArrangementPayload", doc: "Captured tabs and their proposed arrangement." },
  { schema: tabArrangementOutput, io: "output", name: "TabArrangementResult", doc: "Result of accepting a tab arrangement into the box." },
];

const INDENT = "  ";

function isObj(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Render one JSON-Schema node to a TS type, throwing outside the whitelist. */
function printType(node: unknown, depth: number): string {
  if (!isObj(node)) throw new UnsupportedSchemaError(`expected a schema object, got ${JSON.stringify(node)}`);

  // Nullable and any other union arrive as anyOf — render each member.
  const anyOf = node["anyOf"];
  if (Array.isArray(anyOf)) {
    return anyOf.map((member) => printType(member, depth)).join(" | ");
  }

  const type = node["type"];
  if (type === "string") {
    if (Array.isArray(node["enum"])) {
      const values = node["enum"];
      if (!values.every((value) => typeof value === "string")) {
        throw new UnsupportedSchemaError("non-string member in string enum");
      }
      return values.map((value) => JSON.stringify(value)).join(" | ");
    }
    if (typeof node["const"] === "string") {
      return JSON.stringify(node["const"]);
    }
    return "string";
  }
  if (type === "boolean") return "boolean";
  if (type === "number" || type === "integer") return "number";
  if (type === "null") return "null";
  if (type === "array") {
    const inner = printType(node["items"], depth);
    return /^[A-Za-z0-9_.]+$/.test(inner) ? `${inner}[]` : `Array<${inner}>`;
  }
  if (type === "object") return printObject(node, depth);

  throw new UnsupportedSchemaError(`type=${JSON.stringify(type)} keys=${JSON.stringify(Object.keys(node))}`);
}

/** A bare TS identifier can be emitted unquoted; anything else must be quoted. */
function propertyKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

/** Render an object node to a `{ … }` type literal. */
function printObject(node: Record<string, unknown>, depth: number): string {
  const properties = node["properties"];
  if (!isObj(properties)) throw new UnsupportedSchemaError("object schema without a properties map");
  // Reject open objects (`.catchall`/`.passthrough` → an additionalProperties
  // schema). Absent (input side) or `false` (output-side strip) is the only
  // shape the whitelist supports — anything else would need an index signature
  // we don't emit, so fail loudly rather than silently drop it.
  const extra = node["additionalProperties"];
  if (extra !== undefined && extra !== false) {
    throw new UnsupportedSchemaError(`open object (additionalProperties=${JSON.stringify(extra)}) — index signatures are not whitelisted`);
  }
  const requiredRaw = node["required"];
  const required = new Set(
    Array.isArray(requiredRaw) ? requiredRaw.filter((k): k is string => typeof k === "string") : [],
  );
  const pad = INDENT.repeat(depth + 1);
  const closePad = INDENT.repeat(depth);
  const lines: string[] = [];
  for (const key of Object.keys(properties)) {
    const optional = required.has(key) ? "" : "?";
    const valueType = printType(properties[key], depth + 1);
    lines.push(`${pad}${propertyKey(key)}${optional}: ${valueType};`);
  }
  return `{\n${lines.join("\n")}\n${closePad}}`;
}

/** Render one zod schema to its TS type string (throws outside the whitelist). */
export function schemaToTs(schema: z.ZodType, io: "input" | "output"): string {
  return printType(z.toJSONSchema(schema, { io }), 0);
}

/** Emit one exported declaration for a contract entry. */
function emitDeclaration(entry: (typeof CONTRACT)[number]): string {
  const body = schemaToTs(entry.schema, entry.io);
  const decl = body.startsWith("{")
    ? `export interface ${entry.name} ${body}`
    : `export type ${entry.name} = ${body};`;
  return `/** ${entry.doc} */\n${decl}`;
}

export function render(): string {
  const header = [
    "// AUTOGENERATED — DO NOT EDIT.",
    `// Generated by ${GENERATOR_REL} (${PNPM_SCRIPT}).`,
    `// Source of truth: ${LEAF_REL}.`,
    "// Change the leaf schema and regenerate; never hand-edit this file.",
    "",
  ].join("\n");
  const decls = CONTRACT.map(emitDeclaration).join("\n\n");
  return `${header}\n${decls}\n`;
}

function main(): void {
  const output = render();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, output, "utf8");
  console.log(`snapshot-clerk-contract: wrote ${path.relative(REPO_ROOT, OUT_PATH)}`);
}

// Run only as a script, not when imported by a test.
if (process.argv[1] !== undefined && process.argv[1].endsWith("snapshot-clerk-contract.ts")) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
