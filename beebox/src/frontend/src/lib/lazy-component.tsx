/**
 * Code-splits a component out of the entry chunk.
 *
 * The renderer registry (`renderers.ts`) names every card view, and the box's
 * first page (chat) renders none of them. Importing their components
 * statically put them all in the entry script the browser must download and
 * parse before React mounts. A `lazyComponent` view loads on first render
 * instead, inside its own Suspense boundary, so the surrounding surface keeps
 * rendering while the chunk arrives.
 */
import { Component, Suspense, lazy, type ComponentType, type ReactElement, type ReactNode } from "react";
import { StatusMessage } from "../components/ui/StatusMessage";
import { ErrorText } from "../components/ui/ErrorText";
import { Button } from "../components/ui/Button";
import { Stack } from "../components/ui/Stack";

/**
 * A lazy chunk failed to load. After a deploy replaces the hashed assets, a
 * tab that loaded the old entry asks for chunk names that no longer exist;
 * only a reload fetches the new set. `LazyChunkBoundary` shows this in the
 * view's own pane, so the rest of the page keeps working.
 */
class LazyChunkLoadError extends Error {
  constructor(cause: unknown) {
    super("This view's code could not load. The app may have been updated: reload the page.", { cause });
    this.name = "LazyChunkLoadError";
  }
}

/** Catches only a failed chunk load; any other error goes on to the next boundary. */
class LazyChunkBoundary extends Component<{ children: ReactNode }, { failed: LazyChunkLoadError | null }> {
  state: { failed: LazyChunkLoadError | null } = { failed: null };

  static getDerivedStateFromError(error: Error): { failed: LazyChunkLoadError | null } {
    if (error instanceof LazyChunkLoadError) return { failed: error };
    throw error;
  }

  componentDidCatch(error: unknown): void {
    console.error("Lazy view failed to load:", error);
  }

  render(): ReactNode {
    if (this.state.failed === null) return this.props.children;
    return (
      <Stack gap="sm" className="p-4">
        <ErrorText>{this.state.failed.message}</ErrorText>
        <Button id="bbx-lazy-view-reload" className="self-start" intent="primary" onClick={() => window.location.reload()}>Reload page</Button>
      </Stack>
    );
  }
}

function makeLazy<M, P extends object>(load: () => Promise<M>, options: { pick: (module: M) => ComponentType<P>; fallback: ReactNode }): (props: P) => ReactElement {
  // The lazy component takes the caller's props as one concrete `props` field:
  // React's lazy typing (`PropsWithRef<P>`) cannot be checked against a
  // generic `P` when they are spread directly.
  const Lazy = lazy(async () => {
    let Loaded: ComponentType<P>;
    try {
      Loaded = options.pick(await load());
    } catch (e) {
      throw new LazyChunkLoadError(e);
    }
    return { default: ({ props }: { props: P }) => <Loaded {...props} /> };
  });
  function LazyComponent(props: P) {
    return <LazyChunkBoundary><Suspense fallback={options.fallback}><Lazy props={props} /></Suspense></LazyChunkBoundary>;
  }
  return LazyComponent;
}

// Returns a plain function component, not `ComponentType<P>`: that union includes class
// components, which a narrower-props `ComponentType` slot (`renderers/view.tsx`) rejects.
export function lazyComponent<M, P extends object>(load: () => Promise<M>, pick: (module: M) => ComponentType<P>): (props: P) => ReactElement {
  return makeLazy(load, { pick, fallback: <StatusMessage>Loading…</StatusMessage> });
}

/**
 * `lazyComponent` for something rendered only once the user opens it (a
 * full-screen overlay): it shows nothing while its chunk loads, rather than a
 * "Loading…" line in the page.
 */
export function lazyOverlay<M, P extends object>(load: () => Promise<M>, pick: (module: M) => ComponentType<P>): (props: P) => ReactElement {
  return makeLazy(load, { pick, fallback: null });
}
