/**
 * The markdown link renderer: how a link in a card body or a chat message
 * becomes an anchor, a broken marker, or a pointer at the running interface.
 *
 * Split out of `Markdown.tsx` (which owns the Markdoc pipeline and the component
 * map) because the four link kinds and their failure treatments are a subject of
 * their own — and one of them, `control:`, now renders a stateful component.
 */

import type { ReactNode } from "react";
import { BrokenLink } from "../ui/BrokenLink";
import { ControlPointer } from "./ControlPointer";
import {
  classifyMarkdownHref,
  resolveContentTarget,
  serializeViewUrl,
  type ViewTarget,
} from "../../lib/view-url";
import { withBase } from "../../api-core";
import { isRecord } from "@shared/is-record";
import { imageLinkSrc } from "../../lib/image-link";
import { isPlainLeftClick } from "../../lib/plain-click";
import { useMarkdownRender } from "../../lib/markdown-render";

function viewHref(boxSlug: string | undefined, target: ViewTarget): string {
  return withBase(`/${boxSlug ?? ""}/views/${serializeViewUrl(target)}`);
}

function flattenText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (isRecord(node) && isRecord(node.props) && "children" in node.props) {
    return flattenText(node.props.children);
  }
  return "";
}

/**
 * Render a markdown link. A box file/card is referenced by a plain relative or
 * box-root-absolute path — resolved against the document's `basePath` and handed
 * to the caller's `onNavigate` (which opens it in the surrounding surface).
 * Everything else opens as a normal external link. A retired `view:` link
 * renders as a visibly-broken "legacy link" marker (see `classifyMarkdownHref`).
 * Empty/non-string hrefs render as a plain anchor (defensive against malformed
 * input).
 */
export function Link({ href, title, children }: { href?: string; title?: string; children?: ReactNode }): ReactNode {
  const ctx = useMarkdownRender();
  if (typeof href !== "string" || href === "") {
    // No href to link to (malformed input) — render as inline text, not an
    // `<a>` with no destination, which is unreachable by keyboard/screen
    // reader and fails jsx-a11y/anchor-is-valid.
    return <span title={title}>{children}</span>;
  }
  const classified = classifyMarkdownHref(href);
  switch (classified.kind) {
    case "legacy-view":
      return (
        <BrokenLink title="Legacy view: link — needs migration to a plain path">{children}</BrokenLink>
      );
    case "control":
      // A pointer at app chrome, not at content — so it lives here in the
      // shared link path, not in a chat-only override: the controls it
      // addresses are present wherever the app renders markdown.
      return (
        <ControlPointer
          id={classified.id}
          action={classified.action}
          description={classified.description}
          unknownAction={classified.unknownAction}
        >
          {children}
        </ControlPointer>
      );
    case "relative": {
      const target = resolveContentTarget(ctx.basePath, classified.path);
      if (target === null) {
        // The path climbs out of the box root, so it names no file we can open.
        // Draw the same visibly-broken marker a retired `view:` link gets rather
        // than linking to a clamped-to-root guess (the pre-2026-07-30 behavior).
        return <BrokenLink title={`Link escapes the box root: ${href}`}>{children}</BrokenLink>;
      }
      const resolvedHref = viewHref(ctx.boxSlug, target);
      const label = flattenText(children).trim();
      // A link to an image card shows the image; a link that asks for a
      // particular view (`?view=`) still opens that view.
      const imageSrc = ctx.openImageLink === undefined || target.viewer !== null ? null : imageLinkSrc(ctx.boxSlug ?? "", target.path);
      const openCard = (cardPath: string) => {
        const opened = cardPath === target.path ? target : resolveContentTarget(undefined, cardPath);
        if (opened !== null) ctx.onNavigate(opened, { label: cardPath === target.path && label ? label : cardPath });
      };
      return (
        <a
          className="bbx-theme-link"
          href={resolvedHref}
          title={title}
          data-image-src={imageSrc ?? undefined}
          data-image-alt={imageSrc === null ? undefined : label}
          data-image-card={imageSrc === null ? undefined : target.path}
          onClick={(e) => {
            if (e.defaultPrevented) return;
            if (!isPlainLeftClick(e)) return;
            e.preventDefault();
            if (imageSrc !== null && ctx.openImageLink?.(e.currentTarget, { openCard }) === true) return;
            ctx.onNavigate(target, label ? { label } : undefined);
          }}
        >
          {children}
        </a>
      );
    }
    case "external":
      break;
  }
  const isExternal = href.startsWith("http://") || href.startsWith("https://");
  if (isExternal) {
    return (
      <a className="bbx-theme-link" href={href} title={title} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return <a className="bbx-theme-link" href={href} title={title}>{children}</a>;
}
