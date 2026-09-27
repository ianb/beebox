/**
 * The promotion rule: health never notifies on its own, except when it blocks
 * something the boxholder asked for. A schedule card with `requested-by:
 * boxholder` that could not run says so once per episode, `loud`. See
 * docs/implemented-plans/notifications.md (Track E, "Promotion").
 *
 * Three triggers, each latched in `alertedFor` as `skipped:<reason>`
 * (`skip.ts` says when each latch clears):
 *  - the tick held the due card back (a missing connector, engine quota):
 *    `noteTickSkip`, which also records `skipped: { reason, since }`;
 *  - the card could run, but a connector it requires is in a failing episode:
 *    `checkRequiredConnectors`;
 *  - a run deferred because the box has no Jev key: `promoteDeferredRun`.
 *
 * A schedule the system set up never promotes: its failure is a health check.
 */

import { undismissedEpisodes } from "../../connectors/activity-episodes.js";
import { describeVerdict } from "../../connectors/activity-verdict.js";
import { errorMessage } from "../../lib/error-guards.js";
import { assertNever } from "../../lib/invariant.js";
import type { ParsedScheduledScript } from "../../schemas/scheduled-script.js";
import { formatRetryAt } from "../agent/engine-unavailability.js";
import type { Target } from "../notification/target.js";
import { notifyBoxholder, type NotifyServices } from "../notify-boxholder.js";
import { OPENROUTER_SECRET_NAME } from "../openrouter.js";
import { DEFER_REASON_TEXT } from "./defer-reason.js";
import { scheduleCardForTask } from "./parked-templates.js";
import type { AlertedFor, SkipCause } from "./skip.js";
import { saveScriptState, type ScriptState } from "./state.js";

/** Connector names served by the box's Google grant (`connectors/requirements.ts`). */
const GOOGLE_CONNECTORS = new Set(["gmail", "calendar", "drive", "google"]);
const GOOGLE_TARGET: Target = { kind: "admin", section: "google-services" };
const RECONNECT_GOOGLE = "Reconnect Google in Admin, in the Google Services section.";

export interface PromotionContext {
  boxRoot: string;
  scriptName: string;
  parsed: ParsedScheduledScript;
  /** The schedule's state, updated and saved in place. */
  state: ScriptState;
  now: Date;
  /** Injected channel services (tests); omitted ones come from the box. */
  services?: NotifyServices | undefined;
}

interface Promotion {
  latch: AlertedFor;
  body: string;
  target: Target;
}

function requested(ctx: PromotionContext): boolean {
  return ctx.parsed.requestedBy === "boxholder";
}

/** Send the one `loud` notice and stamp the latch. A send that throws is logged and left unlatched. */
async function promote(ctx: PromotionContext, promotion: Promotion): Promise<void> {
  const { boxRoot, scriptName, parsed, state, now } = ctx;
  try {
    await notifyBoxholder(boxRoot, {
      intent: {
        title: `Your ${parsed.description ?? scriptName} could not run`,
        body: promotion.body,
        target: promotion.target,
        loudness: "loud",
        tag: `schedule-skipped:${scriptName}`,
        source: scheduleCardForTask(scriptName),
      },
      now,
      services: ctx.services,
    });
  } catch (e) {
    console.error(`[promotion] could not tell the boxholder that ${scriptName} could not run: ${errorMessage(e)}`);
    return;
  }
  state.alertedAt = now.toISOString();
  state.alertedFor = promotion.latch;
  await saveScriptState({ boxRoot, scriptName, state });
}

function list(names: readonly string[]): string {
  return names.join(", ");
}

function skipPromotion(cause: SkipCause): Promotion {
  switch (cause.reason) {
    case "missing-connectors": {
      const google = cause.connectors.some((c) => GOOGLE_CONNECTORS.has(c));
      return {
        latch: "skipped:missing-connectors",
        body: google
          ? // A missing connector cannot tell never-connected from expired; name both.
            `It needs ${list(cause.connectors)}. Google is not connected or its access expired; open Admin › Google Services.`
          : `It needs ${list(cause.connectors)}, which this box does not have set up.`,
        target: google ? GOOGLE_TARGET : { kind: "dashboard" },
      };
    }
    case "engine-quota":
      return {
        latch: "skipped:engine-quota",
        body: `The ${cause.live.provider} engine is out of usage quota until ${formatRetryAt(cause.live.retryAt)}. It runs once the quota resets.`,
        target: { kind: "dashboard" },
      };
    default:
      return assertNever(cause);
  }
}

/**
 * The tick held a due card back. Record the episode (`skipped`, with the tick
 * that began it as `since`); the tick that begins it promotes a requested card.
 * Later ticks in the same episode send nothing.
 */
export async function noteTickSkip(ctx: PromotionContext, cause: SkipCause): Promise<void> {
  const { state } = ctx;
  if (state.skipped?.reason === cause.reason) return;
  state.skipped = { reason: cause.reason, since: ctx.now.toISOString() };
  await saveScriptState({ boxRoot: ctx.boxRoot, scriptName: ctx.scriptName, state });
  const promotion = skipPromotion(cause);
  if (requested(ctx) && state.alertedFor !== promotion.latch) await promote(ctx, promotion);
}

/**
 * The card is about to run, but a connector it requires is in a failing
 * episode, so it runs on stale data. Promote once per episode; when no
 * required connector is failing, clear the latch so the next episode is new.
 * A damaged activity record is reported and changes nothing.
 */
export async function checkRequiredConnectors(ctx: PromotionContext): Promise<void> {
  const required = ctx.parsed.requires?.connectors ?? [];
  if (!requested(ctx) || required.length === 0) return;
  let failing;
  try {
    failing = (await undismissedEpisodes(ctx.boxRoot, ctx.now)).filter(
      ({ connector, verdict }) => required.includes(connector) && verdict.kind === "failing",
    );
  } catch (e) {
    console.warn(`[promotion] could not read connector activity for ${ctx.scriptName}: ${errorMessage(e)}`);
    return;
  }
  const { state } = ctx;
  const latched = state.alertedFor === "skipped:connector-failing";
  if (failing.length === 0) {
    if (latched) {
      state.alertedAt = null;
      state.alertedFor = null;
      await saveScriptState({ boxRoot: ctx.boxRoot, scriptName: ctx.scriptName, state });
    }
    return;
  }
  if (latched) return;
  const google = failing.some(({ connector }) => GOOGLE_CONNECTORS.has(connector));
  const lines = failing.map(({ connector, verdict }) => describeVerdict(connector, verdict) ?? `${connector} is failing.`);
  await promote(ctx, {
    latch: "skipped:connector-failing",
    body: [`It depends on ${list(failing.map((f) => f.connector))}. ${lines.join(" ")}`, ...(google ? [RECONNECT_GOOGLE] : [])].join("\n"),
    target: google ? GOOGLE_TARGET : { kind: "dashboard" },
  });
}

/** The run just recorded deferred because the box has no Jev key: promote a requested card once. */
export async function promoteDeferredRun(ctx: PromotionContext): Promise<void> {
  const { state } = ctx;
  if (!requested(ctx) || state.lastResult !== "deferred" || state.lastDeferReason !== "unconfigured") return;
  if (state.alertedFor === "skipped:unconfigured") return;
  await promote(ctx, {
    latch: "skipped:unconfigured",
    body: `Its judgment step needs Jev, and ${DEFER_REASON_TEXT.unconfigured}. Grant the "${OPENROUTER_SECRET_NAME}" secret to this box.`,
    target: { kind: "dashboard" },
  });
}
