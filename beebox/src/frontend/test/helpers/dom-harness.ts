/**
 * Mount React components in a happy-dom document from a test: run effects
 * and events, read the DOM, and count which components rendered. How to write
 * one: `docs/testing/tests.md`, "DOM tests". Counts cover committed
 * renders of ordinary trees; Suspense fallbacks are not special-cased.
 */
// First, and bare: React DOM reads the window and the DevTools hook when it loads.
import "./dom-globals.js";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { commitListeners, reactDom, type Fiber, type FiberRoot } from "./dom-globals.js";

// React 18 work tags (react-reconciler ReactWorkTags) and the PerformedWork flag.
const FUNCTION_COMPONENT = 0;
const CLASS_COMPONENT = 1;
const FORWARD_REF = 11;
const SIMPLE_MEMO_COMPONENT = 15;
const PERFORMED_WORK = 0b1;

interface ComponentType {
  displayName?: string;
  name?: string;
  render?: { name?: string };
}

function isComponentType(type: unknown): type is ComponentType {
  return typeof type === "function" || (typeof type === "object" && type !== null);
}

function nameOf(type: ComponentType, fallback?: string): string {
  return type.displayName ?? (fallback || "Anonymous");
}

/** A component's name, or null for a host or internal fiber. */
function componentName(fiber: Fiber): string | null {
  const { type, tag } = fiber;
  if (!isComponentType(type)) return null;
  if (tag === FUNCTION_COMPONENT || tag === CLASS_COMPONENT || tag === SIMPLE_MEMO_COMPONENT) return nameOf(type, type.name);
  if (tag === FORWARD_REF) return nameOf(type, type.render?.name);
  return null;
}

/**
 * Count the components that rendered in one commit. A subtree React reused
 * keeps its old child pointer and is skipped; a fiber React cloned but did
 * not render has no PerformedWork flag. React DevTools uses the same two tests.
 */
function countCommit(root: FiberRoot, counts: Map<string, number>): void {
  const visit = (next: Fiber, prev: Fiber | null): void => {
    const name = componentName(next);
    if (name !== null && (prev === null || (next.flags & PERFORMED_WORK) !== 0)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    if (prev !== null && next.child === prev.child) return;
    for (let child = next.child; child !== null; child = child.sibling) {
      visit(child, prev === null ? null : child.alternate);
    }
  };
  visit(root.current, root.current.alternate);
}

type Step = () => void | Promise<void>;

export interface Mounted {
  container: HTMLElement;
  /** Render a new element into the same root, as a parent re-render would. */
  rerender(element: ReactNode): Promise<void>;
  /** Run `fn` inside act, so its state updates and effects flush before this resolves. */
  act(fn: Step): Promise<void>;
  /** Renders per component name since mount or the last `resetRenders`, sorted by name. */
  renders(): Record<string, number>;
  resetRenders(): void;
  unmount(): Promise<void>;
}

/** React DOM loaded before `dom-globals.ts`, so it has no window and reports no commits. */
export class HarnessLoadOrderError extends Error {
  constructor() {
    super("react-dom loaded before dom-harness.ts; import dom-harness.ts first in the setup block");
    this.name = "HarnessLoadOrderError";
  }
}

/** Mount `element` in a fresh container under `document.body`, effects flushed. */
export async function mount(element: ReactNode): Promise<Mounted> {
  if (!reactDom.connected) throw new HarnessLoadOrderError();
  const container = document.createElement("div");
  document.body.append(container);
  const counts = new Map<string, number>();
  const listener = (root: FiberRoot): void => {
    if (root.containerInfo === container) countCommit(root, counts);
  };
  commitListeners.add(listener);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return {
    container,
    rerender: async (next) => { await act(async () => { root.render(next); }); },
    act: async (fn) => { await act(async () => { await fn(); }); },
    renders: () => Object.fromEntries([...counts].toSorted(([a], [b]) => a.localeCompare(b))),
    resetRenders: () => { counts.clear(); },
    unmount: async () => {
      await act(async () => { root.unmount(); });
      commitListeners.delete(listener);
      container.remove();
    },
  };
}

// ---------- finding controls ----------
// How a DOM test finds an element (docs/testing/check.md, "DOM tests"): the
// `bbx-` id for a static control, else role + accessible name. Each helper
// throws unless exactly one element matches, so a renamed or duplicated
// control fails the test where it is looked up.

/** The element with this id under `root`. */
export function byId(root: ParentNode, id: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  if (found === null) throw new Error(`no element with id "${id}"`);
  return found;
}

export interface RoleQuery {
  role: string;
  /** The accessible name, compared after collapsing whitespace. */
  name: string;
}

/** The one element under `root` with this role and accessible name. */
export function byRole(root: ParentNode, query: RoleQuery): HTMLElement {
  const found = allByRole(root, query);
  const [only] = found;
  if (found.length === 1 && only !== undefined) return only;
  const names = allByRole(root, { role: query.role, name: "*" }).map((el) => JSON.stringify(accessibleName(el)));
  throw new Error(`${found.length} ${query.role} elements named "${query.name}"; ${query.role} names here: ${names.join(", ") || "none"}`);
}

/** Every element under `root` with this role and accessible name; name `"*"` matches any. */
export function allByRole(root: ParentNode, { role, name }: RoleQuery): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("*")].filter(
    (el) => roleOf(el) === role && (name === "*" || accessibleName(el) === collapse(name)),
  );
}

const IMPLICIT_ROLES: Record<string, string> = {
  BUTTON: "button",
  TEXTAREA: "textbox",
  SELECT: "combobox",
  H1: "heading",
  H2: "heading",
  H3: "heading",
  H4: "heading",
  H5: "heading",
  H6: "heading",
  DIALOG: "dialog",
};

const INPUT_ROLES: Record<string, string> = {
  button: "button",
  submit: "button",
  reset: "button",
  checkbox: "checkbox",
  radio: "radio",
  text: "textbox",
  search: "searchbox",
  email: "textbox",
  url: "textbox",
};

/** The explicit role, else the implicit role of the common interactive tags. */
function roleOf(el: HTMLElement): string | null {
  const explicit = el.getAttribute("role");
  if (explicit !== null) return explicit.split(" ")[0] ?? null;
  if (el.tagName === "A") return el.hasAttribute("href") ? "link" : null;
  if (el.tagName === "INPUT") return INPUT_ROLES[el.getAttribute("type") ?? "text"] ?? null;
  return IMPLICIT_ROLES[el.tagName] ?? null;
}

/**
 * A subset of the accessible-name computation: `aria-labelledby`, then
 * `aria-label`, then a `<label>` for a form field, then text content outside
 * `aria-hidden` subtrees, then `title`.
 */
export function accessibleName(el: HTMLElement): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy !== null) {
    return collapse(labelledBy.split(/\s+/).map((id) => visibleText(el.ownerDocument.getElementById(id))).join(" "));
  }
  const label = el.getAttribute("aria-label");
  if (label !== null && label.trim() !== "") return collapse(label);
  const forLabel = el.id === "" ? null : el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
  const fieldLabel = forLabel ?? el.closest("label");
  if (fieldLabel !== null && fieldLabel !== el) return collapse(visibleText(fieldLabel));
  const text = collapse(visibleText(el));
  return text === "" ? collapse(el.getAttribute("title") ?? "") : text;
}

function visibleText(node: Node | null): string {
  if (node === null) return "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof HTMLElement && node.getAttribute("aria-hidden") === "true") return "";
  if (node instanceof HTMLImageElement) return node.alt;
  return [...node.childNodes].map(visibleText).join("");
}

function collapse(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}
