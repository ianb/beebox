import { Badge } from "../ui/Badge";
import { Text } from "../ui/Text";
import type { RouterOutput } from "../../lib/trpc";
import { toDisplayPath } from "@shared/display-path";

function Highlight({ text, query }: { text: string; query?: string }) {
  const needle = query?.trim();
  if (!needle) return text;
  const start = text.toLowerCase().indexOf(needle.toLowerCase());
  if (start === -1) return text;
  return <>{text.slice(0, start)}<mark className="bg-accent-100">{text.slice(start, start + needle.length)}</mark>{text.slice(start + needle.length)}</>;
}

export type SearchResult = RouterOutput["search"]["query"]["results"][number];

export function SearchResults({ results, onOpen, activeIndex, query }: {
  results: SearchResult[];
  onOpen: (result: SearchResult) => void;
  activeIndex?: number;
  query?: string;
}) {
  const selectedIndex = activeIndex ?? -1;
  if (results.length === 0) return <Text tone="muted" className="py-6">No matching cards or markdown files.</Text>;
  return <div className="divide-y divide-warm-200" role="listbox" aria-label="Search results">
    {results.map((result, index) => <button
      key={`${result.path}#${result.fragment}`}
      type="button"
      role="option"
      aria-selected={index === selectedIndex}
      className={`block w-full px-3 py-3 text-left hover:bg-warm-50 ${index === selectedIndex ? "bg-primary-50" : ""}`}
      onClick={() => onOpen(result)}
    >
      <div className="flex items-center gap-2"><Text weight="semibold" truncate>{result.title || toDisplayPath(result.path)}</Text><Badge size="sm" tone="info">{result.kind}</Badge></div>
      <Text as="div" size="sm" tone="muted" truncate>{toDisplayPath(result.path)}{result.fragment ? ` · Section: ${result.fragment}` : " · Card summary"}</Text>
      <Text as="div" size="sm" className="mt-1 line-clamp-2"><Highlight text={result.excerpt} query={query} /></Text>
    </button>)}
  </div>;
}
