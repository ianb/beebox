import { Component, type ErrorInfo, type ReactNode } from "react";

import { Markdown } from "../../components/Markdown.js";
import type { ExhibitBoot } from "../../../shared/exhibits.js";

interface BoundaryState {
  message: string | null;
}

/**
 * A page that throws must not take the exhibit with it: the shell, the
 * breadcrumb, and the title stay, and the failure is named where the page
 * would have been. Agent-authored pages are the normal case here, so a blank
 * screen would be the normal failure without this.
 */
export class ExhibitErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("exhibit page failed to render", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-red-300 bg-red-50 p-4" role="alert">
        <h2 className="m-0 text-base font-bold text-red-900">This page failed to render</h2>
        <pre className="m-0 overflow-auto whitespace-pre-wrap text-sm text-red-900">{this.state.message}</pre>
        <p className="m-0 text-sm text-red-900">Fix the page and save; the dev server reloads it.</p>
      </div>
    );
  }
}

/**
 * The shell every exhibit gets: breadcrumb back to its list, title, and the
 * manifest's prose rendered as Markdown. A page that overrides the default
 * renderer still renders inside this.
 */
export function ExhibitContainer({ boot, children }: { boot: ExhibitBoot; children: ReactNode }): ReactNode {
  const { prose } = boot.manifest;
  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-3">
        <nav className="text-sm">
          <a className="font-semibold text-blue-800 hover:underline" href={boot.listUrl}>
            ← {boot.listLabel}
          </a>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight">{boot.manifest.title}</h1>
        {prose ? <Markdown source={prose} /> : null}
      </header>
      <main className="flex min-w-0 flex-col gap-6">
        <ExhibitErrorBoundary>{children}</ExhibitErrorBoundary>
      </main>
    </div>
  );
}
