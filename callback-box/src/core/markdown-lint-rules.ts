/**
 * Custom markdownlint rules for callback boxes.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Rule, RuleOnError } from "markdownlint";

// Matches [view:...] used as a reference link label (not as a URL in parentheses).
// The invalid form agents write: [view:path/to/file]
// The correct form:             [label](view:path/to/file)
const VIEW_LABEL_RE = /\[view:[^\]]*](?!\()/g;

// Matches inline links: [text](url) — captures the url part.
const INLINE_LINK_RE = /\[[^\]]*]\(([^)]+)\)/g;

export const noViewLabelLinks: Rule = {
  names: ["CB001", "no-view-label-links"],
  description: "view: belongs in the URL, not the link label — use [label](view:path) not [view:path]",
  tags: ["links"],
  parser: "none",
  function: (params: Parameters<Rule["function"]>[0], onError: RuleOnError): void => {
    for (let i = 0; i < params.lines.length; i++) {
      const line = params.lines[i]!;
      VIEW_LABEL_RE.lastIndex = 0;
      let match = VIEW_LABEL_RE.exec(line);
      while (match !== null) {
        onError({
          lineNumber: i + 1,
          detail: `Use [label](view:path) instead of ${match[0]}`,
          range: [match.index + 1, match[0].length],
        });
        match = VIEW_LABEL_RE.exec(line);
      }
    }
  },
};

export const noBrokenInternalLinks: Rule = {
  names: ["CB002", "no-broken-internal-links"],
  description: "Relative links must point to existing files",
  tags: ["links"],
  parser: "none",
  asynchronous: true,
  function: async (params: Parameters<Rule["function"]>[0], onError: RuleOnError): Promise<void> => {
    const fileDir = path.dirname(params.name);

    for (let i = 0; i < params.lines.length; i++) {
      const line = params.lines[i]!;
      INLINE_LINK_RE.lastIndex = 0;
      let match = INLINE_LINK_RE.exec(line);
      while (match !== null) {
        const url = match[1]!.trim();
        if (isRelativePath(url)) {
          const filePath = path.resolve(fileDir, url.split("#")[0]!);
          const exists = await fileExists(filePath);
          if (!exists) {
            onError({
              lineNumber: i + 1,
              detail: `Broken link: ${url}`,
              range: [match.index + 1, match[0].length],
            });
          }
        }
        match = INLINE_LINK_RE.exec(line);
      }
    }
  },
};

function isRelativePath(url: string): boolean {
  if (url.startsWith("#")) return false;
  if (/^[A-Za-z][\d+.A-Za-z-]*:/.test(url)) return false; // any scheme (http, view, mailto, etc.)
  return true;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
