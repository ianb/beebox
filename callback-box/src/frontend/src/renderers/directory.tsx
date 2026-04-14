/**
 * Directory renderer — listing of subdirectories, cards, and other files.
 *
 * Matches any path with no file extension. Fetches via tRPC status.browse.
 * Cards expand inline as accordions via the card renderer registry.
 */

import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { trpc } from "../lib/trpc";
import { href } from "../lib/routing";
import { CardTreeView } from "../components/CardTreeView";
import { getRenderers, registerFileRenderer, type FileData, type RendererProps } from "./index";

function CardAccordion({ cardPath, name, type, status }: { cardPath: string; name: string; type: string; status?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-warm-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-warm-50 transition-colors"
      >
        <span className={`text-warm-400 text-xs transition-transform ${open ? "rotate-90" : ""}`}>&#9654;</span>
        <span className="text-sm font-medium text-warm-800">{name}</span>
        <span className="text-warm-400 text-xs">.{type}.card</span>
        {status ? (
          <span className="text-xs px-1.5 py-0.5 rounded bg-warm-100 text-warm-500">{status}</span>
        ) : null}
      </button>
      {open ? <CardAccordionBody cardPath={cardPath} /> : null}
    </div>
  );
}

function CardAccordionBody({ cardPath }: { cardPath: string }) {
  const { data: card, isLoading, error } = trpc.card.get.useQuery({ path: cardPath });

  if (isLoading) return <div className="px-3 py-2 text-warm-500 text-sm">Loading...</div>;
  if (error || !card) return <div className="px-3 py-2 text-red-500 text-sm">Failed to load card</div>;

  const fileData: FileData = {
    path: card.path,
    tagName: card.tagName,
    element: card.element,
    xml: card.xml,
    version: card.version,
    status: card.status,
  };

  const renderers = getRenderers(cardPath, fileData);
  if (renderers.length > 0) {
    const Renderer = renderers[0].Component;
    return (
      <div className="border-t border-warm-200 px-3 py-2">
        <Renderer data={fileData} onNavigate={() => {}} />
      </div>
    );
  }
  if (card.element) {
    return (
      <div className="border-t border-warm-200 px-3 py-2">
        <CardTreeView element={card.element} path={card.path} version={card.version} />
      </div>
    );
  }
  return (
    <div className="border-t border-warm-200 px-3 py-2">
      <pre className="text-xs whitespace-pre-wrap">{card.xml}</pre>
    </div>
  );
}

function DirectoryRenderer({ data }: RendererProps) {
  const dirPath = data.path.replace(/\/$/, "");
  const { boxSlug } = useParams({ strict: false });
  const { data: browse, isLoading, error } = trpc.status.browse.useQuery({ path: dirPath });

  if (isLoading) return <div className="p-4 text-warm-600">Loading...</div>;
  if (error) return <div className="p-4 text-red-600">Error: {error.message}</div>;
  if (!browse) return <div className="p-4 text-warm-600">Not found: {dirPath || "/"}</div>;

  const isEmpty = browse.dirs.length === 0 && browse.cards.length === 0 && (browse.files ?? []).length === 0;

  return (
    <div className="p-4">
      <div className="text-sm font-mono text-warm-500 mb-2">{dirPath || ""}/</div>
      {isEmpty ? <div className="text-warm-500 text-sm">Empty directory</div> : null}
      {browse.dirs.length > 0 ? (
        <ul className="text-sm space-y-0.5 mb-2">
          {browse.dirs.map((dir) => (
            <li key={dir.name} className="font-mono">
              <Link
                to={href(`/${boxSlug}/browse/${dirPath ? `${dirPath}/${dir.name}` : dir.name}`)}
                className="text-plum hover:text-plum-dark hover:underline"
              >
                <span className="text-warm-400 mr-1">/</span>{dir.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {browse.cards.length > 0 ? (
        <div className="space-y-1 mb-2">
          {browse.cards.map((card) => (
            <CardAccordion
              key={card.relativePath}
              cardPath={card.relativePath}
              name={card.name}
              type={card.type}
              status={card.status}
            />
          ))}
        </div>
      ) : null}
      {(browse.files ?? []).length > 0 ? (
        <ul className="text-sm space-y-0.5">
          {(browse.files ?? []).map((file) => (
            <li key={file.relativePath} className="font-mono">
              <Link
                to={href(`/${boxSlug}/browse/${file.relativePath}`)}
                className="text-plum hover:text-plum-dark hover:underline"
              >
                {file.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

registerFileRenderer(
  (path) => {
    // Directories: no file extension on the last segment, or trailing slash.
    if (path.endsWith("/")) return true;
    const base = path.split("/").pop();
    if (!base) return true; // empty path = box root
    return !base.includes(".");
  },
  { name: "Directory", Component: DirectoryRenderer, priority: 60 },
);
