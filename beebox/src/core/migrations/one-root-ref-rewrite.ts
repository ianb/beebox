/**
 * The dedicated ref rewriter for the `one-root` migration (Track E, step 5,
 * `docs/implemented-plans/one-root-box-layout.md`). Rewrites every ref a card or `.md`
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
 *  - inline markdown links/images (`[text](path)`, `![alt](path)`);
 *  - reference-style link DEFINITIONS (`[id]: path`) — the `[text][id]`
 *    USAGE carries no path to rewrite, only the definition line does.
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
import { attachDirFor, isAttachRef, splitAttachRef } from "../../shared/attach-path.js";
import { formatRefSuffix, isExternalRef, parseRef } from "../../shared/ref-path.js";
import { isRecord } from "../../lib/is-record.js";
import { inlineLinkPattern, matchReferenceDefinitionAt } from "../body-refs.js";
import { PATH_FIELDS } from "../lint-path-fields.js";
import { mapV2Path } from "./one-root-mapping.js";
import { classifyRefTarget } from "./one-root-ref-rescue.js";

export interface OneRootRewriteInput {
  text: string;
  /** This document's OLD path, relative to the v2 content root (`content/`),
   * forward-slashed, no leading slash. */
  oldContentRelPath: string;
  /** Whether `attach/…` is a meaningful virtual prefix for this document
   * (true for `.card` files, false for plain `.md` dossiers). */
  isCard: boolean;
  /**
   * Round-9 hardening (aged-box rehearsal, 2026-09): whether a v2
   * content-relative path existed pre-migration — disambiguates a BARE
   * ref's two readings (see `one-root-ref-rescue.ts`) and flags a ref
   * already dangling before this migration touched anything (see
   * {@link OneRootRewriteResult.preBrokenRefs}). Defaults to `() => true`
   * ("every target existed"), reducing to the old unconditional
   * document-relative behavior for a caller with no pre-migration snapshot.
   */
  oldPathExists?: (v2ContentRelPath: string) => boolean;
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
  /**
   * New (rewritten, v3-form) ref values ALREADY dangling in the v2 tree
   * before this migration touched anything (an aged box's stale job-card
   * refs to long-consumed content). The hard link gate carries these
   * through instead of blocking on them, while still blocking on a ref the
   * migration itself broke.
   */
  preBrokenRefs: string[];
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

function makeTransform(params: {
  oldContentRelPath: string;
  isCard: boolean;
  unresolved: string[];
  preBrokenRefs: string[];
  oldPathExists: (v2ContentRelPath: string) => boolean;
}) {
  let rewritten = 0;
  const transform = (raw: string): string => {
    const parsed = parseRef(raw);
    if (parsed.path === "" || isExternalRef(parsed.path)) return raw;
    if (params.isCard && isAttachRef(parsed.path)) {
      // Travels with the card, text untouched — but still CLASSIFY it: an
      // attach ref whose target never existed pre-migration (aged demo
      // fixtures are full of these) must join the pre-broken carve-out or
      // the hard link gate blocks the whole migration on history.
      const rest = splitAttachRef(parsed.path);
      if (rest !== null) {
        const dir = dirOf(params.oldContentRelPath);
        const fileName = params.oldContentRelPath.slice(dir === "" ? 0 : dir.length + 1);
        const scopeDir = joinSegments(dir, attachDirFor(fileName));
        const oldAttachTarget = scopeDir === null ? null : joinSegments(scopeDir, rest);
        if (oldAttachTarget === null || !params.oldPathExists(oldAttachTarget)) {
          params.preBrokenRefs.push(raw);
        }
      }
      return raw;
    }

    const isBare = !parsed.path.startsWith("/");
    const docTarget = resolveV2Ref(params.oldContentRelPath, parsed.path);
    // Only compute the box-root-intent reading for a bare ref — a ref
    // already written box-root-relative (leading `/`) has no second
    // reading to disambiguate (`classifyRefTarget` ignores it there).
    const rootTarget = isBare ? resolveV2Ref("", parsed.path) : null;
    const { target, preBroken } = classifyRefTarget({
      isBare,
      refPath: parsed.path,
      docTarget,
      rootTarget,
      oldPathExists: params.oldPathExists,
    });

    if (target === null) {
      params.unresolved.push(raw);
      return raw;
    }
    const mapped = mapV2Path(target);
    if (mapped.kind !== "move") {
      params.unresolved.push(raw);
      return raw;
    }
    rewritten++;
    const newRef = "/" + mapped.newPath + formatRefSuffix(parsed);
    if (preBroken) params.preBrokenRefs.push(newRef);
    return newRef;
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

/**
 * Reference-style link DEFINITIONS (`[id]: /path`) — the usage token
 * (`[text][id]`) carries no path at all, so only the definition needs
 * rewriting. Same grammar `markdown-lint-rules.ts`'s BBX002 uses to CHECK
 * these, via the shared `matchReferenceDefinitionAt` (`body-refs.ts`), so the
 * migration's rewriter and the hard link gate agree on what a ref-def is —
 * including the continuation-line form, where the destination to splice
 * lives on the line AFTER the `[id]:` label line, not the label line itself.
 */
function rewriteReferenceDefinitions(body: string, transform: (raw: string) => string): string {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const found = matchReferenceDefinitionAt(lines, i);
    if (found === null) continue;
    const targetLine = lines[found.lineIndex];
    if (targetLine === undefined) continue;
    lines[found.lineIndex] =
      targetLine.slice(0, found.index) + transform(found.url) + targetLine.slice(found.index + found.url.length);
  }
  return lines.join("\n");
}

function rewriteBody(body: string, transform: (raw: string) => string): string {
  const withRefDefs = rewriteReferenceDefinitions(body, transform);
  const withLinks = withRefDefs.replace(inlineLinkPattern(), (...args: string[]) => {
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
  const preBrokenRefs: string[] = [];
  const { transform, getRewritten } = makeTransform({
    oldContentRelPath: input.oldContentRelPath,
    isCard: input.isCard,
    unresolved,
    preBrokenRefs,
    oldPathExists: input.oldPathExists ?? (() => true),
  });

  const split = splitCardContent(input.text);
  const newBody = rewriteBody(split.body, transform);

  if (!split.hasFrontmatter) {
    return { text: newBody, rewritten: getRewritten(), unresolved, preBrokenRefs };
  }

  let fields: unknown;
  try {
    fields = parseYaml(split.frontmatterText);
  } catch (_e) {
    // Malformed frontmatter YAML: leave the frontmatter untouched (still
    // rewrite the body) rather than crash the whole migration on one bad
    // card — `bbx validate` already treats this as a lint error separately.
    return { text: `---\n${split.frontmatterText}---\n${newBody}`, rewritten: getRewritten(), unresolved, preBrokenRefs };
  }
  if (!isRecord(fields)) {
    return { text: `---\n${split.frontmatterText}---\n${newBody}`, rewritten: getRewritten(), unresolved, preBrokenRefs };
  }
  walkFrontmatter(fields, transform);
  rewriteContextDirField(fields);
  rewritePathFields(fields, transform);
  return { text: renderFrontmatterBlock(fields, newBody), rewritten: getRewritten(), unresolved, preBrokenRefs };
}

/**
 * Finding 9 (round 3 hardening): rewrite the two known path-bearing fields
 * NOT named `ref`/`refs` — `navigation.symbol.src` and a figure's `entry` —
 * using the SAME shared inventory ({@link PATH_FIELDS}, `lint-path-fields.ts`)
 * the hard link gate's checks read. `walkFrontmatter` above never sees
 * these (it only walks keys literally named `ref`/`refs`), so before this
 * they went unrewritten and then FAILED the migration's own hard link gate
 * on an otherwise-valid box. Both fields resolve like any other ref (the
 * card's own document-relative / `attach/…` / leading-`/` 3-form), so this
 * reuses the exact same `transform` `walkFrontmatter` uses.
 */
function rewritePathFields(fields: Record<string, unknown>, transform: (raw: string) => string): void {
  for (const field of PATH_FIELDS) {
    const value = field.getValue(fields);
    if (value === undefined || value.trim() === "") continue;
    field.setValue(fields, transform(value));
  }
}

/**
 * A chat husk card's `context-dir` frontmatter field (`src/schemas/chat.ts`)
 * names a box-relative landmark directory — box-root-relative already, not a
 * ref relative to the card's own location, so it needs `mapV2Path` directly
 * rather than the `resolveV2Ref`-then-map pipeline every OTHER frontmatter
 * `ref`/`refs` field goes through. Not a `ref`/`refs` key, so `walkFrontmatter`
 * above never sees it; left unmapped (never "" — the box root) it stays
 * unresolved forever, since nothing else in the box points at a husk to catch
 * it at the hard link gate.
 */
function rewriteContextDirField(fields: Record<string, unknown>): void {
  const value = fields["context-dir"];
  if (typeof value !== "string" || value === "") return;
  const mapped = mapV2Path(value);
  if (mapped.kind === "move") fields["context-dir"] = mapped.newPath;
}

/** `cardRef="…"` / `cardRef='…'` — same attribute `core/views/refs.ts`'s
 * `extractViewRefs` tracks. A view file never moves (it lives at the v2/v3
 * package root, `src/views/`, in both shapes), so its refs need rewriting IN
 * PLACE — this is the box-root-relative counterpart of {@link
 * rewriteOneRootRefs} for that one surface. */
const CARD_REF_ATTR = /(\bcardRef\s*=\s*)(["'])([^"']*)\2/g;

/**
 * Rewrite every `cardRef="…"` in one view source file from v2 to canonical
 * v3 form. A view has no document-relative base — its refs already resolve
 * from the box root (leading `/` or not, `core/views/refs.ts`'s doc
 * comment), so this reuses the same v2-content-relative resolution as any
 * other box-root-relative ref (`fromPath: ""`).
 */
export function rewriteOneRootViewRefs(
  text: string,
  oldPathExists?: (v2ContentRelPath: string) => boolean,
): OneRootRewriteResult {
  const unresolved: string[] = [];
  const preBrokenRefs: string[] = [];
  const { transform, getRewritten } = makeTransform({
    oldContentRelPath: "",
    isCard: false,
    unresolved,
    preBrokenRefs,
    oldPathExists: oldPathExists ?? (() => true),
  });
  const newText = text.replace(CARD_REF_ATTR, (...args: string[]) => {
    const [, prefix, quote, value] = args;
    return (prefix ?? "") + (quote ?? "") + transform(value ?? "") + (quote ?? "");
  });
  return { text: newText, rewritten: getRewritten(), unresolved, preBrokenRefs };
}

