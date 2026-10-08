/**
 * Named regex catalogs for `bin/skill-usage.ts`: recurring human instructions
 * and recurring tool failures. Output is only ever the label and a count, so a
 * transcript's words never reach the report. A turn or error can match several
 * labels; each is counted.
 *
 * The catalogs were seeded from an n-gram and error-signature survey of the
 * transcripts (2026-10). Add a label when a new recurring shape shows up.
 */

export interface Pattern {
  label: string;
  re: RegExp;
}

export const HUMAN_PATTERNS: Pattern[] = [
  { label: "approve: go ahead / do it / sounds good", re: /\b(go ahead|go for it|sounds good|do it|proceed|ship it)\b/i },
  { label: "finish: finish / land / merge to main", re: /\b(finish|land (it|this|that)|merge (it |this )?(in)?to main)\b/i },
  { label: "status: is it on main / deployed / did it land", re: /\b(is (this|it|that) (on main|landed|deployed|live)|did (it|that|you) (land|deploy|merge|commit))\b/i },
  { label: "file an issue", re: /\b(file|make|create|open|write( up)?|add) (an? )?(new )?(issue|bug)s?\b|\bnew issue\b/i },
  { label: "cross-model / Codex review", re: /cross[ -]model|\bcodex\b[^\n!.?]{0,40}\breview|\breview\b[^\n!.?]{0,40}\bcodex\b|second opinion/i },
  { label: "delegate: subagent / parallel / spin off a session", re: /\b(sub-?agents?|delegat\w*|in parallel|spin (it |this )?(off|up)|launch (a |another )?(new )?(session|worktree)|new worktree)\b/i },
  { label: "look in the browser / screenshot / dev URL", re: /\bscreenshots?\b|\bin the browser\b|localhost:3210|\bbrowse\b|\blook at (it|the page)\b/i },
  { label: "tests: run / add tests, doctests", re: /\bdoctests?\b|\brun (the )?tests?\b|\btest (it|this|that)\b|\b(add|write) (a |some )?tests?\b/i },
  { label: "commit", re: /\bcommit\b/i },
  { label: "keep going / continue / resume", re: /\b(keep going|continue|carry on|resume)\b/i },
  { label: "restart / rebuild / reload / refresh", re: /\b(restart|rebuild|reload|refresh|reinstall)\b/i },
  { label: "deploy / production", re: /\b(deploy\w*|prod|production)\b/i },
  { label: "correction: sentence starts with don't / stop / never / no", re: /(^|[\n!.?]\s*)(don't|do not|stop|never|please don't|no[,.])\s/i },
  { label: "investigate: why / look into / figure out / debug", re: /\b(why (is|does|did|isn't|doesn't|didn't)|look into|investigate|figure out|debug)\b/i },
  { label: "plan / planning", re: /\b(plan|planning)\b/i },
  { label: "shorter / simpler / too much text", re: /\b(too (much|long|verbose|wordy)|shorter|more concise|simplif\w*|less (text|verbose))\b/i },
  { label: "issue queue: pick / triage / what next", re: /\b(pick (an? |the next )?issues?|next issue|what('s| should we work on) next|issue queue|triage)\b/i },
  { label: "status: where are we / what happened", re: /\b(what('s| is) the status|where are we|how('s| is) it going|what happened)\b/i },
  { label: "dev router / dev server / Vite", re: /\b(router|dev server|vite)\b/i },
  { label: "remember / from now on", re: /\b(remember (this|that)|from now on|going forward|in the future)\b/i },
  { label: "interrupted the agent", re: /^\[Request interrupted by user/ },
];

export const FAILURE_PATTERNS: Pattern[] = [
  { label: "sleep blocked (use Monitor)", re: /Blocked: (standalone )?sleep/ },
  { label: "command timed out", re: /timed out|etimedout/i },
  { label: "missing file or directory (cwd/path confusion)", re: /No such file or directory|File does not exist/ },
  { label: "Edit: string not found / stale read / ambiguous match", re: /String to replace not found|matches of the string to replace|File has been modified since read|File has not been read yet/ },
  { label: "pre-commit hook failed", re: /\[pre-commit]|husky - pre-commit|pre-commit hook/ },
  { label: "land / finish-preflight refused", re: /\bland: |finish-preflight|refusing to merge/ },
  { label: "git merge conflict", re: /conflict \(|merge conflict|\bconflicted\b/i },
  { label: "worktree isolation guard blocked a command", re: /This session is isolated in the worktree/ },
  { label: "user rejected / permission denied", re: /doesn't want to proceed|tool use was rejected|permission to use [^\n]{0,80} denied|requires approval/i },
  { label: "tool input validation error", re: /InputValidationError/ },
  { label: "git lock / file exists", re: /index\.lock|Unable to create [^\n]{0,200}File exists/ },
  { label: "shell quoting / syntax error", re: /unexpected EOF while looking for matching|syntax error near unexpected token/ },
  { label: "Python traceback", re: /Traceback \(most recent call last\)/ },
  { label: "TypeScript error", re: /error TS\d{4}/ },
  { label: "ESLint errors", re: /\d+ problems? \(\d+ errors?/ },
  { label: "test failures", re: /\bnot ok \d+|# fail [1-9]|\d+ failing\b|tests? failed/i },
  { label: "native module ABI (better-sqlite3 / NODE_MODULE_VERSION)", re: /ERR_DLOPEN_FAILED|NODE_MODULE_VERSION/ },
  { label: "port in use", re: /EADDRINUSE|address already in use/ },
  { label: "git worktree/branch already exists or checked out", re: /fatal: [^\n]{0,200}already exists|is already checked out at|is already used by worktree/ },
  { label: "stale Vite module / dynamic import failed", re: /Failed to fetch dynamically imported module|Outdated Optimize Dep/ },
  { label: "connection refused / bad gateway (router or server down)", re: /ECONNREFUSED|502 Bad Gateway/ },
  { label: "rate or usage limit", re: /rate[ _]limit|usage limit|quota exceeded|too many requests/i },
  { label: "out of memory", re: /heap out of memory|ENOMEM/ },
  { label: "network lookup / fetch failed", re: /fetch failed|ENOTFOUND|getaddrinfo/ },
];

export function matchingLabels(text: string, patterns: Pattern[]): string[] {
  return patterns.filter((p) => p.re.test(text)).map((p) => p.label);
}
