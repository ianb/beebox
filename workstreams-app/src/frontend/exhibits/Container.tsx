import { Component, type ErrorInfo, type ReactNode } from "react";

import { DispositionForm } from "./DispositionForm.js";
import { askTypeLabels, type AskType, type ExhibitBoot } from "../../shared/exhibits.js";

const askBadgeClasses: Record<AskType, string> = {
  decide: "bg-blue-100 text-blue-800",
  confirm: "bg-amber-100 text-amber-800",
  react: "bg-violet-100 text-violet-800",
  fyi: "bg-stone-200 text-stone-700",
};

export function AskBadge({ type }: { type: AskType }): ReactNode {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${askBadgeClasses[type]}`}>
      {askTypeLabels[type]}
    </span>
  );
}

interface BoundaryState {
  message: string | null;
}

/**
 * A page that throws must not take the exhibit with it: the shell, the
 * breadcrumb, and the ask header stay, and the failure is named where the page
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
 * The shell every exhibit gets: breadcrumb back to its list, title, the ask
 * header, and — below whatever the page rendered — the control that answers the
 * ask. A page that overrides the default renderer still renders inside this, so
 * both halves of the ask (the question and the answer) travel with the exhibit
 * rather than with the renderer: an instrument is answerable without writing a
 * line of form code.
 */
export function ExhibitContainer({ boot, children }: { boot: ExhibitBoot; children: ReactNode }): ReactNode {
  const { ask } = boot.manifest;
  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-3">
        <nav className="text-sm">
          <a className="font-semibold text-blue-800 hover:underline" href={boot.listUrl}>
            ← {boot.listLabel}
          </a>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight">{boot.manifest.title}</h1>
        {ask ? (
          <div className="flex flex-col gap-2 rounded-lg border border-stone-300 bg-white p-4">
            <div className="flex items-center gap-2">
              <AskBadge type={ask.type} />
              <span className="text-xs text-stone-500">{boot.scope}</span>
            </div>
            <p className="m-0 text-stone-800">{ask.prose}</p>
          </div>
        ) : (
          <p className="m-0 text-sm text-stone-500">Committed app — {boot.scope}</p>
        )}
      </header>
      <main className="flex min-w-0 flex-col gap-6">
        <ExhibitErrorBoundary>{children}</ExhibitErrorBoundary>
        {ask ? (
          <section className="flex flex-col gap-3 rounded-lg border border-dashed border-stone-400 p-4">
            <h2 className="m-0 text-base font-bold">Your answer</h2>
            <DispositionForm ask={ask} />
          </section>
        ) : null}
      </main>
    </div>
  );
}
