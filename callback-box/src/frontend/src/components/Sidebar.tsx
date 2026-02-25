/**
 * Sidebar - Shared collapsible sidebar for list/detail pages.
 *
 * Provides the container, header with collapse button, and scrollable content area.
 * The actual list content is passed as children.
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
}

/**
 * Collapsible sidebar with header and scrollable content.
 *
 * Usage:
 * ```tsx
 * <Sidebar title="Commits" subtitle="50 loaded">
 *   <CommitTimeline ... />
 * </Sidebar>
 * ```
 */
export function Sidebar({
  title,
  subtitle,
  children,
  widthPx = 320,
  defaultCollapsed = false,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Collapsed width: just enough for the hamburger button
  const collapsedWidth = 40;

  return (
    <div
      className="border-r bg-white flex-shrink-0 overflow-hidden flex flex-col transition-[width] duration-150 ease-in-out"
      style={{ width: collapsed ? collapsedWidth : widthPx }}
    >
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
              <h2 className="text-sm font-medium text-warm-700 truncate">{title}</h2>
              {subtitle ? <div className="text-xs text-warm-500 truncate">{subtitle}</div> : null}
            </div>
            <button
              onClick={() => setCollapsed(true)}
              className="p-1 hover:bg-warm-200 rounded text-warm-500 hover:text-warm-700 flex-shrink-0"
              title="Collapse sidebar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </>
      )}
    </div>
  );
}
