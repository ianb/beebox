/**
 * Set one todo's `status` (or another single attribute, `setTodoAttribute`)
 * by editing exactly the bytes that change — nothing else in the card's text
 * moves (`docs/plans/todos-ui.md`, Tracks 3 and 7).
 *
 * A body `{% todo %}` tag is found by re-running the SAME identity pass the
 * collector and the renderer use (`assignLocators`,
 * `../../shared/todo-locators.js`), then its opening tag's attribute
 * is rewritten in place — the `rewrite-card-refs.ts:220`
 * text-surgical-attribute-edit approach, not a reserialize. A frontmatter
 * `todos:` entry goes through format-preserving YAML instead
 * (`webapp/trpc/routers/card.ts`'s `setTheme`, same `parseDocument` +
 * `setIn`/`deleteIn` shape as `core/landmark/hq-preference.ts`).
 *
 * Pure: no filesystem, no lock, no clock. The caller (the `todos.setStatus`
 * mutation, a later track) owns reading the file, taking `withCardLock`,
 * checking the text/`expectedStatus` the client saw, writing the result,
 * and committing.
 *
 * **Accepted gap**, recorded here per the plan: this function's caller
 * reads the card, and a separate process (an agent) can write it between
 * that read and this function's caller's write. `withCardLock` is
 * in-process only. The window is one read-modify-write, and the agent's own
 * edit tool refuses to write a file that changed since it read it, so the
 * reverse race fails loudly on the agent's side.
 */

import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";
import { isMap, isSeq, parseDocument } from "yaml";
import { splitCardContent } from "../../cards/index.js";
import { assignLocators } from "../../shared/todo-locators.js";
import { invariant } from "../../lib/invariant.js";
import { errorMessage } from "../../lib/error-guards.js";
import type { TodoLocator } from "./collect-types.js";

// Same CJS/ESM workaround as `extract-body.ts`.
// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { parse } = Markdoc;

/** The two statuses a boxholder checkbox can set. `parked`/`dropped` stay chat or hand edits (plan, NOT in scope). */
export type TodoWriteStatus = "open" | "done";

/**
 * The attributes a program may write on one todo: `status` (the checkbox,
 * Track 3) and `recheck` (the todo-review verify step, Track 7). A closed
 * list, since each name is spliced into a regex below.
 */
type TodoAttributeName = "status" | "recheck";

/** Thrown when `locator` does not resolve to a todo in `content` (a stale locator, or a body that no longer parses). */
export class TodoLocatorNotFoundError extends Error {
  readonly locator: TodoLocator;
  constructor(locator: TodoLocator, reason?: string) {
    super(`No todo found at locator ${JSON.stringify(locator)}${reason === undefined ? "" : `: ${reason}`}`);
    this.name = "TodoLocatorNotFoundError";
    this.locator = locator;
  }
}

/** Set the todo at `locator` to `status`, changing nothing else in `content`. */
export function setTodoStatus(content: string, { locator, status }: { locator: TodoLocator; status: TodoWriteStatus }): string {
  // `open` is the default, written as absence (the common case costs zero typing).
  return setTodoAttribute(content, { locator, name: "status", value: status === "open" ? null : "done" });
}

/**
 * Set one attribute of the todo at `locator` to `value`, or remove it when
 * `value` is `null`, changing nothing else in `content`.
 */
export function setTodoAttribute(
  content: string,
  edit: { locator: TodoLocator; name: TodoAttributeName; value: string | null }
): string {
  invariant(edit.value === null || !/["$%']/.test(edit.value), `todo attribute value must not contain quotes, % or $: ${edit.value ?? ""}`);
  const { locator } = edit;
  return locator.kind === "frontmatter"
    ? setFrontmatterAttribute(content, { ...edit, locator })
    : setBodyAttribute(content, { ...edit, locator });
}

interface AttributeEdit<L extends TodoLocator> {
  locator: L;
  name: TodoAttributeName;
  value: string | null;
}

function setFrontmatterAttribute(content: string, edit: AttributeEdit<{ kind: "frontmatter"; index: number }>): string {
  const { locator, name, value } = edit;
  const split = splitCardContent(content);
  if (!split.hasFrontmatter || split.frontmatterText.trim() === "") {
    throw new TodoLocatorNotFoundError(locator, "card has no frontmatter block");
  }
  const doc = parseDocument(split.frontmatterText);
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    throw new TodoLocatorNotFoundError(locator, "frontmatter is not a valid YAML mapping");
  }
  const todos = doc.getIn(["todos"]);
  if (!isSeq(todos) || locator.index < 0 || locator.index >= todos.items.length) {
    throw new TodoLocatorNotFoundError(locator, "no such todos[] entry");
  }
  if (value === null) {
    doc.deleteIn(["todos", locator.index, name]);
  } else {
    doc.setIn(["todos", locator.index, name], value);
  }
  const yaml = doc.toString({ lineWidth: 0 });
  return `---\n${yaml.endsWith("\n") ? yaml : `${yaml}\n`}---\n${split.body}`;
}

function setBodyAttribute(content: string, edit: AttributeEdit<{ kind: "body"; line: number; nth?: number }>): string {
  const { locator } = edit;
  const split = splitCardContent(content);
  let ast: Node;
  try {
    ast = parse(split.body);
  } catch (e) {
    throw new TodoLocatorNotFoundError(locator, `body failed to parse as Markdoc: ${errorMessage(e)}`);
  }
  const node = findTodoNode(assignLocators(ast, split.lineOffset), locator);
  if (node === undefined) throw new TodoLocatorNotFoundError(locator);

  // The line assignLocators gave this node is the FILE line (already
  // shifted by lineOffset); recover the body-relative, 0-indexed line to
  // splice `split.body`'s own lines rather than the file's, since the
  // frontmatter prefix is copied through untouched below.
  const bodyLines = split.body.split("\n");
  const bodyLineIndex = locator.line - split.lineOffset - 1;
  const lineText = bodyLines[bodyLineIndex];
  if (lineText === undefined) throw new TodoLocatorNotFoundError(locator);

  const rewritten = rewriteNthOpeningTag({ lineText, occurrence: locator.nth ?? 1, edit });
  if (rewritten === null) throw new TodoLocatorNotFoundError(locator, "opening tag not found on its own line");
  bodyLines[bodyLineIndex] = rewritten;

  const prefixLength = content.length - split.body.length;
  return content.slice(0, prefixLength) + bodyLines.join("\n");
}

/** The node `assignLocators` gave exactly `locator`, or `undefined` if none did. */
function findTodoNode(locators: Map<Node, TodoLocator>, locator: TodoLocator): Node | undefined {
  for (const [node, candidate] of locators) {
    if (sameBodyLocator(candidate, locator)) return node;
  }
  return undefined;
}

function sameBodyLocator(a: TodoLocator, b: TodoLocator): boolean {
  return a.kind === "body" && b.kind === "body" && a.line === b.line && (a.nth ?? 1) === (b.nth ?? 1);
}

/** An opening `{% todo … %}` tag, stopping at its first `%}` — attributes never carry a bare `%`. */
const OPENING_TODO_TAG_RE = /{%\s*todo\b[^%]*%}/g;

/** A `name="…"` (or `'…'`) attribute anywhere in an opening tag's text, one per writable attribute. */
const ATTRIBUTE_RE: Record<TodoAttributeName, RegExp> = {
  status: /(\sstatus=)(["'])[^"']*\2/,
  recheck: /(\srecheck=)(["'])[^"']*\2/,
};

/** Rewrite the `occurrence`-th (1-based) opening todo tag on one line; `null` if there is no such occurrence. */
function rewriteNthOpeningTag(input: {
  lineText: string;
  occurrence: number;
  edit: { name: TodoAttributeName; value: string | null };
}): string | null {
  const { lineText, occurrence, edit } = input;
  const match = [...lineText.matchAll(OPENING_TODO_TAG_RE)][occurrence - 1];
  if (match === undefined) return null;
  const rewrittenTag = rewriteAttribute(match[0], edit);
  return lineText.slice(0, match.index) + rewrittenTag + lineText.slice(match.index + match[0].length);
}

function rewriteAttribute(tagText: string, { name, value }: { name: TodoAttributeName; value: string | null }): string {
  const re = ATTRIBUTE_RE[name];
  if (value === null) {
    return tagText.replace(re, "");
  }
  if (re.test(tagText)) {
    return tagText.replace(re, (_m: string, ...g: string[]) => {
      const [eq, quote] = g;
      invariant(eq !== undefined && quote !== undefined, "attribute regex has two mandatory capture groups");
      return `${eq}${quote}${value}${quote}`;
    });
  }
  return tagText.replace(/^({%\s*todo)/, `$1 ${name}="${value}"`);
}
