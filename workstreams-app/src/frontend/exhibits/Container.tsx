import type { ReactNode } from "react";

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

/**
 * The shell every exhibit gets: breadcrumb back to its list, title, and the
 * ask header. A page that overrides the default renderer still renders inside
 * this, so the ask travels with the exhibit rather than with the renderer.
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
      <main className="flex flex-col gap-6">{children}</main>
    </div>
  );
}
