/**
 * ExtfileView — renderer for `extfile` cards (an in-box pointer to a live
 * external file).
 *
 * The card is a pointer, not a document: the live file is fetched on each render
 * via the dev-only `/api/external` route and shown through the registry renderer
 * for its type (text/source/markdown only — see the binary note below).
 * A **drift badge** appears when the file's current hash differs from the card's
 * stamped `version` (the cue to run `bbx extfile sync`). Commentary about the file
 * lives in the card's `.attach/` scope and is surfaced inline; bare `{% source %}`
 * anchors jump to their span in the rendered file pane.
 */

import { useCallback, useRef } from "react";
import { Text } from "./ui/Text";
import { FriendlyDate } from "./ui/FriendlyDate";
import { type RendererProps } from "../renderers";
import { type NavigateHint, type ViewTarget } from "../lib/view-url";
import { findQuoteRange, highlightRange, scrollRangeIntoView } from "../lib/selection/quote-anchor";
import { isBinaryPath } from "../lib/binary-files";
import { ExternalDocument, useExternalTarget } from "./ExternalDocument";
import { AttachedCommentary, type JumpToQuote } from "./AttachedCommentary";

/** The `sha256:<hex>` value from a version-markers string, or null. */
function sha256Of(markers: string): string | null {
  const match = /sha256:([\da-f]+)/.exec(markers);
  return match?.[1] ?? null;
}

/** The live file pane: fetch, drift badge, and registry-rendered content. */
function ExtfileLiveFile({
  href,
  storedVersion,
  onNavigate,
}: {
  href: string;
  storedVersion: string | null;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
}) {
  const { data, isLoading, error } = useExternalTarget(href);
  const filePath = decodeURIComponent(new URL(href).pathname);
  const binary = isBinaryPath(filePath);

  // Drift: the stamped version's hash vs the live file's current hash. Only
  // meaningful once both are known and the card has been stamped.
  const liveHash = data !== undefined ? sha256Of(data.markers) : null;
  const storedHash = storedVersion === null ? null : sha256Of(storedVersion);
  const stale = storedHash !== null && liveHash !== null && storedHash !== liveHash;

  return (
    <div>
      {stale ? (
        <Text as="div" size="sm" tone="danger" className="mb-2 rounded-md border border-danger-dark/30 bg-danger-light/40 px-3 py-1.5">
          ⚠ Stale — the file changed since the card was last stamped. Run{" "}
          <code className="font-mono">bbx extfile sync</code> to refresh.
        </Text>
      ) : null}
      {isLoading ? (
        <Text as="div" tone="subtle" className="p-2 italic">Loading file…</Text>
      ) : error !== null ? (
        <Text as="div" tone="danger" className="p-2">
          Couldn’t load the file. It may be missing, outside the allowed roots, or
          external rendering may be disabled (it is available in dev only).
        </Text>
      ) : binary ? (
        <Text as="div" tone="subtle" className="p-2 italic">
          Preview unavailable for this file type — the pointer’s metadata and any
          commentary still apply.
        </Text>
      ) : data !== undefined ? (
        <ExternalDocument href={href} envelope={data} onNavigate={onNavigate} />
      ) : null}
    </div>
  );
}

export function ExtfileView({ data, onNavigate }: RendererProps) {
  const frontmatter = data.frontmatter ?? {};
  const title = frontmatter["title"];
  const href = typeof frontmatter["href"] === "string" && frontmatter["href"] !== "" ? frontmatter["href"] : null;
  const storedVersion = typeof frontmatter["version"] === "string" ? frontmatter["version"] : null;
  const mtime = typeof frontmatter["mtime"] === "string" ? frontmatter["mtime"] : null;

  // A source chip jumps to its verbatim span in the rendered file pane.
  const fileBodyRef = useRef<HTMLDivElement>(null);
  const onJumpToQuote = useCallback<JumpToQuote>((quoteText) => {
    const exact = quoteText.trim();
    if (exact === "") return Promise.resolve(false);
    const root = fileBodyRef.current;
    if (root !== null) {
      const range = findQuoteRange(root, exact);
      if (range !== null) {
        highlightRange(range);
        scrollRangeIntoView(range);
        return Promise.resolve(true);
      }
    }
    return Promise.resolve(false);
  }, []);

  return (
    <div className="p-4">
      {typeof title === "string" && title !== "" ? (
        <Text as="h1" size="lg" weight="semibold" className="mb-1">{title}</Text>
      ) : null}

      <Text as="div" size="sm" tone="subtle" className="mb-3">
        {href !== null ? <span className="font-mono break-all">{href}</span> : "No file linked"}
        {mtime !== null ? <> · stamped <FriendlyDate iso={mtime} /></> : null}
      </Text>

      {href !== null ? (
        <AttachedCommentary cardPath={data.path} onNavigate={onNavigate} onJumpToQuote={onJumpToQuote} />
      ) : null}

      {href !== null ? (
        <div className="min-w-0" data-card-section="body" ref={fileBodyRef}>
          <ExtfileLiveFile href={href} storedVersion={storedVersion} onNavigate={onNavigate} />
        </div>
      ) : (
        <Text as="div" tone="danger">This extfile card has no <code className="font-mono">href</code>.</Text>
      )}
    </div>
  );
}
