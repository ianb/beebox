import Markdoc from "@markdoc/markdoc";
import * as React from "react";
import { useMemo, type AnchorHTMLAttributes, type ReactNode } from "react";

import { CodeBlock, languageForFence } from "./CodeBlock.js";

function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  if (/^[a-z][a-z\d+.-]*:/iu.test(href)) return /^(?:https?|mailto):/iu.test(href) ? href : undefined;
  return href.startsWith("//") ? undefined : href;
}

function MarkdownLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const safe = safeHref(href);
  return safe ? (
    <a {...props} href={safe}>
      {children}
    </a>
  ) : (
    <span className="cursor-help underline decoration-dotted" title={`Unsupported link: ${href ?? "missing destination"}`}>
      {children}
    </span>
  );
}

/**
 * A fenced block, highlighted by the same component the browser's code view
 * uses — a `.ts` file and a ```ts fence inside a document are the same thing to
 * read, so they are the same thing to look at.
 */
function MarkdownFence({ content, language }: { content?: string | undefined; language?: string | undefined }) {
  return <CodeBlock source={content ?? ""} language={languageForFence(language)} />;
}

export function Markdown({ source }: { source: string }): ReactNode {
  // eslint-disable-next-line import-x/no-named-as-default-member -- Markdoc's Node ESM runtime exposes these only on its default export despite its named-export typings.
  const { parse, renderers, transform } = Markdoc;
  const tree = useMemo(
    () =>
      transform(parse(source), {
        nodes: {
          link: {
            render: "MarkdownLink",
            attributes: { href: { type: String }, title: { type: String } },
          },
          fence: {
            render: "MarkdownFence",
            attributes: { content: { type: String }, language: { type: String } },
          },
        },
      }),
    [parse, source, transform],
  );
  const rendered = renderers.react(tree, React, {
    components: { MarkdownFence, MarkdownLink },
  });
  return <div className="prose prose-sm max-w-none">{rendered}</div>;
}
