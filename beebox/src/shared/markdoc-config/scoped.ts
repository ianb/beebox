/**
 * A type's scoped Markdoc tags merged over the core table. Lint and the
 * Markdown widget both build their config here so they cannot disagree.
 */

import type { Config, Schema } from "@markdoc/markdoc";
import { markdocConfig } from "./tags/core.js";

export function withScopedTags(scoped?: Readonly<Record<string, Schema>>): Config {
  if (scoped === undefined || Object.keys(scoped).length === 0) return markdocConfig;
  return { ...markdocConfig, tags: { ...markdocConfig.tags, ...scoped } };
}
