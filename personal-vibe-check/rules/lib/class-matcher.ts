/**
 * Class matcher shared by the class-ban rules (`restricted-classes`).
 *
 * Reads a class value from the AST into the classes it can render, and
 * matches variant-aware class patterns against them.
 *
 * Reading. A class value is split into the unconditional tokens and a list of
 * conditional operands (each branch of `a ? x : y`, the right side of
 * `a && x`, each key of an object argument). Sources are string literals,
 * template literals (a token that touches a `${}` boundary is joined from the
 * interpolation's static string spellings, or dropped as partial when it has
 * none), conditional and logical expressions, and the arguments of the
 * configured class helpers (`cn`, `clsx`, `twMerge`), including nested arrays
 * and object keys. Identifiers, member expressions and other calls are
 * invisible: their classes cannot be known here.
 *
 * Candidate sets. The checked sets are the unconditional tokens U alone and
 * U plus each operand O on its own. Two operands are never combined, so a
 * correlated pair such as `a && "absolute"`, `!a && "z-50"` is not reported,
 * and a banned combination split across two independent operands is missed.
 * There is no cross product, so the work is linear in the operands.
 *
 * Merging. `twMerge` can drop an earlier class at runtime (`cn("fixed",
 * "static")` renders `static`). The matcher does not simulate the merge, so
 * it reports that case.
 *
 * Patterns. `[variants:]utility-glob`, with `*` matching any run of
 * characters in the utility. Responsive variants (`sm`, `md`, `lg`, `xl`,
 * `2xl`) and `dark` are ignored on both sides; every other variant on a token
 * must be listed in the pattern, in any order. `|` separates alternatives,
 * and `!` after an alternative adds an exclusion: `focus:outline-*!focus:outline-none`.
 */

const IGNORED_VARIANTS = new Set(["sm", "md", "lg", "xl", "2xl", "dark"]);

export const DEFAULT_CALLEES = ["cn", "clsx", "twMerge"];

/** One class token with its variant chain split off. */
export interface ClassToken {
  raw: string;
  /** Variants that take part in matching, sorted. */
  variants: string[];
  utility: string;
}

/** A read class value: tokens always present, and the conditional operands. */
export interface ClassValue {
  unconditional: ClassToken[];
  operands: ClassToken[][];
}

interface PatternPart {
  variants: string[];
  utility: RegExp;
}

interface PatternAlternative {
  include: PatternPart;
  exclude: PatternPart[];
}

/** A compiled pattern: any alternative may match. */
export interface ClassPattern {
  source: string;
  alternatives: PatternAlternative[];
}

/** Split on `:` outside square brackets, so `[&:hover]:x` keeps its variant whole. */
function splitVariants(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of raw) {
    if (char === "[") depth += 1;
    else if (char === "]") depth = Math.max(0, depth - 1);
    if (char === ":" && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts;
}

function matchingVariants(variants: string[]): string[] {
  return variants.filter((variant) => !IGNORED_VARIANTS.has(variant)).toSorted();
}

export function parseToken(raw: string): ClassToken | null {
  const parts = splitVariants(raw);
  const last = parts.pop();
  if (last === undefined) return null;
  const utility = last.replace(/^!/, "").replace(/!$/, "");
  if (utility === "") return null;
  return { raw, variants: matchingVariants(parts), utility };
}

export function tokensOf(text: string): ClassToken[] {
  const tokens: ClassToken[] = [];
  for (const raw of text.split(/\s+/)) {
    const parsed = raw.length === 0 ? null : parseToken(raw);
    if (parsed !== null) tokens.push(parsed);
  }
  return tokens;
}

function globToRegExp(glob: string): RegExp {
  const body = glob
    .split("*")
    .map((piece) => piece.replaceAll(/[$()+.?[\\\]^{|}]/g, String.raw`\$&`))
    .join(".*");
  // eslint-disable-next-line security/detect-non-literal-regexp -- built from a project-config class pattern (rule options) with every metacharacter but `*` escaped.
  return new RegExp(`^${body}$`);
}

function parsePart(source: string): PatternPart {
  const parts = splitVariants(source);
  const utility = parts.pop() ?? "";
  return { variants: matchingVariants(parts), utility: globToRegExp(utility) };
}

export function parsePattern(source: string): ClassPattern {
  const alternatives = source.split("|").map((alternative) => {
    const [include = "", ...exclude] = alternative.split("!");
    return { include: parsePart(include), exclude: exclude.map((part) => parsePart(part)) };
  });
  return { source, alternatives };
}

function sameVariants(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((variant, index) => variant === b[index]);
}

function partMatches(token: ClassToken, part: PatternPart): boolean {
  return sameVariants(token.variants, part.variants) && part.utility.test(token.utility);
}

export function tokenMatches(token: ClassToken, pattern: ClassPattern): boolean {
  return pattern.alternatives.some(
    (alternative) =>
      partMatches(token, alternative.include) &&
      !alternative.exclude.some((part) => partMatches(token, part)),
  );
}

// ---------- reading the AST ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const EMPTY: ClassValue = { unconditional: [], operands: [] };

function merge(values: ClassValue[]): ClassValue {
  return {
    unconditional: values.flatMap((value) => value.unconditional),
    operands: values.flatMap((value) => value.operands),
  };
}

/** A whole sub-value that may or may not render: each of its own candidate sets becomes one operand. */
function asOperands(value: ClassValue): ClassValue {
  return { unconditional: [], operands: candidateSets(value).filter((set) => set.length > 0) };
}

/** At most this many spellings of one glued token; more is treated as unknown. */
const MAX_SPELLINGS = 8;

/** Every string `node` can evaluate to, or null when any branch is not a static string. */
function staticStrings(node: unknown): string[] | null {
  if (!isRecord(node)) return null;
  switch (node.type) {
    case "Literal":
      return typeof node.value === "string" ? [node.value] : null;
    case "TemplateLiteral": {
      const quasis = Array.isArray(node.quasis) ? node.quasis : [];
      const [only] = quasis;
      return quasis.length === 1 && isRecord(only) && isRecord(only.value) && typeof only.value.cooked === "string"
        ? [only.value.cooked]
        : null;
    }
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return staticStrings(node.expression);
    case "ConditionalExpression": {
      const consequent = staticStrings(node.consequent);
      const alternate = staticStrings(node.alternate);
      return consequent === null || alternate === null ? null : [...new Set([...consequent, ...alternate])];
    }
    default:
      return null;
  }
}

/** Every spelling of `before` followed by every spelling of `after`; null past the cap. */
function joinSpellings(before: string[], after: string[]): string[] | null {
  const joined = [...new Set(before.flatMap((left) => after.map((right) => left + right)))];
  return joined.length > MAX_SPELLINGS ? null : joined;
}

function cookedText(quasi: unknown): string {
  return isRecord(quasi) && isRecord(quasi.value) && typeof quasi.value.cooked === "string"
    ? quasi.value.cooked
    : "";
}

/**
 * Reads a template literal. A token that touches a `${}` boundary without
 * whitespace is built from the text and the interpolation's static spellings
 * (`hover:${a ? "x" : "y"}` is `hover:x` or `hover:y`); when an interpolation
 * is not a static string the token is partial and dropped. An interpolation
 * with whitespace on both sides is read as a class value of its own.
 */
function readTemplate(
  template: { quasis: unknown[]; expressions: unknown[] },
  read: (node: unknown) => ClassValue,
): ClassValue {
  const { quasis, expressions } = template;
  const unconditional: ClassToken[] = [];
  const operands: ClassToken[][] = [];
  const nested: ClassValue[] = [];
  /** Spellings of the token being built (text since the last whitespace); null when partial. */
  let current: string[] | null = [""];
  const finish = (): void => {
    if (current !== null) {
      const sets = current.map((text) => tokensOf(text)).filter((set) => set.length > 0);
      const [only] = sets;
      if (sets.length === 1 && only !== undefined) unconditional.push(...only);
      else operands.push(...sets);
    }
    current = [""];
  };
  for (const [index, quasi] of quasis.entries()) {
    for (const [pieceIndex, piece] of cookedText(quasi).split(/\s+/).entries()) {
      if (pieceIndex > 0) finish();
      current = current === null ? null : joinSpellings(current, [piece]);
    }
    const expression = expressions[index];
    if (expression === undefined) continue;
    const next = cookedText(quasis[index + 1]);
    const lastQuasi = index + 1 === quasis.length - 1;
    const glueAfter = lastQuasi ? next !== "" && !/^\s/.test(next) : !/^\s/.test(next);
    const glueBefore = current === null || current.length !== 1 || current[0] !== "";
    if (!glueBefore && !glueAfter) {
      nested.push(read(expression));
      continue;
    }
    const spellings = staticStrings(expression);
    current = current === null || spellings === null ? null : joinSpellings(current, spellings);
  }
  finish();
  return merge([{ unconditional, operands }, ...nested]);
}

function objectKeyOperands(properties: unknown[]): ClassValue {
  const operands: ClassToken[][] = [];
  for (const property of properties) {
    if (!isRecord(property) || property.type !== "Property" || property.computed === true) continue;
    const key = property.key;
    if (!isRecord(key)) continue;
    const text = key.type === "Identifier" ? key.name : key.type === "Literal" ? key.value : null;
    if (typeof text !== "string") continue;
    const tokens = tokensOf(text);
    if (tokens.length > 0) operands.push(tokens);
  }
  return { unconditional: [], operands };
}

export function calleeName(node: unknown): string | null {
  if (!isRecord(node) || node.type !== "CallExpression" || !isRecord(node.callee)) return null;
  return node.callee.type === "Identifier" && typeof node.callee.name === "string"
    ? node.callee.name
    : null;
}

interface ReadContext {
  callees: ReadonlySet<string>;
  /** Inside a class helper's arguments, where arrays and object keys are class sources. */
  inHelper: boolean;
}

function readExpression(node: unknown, context: ReadContext): ClassValue {
  if (!isRecord(node)) return EMPTY;
  const { callees, inHelper } = context;
  const read = (child: unknown): ClassValue => readExpression(child, context);
  switch (node.type) {
    case "Literal":
      return typeof node.value === "string"
        ? { unconditional: tokensOf(node.value), operands: [] }
        : EMPTY;
    case "JSXExpressionContainer":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return read(node.expression);
    case "TemplateLiteral": {
      const quasis = Array.isArray(node.quasis) ? node.quasis : [];
      const expressions = Array.isArray(node.expressions) ? node.expressions : [];
      return readTemplate({ quasis, expressions }, read);
    }
    case "ConditionalExpression":
      return merge([asOperands(read(node.consequent)), asOperands(read(node.alternate))]);
    case "LogicalExpression":
      // `a && x` renders x or nothing; `a || x` and `a ?? x` render either side.
      return node.operator === "&&"
        ? asOperands(read(node.right))
        : merge([asOperands(read(node.left)), asOperands(read(node.right))]);
    case "CallExpression": {
      const name = calleeName(node);
      if (name === null || !callees.has(name) || !Array.isArray(node.arguments)) return EMPTY;
      return merge(
        node.arguments.map((argument) => readExpression(argument, { callees, inHelper: true })),
      );
    }
    case "ArrayExpression":
      return inHelper && Array.isArray(node.elements) ? merge(node.elements.map(read)) : EMPTY;
    case "ObjectExpression":
      return inHelper && Array.isArray(node.properties)
        ? objectKeyOperands(node.properties)
        : EMPTY;
    default:
      return EMPTY;
  }
}

/** Read a `className` value or a class helper call into a class value. */
export function readClassValue(node: unknown, callees: ReadonlySet<string>): ClassValue {
  return readExpression(node, { callees, inHelper: false });
}

/** U alone, then U with each operand on its own. */
export function candidateSets(value: ClassValue): ClassToken[][] {
  return [
    value.unconditional,
    ...value.operands.map((operand) => [...value.unconditional, ...operand]),
  ];
}

/** Patterns of one entry: the set must hold every `all` pattern and no `none` pattern. */
export interface ClassEntryPatterns {
  all: ClassPattern[];
  none: ClassPattern[];
}

/** Returns the tokens that matched `all`, or null when the set does not match. */
function setMatches(set: ClassToken[], { all, none }: ClassEntryPatterns): ClassToken[] | null {
  if (set.some((token) => none.some((pattern) => tokenMatches(token, pattern)))) return null;
  const matched: ClassToken[] = [];
  for (const pattern of all) {
    const hits = set.filter((token) => tokenMatches(token, pattern));
    if (hits.length === 0) return null;
    matched.push(...hits);
  }
  return matched;
}

/**
 * The first candidate set of `value` that holds every `all` pattern and no
 * `none` pattern, as the matched tokens' spellings (deduplicated), or null.
 */
export function findMatch(value: ClassValue, entry: ClassEntryPatterns): string[] | null {
  if (entry.all.length === 0) return null;
  for (const set of candidateSets(value)) {
    const matched = setMatches(set, entry);
    if (matched !== null) return [...new Set(matched.map((token) => token.raw))];
  }
  return null;
}
