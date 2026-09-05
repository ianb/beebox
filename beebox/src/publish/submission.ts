/**
 * Runtime-agnostic submission vocabulary (Track F of
 * `docs/plans/publish-pages.md`) — the shape of a stored "drop box" submission
 * and the pure field validator the Worker runs on an incoming form POST.
 *
 * Like `manifest-edge.ts`, this module has **zero node-only imports** (zod only):
 * it is *written* by the Cloudflare Worker (workerd) at `POST /__submit/<id>` and
 * later *read* by the box connector (Node) that pulls submissions during
 * `bbx wakeup`. Both runtimes import it directly, so nothing here may reach for a
 * `node:*` builtin.
 *
 * A submission is the one per-viewer datum v1 keeps: the validated form fields,
 * plus a coarse attribution (the Access-verified `viewer` email on account tiers,
 * `null` on `secret`; a country-only `country`, never an IP). The Worker validates
 * every field against the manifest's `submit` block before writing; the box
 * `safeParse`s again on pull (the edge is *also* untrusted from the box's side —
 * principle #3).
 */

import { z } from "zod";
import type { SubmitBlock } from "./manifest-edge.js";

/** A stored submission object: `submissions/<pubId>/<id>.json`. */
export const submissionSchema = z
  .object({
    /** Opaque unique id (also the object filename stem) — from the Worker's id source. */
    id: z.string().min(1),
    /** ISO-8601 receive time, from the Worker clock. */
    ts: z.string().datetime({ offset: true }),
    /** The publication the submission targets (redundant with the key prefix). */
    pubId: z.string().min(1),
    /** The validated form fields (only names declared in the manifest's submit block). */
    fields: z.record(z.string(), z.string()),
    /** Access-verified submitter email on account tiers; `null` on `secret` (anonymous). */
    viewer: z.string().nullable(),
    /** Coarse origin — country code only (never an IP); `null` when unknown. */
    country: z.string().nullable(),
  })
  .strict();

export type Submission = z.infer<typeof submissionSchema>;

/** The outcome of validating a raw form body against a submit block. */
export type SubmissionFieldResult =
  | { ok: true; fields: Record<string, string> }
  | { ok: false; errors: string[] };

/** A minimal, deliberately-strict email shape check (mirrors zod's `.email()` intent). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a raw urlencoded form body against a manifest `submit` block. PURE —
 * no I/O, no runtime globals. Every rule is fail-closed and collects a
 * human-readable error (the response names the offending field):
 *  - a required field must be present and non-empty (after trimming);
 *  - every value must be within its `maxLength`;
 *  - a `choice` field's value must be one of its `choices`;
 *  - an `email` field's value must look like an email;
 *  - a field not declared in the block is rejected (no silent drop).
 *
 * On success `fields` carries only declared fields that were present, trimmed.
 */
export function validateSubmissionFields(block: SubmitBlock, raw: Record<string, string>): SubmissionFieldResult {
  const errors: string[] = [];
  const declared = new Set(block.fields.map((field) => field.name));

  // Unknown fields are rejected, not ignored — an unexpected key means the form
  // and the manifest disagree, which is a client error worth surfacing.
  for (const name of Object.keys(raw)) {
    if (!declared.has(name)) errors.push(`unknown field: ${name}`);
  }

  const fields: Record<string, string> = {};
  for (const field of block.fields) {
    const rawValue = raw[field.name];
    const value = rawValue === undefined ? "" : rawValue.trim();
    if (value.length === 0) {
      if (field.required) errors.push(`missing required field: ${field.name}`);
      continue; // an absent optional field simply isn't stored
    }
    if (value.length > field.maxLength) {
      errors.push(`field '${field.name}' exceeds maxLength ${field.maxLength}`);
      continue;
    }
    if (field.kind === "choice") {
      const choices = field.choices ?? [];
      if (!choices.includes(value)) {
        errors.push(`field '${field.name}' must be one of: ${choices.join(", ")}`);
        continue;
      }
    }
    if (field.kind === "email" && !EMAIL_RE.test(value)) {
      errors.push(`field '${field.name}' must be a valid email address`);
      continue;
    }
    fields[field.name] = value;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, fields };
}
