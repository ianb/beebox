import { useEffect, useState } from "react";
import { registerFileType, type RendererProps } from "./index";
import { SystemCardBoundary } from "../components/system-cards/SystemCardBoundary";
import { TextField } from "../components/ui/fields";
import { Text } from "../components/ui/Text";
import { Badge } from "../components/ui/Badge";
import { Row } from "../components/ui/Row";
import { SearchResults, type SearchResult } from "../components/search/SearchResults";
import { trpc } from "../lib/trpc";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";

interface SearchState { query: string; paths: string[]; types: string[]; limit: number }
function stateFrom(fieldsInput: Record<string, unknown> | undefined, viewState: RendererProps["viewState"]): SearchState {
  const fields = fieldsInput ?? {};
  const view = viewState ?? {};
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    query: typeof view.query === "string" ? view.query : typeof fields.query === "string" ? fields.query : "",
    paths: Array.isArray(view.paths) ? strings(view.paths) : strings(fields.paths),
    types: Array.isArray(view.types) ? strings(view.types) : strings(fields.types),
    limit: typeof view.limit === "number" ? view.limit : typeof fields.limit === "number" ? fields.limit : 10,
  };
}

function SearchCardBody(props: RendererProps) {
  const fields = props.data.frontmatter;
  const viewState = props.viewState;
  const [state, setState] = useState(() => stateFrom(fields, viewState));
  useEffect(() => setState(stateFrom(fields, viewState)), [fields, viewState]);
  const [term, setTerm] = useState(state.query);
  useEffect(() => { const id = window.setTimeout(() => setTerm(state.query), 180); return () => window.clearTimeout(id); }, [state.query]);
  const result = trpc.search.query.useQuery({ query: term, ...(state.paths.length > 0 ? { pathPrefixes: state.paths } : {}), ...(state.types.length > 0 ? { kinds: state.types } : {}), limit: state.limit, mode: "text" }, { enabled: term.trim().length > 0 });
  const change = (next: Partial<SearchState>) => props.onViewStateChange?.({ ...state, ...next }, "replace");
  const open = (item: SearchResult) => props.onNavigate({ path: item.path, viewer: null, params: {}, viewState: null }, { label: item.path });
  return <div className="mx-auto max-w-3xl p-4">
    <Text as="h1" size="xl" weight="bold" className="mb-4">Search</Text>
    <TextField label="Search this box" type="search" hideLabel value={state.query} onChange={(query) => change({ query })} placeholder="Search cards and markdown…" autoFocus />
    <Row className="mt-2"><Badge tone="neutral">{state.paths.length > 0 ? `paths: ${state.paths.join(", ")}` : "all paths"}</Badge><Badge tone="neutral">{state.types.length > 0 ? `types: ${state.types.join(", ")}` : "all types"}</Badge></Row>
    {result.isLoading ? <Text tone="muted" className="py-6">Searching…</Text> : null}
    {result.error ? <Text tone="danger" className="py-6">Could not search: {result.error.message}</Text> : null}
    {result.data ? <><div className="mt-4"><SearchResults results={result.data.results} onOpen={open} /></div>{result.data.truncated ? <Text size="sm" tone="muted" className="mt-3">Showing {result.data.results.length} of {result.data.total}; narrow the search to see more.</Text> : null}{result.data.warnings.map((warning) => <Text key={warning} size="sm" tone="muted" className="mt-2">{warning}</Text>)}</> : null}
  </div>;
}

function SearchCard(props: RendererProps) {
  return props.data.path === SYSTEM_CARD_PATHS.search
    ? <SystemCardBoundary path={props.data.path} type="search"><SearchCardBody {...props} /></SystemCardBoundary>
    : <SearchCardBody {...props} />;
}
registerFileType({ type: "search" }, { renderer: { name: "Search", Component: SearchCard, priority: 100 } });
