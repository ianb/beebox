/**
 * Mount React components in a happy-dom document from a doctest: run effects
 * and events, read the DOM, and count which components rendered. How to write
 * one: `docs/testing/doctests.md`, "DOM doctests". Counts cover committed
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
  if (type.displayName !== undefined) return type.displayName;
  return fallback !== undefined && fallback !== "" ? fallback : "Anonymous";
}

/** A component's name, or null for a host or internal fiber. */
type ComponentName = string | null;
type PreviousFiber = Fiber | null;

function componentName(fiber: Fiber): ComponentName {
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
  const visit = (next: Fiber, prev: PreviousFiber): void => {
    const name = componentName(next);
    if (name !== null && (prev === null || (next.flags & PERFORMED_WORK) !== 0)) {
      const before = counts.get(name);
      counts.set(name, before === undefined ? 1 : before + 1);
    }
    if (prev !== null && next.child === prev.child) return;
    for (let child = next.child; child !== null; child = child.sibling) {
      visit(child, prev === null ? null : child.alternate);
    }
  };
  visit(root.current, root.current.alternate);
}

type StepResult = void | Promise<void>;
type Step = () => StepResult;

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
