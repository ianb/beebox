import { Badge } from "../ui/Badge";
import { Text } from "../ui/Text";
import type { RouterOutput } from "../../lib/trpc";

export type SearchResult = RouterOutput["search"]["query"]["results"][number];

export function SearchResults({ results, onOpen, activeIndex }: {
  results: SearchResult[];
  onOpen: (result: SearchResult) => void;
  activeIndex?: number;
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
      <div className="flex items-center gap-2"><Text weight="semibold" truncate>{result.title || result.path}</Text><Badge size="sm" tone="info">{result.kind}</Badge></div>
      <Text as="div" size="sm" tone="muted" truncate>{result.path}{result.fragment ? ` · ${result.fragment}` : ""}</Text>
      <Text as="div" size="sm" className="mt-1 line-clamp-2">{result.excerpt}</Text>
    </button>)}
  </div>;
}
