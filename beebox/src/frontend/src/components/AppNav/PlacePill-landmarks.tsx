import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CardSymbolData } from "@shared/card-symbol";
import { MenuItem } from "../ui/dropdown-menu-item";
import { TextField } from "../ui/fields/field";
import { Button } from "../ui/Button";
import { CardMark } from "../ui/CardMark";

/** One landmark row's data — the subset of `chat.byLandmark` this menu reads. */
export interface SwitchLandmark {
  /** Box-relative path of the landmark card — the row's identity (see below). */
  path: string;
  /** Box-relative dir; `""` for the root landmark. */
  dir: string;
  label: string;
  symbol: CardSymbolData | null;
  /** Sessions touched inside the fresh window — rendered as a badge when > 0. */
  freshCount: number;
}

function FreshCount({ count }: { count: number }) {
  if (count === 0) return null;
  return <span className="ml-auto shrink-0 text-xs text-warm-500 tabular-nums">{count}</span>;
}

function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, {
  query,
  setQuery,
  visibleLandmarks,
  onSelectLandmark,
  mobileViewport,
  onCancelSearch,
}: {
  query: string;
  setQuery: (value: string) => void;
  visibleLandmarks: SwitchLandmark[];
  onSelectLandmark: (dir: string) => void;
  mobileViewport: boolean;
  onCancelSearch: () => void;
}) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    const first = document.getElementById("bbx-switch-menu-landmark-first");
    if (first) first.focus();
    else if (visibleLandmarks[0] !== undefined) onSelectLandmark(visibleLandmarks[0].dir);
  }
  if (event.key === "Enter" && visibleLandmarks.length > 0) {
    event.preventDefault();
    const first = document.getElementById("bbx-switch-menu-landmark-first");
    if (first) first.click();
    else if (visibleLandmarks[0] !== undefined) onSelectLandmark(visibleLandmarks[0].dir);
  }
  if (event.key === "Escape") {
    if (query !== "") {
      event.stopPropagation();
      event.preventDefault();
      setQuery("");
    } else if (mobileViewport) {
      event.stopPropagation();
      event.preventDefault();
      onCancelSearch();
    }
  }
}

function useSearchViewport(searchOpen: boolean) {
  const [mobileViewport, setMobileViewport] = useState(false);
  const [visibleViewport, setVisibleViewport] = useState({ top: 0, left: 0, width: 0, height: 0 });
  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px), (max-height: 499px)");
    const updateMobile = () => setMobileViewport(media.matches);
    updateMobile();
    media.addEventListener("change", updateMobile);
    return () => media.removeEventListener("change", updateMobile);
  }, []);
  useEffect(() => {
    if (!searchOpen || !mobileViewport) return;
    const viewport = window.visualViewport;
    const measure = () => setVisibleViewport({
      top: viewport?.offsetTop ?? 0,
      left: viewport?.offsetLeft ?? 0,
      width: viewport?.width ?? window.innerWidth,
      height: viewport?.height ?? window.innerHeight,
    });
    measure();
    window.addEventListener("resize", measure);
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    return () => {
      window.removeEventListener("resize", measure);
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
    };
  }, [searchOpen, mobileViewport]);
  return { mobileViewport, visibleViewport };
}

export function LandmarkList({
  landmarks,
  failed,
  onRetry,
  boxSlug,
  currentDir,
  onSelectLandmark,
  searchOpen,
  onCancelSearch,
}: {
  landmarks: SwitchLandmark[] | null;
  failed: boolean;
  onRetry: () => void;
  boxSlug: string;
  currentDir: string | null;
  onSelectLandmark: (dir: string) => void;
  searchOpen: boolean;
  onCancelSearch: () => void;
}) {
  const [query, setQuery] = useState("");
  const queryRef = useRef("");
  const searchRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLElement>(null);
  const { mobileViewport, visibleViewport } = useSearchViewport(searchOpen);
  const searchable = landmarks !== null && landmarks.length > 20;

  useLayoutEffect(() => {
    if (!searchOpen) {
      queryRef.current = "";
      setQuery("");
      return;
    }
    const overlay = overlayRef.current;
    const stopOutsideClose = (event: MouseEvent) => event.stopPropagation();
    const trapTab = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (queryRef.current !== "") {
          queryRef.current = "";
          setQuery("");
        } else {
          onCancelSearch();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(overlay?.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    overlay?.addEventListener("mousedown", stopOutsideClose);
    overlay?.addEventListener("keydown", trapTab);
    searchRef.current?.focus();
    return () => {
      overlay?.removeEventListener("mousedown", stopOutsideClose);
      overlay?.removeEventListener("keydown", trapTab);
    };
  }, [searchOpen, mobileViewport, onCancelSearch]);

  if (landmarks === null) {
    if (failed) return <MenuItem id="bbx-switch-menu-landmarks-retry" onClick={onRetry} keepOpen danger>Couldn&rsquo;t load this menu — Retry</MenuItem>;
    return <div className="px-3 py-2 text-warm-500">Loading…</div>;
  }

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const updateQuery = (value: string) => {
    queryRef.current = value;
    setQuery(value);
  };
  const visibleLandmarks = !searchable || normalizedQuery === ""
    ? landmarks
    : landmarks.filter((landmark) => `${landmark.label}\n${landmark.dir}`.toLocaleLowerCase().includes(normalizedQuery));

  const searchField = searchable && searchOpen ? (
    <div className="px-3 py-2" role="none">
      <TextField
        id="bbx-switch-menu-landmark-search"
        label="Search landmarks"
        inputRef={searchRef}
        hideLabel
        type="search"
        placeholder="Search landmarks"
        value={query}
        onChange={updateQuery}
        onKeyDown={(event) => handleSearchKeyDown(event, { query, setQuery: updateQuery, visibleLandmarks, onSelectLandmark, mobileViewport, onCancelSearch })}
      />
    </div>
  ) : null;

  const rows = (
    <>
      {visibleLandmarks.map((landmark) => {
        const current = currentDir !== null && landmark.dir === currentDir;
        return (
          <MenuItem key={landmark.path} id={landmark === visibleLandmarks[0] ? "bbx-switch-menu-landmark-first" : undefined}
            onClick={() => onSelectLandmark(landmark.dir)} active={current}>
            <span className="flex items-center gap-2 w-full">
              <CardMark symbol={landmark.symbol} size="sm" boxSlug={boxSlug} fallback="📍" />
              <span className={`min-w-0 truncate${current ? " font-semibold" : ""}`}>{landmark.label}</span>
              {current ? <span className="shrink-0 text-info-dark font-semibold" aria-hidden>✓</span> : null}
              {current ? <span className="sr-only">(current)</span> : null}
              <FreshCount count={landmark.freshCount} />
            </span>
          </MenuItem>
        );
      })}
      {searchable && normalizedQuery !== "" && visibleLandmarks.length === 0
        ? <MenuItem disabled onClick={() => {}}>No landmarks match</MenuItem>
        : null}
    </>
  );

  if (searchable && searchOpen && mobileViewport) {
    return createPortal(
      <section ref={overlayRef} role="dialog" aria-label="Search landmarks" aria-modal="true" className="fixed z-[110] flex flex-col overflow-hidden bg-white text-sm"
        style={{ top: visibleViewport.top, left: visibleViewport.left, width: visibleViewport.width, height: visibleViewport.height }}>
        <header className="flex shrink-0 items-center gap-2 border-b border-warm-200 px-3 py-2">
          <div className="min-w-0 flex-1">{searchField}</div>
          <Button id="bbx-switch-menu-landmark-search-cancel" intent="ghost" size="sm" onClick={onCancelSearch}>Cancel</Button>
        </header>
        <div role="menu" aria-label="Matching landmarks" className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">{rows}</div>
      </section>,
      document.body,
    );
  }

  return <>{searchField}{rows}</>;
}
