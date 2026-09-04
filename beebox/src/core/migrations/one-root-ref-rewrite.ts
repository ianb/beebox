/**
 * The dedicated ref rewriter for the `one-root` migration (Track E, step 5,
 * `docs/plans/one-root-box-layout.md`). Rewrites every ref a card or `.md`
 * dossier carries from its v2 form (relative to `content/`, no underscore
 * fence) to the v3 canonical leading-`/` form (relative to the one root,
 * landing in an underscore area).
 *
 * `core/rewrite-card-refs.ts` (`bbx mv`) is explicitly NOT reused — the plan
 * calls for a dedicated rewriter because `bbx mv`'s frontmatter half
 * (`rewrite-frontmatter-refs.ts`) is deliberately line-based and skips YAML
 * inline-map ref forms (`- { ref: x }`) to avoid reordering frontmatter keys
 * on an ordinary move. A migration commit rewrites every card's frontmatter
 * anyway (paths are changing everywhere), so this module parses and
 * re-serializes frontmatter with the real YAML library — reordering keys to
 * schema-agnostic insertion order is an acceptable, one-time cost here that
 * it is NOT for `bbx mv`.
 *
 * Three ref-bearing forms, matching `rewrite-card-refs.ts`'s coverage:
 *  - frontmatter `ref`/`refs` keys, at any nesting, INCLUDING inline-map list
 *    items (`refs: [{ ref: x }]` or block `- ref: x` — both walked, not
 *    text-matched);
 *  - body `ref="…"` attributes (Markdoc tags);
 *  - inline markdown links/images (`[text](path)`, `![alt](path)`).
 * `attach/…` refs are left untouched (the one deliberate exception — they
 * stay relative to the card's own attach scope, which moves with the card).
 *
 * A ref this module can't confidently resolve/map is left AS WRITTEN, not
 * guessed at — after the move its old target no longer exists, so it becomes
 * a dangling ref. That's intentional: Track E step 6 (the hard link gate,
 * `one-root-link-gate.ts`) is the backstop that turns a missed ref form into
 * a hard abort instead of a silent broken link.
 */

import { parse as parseYaml } from "yaml";
import { splitCardContent, renderFrontmatterBlock } from "../../cards/frontmatter.js";
import { isAttachRef } from "../../shared/attach-path.js";
import { formatRefSuffix, isExternalRef, parseRef } from "../../shared/ref-path.js";
import { isRecord } from "../../lib/is-record.js";
import { mapV2Path } from "./one-root-mapping.js";

export interface OneRootRewriteInput {
  text: string;
  /** This document's OLD path, relative to the v2 content root (`content/`),
   * forward-slashed, no leading slash. */
  oldContentRelPath: string;
  /** Whether `attach/…` is a meaningful virtual prefix for this document
   * (true for `.card` files, false for plain `.md` dossiers). */
  isCard: boolean;
}

export interface OneRootRewriteResult {
  text: string;
  /** Refs successfully rewritten to canonical v3 form. */
  rewritten: number;
  /** Ref tokens found but left unchanged because they couldn't be resolved
   * (escape the box, or resolve to something `mapV2Path` doesn't recognize).
   * Surfaced so the caller can log them before the hard link gate catches
   * the resulting dangling refs. */
  unresolved: string[];
}

/** Resolve a v2 content-relative ref against the document that holds it,
 * mirroring `resolveRefPath`'s 3-form + fail-closed `..`-escape rule — but
 * over the OLD (v2, no underscore fence) namespace, since that's what a v2
 * card's refs actually addressed. `fromPath` is the referring document's
 * v2-content-relative path. Returns `null` for an escaping/empty ref. */
function resolveV2Ref(fromPath: string, ref: string): string | null {
  if (ref === "") return null;
  if (ref.startsWith("/")) return joinSegments("", ref.slice(1));
  const dir = dirOf(fromPath);
  return joinSegments(dir, ref);
}

function dirOf(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i === -1 ? "" : filePath.slice(0, i);
}

function joinSegments(baseDir: string, rel: string): string | null {
  const out: string[] = [];
  for (const part of [...baseDir.split("/"), ...rel.split("/")]) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

function makeTransform(params: { oldContentRelPath: string; isCard: boolean; unresolved: string[] }) {
  let rewritten = 0;
  const transform = (raw: string): string => {
    const parsed = parseRef(raw);
    if (parsed.path === "" || isExternalRef(parsed.path)) return raw;
    if (params.isCard && isAttachRef(parsed.path)) return raw; // travels with the card, untouched
    const oldTarget = resolveV2Ref(params.oldContentRelPath, parsed.path);
    if (oldTarget === null) {
      params.unresolved.push(raw);
      return raw;
    }
    const mapped = mapV2Path(oldTarget);
    if (mapped.kind !== "move") {
      params.unresolved.push(raw);
      return raw;
    }
    rewritten++;
    return "/" + mapped.newPath + formatRefSuffix(parsed);
  };
  return { transform, getRewritten: () => rewritten };
}

/** Deep-walk a parsed YAML frontmatter object, rewriting every `ref`/`refs`
 * key at any nesting — including inline-map list items — in place. */
function walkFrontmatter(value: unknown, transform: (raw: string) => string): void {
  if (Array.isArray(value)) {
    for (const item of value) walkFrontmatter(item, transform);
    return;
  }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (key === "ref" && typeof v === "string") {
      value[key] = transform(v);
      continue;
    }
    if (key === "refs" && Array.isArray(v)) {
      value[key] = v.map((item) => {
        if (typeof item === "string") return transform(item);
        walkFrontmatter(item, transform);
        return item;
      });
      continue;
    }
    walkFrontmatter(v, transform);
  }
}

/** `[text](path)` / `![alt](path)` — same grammar as `body-refs.ts`'s `inlineLinkPattern`. */
function inlineLinkPattern(): RegExp {
  return /(!?\[[^\]]*]\(\s*)([^\s()]+)/g;
}

function rewriteBody(body: string, transform: (raw: string) => string): string {
  const withLinks = body.replace(inlineLinkPattern(), (...args: string[]) => {
    const [, prefix, ref] = args;
    return (prefix ?? "") + transform(ref ?? "");
  });
  return withLinks.replace(/(\bref=)(["'])([^"']*)\2/g, (...args: string[]) => {
    const [, attr, quote, value] = args;
    return (attr ?? "") + (quote ?? "") + transform(value ?? "") + (quote ?? "");
  });
}

/**
 * Rewrite every ref in one card/doc's text from v2 to canonical v3 form.
 * `text` with no frontmatter block (a plain `.md` dossier) still has its body
 * scanned.
 */
export function rewriteOneRootRefs(input: OneRootRewriteInput): OneRootRewriteResult {
  const unresolved: string[] = [];
  const { transform, getRewritten } = makeTransform({
    oldContentRelPath: input.oldContentRelPath,
    isCard: input.isCard,
    unresolved,
  });

  const split = splitCardContent(input.text);
  const newBody = rewriteBody(split.body, transform);

  if (!split.hasFrontmatter) {
    return { text: newBody, rewritten: getRewritten(), unresolved };
  }

  let fields: unknown;
  try {
    fields = parseYaml(split.frontmatterText);
  } catch (_e) {
    // Malformed frontmatter YAML: leave the frontmatter untouched (still
    // rewrite the body) rather than crash the whole migration on one bad
    // card — `bbx validate` already treats this as a lint error separately.
    return { text: `---\n${split.frontmatterText}---\n${newBody}`, rewritten: getRewritten(), unresolved };
  }
  if (!isRecord(fields)) {
    return { text: `---\n${split.frontmatterText}---\n${newBody}`, rewritten: getRewritten(), unresolved };
  }
  walkFrontmatter(fields, transform);
  return { text: renderFrontmatterBlock(fields, newBody), rewritten: getRewritten(), unresolved };
}
