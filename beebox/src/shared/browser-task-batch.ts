/**
 * Validation of a browser-task submission batch: a manifest (coverage plus
 * records) and the files uploaded beside it, checked against the task's own
 * JSON Schema for one record.
 *
 * Pure and isomorphic: the same function runs in the browser (the submission
 * form, before any upload) and on the server (the accept helper, the actual
 * boundary). Both callers hand in the schema text they fetched or read; this
 * module never touches the filesystem or the network.
 *
 * The record schema is JSON Schema, converted with zod's `fromJSONSchema`.
 * Zod ignores unknown `format` values, so the `"format": "attachment"`
 * convention — a string field naming an uploaded file — is enforced by a
 * separate walk over the raw schema (`collectAttachmentRefs`). That walk
 * supports a deliberately flat subset (`properties`, `items`, `anyOf`,
 * `oneOf`, `allOf`, nested objects); reference keywords are refused so the
 * two interpretations of the schema can never disagree.
 */

import { z } from "zod";
import { isRecord } from "../lib/is-record.js";

/** File names the batch layout reserves; an uploaded part may not use them. */
export const RESERVED_BATCH_FILES: ReadonlyArray<string> = ["records.json", "filed.json"];

/** Why an executor stopped scanning. Always reported, even on success. */
export const COVERAGE_REASONS = [
  "reached-watermark",
  "reached-limit",
  "end-of-feed",
  "login-wall",
  "rate-limited",
  "error",
] as const;
export type CoverageReason = (typeof COVERAGE_REASONS)[number];

const CoverageSchema = z.object({
  scanned: z.number().int().nonnegative(),
  stoppedAt: z.string(),
  reason: z.enum(COVERAGE_REASONS),
});
export type BatchCoverage = z.infer<typeof CoverageSchema>;

const ManifestSchema = z.object({
  coverage: CoverageSchema,
  records: z.array(z.unknown()),
});
export type BatchManifest = z.infer<typeof ManifestSchema>;

/** Keywords the attachment walk does not follow; a schema using one is refused. */
const UNSUPPORTED_SCHEMA_KEYWORDS: ReadonlyArray<string> = [
  "$ref",
  "$defs",
  "definitions",
  "patternProperties",
  "if",
  "then",
  "else",
  "dependentSchemas",
];

/** One problem with a batch, addressed by a JSON-pointer-like path. */
export type BatchIssue =
  | { kind: "schema"; path: "schema"; message: string }
  | { kind: "coverage"; path: string; message: string }
  | { kind: "record"; path: string; index: number; message: string }
  | { kind: "missing-file"; path: string; index: number; name: string; message: string }
  | { kind: "unreferenced-file"; path: string; name: string; message: string }
  | { kind: "bad-filename"; path: string; name: string; message: string };

export type BatchValidation =
  | { ok: true; count: number; coverage: BatchCoverage; records: unknown[] }
  | { ok: false; issues: BatchIssue[] };

export interface ValidateBatchInput {
  /** The parsed contents of the task's `attach/schema.json`. */
  schemaJson: unknown;
  /** The parsed manifest part (`records`): `{ coverage, records }`. */
  manifest: unknown;
  /** Names of the file parts uploaded beside the manifest. */
  fileNames: readonly string[];
}

const FILE_NAME_RE = /^[\dA-Za-z][\w.-]{0,199}$/;

/** True when a name may be stored as an uploaded batch file. */
export function isValidBatchFileName(name: string): boolean {
  return FILE_NAME_RE.test(name) && !RESERVED_BATCH_FILES.includes(name);
}

/**
 * Find every keyword the attachment walk cannot follow. Returns the first
 * offending path so the message names one concrete thing to fix.
 */
function findUnsupportedKeyword(node: unknown, path: string): string | null {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      const found = findUnsupportedKeyword(entry, `${path}[${String(i)}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isRecord(node)) return null;
  for (const key of Object.keys(node)) {
    if (UNSUPPORTED_SCHEMA_KEYWORDS.includes(key)) {
      return path === "" ? key : `${path}.${key}`;
    }
    if (key === "additionalProperties" && isRecord(node[key])) {
      return path === "" ? key : `${path}.${key}`;
    }
    const found = findUnsupportedKeyword(node[key], path === "" ? key : `${path}.${key}`);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Walk a value alongside its schema and collect every string that sits under
 * a `"format": "attachment"` declaration. Composition keywords are tried
 * against the same value; a string reached twice is reported once.
 */
interface AttachmentWalk {
  schema: unknown;
  value: unknown;
  path: string;
}

function collectAttachmentRefs(out: Map<string, string>, { schema, value, path }: AttachmentWalk): void {
  if (!isRecord(schema)) return;
  if (schema["format"] === "attachment" && typeof value === "string") {
    out.set(path, value);
    return;
  }
  const properties = schema["properties"];
  if (isRecord(properties) && isRecord(value)) {
    for (const [key, sub] of Object.entries(properties)) {
      if (key in value) collectAttachmentRefs(out, { schema: sub, value: value[key], path: `${path}.${key}` });
    }
  }
  const items = schema["items"];
  if (items !== undefined && Array.isArray(value)) {
    for (const [i, entry] of value.entries()) {
      collectAttachmentRefs(out, { schema: items, value: entry, path: `${path}[${String(i)}]` });
    }
  }
  for (const keyword of ["anyOf", "oneOf", "allOf"]) {
    const branches = schema[keyword];
    if (Array.isArray(branches)) {
      for (const branch of branches) collectAttachmentRefs(out, { schema: branch, value, path });
    }
  }
}

function formatZodIssue(issue: z.core.$ZodIssue): { path: string; message: string } {
  const path = issue.path.map((p) => (typeof p === "number" ? `[${String(p)}]` : `.${String(p)}`)).join("");
  return { path, message: issue.message };
}

/**
 * Validate a whole batch. Fails as a unit: any issue refuses the batch, and
 * every issue found is reported so the executor fixes them in one pass.
 */
export function validateBatch(input: ValidateBatchInput): BatchValidation {
  const issues: BatchIssue[] = [];

  const unsupported = findUnsupportedKeyword(input.schemaJson, "");
  if (unsupported !== null) {
    return {
      ok: false,
      issues: [{ kind: "schema", path: "schema", message: `schema.json uses "${unsupported}", which the attachment walk does not support; write a flat schema` }],
    };
  }
  if (!isRecord(input.schemaJson)) {
    return { ok: false, issues: [{ kind: "schema", path: "schema", message: "schema.json must be a JSON object describing one record" }] };
  }
  let recordSchema: z.ZodType;
  try {
    recordSchema = z.fromJSONSchema(input.schemaJson);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, issues: [{ kind: "schema", path: "schema", message: `schema.json could not be converted: ${message}` }] };
  }

  const manifest = ManifestSchema.safeParse(input.manifest);
  if (!manifest.success) {
    for (const zi of manifest.error.issues) {
      const { path, message } = formatZodIssue(zi);
      issues.push({ kind: "coverage", path: path === "" ? "manifest" : `manifest${path}`, message });
    }
    return { ok: false, issues };
  }

  for (const name of input.fileNames) {
    if (!isValidBatchFileName(name)) {
      issues.push({
        kind: "bad-filename",
        path: `files/${name}`,
        name,
        message: RESERVED_BATCH_FILES.includes(name)
          ? `"${name}" is reserved by the batch layout`
          : `"${name}" must be a bare name of letters, digits, dot, dash, underscore (no leading dot), at most 200 chars`,
      });
    }
  }

  const referenced = new Set<string>();
  for (const [index, record] of manifest.data.records.entries()) {
    const parsed = recordSchema.safeParse(record);
    if (!parsed.success) {
      for (const zi of parsed.error.issues) {
        const { path, message } = formatZodIssue(zi);
        issues.push({ kind: "record", path: `records[${String(index)}]${path}`, index, message });
      }
    }
    const refs = new Map<string, string>();
    collectAttachmentRefs(refs, { schema: input.schemaJson, value: record, path: `records[${String(index)}]` });
    for (const [path, name] of refs) {
      referenced.add(name);
      if (!input.fileNames.includes(name)) {
        issues.push({ kind: "missing-file", path, index, name, message: `references "${name}", which was not uploaded` });
      }
    }
  }

  for (const name of input.fileNames) {
    if (isValidBatchFileName(name) && !referenced.has(name)) {
      issues.push({ kind: "unreferenced-file", path: `files/${name}`, name, message: `"${name}" is not referenced by any record` });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, count: manifest.data.records.length, coverage: manifest.data.coverage, records: manifest.data.records };
}
