/**
 * Sidebar list for the browse page: directory entries, card rows, and
 * raw-file rows. Appearance-heavy (hover states, selected highlight, row
 * chrome) so it lives in components/ rather than in the page.
 *
 * Compact mode (`docs/plans/card-prominence.md`, Track C) leads with
 * `foldListing`'s `lead` tier, then folds `more` behind a single "N more"
 * disclosure, background items dimmed and last. Raw mode ignores prominence
 * entirely — today's flat listing, unchanged.
 */

import { bbxSource } from "../../../lib/source-tag";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { Accordion } from "../../../components/ui/Accordion";
import { Text } from "../../../components/ui/Text";
import type { RouterOutput } from "../../../lib/trpc";
import { apiRawFileUrl, getApiBase } from "../../../api";
import { attachDirFor } from "@shared/attach-path";
import { areaDisplayLabel } from "@shared/display-path";
import { encodePathForUrl } from "../../../lib/view-url";
import { foldListing, type FoldEntry } from "@shared/browse-fold";
import type { BrowseListingMode } from "../useBrowseListingMode";

type BrowseData = RouterOutput["status"]["browse"];
type BrowseDirData = BrowseData["dirs"][number];
type BrowseCardData = BrowseData["cards"][number];
type BrowseFileData = BrowseData["files"][number];
type Entry = FoldEntry<BrowseCardData, BrowseDirData, BrowseFileData>;

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg", ".ico"]);

function imageDataAttrs(relativePath: string, name: string): Record<string, string> | null {
  const dot = relativePath.lastIndexOf(".");
  if (dot <= 0) return null;
  if (!IMAGE_EXTS.has(relativePath.slice(dot).toLowerCase())) return null;
  return {
    "data-image-src": apiRawFileUrl(getApiBase(), relativePath),
    "data-image-alt": name,
  };
}

function DirRow({
  dir,
  dirPath,
  dimmed,
  showLandmark,
  onNavigate,
}: {
  dir: BrowseDirData;
  dirPath: string;
  dimmed: boolean;
  showLandmark: boolean;
  onNavigate: (path: string) => void;
}) {
  const target = dirPath ? `${dirPath}/${dir.name}` : dir.name;
  const landmark = showLandmark ? dir.landmark : undefined;
  const label = dirPath === "" ? areaDisplayLabel(dir.name) : (landmark?.label ?? dir.name);
  return (
    <button
      {...bbxSource("dir", target)}
      onClick={() => onNavigate(target)}
      aria-label={dir.fileCount > 0 ? `${label} directory, ${dir.fileCount} item${dir.fileCount === 1 ? "" : "s"}` : `${label} directory`}
      className={`w-full text-left px-4 py-2.5 hover:bg-warm-50 transition-colors flex items-center gap-2 border-b border-warm-200 ${dimmed ? "opacity-60" : ""}`}
    >
      <span className="text-primary flex-shrink-0" aria-hidden="true">
        {landmark?.symbol?.glyph ? (
          <Text as="span" size="sm">{landmark.symbol.glyph}</Text>
        ) : (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
        )}
      </span>
      <span className="text-warm-900 font-medium text-sm flex-1">{label}/</span>
      {dir.fileCount > 0 ? <span className="text-xs text-warm-400">{dir.fileCount}</span> : null}
    </button>
  );
}

function CardRow({
  card,
  dimmed,
  selected,
  onNavigate,
}: {
  card: BrowseCardData;
  dimmed: boolean;
  selected: boolean;
  onNavigate: (path: string) => void;
}) {
  // A card with an `.attach/` scope behaves like a directory: the row still
  // opens the card in the detail panel, but a trailing chevron navigates
  // INTO the attach scope (presented as the card itself — the breadcrumb
  // relabels the `.attach` segment to the card name).
  const attachPath = card.hasAttachments ? attachDirFor(card.relativePath) : null;
  return (
    <div className={`flex items-stretch border-b border-warm-200 ${selected ? "bg-info-50" : ""} ${dimmed ? "opacity-60" : ""}`}>
      <button
        onClick={() => onNavigate(card.relativePath)}
        {...bbxSource("card", card.relativePath)}
        {...(card.type === "image" ? {
          "data-image-src": `${getApiBase()}/image/${encodePathForUrl(card.relativePath)}`,
          "data-image-alt": card.name,
        } : {})}
        aria-label={card.name === card.type ? `${card.name} card${card.status ? `, ${card.status}` : ""}` : `${card.name}, ${card.type} card${card.status ? `, ${card.status}` : ""}`}
        className="min-w-0 flex-1 text-left px-4 py-2.5 hover:bg-warm-50 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-medium text-warm-900 text-sm truncate">{card.name}</div>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-xs text-warm-500">{card.type}</span>
            {card.status ? <StatusBadge status={card.status} size="sm" /> : null}
          </div>
        </div>
      </button>
      {attachPath ? (
        <button
          onClick={() => onNavigate(attachPath)}
          aria-label={`Open ${card.name} attachments`}
          title="Open attachments"
          className="flex-shrink-0 flex items-center px-3 text-primary hover:bg-warm-50 transition-colors border-l border-warm-200"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

function FileRow({
  file,
  dimmed,
  selected,
  onNavigate,
  onFileContextMenu,
}: {
  file: BrowseFileData;
  dimmed: boolean;
  selected: boolean;
  onNavigate: (path: string) => void;
  onFileContextMenu: (event: React.MouseEvent<HTMLButtonElement>, path: string) => void;
}) {
  return (
    <button
      onClick={() => onNavigate(file.relativePath)}
      onContextMenu={(event) => onFileContextMenu(event, file.relativePath)}
      {...(imageDataAttrs(file.relativePath, file.name) ?? {})}
      className={`w-full text-left px-4 py-2.5 hover:bg-warm-50 transition-colors border-b border-warm-200 ${selected ? "bg-info-50" : ""} ${dimmed ? "opacity-60" : ""}`}
    >
      <div className="font-medium text-warm-900 text-sm truncate">{file.name}</div>
    </button>
  );
}

function FoldRow({
  entry,
  dirPath,
  selectedFilePath,
  showLandmark,
  onNavigate,
  onFileContextMenu,
}: {
  entry: Entry;
  dirPath: string;
  selectedFilePath: string | null;
  showLandmark: boolean;
  onNavigate: (path: string) => void;
  onFileContextMenu: (event: React.MouseEvent<HTMLButtonElement>, path: string) => void;
}) {
  if (entry.kind === "dir") {
    return <DirRow dir={entry.dir} dirPath={dirPath} dimmed={entry.dimmed} showLandmark={showLandmark} onNavigate={onNavigate} />;
  }
  if (entry.kind === "card") {
    return <CardRow card={entry.card} dimmed={entry.dimmed} selected={selectedFilePath === entry.card.relativePath} onNavigate={onNavigate} />;
  }
  return <FileRow file={entry.file} dimmed={entry.dimmed} selected={selectedFilePath === entry.file.relativePath} onNavigate={onNavigate} onFileContextMenu={onFileContextMenu} />;
}

function entryKey(entry: Entry): string {
  if (entry.kind === "dir") return `dir:${entry.dir.name}`;
  if (entry.kind === "card") return `card:${entry.card.relativePath}`;
  return `file:${entry.file.relativePath}`;
}

interface BrowseSidebarListProps {
  data: BrowseData;
  dirPath: string;
  loading: boolean;
  /**
   * Opens a row — a directory, a card, or a raw file. Every row is a URL, so
   * opening one is a real navigation (and a back-button step), not a
   * selection the URL doesn't know about.
   */
  onNavigate: (path: string) => void;
  selectedFilePath: string | null;
  onFileContextMenu: (event: React.MouseEvent<HTMLButtonElement>, path: string) => void;
  omitCardPath?: string;
  /** Compact (fold behind "N more") or raw (today's full listing). */
  mode: BrowseListingMode;
}

export function BrowseSidebarList({
  data,
  dirPath,
  loading,
  onNavigate,
  selectedFilePath,
  onFileContextMenu,
  omitCardPath,
  mode,
}: BrowseSidebarListProps) {
  if (loading) {
    return <div className="p-4 text-warm-600 text-sm">Loading...</div>;
  }

  const cards = data.cards.filter((card) => card.relativePath !== omitCardPath);
  if (data.dirs.length === 0 && cards.length === 0 && data.files.length === 0) {
    return <div className="p-4 text-warm-600 text-sm text-center">Empty directory</div>;
  }

  const row = (entry: Entry, showLandmark: boolean) => (
    <FoldRow
      key={entryKey(entry)}
      entry={entry}
      dirPath={dirPath}
      selectedFilePath={selectedFilePath}
      showLandmark={showLandmark}
      onNavigate={onNavigate}
      onFileContextMenu={onFileContextMenu}
    />
  );

  if (mode === "raw") {
    return (
      <div>
        {data.dirs.map((dir) => <DirRow key={dir.name} dir={dir} dirPath={dirPath} dimmed={false} showLandmark={false} onNavigate={onNavigate} />)}
        {cards.map((card) => <CardRow key={card.relativePath} card={card} dimmed={false} selected={selectedFilePath === card.relativePath} onNavigate={onNavigate} />)}
        {data.files.map((file) => <FileRow key={file.relativePath} file={file} dimmed={false} selected={selectedFilePath === file.relativePath} onNavigate={onNavigate} onFileContextMenu={onFileContextMenu} />)}
      </div>
    );
  }

  const fold = foldListing<BrowseCardData, BrowseDirData, BrowseFileData>({ background: data.background, cards, dirs: data.dirs, files: data.files });
  return (
    <div>
      {fold.lead.map((entry) => row(entry, true))}
      {fold.folded
        ? (fold.more.length > 0 ? (
          <Accordion title={<Text size="sm" tone="muted">{fold.more.length} more</Text>} className="mx-2 my-1">
            {fold.more.map((entry) => row(entry, false))}
          </Accordion>
        ) : null)
        : fold.more.map((entry) => row(entry, false))}
    </div>
  );
}
