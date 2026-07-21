/**
 * Shape of `knowledge-audits.yaml` — split out of test-runner.ts to keep that
 * file under the 300-line limit. `loadTests` validates against this schema at
 * the YAML parse boundary instead of casting, so a malformed audits file
 * throws a pointed zod error instead of flowing bad data into the runner.
 */

import { z } from "zod";

export const auditTestSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  expected_level: z.string(),
  watch_for: z.string(),
  correct_contains: z.array(z.string()).optional(),
  correct_contains_any: z.array(z.string()).optional(),
  /** Substrings that must NOT appear in the agent's response. */
  response_not_contains: z.array(z.string()).optional(),
  /**
   * Regexes (case-insensitive) that must NOT match the agent's response —
   * for forbidden shapes a substring can't express (e.g. a bare card
   * filename outside a markdown link target or ref attribute).
   */
  response_not_matches: z.array(z.string()).optional(),
  cards_contain: z.array(z.string()).optional(),
  should_read: z.array(z.string()).optional(),
  should_not_read: z.array(z.string()).optional(),
  bash_contains: z.array(z.string()).optional(),
  style: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  max_turns: z.number().optional(),
  /**
   * Box-relative subdirectory to run the agent from — simulates a landmark
   * session. The SDK's `cwd` becomes `<boxRoot>/<context_dir>` and the box
   * root is added via `additionalDirectories`, mirroring what `ChatSession`
   * does for landmark-bound chats. The directory's own `CLAUDE.md` walk-up is
   * what's being audited.
   */
  context_dir: z.string().optional(),
  /**
   * Files to write before the test (box-relative path → content). Used to
   * stage a `CLAUDE.md` or other fixture inside `context_dir` without
   * checking it into the box. Cleaned up after the test runs.
   */
  fixture: z.record(z.string(), z.string()).optional(),
  /**
   * Run the agent with `CHAT_SYSTEM_PROMPT` instead of the default
   * working-directory prompt. Use for tests that audit chat-mode knowledge
   * (e.g. the `<chat-app>`, `<ack>`, `<callout>` tags) — the agent in a chat
   * session sees these via the chat prompt, so the audit has to load them
   * too.
   */
  chat_mode: z.boolean().optional(),
});
export type AuditTest = z.infer<typeof auditTestSchema>;

export const testSuiteSchema = z.object({ tests: z.array(auditTestSchema) });
export type TestSuite = z.infer<typeof testSuiteSchema>;
