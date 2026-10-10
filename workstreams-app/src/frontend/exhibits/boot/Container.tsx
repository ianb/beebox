import { Component, useState, type ErrorInfo, type ReactNode } from "react";

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

/** The dashboard's workstream list, where a row's Resume button lives. */
export const DASHBOARD_WORKSTREAMS_URL = "http://localhost:3210/main/workstreams/streams";

type ReplyState = { kind: "idle" } | { kind: "working" } | { kind: "done" } | { kind: "refused"; detail: string };

/** The server's 409 body is `{ message, detail }`; anything else reads as a generic failure. */
async function refusalDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "detail" in body && typeof body.detail === "string" && body.detail !== "") {
      return body.detail;
    }
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  } catch (_error) {
    // Not JSON: fall through to the status line.
  }
  return `The exhibits server answered HTTP ${String(response.status)}.`;
}

/**
 * Brings the workstream's terminal tab to the front, so a reaction is typed
 * where the agent is listening. When no live session exists the reason is
 * shown here, with the way to the dashboard where Resume lives.
 */
export function ReplyInSessionButton({ scope }: { scope: string }): ReactNode {
  const [state, setState] = useState<ReplyState>({ kind: "idle" });
  const focus = async (): Promise<void> => {
    setState({ kind: "working" });
    try {
      const response = await fetch(`/api/${scope}/focus`, { method: "POST" });
      setState(response.ok ? { kind: "done" } : { kind: "refused", detail: await refusalDetail(response) });
    } catch (error) {
      setState({ kind: "refused", detail: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <button
          className="rounded-md border border-stone-400 bg-white px-3 py-1.5 text-sm font-semibold text-stone-800 hover:bg-stone-100 disabled:opacity-60"
          disabled={state.kind === "working"}
          onClick={() => void focus()}
          type="button"
        >
          Reply in the session
        </button>
        {state.kind === "done" ? <span className="ml-3 text-sm text-stone-600">Terminal tab brought forward.</span> : null}
      </div>
      {state.kind === "refused" ? (
        <p className="m-0 text-sm text-red-900" role="alert">
          {state.detail}{" "}
          <a className="font-semibold text-blue-800 hover:underline" href={DASHBOARD_WORKSTREAMS_URL}>
            Open the workstream list
          </a>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The shell every exhibit gets: breadcrumb back to its list, title, and the
 * manifest's prose rendered as Markdown, and — for store exhibits — the Reply
 * in the session button. A page that overrides the default
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
        {boot.scope.startsWith("apps/") ? null : <ReplyInSessionButton scope={boot.scope} />}
      </header>
      <main className="flex min-w-0 flex-col gap-6">
        <ExhibitErrorBoundary>{children}</ExhibitErrorBoundary>
      </main>
    </div>
  );
}
