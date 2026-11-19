/**
 * The language of a text file, from its extension: a name a person reads on the
 * card's properties face, and the highlight.js grammar that colours it
 * (`components/CodeText`). A file with no entry is plain text.
 */

import { pathExt } from "./binary-files";

/** The highlight.js grammars the code viewer loads (`components/CodeText/highlight.ts`). */
export type Grammar =
  | "bash" | "c" | "cpp" | "css" | "diff" | "go" | "ini" | "java" | "javascript" | "kotlin"
  | "python" | "ruby" | "rust" | "sql" | "swift" | "typescript" | "xml" | "yaml";

export interface CodeLanguage {
  label: string;
  /** `null`: shown uncoloured. */
  grammar: Grammar | null;
}

const LANGUAGES: Readonly<Record<string, CodeLanguage>> = {
  ".ts": { label: "TypeScript", grammar: "typescript" },
  ".tsx": { label: "TypeScript", grammar: "typescript" },
  ".mts": { label: "TypeScript", grammar: "typescript" },
  ".cts": { label: "TypeScript", grammar: "typescript" },
  ".js": { label: "JavaScript", grammar: "javascript" },
  ".jsx": { label: "JavaScript", grammar: "javascript" },
  ".mjs": { label: "JavaScript", grammar: "javascript" },
  ".cjs": { label: "JavaScript", grammar: "javascript" },
  ".py": { label: "Python", grammar: "python" },
  ".sh": { label: "Shell script", grammar: "bash" },
  ".bash": { label: "Shell script", grammar: "bash" },
  ".zsh": { label: "Shell script", grammar: "bash" },
  ".yaml": { label: "YAML", grammar: "yaml" },
  ".yml": { label: "YAML", grammar: "yaml" },
  ".toml": { label: "TOML", grammar: "ini" },
  ".ini": { label: "INI", grammar: "ini" },
  ".cfg": { label: "Config", grammar: "ini" },
  ".css": { label: "CSS", grammar: "css" },
  ".html": { label: "HTML", grammar: "xml" },
  ".htm": { label: "HTML", grammar: "xml" },
  ".xml": { label: "XML", grammar: "xml" },
  ".sql": { label: "SQL", grammar: "sql" },
  ".go": { label: "Go", grammar: "go" },
  ".rs": { label: "Rust", grammar: "rust" },
  ".java": { label: "Java", grammar: "java" },
  ".kt": { label: "Kotlin", grammar: "kotlin" },
  ".swift": { label: "Swift", grammar: "swift" },
  ".rb": { label: "Ruby", grammar: "ruby" },
  ".c": { label: "C", grammar: "c" },
  ".h": { label: "C", grammar: "c" },
  ".cpp": { label: "C++", grammar: "cpp" },
  ".cc": { label: "C++", grammar: "cpp" },
  ".hpp": { label: "C++", grammar: "cpp" },
  ".diff": { label: "Diff", grammar: "diff" },
  ".patch": { label: "Diff", grammar: "diff" },
  ".md": { label: "Markdown", grammar: null },
  ".csv": { label: "CSV", grammar: null },
  ".log": { label: "Log", grammar: null },
};

const PLAIN: CodeLanguage = { label: "Text", grammar: null };

export function languageForPath(path: string): CodeLanguage {
  return LANGUAGES[pathExt(path)] ?? PLAIN;
}
