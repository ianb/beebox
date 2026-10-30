import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { TextField } from "../ui/fields/field";
import { Text } from "../ui/Text";
import { ErrorText } from "../ui/ErrorText";
import { ModalCard } from "../ui/ModalCard";
import { SearchResults, type SearchResult } from "./SearchResults";
import { searchResultTarget } from "./target";
import { trpc } from "../../lib/trpc/client";
import { useWorkspace } from "../chat/workspace/WorkspaceProvider/provider";
import { isComposing } from "../../lib/ime";

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
    if (item) workspace?.open(searchResultTarget(item), { label: item.path });
    else return;
    close();
  };
  const list = results.data?.results ?? [];
  const onInputKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isComposing(event.nativeEvent)) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, Math.max(0, list.length - 1))); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); }
    else if (event.key === "Enter") { void openResult(list[active]); }
  };
  // Escape reaches the dialog's native cancel; the shell's top margin keeps the
  // input still while results grow below it.
  return <ModalCard open labelledBy="quick-search-title" initialFocus='input[type="search"]' onCancel={close} onBackdropClick={close} className="mt-[10vh] max-w-xl">
    <h2 id="quick-search-title" className="sr-only">Quick search</h2>
    <TextField label="Quick search" hideLabel type="search" value={query} onChange={(value) => { setQuery(value); setActive(0); }} onKeyDown={onInputKey} placeholder="Search or go to a path…" />
    {!query ? <Text tone="muted" className="pt-3">Type to search this box. Press Escape to close.</Text> : null}
    {results.isLoading ? <Text tone="muted" className="pt-3">Searching…</Text> : null}
    {results.error ? <ErrorText className="pt-3">Could not search: {results.error.message}</ErrorText> : null}
    {results.data ? <div className="-mx-5 -mb-5 mt-3 max-h-[65vh] overflow-y-auto"><SearchResults results={list} activeIndex={active} query={query} onOpen={(item) => { void openResult(item); }} /></div> : null}
  </ModalCard>;
}
