/**
 * The "deployed paths" rule: which changed files actually reach the server.
 *
 * The root husky `post-commit`/`post-merge` hooks use it to decide whether a
 * commit on `main` triggers `callback-box/deploy/deploy.sh`, and the merge-time
 * smoke tier (bin/smoke.ts, wired in through bin/finish-preflight-lib.ts) uses
 * it to decide whether a landing is "code-related" and has to boot a real box
 * first. Those two must never disagree: a change that ships is a change the
 * smoke tier owes an answer for.
 *
 * The hooks are bash and cannot import this, so the pattern is stated in both
 * places and `bin/deployed-paths.test.ts` fails if the two texts drift. That
 * beats making the deploy path depend on tsx at commit time.
 */

/**
 * Anchored alternation over repo-relative paths, in POSIX ERE — the exact text
 * `.husky/post-commit` passes to `grep -qE`. Kept as ERE (not a JS-flavoured
 * rewrite) so the drift test can compare the two literally.
 */
export const DEPLOYED_PATHS_PATTERN =
  "^(callback-box|agent-doctest|personal-vibe-check|patches)/|^(package\\.json|pnpm-workspace\\.yaml|\\.npmrc|pnpm-lock\\.yaml)$";

const DEPLOYED_PATHS = new RegExp(DEPLOYED_PATHS_PATTERN);

/** Does this repo-relative path ship to the server? */
export function isDeployedPath(path: string): boolean {
  return DEPLOYED_PATHS.test(path);
}

/** Does any path in this diff ship? Empty diff ships nothing. */
export function touchesDeployedPath(paths: readonly string[]): boolean {
  return paths.some(isDeployedPath);
}
