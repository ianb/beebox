/**
 * Parse a guide card's frontmatter into a typed `ParsedGuide` structure.
 *
 * The on-disk shape (kebab-case keys, optional arrays) maps to the
 * camelCase, defaults-filled `ParsedGuide` the compiler and revision agent
 * consume. `parseGuideCard` is the convenience reader for callers that have
 * the raw card text.
 */

import { splitCardContent } from "cardworks";
import { parse as parseYaml } from "yaml";
import {
  GuideObject,
  type GuideFields,
  type ParsedGuide,
} from "./guide-elements.js";

/**
 * Map a validated guide fields object into a `ParsedGuide`.
 */
export function parseGuide(fields: GuideFields): ParsedGuide {
  const defaultActionField = fields["default-action"];
  return {
    version: fields.version,
    jobTypes: fields["job-types"] ?? [],
    appliesTo: fields["applies-to"],
    triageRules: (fields["triage-rules"] ?? []).map((r) => ({
      text: r.text,
      confidence: r.confidence,
      source: r.source,
      ref: r.ref,
      action: r.action,
    })),
    defaultAction:
      defaultActionField === undefined
        ? undefined
        : { action: defaultActionField.action, text: defaultActionField.text },
    actions: (fields.actions ?? []).map((a) => ({
      name: a.name,
      when: a.when,
      instructions: a.instructions,
    })),
    experiments: (fields.experiments ?? []).map((e) => ({
      id: e.id,
      status: e.status,
      createdAt: e["created-at"],
      updatedAt: e["updated-at"],
      hypothesis: e.hypothesis,
      approach: e.approach,
      observations: (e.observations ?? []).map((o) => ({
        text: o.text,
        ref: o.ref,
        date: o.date,
      })),
      conclusion: e.conclusion,
    })),
    reactions: (fields.reactions ?? []).map((r) => ({
      id: r.id,
      sentiment: r.sentiment,
      text: r.text,
    })),
    contextNotes: (fields["context-notes"] ?? []).map((c) => ({
      text: c.text,
      duration: c.duration,
      addedAt: c["added-at"],
    })),
  };
}

/**
 * Parse a guide card's raw text into typed fields, or null if it has no
 * frontmatter or fails validation.
 */
export function parseGuideCard(content: string): GuideFields | null {
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return null;
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (_e) {
    return null;
  }
  const parsed = GuideObject.safeParse(fm ?? {});
  if (!parsed.success) return null;
  return parsed.data;
}
