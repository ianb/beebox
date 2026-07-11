/**
 * Typed environment-variable boundary (Track D.8).
 *
 * The codebase reads `process.env` ad hoc in ~30 files with no startup
 * validation, so a malformed value (a non-numeric `PORT`, a typo'd URL)
 * surfaces as a confusing downstream failure instead of a loud one at boot.
 * This module is the one place env vars get validated into typed data, at
 * process start, with ALL failures reported at once and secret VALUES never
 * echoed into an error or a log line.
 *
 * ## Shape (per the Track D.8 research decision)
 *
 * - Hand-rolled zod, no env library (t3-env/envalid/znv each bring a second
 *   validation vocabulary and/or unconfirmed secret redaction; the ~20 lines
 *   we actually need — all-errors reporting + name-driven redaction — are
 *   below).
 * - `loadEnv(schema, source)` is a FUNCTION, not a top-level parsed constant:
 *   a test constructs its own `source` and calls it directly, with no
 *   module-cache reset dance.
 * - Per-entrypoint schemas via `baseEnvSchema.extend(...)`: {@link cliEnvSchema}
 *   (every `cb` invocation), {@link serverEnvSchema} (`cb serve` /
 *   `server-main`), {@link hubEnvSchema} (`cb hub`). Each entrypoint calls
 *   `loadEnv` as its first substantive step so a bad value fails at boot.
 *
 * ## What migrates now vs later
 *
 * Secrets and networking vars are modeled here so they're validated at
 * startup and covered by redaction ({@link SECRET_ENV_NAMES}). The long-tail
 * feature-gate/harness vars (`CB_STRICT_FETCH`, `CB_PUSH_FAKE`, `GEMINI_KEY`,
 * scenario stubs, …) keep their direct reads for now, each marked with a
 * `// TODO(env-migration)` comment at the read site. A handful of secret
 * read sites (`webapp/auth.ts`'s session/hub/diag secrets, `core/send-push.ts`'s
 * VAPID keys) also keep their lazy reads — they carry caching / file-fallback
 * semantics that don't belong in a schema — but their NAMES are in the schema
 * and the redaction set, so a malformed value is caught and redacted at boot.
 *
 * Note on the bundler: `scripts/build-cli.mjs` bundles with esbuild but uses
 * NO `define` on `process.env`, and nothing in the tree does
 * `import process from "node:process"`, so the esbuild#2671 define-replacement
 * gotcha does not apply — reads stay live at runtime. Centralizing is safe.
 */

import { z } from "zod";

/**
 * Env var names whose VALUES must never appear in an error message or log
 * line. The error formatter redacts any of these; the set is also the
 * authoritative list of which vars are secrets for anything else that needs
 * to know (e.g. a future logging scrubber).
 */
export const SECRET_ENV_NAMES: ReadonlySet<string> = new Set([
  "CB_SESSION_SECRET",
  "CB_HUB_SECRET",
  "CB_DIAG_API_KEY",
  "CB_VAPID_PUBLIC_KEY",
  "CB_VAPID_PRIVATE_KEY",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  // Transcription / vision provider keys (validated when present, redacted).
  "THINKING_OPENAI_API_KEY",
  "CALLBACK_MISTRAL_API_KEY",
  "CALLBACK_OPENAI_API_KEY",
  "GEMINI_KEY",
  "SKE_GEMINI_API_KEY",
  "CALLBACK_DEEPGRAM_API_KEY",
]);

/** Thrown by {@link loadEnv} when one or more env vars fail validation. */
export class EnvValidationError extends Error {
  /** One human line per failing var, secrets already redacted. */
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `Invalid environment (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
    this.name = "EnvValidationError";
    this.problems = problems;
  }
}

/**
 * Coerce an optional integer env var (e.g. `PORT`). Empty string and unset
 * both mean "not provided" (matching the dominant `process.env.X ? … : …`
 * convention); a present-but-non-integer value is a loud failure.
 */
const optionalPort = z.coerce.number().int().positive().optional();

/** An optional URL-shaped string (validated as parseable when present). */
const optionalUrl = z.string().url().optional();

/** An optional non-empty string. */
const optionalString = z.string().min(1).optional();

/**
 * Vars every entrypoint may see. Kept deliberately small — only what's read
 * across CLI, server, and hub alike.
 *
 * Deliberately permissive (codex review finding): the CLI schema runs on
 * EVERY `cb` invocation, including in shells exporting ambient values the
 * command never acts on. `NODE_ENV` is a plain string because the runtime
 * only ever compares it against `"production"` — an ambient `staging` must
 * not crash `cb status`. The public-URL pair are plain strings here because
 * every CLI read path already tolerates unparseable values (`script-env.ts`
 * warns and treats them as absent). The server/hub schemas override them
 * with strict URL validation — there a malformed value is a boot-stopping
 * misconfig an operator should see immediately.
 */
export const baseEnvSchema = z.object({
  NODE_ENV: optionalString,
  // Public base URL cascade (see lib/public-url.ts). Both are optional; the
  // resolver picks CB_PUBLIC_URL over PUBLIC_URL over a caller fallback.
  CB_PUBLIC_URL: optionalString,
  PUBLIC_URL: optionalString,
});

/**
 * Server entrypoint (`cb serve` / `server-main.ts`): networking + the box's
 * own auth/push/connector secrets. Every secret is optional — a box may run
 * with auth disabled, push unconfigured, etc. — so the schema validates SHAPE
 * (and redacts values), it does not force any secret to be present.
 */
export const serverEnvSchema = baseEnvSchema.extend({
  CB_PUBLIC_URL: optionalUrl,
  PUBLIC_URL: optionalUrl,
  PORT: optionalPort,
  HOST: optionalString,
  CB_SESSION_SECRET: optionalString,
  CB_HUB_SECRET: optionalString,
  CB_DIAG_API_KEY: optionalString,
  CB_OWNER_EMAIL: z.string().email().optional(),
  GOOGLE_OAUTH_CLIENT_ID: optionalString,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalString,
  CB_VAPID_PUBLIC_KEY: optionalString,
  CB_VAPID_PRIVATE_KEY: optionalString,
  CB_VAPID_SUBJECT: optionalString,
});

/**
 * Hub entrypoint (`cb hub`): the hub holds the session secret (no box may) and
 * mints its own per-boot `CB_HUB_SECRET`. Networking mirrors the server.
 */
export const hubEnvSchema = baseEnvSchema.extend({
  CB_PUBLIC_URL: optionalUrl,
  PUBLIC_URL: optionalUrl,
  PORT: optionalPort,
  HOST: optionalString,
  CB_SESSION_SECRET: optionalString,
  CB_OWNER_EMAIL: z.string().email().optional(),
  GOOGLE_OAUTH_CLIENT_ID: optionalString,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalString,
});

/**
 * CLI entrypoint (every `cb` invocation): the base plus the networking vars a
 * generic command might honor. Intentionally permissive — the CLI is also how
 * `cb serve`/`cb hub` launch, and how tests/scenarios invoke commands, so this
 * only rejects genuinely malformed values (never absence).
 */
export const cliEnvSchema = baseEnvSchema.extend({
  PORT: optionalPort,
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type HubEnv = z.infer<typeof hubEnvSchema>;
export type CliEnv = z.infer<typeof cliEnvSchema>;

/**
 * The raw value a failing var held, redacted if the var is a secret. Used
 * only to build the error message — never returned to a caller.
 */
function valueHint(name: string, source: NodeJS.ProcessEnv): string {
  const raw = source[name];
  if (raw === undefined) return "";
  if (SECRET_ENV_NAMES.has(name)) return " (received: <redacted>)";
  return ` (received: ${JSON.stringify(raw)})`;
}

/**
 * Validate `source` (default `process.env`) against `schema`, returning the
 * typed, parsed env. On failure throws {@link EnvValidationError} reporting
 * EVERY failing var at once, with secret values redacted.
 *
 * Empty-string env values are normalized to "unset" before validation, so an
 * exported-but-empty var (common in shell/systemd) reads the same as an unset
 * one — matching the codebase's dominant `process.env.X ? … : …` reads.
 */
export function loadEnv<T extends z.ZodType>(schema: T, source?: NodeJS.ProcessEnv): z.infer<T> {
  const src = source ?? process.env;
  // Only pass keys the schema knows about, with "" treated as absent. This
  // keeps the parsed object narrow (no stray process.env keys) and honors the
  // empty-string-as-unset convention.
  const known = schema instanceof z.ZodObject ? Object.keys(schema.shape) : Object.keys(src);
  const cleaned: Record<string, string> = {};
  for (const key of known) {
    const raw = src[key];
    if (raw !== undefined && raw !== "") cleaned[key] = raw;
  }

  const result = schema.safeParse(cleaned);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const name = typeof issue.path[0] === "string" ? issue.path[0] : String(issue.path[0] ?? "?");
    // Fail-safe: for a secret, don't trust even zod's own message text (some
    // issue kinds embed the received input) — emit a fixed redacted line.
    if (SECRET_ENV_NAMES.has(name)) return `${name}: invalid value (received: <redacted>)`;
    return `${name}: ${issue.message}${valueHint(name, src)}`;
  });
  throw new EnvValidationError(problems);
}
