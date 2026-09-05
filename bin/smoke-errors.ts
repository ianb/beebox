/**
 * Every way the smoke tier fails, as a class per failure.
 *
 * `SmokeFailureError` is the base the walk catches on; each subclass composes
 * its own message so a red run names the cause rather than a format string
 * assembled at the throw site. Split out of bin/smoke-probe.ts because there are
 * enough of them to be their own module.
 *
 * See issues/exploration/2026-08-26-merge-time-smoke-tier.md.
 */

/** A step that failed, with enough context to act on without re-running. */
export class SmokeFailureError extends Error {
  /** The page/HTTP evidence, printed under the message. Empty when there is none. */
  readonly detail: string;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = "SmokeFailureError";
    this.detail = detail ?? "";
  }
}

// ── probe verdicts (bin/smoke-probe.ts) ───────────────────────────────────────

/** The box refused to boot, per the router's failed-to-start page. */
export class BoxFailedToStartError extends SmokeFailureError {
  constructor(input: { phase: string; url: string; message: string; stderr: string }) {
    super(
      `the box failed to start (router phase: ${input.phase}) — ${input.url}`,
      [input.message, input.stderr].filter((part) => part !== "").join("\n\n"),
    );
    this.name = "BoxFailedToStartError";
  }
}

/** Our own dev credential was refused. */
export class CredentialRefusedError extends SmokeFailureError {
  constructor(readonly url: string) {
    super(
      `the router refused our credential at ${url}` +
        " — BBX_BROWSE_API_KEY is missing or stale in beebox/.env",
    );
    this.name = "CredentialRefusedError";
  }
}

/** Any status other than the ones this tier knows how to read. */
export class UnexpectedStatusError extends SmokeFailureError {
  constructor(input: { url: string; status: number; body: string }) {
    super(`${input.url} answered ${String(input.status)}, expected 200`, input.body.slice(0, 2000));
    this.name = "UnexpectedStatusError";
  }
}

/** A 200 that vite served — the request never reached the box's Fastify. */
export class NotBackendResponseError extends SmokeFailureError {
  constructor(input: { url: string; body: string }) {
    super(
      `${input.url} answered 200 but not with a health payload — the request did not reach the backend`,
      input.body.slice(0, 2000),
    );
    this.name = "NotBackendResponseError";
  }
}

/** A `ProbeVerdict` member no branch knows about — impossible by typing. */
export class UnhandledProbeVerdictError extends Error {
  constructor(readonly verdict: unknown) {
    super(`unhandled probe verdict: ${JSON.stringify(verdict)}`);
    this.name = "UnhandledProbeVerdictError";
  }
}

// ── snapshot readings (bin/smoke-snapshot.ts) ───────────────────────────────

export class PlaceMenuErroredError extends SmokeFailureError {
  constructor(readonly snapshot: string) {
    super(
      "the place menu opened but could not load its landmarks" +
        " — the menu is showing its error row, not a list",
      snapshot,
    );
    this.name = "PlaceMenuErroredError";
  }
}

export class PlaceMenuCollapsedError extends SmokeFailureError {
  constructor(readonly snapshot: string) {
    super(
      "clicking the place pill did not open the menu (#bbx-nav-place is still collapsed)",
      snapshot,
    );
    this.name = "PlaceMenuCollapsedError";
  }
}

export class PlaceMenuMissingFixedRowsError extends SmokeFailureError {
  constructor(readonly snapshot: string) {
    super("the place menu is missing its fixed rows", snapshot);
    this.name = "PlaceMenuMissingFixedRowsError";
  }
}

export class PlaceMenuNoLandmarksError extends SmokeFailureError {
  constructor(readonly snapshot: string) {
    super(
      "the place menu lists no landmarks — the box has none, or the query returned empty",
      snapshot,
    );
    this.name = "PlaceMenuNoLandmarksError";
  }
}

/**
 * The click on a landmark row changed nothing about the URL.
 *
 * Asserts the consequence, never the click: `bin/browse click` dispatches a
 * mouse event at the element's box centre and reports success whether or not
 * anything happened (issues/closed/bugs/2026-08-21-browse-click-on-a-ref-does-not-dispatch.md).
 */
export class PlaceSwitchDidNotNavigateError extends SmokeFailureError {
  constructor(input: { target: string; url: string; slow: string; snapshot: string }) {
    super(
      `selecting the landmark "${input.target}" did not navigate — the URL is unchanged` +
        ` (${input.url})${input.slow}`,
      input.snapshot,
    );
    this.name = "PlaceSwitchDidNotNavigateError";
  }
}

/**
 * The page moved but the place pill still names the old place — the 2026-08-20
 * bug's exact shape, which a URL check alone passes.
 */
export class PlaceSwitchDidNotTakeError extends SmokeFailureError {
  constructor(input: { target: string; labelAfter: string | null; slow: string; snapshot: string }) {
    super(
      `selected the landmark "${input.target}" and the page moved, but the place pill still names` +
        ` "${input.labelAfter ?? "nothing"}" — the switch did not take${input.slow}`,
      input.snapshot,
    );
    this.name = "PlaceSwitchDidNotTakeError";
  }
}

/**
 * Every landmark the menu lists is the one we are standing in, so the switch
 * cannot be walked. A failure rather than a skip: a gate that quietly tests
 * nothing is the failure mode this whole tier exists against.
 */
export class NoLandmarkToSwitchToError extends SmokeFailureError {
  constructor(input: { current: string | null; snapshot: string }) {
    super(
      "the box offers nowhere to switch to — it lists no landmark other than the one" +
        ` we are already in ("${input.current ?? "unknown"}"), so the switch cannot be walked.` +
        " A box used for smoke needs at least two landmarks.",
      input.snapshot,
    );
    this.name = "NoLandmarkToSwitchToError";
  }
}

export class LandmarkRefUnresolvedError extends SmokeFailureError {
  constructor(input: { name: string; snapshot: string }) {
    super(`could not resolve a ref for the landmark "${input.name}"`, input.snapshot);
    this.name = "LandmarkRefUnresolvedError";
  }
}

// ── the harness (bin/smoke-harness.ts) ──────────────────────────────────────

export class MissingBoxSlugError extends Error {
  constructor() {
    super("--box needs a slug");
    this.name = "MissingBoxSlugError";
  }
}

/** The socket request itself timed out; destroys the request with this cause. */
export class RouterRequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`no answer within ${String(timeoutMs)}ms`);
    this.name = "RouterRequestTimeoutError";
  }
}

export class RouterSocketDownError extends SmokeFailureError {
  constructor(input: { socketPath: string; cause: string }) {
    super(
      `the dev router is not answering on its socket (${input.socketPath})` +
        " — start it with `pnpm dev` in the main checkout (it is shared; do not restart a running one)",
      input.cause,
    );
    this.name = "RouterSocketDownError";
  }
}

export class RouterUnreachableError extends SmokeFailureError {
  constructor(input: { url: string; cause: string }) {
    super(
      `the dev router is not answering at ${input.url}` +
        " — start it with `pnpm dev` in the main checkout (it is shared; do not restart a running one)",
      input.cause,
    );
    this.name = "RouterUnreachableError";
  }
}

export class BudgetExhaustedError extends SmokeFailureError {
  constructor(input: { step: string; budgetSeconds: string }) {
    super(`budget exhausted (${input.budgetSeconds}s) before "${input.step}" could finish`);
    this.name = "BudgetExhaustedError";
  }
}

export class StepOverBudgetError extends SmokeFailureError {
  constructor(input: { step: string; budgetSeconds: string }) {
    super(
      `"${input.step}" did not finish within the remaining budget` +
        ` (${input.budgetSeconds}s total)`,
    );
    this.name = "StepOverBudgetError";
  }
}

export class RouterRefusedStopError extends SmokeFailureError {
  constructor(input: { name: string; status: number; body: string }) {
    super(
      `the router refused to stop ${input.name} (${String(input.status)})`,
      input.body.slice(0, 2000),
    );
    this.name = "RouterRefusedStopError";
  }
}

export class StillFailingAfterRestartError extends SmokeFailureError {
  constructor(input: { message: string; detail: string; coldStartSeconds: string }) {
    super(
      `${input.message} — still, ${input.coldStartSeconds}s after the restart`,
      input.detail,
    );
    this.name = "StillFailingAfterRestartError";
  }
}

export class NoAnswerAfterRestartError extends SmokeFailureError {
  constructor(input: { url: string; coldStartSeconds: string }) {
    super(`${input.url} did not answer within ${input.coldStartSeconds}s of the restart`);
    this.name = "NoAnswerAfterRestartError";
  }
}

// ── walk steps (bin/smoke.ts) ───────────────────────────────────────────────

export class StaleGenerationError extends SmokeFailureError {
  constructor(input: { before: number | null; now: number | null }) {
    super(
      "the box served, but the router still reports the generation this run replaced" +
        " — it is running older source than the code under test",
      `generation before: ${String(input.before)}, now: ${String(input.now)}`,
    );
    this.name = "StaleGenerationError";
  }
}

export class ChatShellMissingError extends SmokeFailureError {
  constructor(readonly snapshot: string) {
    super("the chat page loaded but rendered neither its composer nor its app bar", snapshot);
    this.name = "ChatShellMissingError";
  }
}

export class BrowseListEmptyError extends SmokeFailureError {
  constructor(readonly snapshot: string) {
    super(
      "the browse page rendered no directories — the box's content did not reach the browser",
      snapshot,
    );
    this.name = "BrowseListEmptyError";
  }
}

export class NoCardToOpenError extends SmokeFailureError {
  constructor(readonly listing: string) {
    super("the browse listing offered no card to open", listing);
    this.name = "NoCardToOpenError";
  }
}

export class CardRefUnresolvedError extends SmokeFailureError {
  constructor(input: { role: string; name: string; listing: string }) {
    super(`could not resolve a ref for ${input.role} "${input.name}"`, input.listing);
    this.name = "CardRefUnresolvedError";
  }
}

export class CardViewMissingError extends SmokeFailureError {
  constructor(input: { name: string; url: string; snapshot: string }) {
    super(
      `opening the card "${input.name}" did not render a card view (at ${input.url})`,
      input.snapshot,
    );
    this.name = "CardViewMissingError";
  }
}

export class CardContentMissingError extends SmokeFailureError {
  constructor(input: { name: string; snapshot: string }) {
    super(
      `the card view for "${input.name}" mounted but rendered no card — its content did not load`,
      input.snapshot,
    );
    this.name = "CardContentMissingError";
  }
}

export class PageErrorsRaisedError extends SmokeFailureError {
  constructor(readonly errors: string) {
    super("the page raised uncaught errors during the walk", errors);
    this.name = "PageErrorsRaisedError";
  }
}
