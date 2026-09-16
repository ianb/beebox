import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { TextField } from "../ui/fields";
import { Text } from "../ui/Text";
import { SearchResults, type SearchResult } from "./SearchResults";
import { trpc } from "../../lib/trpc";
import { useWorkspace } from "../chat/workspace/WorkspaceProvider";

export function QuickSearchOverlay() {
  const workspace = useWorkspace();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = trpc.search.query.useQuery({ query, limit: 8, mode: "text" }, { enabled: open && query.trim().length > 0 });
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const shortcut = event.key.toLowerCase() === "k" && (navigator.platform.includes("Mac") ? event.metaKey : event.ctrlKey);
      if (!shortcut || (navigator.platform.includes("Mac") && event.ctrlKey && !event.metaKey)) return;
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA"].includes(event.target.tagName))) return;
      event.preventDefault(); setOpen(true); setQuery(""); setActive(0);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  if (!open) return null;
  const close = () => { setOpen(false); setQuery(""); };
  const openResult = async (item?: SearchResult) => {
    if (query.includes("/") || query.endsWith(".card")) {
      const kind = await utils.files.kind.fetch({ path: query }).catch(() => null);
      if (kind?.kind === "file" || kind?.kind === "directory") {
        workspace?.open({ path: query, viewer: null, params: {}, viewState: null }, { label: query }); close(); return;
      }
    }
    if (item) workspace?.open({ path: item.path, viewer: null, params: {}, viewState: null }, { label: item.path });
    else return;
    close();
  };
  const list = results.data?.results ?? [];
  const onInputKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") close();
    else if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, Math.max(0, list.length - 1))); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); }
    else if (event.key === "Enter") { void openResult(list[active]); }
  };
  return <div className="fixed inset-0 z-50 bg-warm-900/30 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="mx-auto mt-[10vh] max-w-xl rounded-lg border border-warm-200 bg-white shadow-xl" role="dialog" aria-modal="true" aria-label="Quick search">
      <div className="p-3"><TextField label="Quick search" hideLabel type="search" value={query} onChange={(value) => { setQuery(value); setActive(0); }} onKeyDown={onInputKey} placeholder="Search or go to a path…" autoFocus /></div>
      {!query ? <Text tone="muted" className="px-3 pb-4">Type to search this box. Press Escape to close.</Text> : null}
      {results.isLoading ? <Text tone="muted" className="px-3 pb-4">Searching…</Text> : null}
      {results.error ? <Text tone="danger" className="px-3 pb-4">Could not search: {results.error.message}</Text> : null}
      {results.data ? <SearchResults results={list} activeIndex={active} onOpen={(item) => { void openResult(item); }} /> : null}
    </div>
  </div>;
}
