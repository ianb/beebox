/**
 * Sidebar - Shared collapsible sidebar for list/detail pages.
 *
 * On desktop: fixed-width sidebar alongside content.
 * On mobile: full-width list view. When `detailSelected` is true,
 * the sidebar hides and content takes over.
 */

import { useState, type ReactNode } from "react";

interface SidebarProps {
  /** Header title */
  title: string;
  /** Optional subtitle (e.g., item count) */
  subtitle?: string;
  /** Content to render in the scrollable area */
  children: ReactNode;
  /** Width in pixels (default: 320, i.e. w-80) */
  widthPx?: number;
  /** Initially collapsed? */
  defaultCollapsed?: boolean;
  /** Whether a detail item is selected (controls mobile visibility) */
  detailSelected?: boolean;
}

export function Sidebar({
  title,
  subtitle,
  children,
  widthPx = 320,
  defaultCollapsed = false,
  detailSelected = false,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const collapsedWidth = 40;
  const desktopWidth = collapsed ? collapsedWidth : widthPx;

  return (
    <div
      className={`sm:border-r bg-white overflow-hidden flex-col transition-[width] duration-150 ease-in-out print:hidden ${
        detailSelected
          ? "hidden sm:flex sm:flex-shrink-0"
          : "flex flex-1 sm:flex-initial sm:flex-shrink-0"
      }`}
      style={{ "--sidebar-desktop-w": `${desktopWidth}px` } as React.CSSProperties}
    >
      {/* Apply desktop width via inline style scoped to sm+ */}
      <style>{"@media (min-width: 640px) { [style*=\"--sidebar-desktop-w\"] { width: var(--sidebar-desktop-w) !important; } }"}</style>
      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          className="p-2 hover:bg-warm-100 text-warm-600 hover:text-warm-700"
          title={`Show ${title.toLowerCase()}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      ) : (
        <>
          <div className="px-3 py-2 border-b bg-warm-50 flex-shrink-0 flex items-center justify-between">
            <div className="min-w-0">
              <h1 className="text-sm font-medium text-warm-700 truncate">{title}</h1>
              {subtitle ? <div className="text-xs text-warm-500 truncate">{subtitle}</div> : null}
            </div>
            <button
              onClick={() => setCollapsed(true)}
              className="hidden sm:block p-1 hover:bg-warm-200 rounded text-warm-500 hover:text-warm-700 flex-shrink-0"
              title="Collapse sidebar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-auto" tabIndex={0} aria-label={title}>
            {children}
          </div>
        </>
      )}
    </div>
  );
}
