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
import { isAttachRef } from "../../shared/attach-path.js";
import { formatRefSuffix, isExternalRef, parseRef } from "../../shared/ref-path.js";
import { isRecord } from "../../lib/is-record.js";
import { inlineLinkPattern, matchReferenceDefinitionAt } from "../body-refs.js";
import { PATH_FIELDS } from "../lint-path-fields.js";
import { mapV2Path } from "./one-root-mapping.js";
import { OneRootPreflightError } from "./one-root-errors.js";

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
  rewriteContextDirField(fields);
  rewritePathFields(fields, transform);
  return { text: renderFrontmatterBlock(fields, newBody), rewritten: getRewritten(), unresolved };
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
export function rewriteOneRootViewRefs(text: string): OneRootRewriteResult {
  const unresolved: string[] = [];
  const { transform, getRewritten } = makeTransform({ oldContentRelPath: "", isCard: false, unresolved });
  const newText = text.replace(CARD_REF_ATTR, (...args: string[]) => {
    const [, prefix, quote, value] = args;
    return (prefix ?? "") + (quote ?? "") + transform(value ?? "") + (quote ?? "");
  });
  return { text: newText, rewritten: getRewritten(), unresolved };
}

const GLOB_METACHAR = /[*?[{]/;
const DEPENDENCIES_HEAD = /export\s+const\s+dependencies\s*(?::[^=]+)?=\s*\[/;
const STRING_LITERAL = /(["'])((?:(?!\1)[^\\]|\\.)*)\1/g;

/**
 * Round-8 hardening finding 5: the old extraction regex captured the array
 * body as `[^\]]*` — everything up to the FIRST `]` — which closes early on a
 * glob CHARACTER CLASS inside a quoted entry (`"store/recipes/[AB]*.recipe.card"`
 * has its own `]`), silently truncating the body the rewriter/gate then read.
 * This walks `text` from the `dependencies = [` head one character at a time,
 * tracking whether it's inside a quoted string (honoring `\`-escapes), and
 * only treats an UNQUOTED `]` as the array's real close.
 *
 * Returns `null` when there's no `dependencies` declaration at all (nothing
 * to do, not an error). Throws naming `viewRelPath` when a declaration IS
 * found but no close can be located before EOF — fail closed rather than
 * guess at the array's extent the way the old regex did.
 */
function findDependenciesArray(text: string, viewRelPath: string): { bodyStart: number; bodyEnd: number } | null {
  const head = DEPENDENCIES_HEAD.exec(text);
  if (head === null) return null;
  const bodyStart = head.index + head[0].length;
  let quote: string | null = null;
  for (let i = bodyStart; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "]") return { bodyStart, bodyEnd: i };
  }
  throw new OneRootPreflightError(
    `${viewRelPath}: "dependencies" array declaration has no closing "]" this migration can find — refusing ` +
      'to guess at its extent (a glob character class\'s own "]" can look like the array\'s closing bracket to ' +
      "a naive scan). Reconcile by hand, then re-run.",
  );
}

/**
 * Every literal string entry in a view source's exported `dependencies`
 * array, in source order. Shared with {@link OneRootLinkGateResult}'s
 * dependency-prefix check (`one-root-link-gate.ts`) so the rewriter and the
 * gate that double-checks its output read the exact same grammar.
 */
export function extractDependencyGlobs(text: string, viewRelPath: string): string[] {
  const found = findDependenciesArray(text, viewRelPath);
  if (found === null) return [];
  const body = text.slice(found.bodyStart, found.bodyEnd);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  STRING_LITERAL.lastIndex = 0;
  while ((m = STRING_LITERAL.exec(body)) !== null) {
    if (m[2] !== undefined) out.push(m[2]);
  }
  return out;
}

/** Split a dependency glob into its static directory prefix (everything
 * before the first glob metacharacter, trimmed back to the previous `/`) and
 * the remaining suffix (kept byte-for-byte, including its leading `/`). An
 * empty prefix means the pattern has no static directory context at all
 * (e.g. `**\/*.card`) — nothing to resolve confidently. */
export function staticGlobPrefix(pattern: string): { prefix: string; suffix: string } {
  const idx = pattern.search(GLOB_METACHAR);
  if (idx === -1) return { prefix: pattern, suffix: "" };
  const cut = pattern.lastIndexOf("/", idx);
  const prefix = cut === -1 ? "" : pattern.slice(0, cut);
  return { prefix, suffix: pattern.slice(prefix.length) };
}

/** The v3 top-level "area" a moved path lands under — its first path
 * segment. Used to detect a v2 static PREFIX whose subtree crosses more than
 * one v3 area (round-8 hardening finding 6, below). */
function areaOf(newPath: string): string {
  const slash = newPath.indexOf("/");
  return slash === -1 ? newPath : newPath.slice(0, slash);
}

/**
 * Round-8 hardening finding 6: every v3 area a v2 static directory PREFIX's
 * subtree can land in — probed by feeding {@link mapV2Path} itself synthetic
 * children, one per literal case the mapping table's own switches recognize
 * at the places a v2 prefix's subtree splits across more than one v3 area:
 * `box/*` (`_content`/`_bookkeeping`/`_publish`), `store/*`
 * (`_content`/`_bookkeeping`), and `config/connectors/*` (`_config`, except
 * a `*.state.json` FILE, which lands in `_bookkeeping/connectors`). A prefix
 * this finds more than one area for is a split IN THE MAPPING TABLE ITSELF,
 * not a guess — `store/**` cannot assume every match it selects lands in one
 * place post-migration, and neither can `config/connectors/*.state.json`'s
 * own static directory prefix.
 */
function areasUnderPrefix(prefix: string): string[] {
  const normalized = prefix.replace(/\/+$/, "");
  if (normalized === "") return ["_content", "_bookkeeping", "_publish", "_config", "src", ".claude"];
  const connectorsPrefix = normalized === "config" ? "config/connectors" : normalized;
  const probes: readonly string[] =
    normalized === "box"
      ? ["box/inbox/x", "box/jobs/x", "box/output/x", "box/questions/x", "box/resources/x", "box/publish/x"]
      : normalized === "store"
        ? [
            "store/archive/x",
            "store/trash/x",
            "store/usage/x",
            "store/recipes/x",
            "store/todos/x",
            "store/drive/x",
            "store/calendar/x",
            "store/chat/x",
            "store/reviews/x",
            "store/other/x",
          ]
        : normalized === "config" || normalized === "config/connectors"
          ? [`${connectorsPrefix}/x.json`, `${connectorsPrefix}/x.state.json`]
          : [];
  if (probes.length === 0) {
    const direct = mapV2Path(normalized);
    return direct.kind === "move" ? [areaOf(direct.newPath)] : [];
  }
  const areas = new Set<string>();
  for (const probe of probes) {
    const mapped = mapV2Path(probe);
    if (mapped.kind === "move") areas.add(areaOf(mapped.newPath));
  }
  return [...areas];
}

/**
 * Round-7 hardening finding 4: a view's exported `dependencies` array
 * (`["store/recipes/**\/*.card"]`) carries plain glob strings that
 * {@link rewriteOneRootViewRefs} never touches — that function only rewrites
 * `cardRef="…"` attributes. Left alone, a v2 dependency glob survives the
 * migration verbatim, and since the directory it named just moved, it
 * matches nothing post-migration — a view that silently renders empty rather
 * than a ref the hard link gate can catch (a dependency glob is not a ref).
 *
 * Maps each entry's STATIC prefix (the part before the first glob
 * metacharacter) through the same v2→v3 table every other path goes through
 * and splices the original glob suffix back on unchanged — a dependency glob
 * is used directly as a `glob()` cwd-relative pattern (`core/views/cards.ts`),
 * never in the leading-`/` canonical ref form the other rewriters produce.
 *
 * Fails CLOSED: a prefix `mapV2Path` can't resolve — including the
 * degenerate empty-prefix case (no static directory context at all) — throws
 * naming `viewRelPath` AND the offending glob, rather than leave a migrated
 * box with a dependency nobody can be sure still matches the right thing.
 * Same stance for a prefix whose subtree crosses more than one v3 area
 * (finding 6): the migration can't confidently rewrite a glob it can't be
 * sure lands in one place, so it aborts naming both destination areas rather
 * than picking one and silently losing the other's matches.
 */
export function rewriteOneRootViewDependencies(
  text: string,
  viewRelPath: string,
): { text: string; rewritten: number } {
  let rewritten = 0;
  const found = findDependenciesArray(text, viewRelPath);
  if (found === null) return { text, rewritten };
  const body = text.slice(found.bodyStart, found.bodyEnd);
  const newBody = body.replace(STRING_LITERAL, (...innerArgs: string[]) => {
    const [, quote, value] = innerArgs;
    const { prefix, suffix } = staticGlobPrefix(value ?? "");
    const areas = prefix === "" ? [] : areasUnderPrefix(prefix);
    if (areas.length > 1) {
      throw new OneRootPreflightError(
        `${viewRelPath}: dependency glob "${value}" spans more than one v3 area under "${prefix}" ` +
          `(${areas.join(", ")}) — the migration can't assume every match it selects lands in the same place. ` +
          "Split the glob into one pattern per destination area, then re-run.",
      );
    }
    const mapped = prefix === "" ? null : mapV2Path(prefix);
    if (mapped === null || mapped.kind !== "move") {
      throw new OneRootPreflightError(
        `${viewRelPath}: dependency glob "${value}" has no confidently-mappable static directory prefix — ` +
          "refusing to migrate rather than leave a dependency that may match the wrong thing (or nothing) " +
          "post-migration. Reconcile by hand, then re-run.",
      );
    }
    rewritten++;
    return `${quote}${mapped.newPath}${suffix}${quote}`;
  });
  return { text: text.slice(0, found.bodyStart) + newBody + text.slice(found.bodyEnd), rewritten };
}
