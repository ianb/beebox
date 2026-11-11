/**
 * Side-effect module: a happy-dom window on `globalThis`, React's act
 * environment flag, and a minimal DevTools hook that reports each commit to
 * `dom-harness.ts`. React DOM reads the window and the hook once, when it
 * loads, so this module must evaluate before `react-dom` does: `dom-harness.ts`
 * imports it first, and a test imports `dom-harness.ts` first. It also
 * installs Temporal (`temporal-global.ts`), which the app loads in `boot()`.
 */
import "./temporal-global.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost/" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// The app's page has a doctype, so it renders in standards mode. happy-dom
// reports no `compatMode`, which KaTeX reads as quirks mode and warns about.
Object.defineProperty(document, "compatMode", { value: "CSS1Compat", configurable: true });

/** The fields of a React fiber the render counter reads. */
export interface Fiber {
  tag: number;
  type: unknown;
  flags: number;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
}
export interface FiberRoot {
  current: Fiber;
  containerInfo: unknown;
}

export const commitListeners = new Set<(root: FiberRoot) => void>();
/** Set when React DOM connects to the hook, which it does only if this module loaded first. */
export const reactDom = { connected: false };

Object.assign(globalThis, {
  __REACT_DEVTOOLS_GLOBAL_HOOK__: {
    supportsFiber: true,
    renderers: new Map(),
    inject: () => { reactDom.connected = true; return 1; },
    checkDCE: () => {},
    onScheduleFiberRoot: () => {},
    onCommitFiberRoot: (_id: number, root: FiberRoot) => { for (const listener of commitListeners) listener(root); },
    onPostCommitFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
  },
});
